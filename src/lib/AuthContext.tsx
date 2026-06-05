import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import {
  User, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile, updatePassword,
  sendPasswordResetEmail
} from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore'
import { auth, db } from './firebase'
import * as perm from './permissions'

// Re-Exports für Abwärtskompatibilität — die Typen lebten ursprünglich
// hier. Pure-Logik ist nach src/lib/permissions.ts ausgelagert (testbar
// ohne React/Firebase).
export type UserRole         = perm.UserRole
export type UserStatus       = perm.UserStatus
export type UserPermissions  = perm.UserPermissions

export interface ArbeitszeitTag { von: string; bis: string }
export type Arbeitszeit = Partial<Record<'mo' | 'di' | 'mi' | 'do' | 'fr' | 'sa', ArbeitszeitTag | null>>

export interface UserProfile {
  uid: string
  email: string
  displayName: string
  username: string
  role: UserRole
  additionalRoles?: UserRole[]
  status: UserStatus
  isSuperAdmin?: boolean
  locked?: boolean
  lockedReason?: 'tooManyAttempts' | 'admin'
  mustChangePassword?: boolean
  canEditPlanung?: boolean      // Darf Einsatzplanung bearbeiten (ohne Admin-Rolle)
  permissions?: UserPermissions // Bereichsberechtigungen für Geschäftsleitung
  fachtitel?: string | null     // Fachtitel für Briefköpfe (z.B. «Fachärztin FMH für Ophthalmologie»)
  arbeitszeit?: Arbeitszeit
  createdAt?: unknown
  approvedBy?: string
  approvedAt?: unknown
  lastSeen?: unknown
  lastLogin?: unknown
}

