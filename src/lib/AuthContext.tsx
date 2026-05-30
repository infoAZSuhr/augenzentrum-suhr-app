import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import {
  User, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile, updatePassword,
  sendPasswordResetEmail
} from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore'
import { auth, db } from './firebase'

export type UserRole   = 'admin' | 'arzt' | 'mpa' | 'gast' | 'geschaeftsleitung'
export type UserStatus = 'pending' | 'approved' | 'rejected'

export interface ArbeitszeitTag { von: string; bis: string }
export type Arbeitszeit = Partial<Record<'mo' | 'di' | 'mi' | 'do' | 'fr' | 'sa', ArbeitszeitTag | null>>

export interface UserPermissions {
  ivom?:           boolean
  lager?:          boolean
  planung?:        boolean
  onboarding?:     boolean
  aufgaben?:       boolean
  recall?:         boolean
  akv?:            boolean
}

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
        // No Firestore profile yet — create a pending placeholder
        const newProfile: UserProfile = {
          uid: user.uid,
          email: user.email ?? '',
          displayName: user.displayName ?? user.email ?? '',
          username: user.displayName ?? user.email?.split('@')[0] ?? '',
          role: 'admin',
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
      await signInWithEmailAndPassword(auth, email, password)
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

  const isApproved = profile?.status === 'approved' && !profile?.locked
  const hasRole    = (r: UserRole) => isApproved && (profile?.role === r || (profile?.additionalRoles?.includes(r) ?? false))
  const isAdmin        = hasRole('admin')
  const isArzt         = hasRole('arzt')
  const isMpa          = hasRole('mpa')
  const isGuest        = profile?.role === 'gast' && isApproved
  const isGeschaeftsleitung = hasRole('geschaeftsleitung')
  const isReadOnly     = (isGuest || isGeschaeftsleitung) && !isAdmin && !isArzt && !isMpa
  const isSuperAdmin   = isAdmin && profile?.isSuperAdmin === true
  const canEditPlanung = isAdmin || isGeschaeftsleitung

  // Module access: unified permissions check for all roles
  // - Admin: always true
  // - Users with permissions object set: use it explicitly
  // - Arzt/MPA without permissions set: default full access (backward compat)
  // - GL/Gast without permissions set: no access by default
  const permGranted = (key: keyof UserPermissions): boolean => {
    if (!isApproved) return false
    if (isAdmin) return true
    if (profile?.permissions !== undefined) return profile.permissions?.[key] === true
    // recall: only GL has access by default; arzt/mpa need explicit grant
    if (key === 'recall') return isGeschaeftsleitung
    // akv: GL + arzt/mpa by default
    if (key === 'akv') return isGeschaeftsleitung || hasRole('arzt') || hasRole('mpa')
    return hasRole('arzt') || hasRole('mpa')
  }
  const canAccessIvom                = permGranted('ivom')
  const canAccessLager               = permGranted('lager')
  const canAccessPlanung             = permGranted('planung')
  const canAccessSOP                 = permGranted('onboarding')
  const canAccessAufgaben            = permGranted('aufgaben')
  const canAccessRecall              = permGranted('recall')
  const canAccessAkv                 = permGranted('akv')
  const canAccessBenutzerverwaltung  = isAdmin || isGeschaeftsleitung

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