interface AuthContextType {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  isAdmin: boolean
  isArzt: boolean
  isGuest: boolean
  isGeschaeftsleitung: boolean
  isReadOnly: boolean
  isSuperAdmin: boolean
  canEditPlanung: boolean
  canAccessIvom: boolean
  canAccessLager: boolean
  canAccessPlanung: boolean
  canAccessSOP: boolean
  canAccessAufgaben: boolean
  canAccessRecall: boolean
  canAccessAkv: boolean
  canAccessBenutzerverwaltung: boolean
  login:             (email: string, password: string) => Promise<void>
  register:          (email: string, password: string, displayName: string, username: string, role: UserRole) => Promise<void>
  logout:            () => Promise<void>
  refreshProfile:    () => Promise<void>
  changePassword:    (newPassword: string) => Promise<void>
  sendResetEmail:       (email: string) => Promise<void>
  sendResetByUsername:  (username: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

async function loadProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? (snap.data() as UserProfile) : null
}

// Lock user by email after too many failed attempts
async function lockUserByEmail(email: string) {
  try {
    const q = query(collection(db, 'users'), where('email', '==', email))
    const snap = await getDocs(q)
    if (!snap.empty) {
      await updateDoc(snap.docs[0].ref, {
        locked: true,
        lockedReason: 'tooManyAttempts',
      })
    }
  } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshProfile = async () => {
    if (!user) return
    const p = await loadProfile(user.uid)
    setProfile(p)
  }

  // Track Firebase auth state — just sets the user object
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      if (!u) {
        setProfile(null)
        setLoading(false)
      }
    })
    return unsub
  }, [])

  // Presence heartbeat — updates lastSeen every 2 minutes while logged in
  useEffect(() => {
    if (!user) return
    const ref = doc(db, 'users', user.uid)
    updateDoc(ref, { lastSeen: serverTimestamp() }).catch(() => {})
    const interval = setInterval(() => {
      updateDoc(ref, { lastSeen: serverTimestamp() }).catch(() => {})
    }, 2 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user?.uid])

  // Live profile subscription — re-subscribes whenever the logged-in uid changes
  useEffect(() => {
    if (!user) return
    const profileRef = doc(db, 'users', user.uid)
    const unsub = onSnapshot(profileRef, async (snap) => {
      if (snap.exists()) {
        setProfile(snap.data() as UserProfile)
        setLoading(false)
      } else {
        // No Firestore profile yet — create a pending placeholder.
        //
        // Default-Rolle bewusst 'gast' (unprivilegiert): dieser Pfad
        // greift nur wenn ein Firebase-Auth-User existiert, dessen
        // Firestore-Profil fehlt (z.B. Profil gelöscht oder User direkt
        // in der Firebase-Console angelegt). Mit role='admin' (vorher)
        // wäre ein Admin, der bei Approval nur auf den Status schaut,
        // dem User unbeabsichtigt Admin-Rechte gegeben.
        // Admin kann die Rolle bei Approval explizit hochstufen.
        const newProfile: UserProfile = {
          uid: user.uid,
          email: user.email ?? '',
          displayName: user.displayName ?? user.email ?? '',
          username: user.displayName ?? user.email?.split('@')[0] ?? '',
          role: 'gast',
          status: 'pending',
        }
        await setDoc(profileRef, { ...newProfile, createdAt: serverTimestamp() })
        // onSnapshot will fire again with the newly created document
        setLoading(false)
      }
    })
    return unsub
  }, [user?.uid])

  const login = async (username: string, password: string) => {
    setProfile(null)
    // Resolve username → email via Firestore
    const q = query(collection(db, 'users'), where('username', '==', username.trim()))
    const snap = await getDocs(q)
    if (snap.empty) throw { code: 'auth/user-not-found' }
    const email = (snap.docs[0].data() as UserProfile).email
    try {
      const uid = snap.docs[0].id
      await signInWithEmailAndPassword(auth, email, password)
      updateDoc(doc(db, 'users', uid), { lastLogin: serverTimestamp() }).catch(() => {})
      window.location.hash = '/'
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/too-many-requests') {
        await lockUserByEmail(email)
      }
      throw err
    }
  }

  const register = async (
    email: string, password: string,
    displayName: string, username: string, role: UserRole
  ) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName })
    const p: UserProfile = { uid: cred.user.uid, email, displayName, username, role, status: 'pending' }
    await setDoc(doc(db, 'users', cred.user.uid), { ...p, createdAt: serverTimestamp() })
    setProfile(p)
  }

  const logout = async () => {
    await signOut(auth)
    setProfile(null)
  }

  const changePassword = async (newPassword: string) => {
    if (!user) throw new Error('Not logged in')
    await updatePassword(user, newPassword)
    if (profile) {
      await updateDoc(doc(db, 'users', profile.uid), { mustChangePassword: false })
      setProfile({ ...profile, mustChangePassword: false })
    }
  }

  const sendResetEmail = async (email: string) => {
    await sendPasswordResetEmail(auth, email)
  }

  const sendResetByUsername = async (username: string) => {
    const q = query(collection(db, 'users'), where('username', '==', username.trim()))
    const snap = await getDocs(q)
    if (snap.empty) throw { code: 'auth/user-not-found' }
    const email = (snap.docs[0].data() as UserProfile).email
    await sendPasswordResetEmail(auth, email)
  }

  // Alle Permission-Booleans laufen jetzt durch die pure Helpers in
  // src/lib/permissions.ts — siehe dortige Tests für Verträge & Edge-Cases.
  const isAdmin                     = perm.isAdmin(profile)
  const isArzt                      = perm.isArzt(profile)
  const isGuest                     = perm.isGuest(profile)
  const isGeschaeftsleitung         = perm.isGeschaeftsleitung(profile)
  const isReadOnly                  = perm.isReadOnly(profile)
  const isSuperAdmin                = perm.isSuperAdmin(profile)
  const canEditPlanung              = perm.canEditPlanung(profile)
  const canAccessIvom               = perm.permGranted(profile, 'ivom')
  const canAccessLager              = perm.permGranted(profile, 'lager')
  const canAccessPlanung            = perm.permGranted(profile, 'planung')
  const canAccessSOP                = perm.permGranted(profile, 'onboarding')
  const canAccessAufgaben           = perm.permGranted(profile, 'aufgaben')
  const canAccessRecall             = perm.permGranted(profile, 'recall')
  const canAccessAkv                = perm.permGranted(profile, 'akv')
  const canAccessBenutzerverwaltung = perm.canAccessBenutzerverwaltung(profile)

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      isAdmin, isArzt, isGuest, isGeschaeftsleitung, isReadOnly, isSuperAdmin,
      canEditPlanung, canAccessIvom, canAccessLager, canAccessPlanung, canAccessSOP, canAccessAufgaben, canAccessRecall, canAccessAkv, canAccessBenutzerverwaltung,
      login, register, logout, refreshProfile, changePassword, sendResetEmail, sendResetByUsername
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
