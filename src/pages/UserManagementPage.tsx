import { Fragment, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  collection, onSnapshot, doc, updateDoc, deleteDoc, setDoc, serverTimestamp, query, orderBy, where, getDocs, writeBatch
} from 'firebase/firestore'
import { initializeApp, getApps } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth'
import { db } from '../lib/firebase'
import { useAuth, UserProfile, UserRole, UserStatus, UserPermissions, Arbeitszeit } from '../lib/AuthContext'
import { loadPlanung, savePlanung, loadYearListFirestore } from '../lib/firestorePlanung'
import { Check, X, Users, Shield, ShieldCheck, Clock, UserCheck, UserPlus, Eye, EyeOff, Trash2, Crown, Unlock, Mail, Pencil, Save, Lock, MessageSquare, ClipboardList, Search, ChevronUp, ChevronDown, ChevronsUpDown, Package, CalendarDays, BookOpen, Phone, type LucideIcon } from 'lucide-react'
import BackButton from '../components/ui/BackButton'

const firebaseConfig = {
  apiKey: "AIzaSyAYRnIZJ46oEPUIZ9uRiLDbTWW0dB93vgQ",
  authDomain: "azsdb-999d6.firebaseapp.com",
  projectId: "azsdb-999d6",
  storageBucket: "azsdb-999d6.firebasestorage.app",
  messagingSenderId: "782091866487",
  appId: "1:782091866487:web:4616ff6bf7cce1e15c1172",
}

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin', arzt: 'Arzt/Ärztin', mpa: 'MPA', gast: 'Gast', geschaeftsleitung: 'Geschäftsleitung',
}

const ROLE_GROUPS: { role: UserRole; label: string }[] = [
  { role: 'arzt',              label: 'Ärztinnen & Ärzte' },
  { role: 'mpa',               label: 'MPA' },
  { role: 'geschaeftsleitung', label: 'Geschäftsleitung' },
  { role: 'admin',             label: 'Administration' },
  { role: 'gast',              label: 'Gäste' },
]

const PERMISSION_AREAS: { key: keyof UserPermissions; label: string; Icon: LucideIcon }[] = [
  { key: 'ivom',       label: 'OP / IVI',       Icon: Eye },
  { key: 'lager',      label: 'Lager',          Icon: Package },
  { key: 'planung',    label: 'Einsatzplanung', Icon: CalendarDays },
  { key: 'onboarding', label: 'SOP',            Icon: BookOpen },
  { key: 'aufgaben',   label: 'Aufgaben',       Icon: ClipboardList },
  { key: 'recall',     label: 'Recall',         Icon: Phone },
  { key: 'akv',        label: 'AKV',            Icon: ClipboardList },
]
function formatTimestamp(ts: unknown): string {
  const seconds = (ts as { seconds?: number })?.seconds
  if (!seconds) return '—'
  const d = new Date(seconds * 1000)
  return d.toLocaleDateString('de-CH') + ' ' + d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
}

// User is considered online if lastSeen within the last 5 minutes
function isOnline(u: UserProfile): boolean {
  const ts = (u.lastSeen as { seconds?: number })?.seconds
  if (!ts) return false
  return Date.now() / 1000 - ts < 5 * 60
}

const STATUS_STYLE: Record<UserStatus, string> = {
  pending:  'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50   text-red-700   border-red-200',
}
const STATUS_LABEL: Record<UserStatus, string> = {
  pending: 'Ausstehend', approved: 'Aktiv', rejected: 'Gesperrt',
}

interface AddForm { name: string; username: string; email: string; password: string; role: UserRole; additionalRoles: UserRole[] }

interface LoginRequest { id: string; senderName?: string; email?: string; note?: string; createdAt?: unknown }

export default function UserManagementPage() {
  const { profile: me, isSuperAdmin, isAdmin, isGeschaeftsleitung, canAccessBenutzerverwaltung, sendResetEmail } = useAuth()
  const canManageUsers = isAdmin || canAccessBenutzerverwaltung
  const [searchParams, setSearchParams] = useSearchParams()
  const [users,   setUsers]   = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<AddForm>({ name: '', username: '', email: '', password: '', role: 'mpa', additionalRoles: [] })
  const [addErr,  setAddErr]  = useState('')
  const [adding,  setAdding]  = useState(false)
  const [showPw,  setShowPw]  = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [editUser, setEditUser] = useState<UserProfile | null>(null)
  const [editForm, setEditForm] = useState({ name: '', username: '', email: '', role: 'mpa' as UserRole, additionalRoles: [] as UserRole[], fachtitel: '', mustSetRealEmail: false })
  const [editSaving, setEditSaving] = useState(false)
  const [editErr, setEditErr] = useState('')
  const [loginRequests, setLoginRequests] = useState<LoginRequest[]>([])
  const [loginRequestId, setLoginRequestId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'users' | 'log'>('users')

  type DayKey = 'mo' | 'di' | 'mi' | 'do' | 'fr' | 'sa'
  const AZ_DAYS: { key: DayKey; label: string }[] = [
    { key: 'mo', label: 'Mo' }, { key: 'di', label: 'Di' }, { key: 'mi', label: 'Mi' },
    { key: 'do', label: 'Do' }, { key: 'fr', label: 'Fr' }, { key: 'sa', label: 'Sa' },
  ]
  const [editingAz,    setEditingAz]    = useState<string | null>(null)
  const [azDraft,      setAzDraft]      = useState<Arbeitszeit>({})
  const [editingPerms, setEditingPerms] = useState<string | null>(null)

  function openAz(u: UserProfile) {
    if (editingAz === u.uid) { setEditingAz(null); return }
    setEditingAz(u.uid)
    setAzDraft(u.arbeitszeit ?? {})
  }
  async function saveAz(uid: string, draft: Arbeitszeit) {
    await updateDoc(doc(db, 'users', uid), { arbeitszeit: draft })
  }
  function toggleAzDay(uid: string, day: DayKey, enabled: boolean) {
    const next = { ...azDraft, [day]: enabled ? { von: '08:00', bis: '17:00' } : null }
    setAzDraft(next)
    saveAz(uid, next)
  }
  function updateAzTime(day: DayKey, field: 'von' | 'bis', val: string) {
    const existing = azDraft[day]
    if (!existing) return
    setAzDraft(prev => ({ ...prev, [day]: { ...existing, [field]: val } }))
  }

  // Real-time listener
  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setUsers(snap.docs.map(d => d.data() as UserProfile))
      setLoading(false)
    })
  }, [])

  // Real-time listener for pending login requests
  useEffect(() => {
    const q = query(collection(db, 'adminMessages'), where('status', '==', 'pending'))
    return onSnapshot(q, snap => {
      const reqs = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as LoginRequest & { topic: string }))
        .filter(d => d.topic === 'login')
        .sort((a, b) => ((b.createdAt as any)?.seconds ?? 0) - ((a.createdAt as any)?.seconds ?? 0))
      setLoginRequests(reqs)
    })
  }, [])

  // Auto-open add modal if navigated from login request (with optional pre-fill)
  useEffect(() => {
    if (searchParams.get('addUser') === '1') {
      const name = searchParams.get('name') ?? ''
      const email = searchParams.get('email') ?? ''
      setShowAdd(true)
      if (name || email) {
        setAddForm(f => ({ ...f, name, email }))
      }
      setSearchParams({}, { replace: true })
    }
    if (searchParams.get('tab') === 'log') {
      setActiveTab('log')
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Permission: can current admin modify this user?
  function canModify(u: UserProfile) {
    if (u.uid === me?.uid) return false                    // can't modify yourself
    if (u.isSuperAdmin) return false                       // can never touch System-Admin
    if (u.role === 'admin' && !isSuperAdmin && !isAdmin && !isGeschaeftsleitung) return false
    return true
  }

  const updateStatus = async (uid: string, status: UserStatus) => {
    setSaving(uid)
    await updateDoc(doc(db, 'users', uid), {
      status,
      approvedBy: me?.displayName ?? me?.email ?? 'Admin',
      approvedAt: serverTimestamp(),
    })
    setSaving(null)
  }

  const updateRole = async (uid: string, role: UserRole) => {
    await updateDoc(doc(db, 'users', uid), { role })
  }

  const togglePlanung = async (uid: string, current: boolean) => {
    await updateDoc(doc(db, 'users', uid), { canEditPlanung: !current })
  }

  const togglePermission = async (uid: string, perms: UserPermissions | undefined, key: keyof UserPermissions) => {
    const updated = { ...(perms ?? {}), [key]: !(perms?.[key] ?? false) }
    await updateDoc(doc(db, 'users', uid), { permissions: updated })
  }

  // Unified toggle for all non-admin roles — initialises defaults based on role
  const togglePermissionForAll = async (u: UserProfile, key: keyof UserPermissions) => {
    const isFullAccess = u.role === 'arzt' || u.role === 'mpa'
    const defaults: UserPermissions = isFullAccess
      ? { ivom: true, lager: true, planung: true, onboarding: true, aufgaben: true, recall: false }
      : { ivom: false, lager: false, planung: false, onboarding: false, aufgaben: false, recall: u.role === 'geschaeftsleitung' }
    const current = u.permissions ?? defaults
    const currentVal = current[key] ?? defaults[key] ?? false
    await updateDoc(doc(db, 'users', u.uid), { permissions: { ...current, [key]: !currentVal } })
  }

  // Effective permission value — respects role defaults when no permissions object set
  const effectivePerm = (u: UserProfile, key: keyof UserPermissions): boolean => {
    if (u.permissions !== undefined) return u.permissions?.[key] === true
    // recall: only GL has access by default; arzt/mpa need explicit grant
    if (key === 'recall') return u.role === 'geschaeftsleitung'
    // akv: GL + arzt/mpa by default
    if (key === 'akv') return u.role === 'geschaeftsleitung' || u.role === 'arzt' || u.role === 'mpa'
    return u.role === 'arzt' || u.role === 'mpa'
  }

  const deleteUser = async (uid: string) => {
    await deleteDoc(doc(db, 'users', uid))
    setConfirmDelete(null)
  }

  const unlockUser = async (uid: string) => {
    await updateDoc(doc(db, 'users', uid), { locked: false, lockedReason: null, status: 'approved' })
  }

  const sendPasswordReset = async (email: string, uid: string) => {
    try {
      await sendResetEmail(email)
      await updateDoc(doc(db, 'users', uid), { mustChangePassword: true })
      alert(`Passwort-Reset E-Mail wurde an ${email} gesendet.`)
    } catch {
      alert('Fehler beim Senden der E-Mail.')
    }
  }

  const openEdit = (u: UserProfile) => {
    setEditUser(u)
    setEditForm({ name: u.displayName, username: u.username, email: u.email ?? '', role: u.role, additionalRoles: u.additionalRoles ?? [], fachtitel: u.fachtitel ?? '', mustSetRealEmail: u.mustSetRealEmail ?? false })
    setEditErr('')
  }

  const saveEdit = async () => {
    if (!editUser) return
    if (!editForm.name.trim() || !editForm.username.trim()) {
      setEditErr('Name und Benutzername sind erforderlich.')
      return
    }
    setEditSaving(true); setEditErr('')
    try {
      const newName = editForm.name.trim()
      const oldName = editUser.displayName
      const uid = editUser.uid
      const nameChanged = newName !== oldName

      // E-Mail wird hier nur im Firestore-Doc nachgefuehrt (Anzeige + Username->Email
      // Login-Lookup). Der echte Firebase-Auth-Login wechselt erst, wenn der User
      // selber im Profil "E-Mail aendern" + Verifizierungs-Mail bestaetigt.
      await updateDoc(doc(db, 'users', uid), {
        displayName:      newName,
        username:         editForm.username.trim(),
        email:            editForm.email.trim().toLowerCase(),
        role:             editForm.role,
        additionalRoles:  editForm.additionalRoles,
        fachtitel:        editForm.fachtitel.trim() || null,
        mustSetRealEmail: editForm.mustSetRealEmail,
      })

      // Close modal immediately after the user record is saved
      setEditUser(null)

      // Propagate name change across all collections in background (fire-and-forget)
      if (nameChanged) {
        ;(async () => {
          try {
            const batch = writeBatch(db)

            // taskCards: members[].name + checklist[].doneBy
            const cardsSnap = await getDocs(collection(db, 'taskCards'))
            cardsSnap.docs.forEach(cardDoc => {
              const data = cardDoc.data()
              let changed = false
              const members = (data.members ?? []).map((m: { uid: string; name: string }) => {
                if (m.uid === uid) { changed = true; return { ...m, name: newName } }
                return m
              })
              const checklist = (data.checklist ?? []).map((item: { doneByUid?: string; doneBy?: string }) => {
                if (item.doneByUid === uid) { changed = true; return { ...item, doneBy: newName } }
                return item
              })
              if (changed) batch.update(cardDoc.ref, { members, checklist })
            })

            // taskComments: authorName
            const commentsSnap = await getDocs(query(collection(db, 'taskComments'), where('authorUid', '==', uid)))
            commentsSnap.docs.forEach(d => batch.update(d.ref, { authorName: newName }))

            // recall_activity_log: user-Feld nachziehen (sonst erscheint die Person
            // in der Recall-Auswertung doppelt — alte Eintraege unter altem Namen,
            // neue unter neuem). Es gibt kein userUid-Feld, daher Suche per altem Namen.
            const actSnap = await getDocs(query(collection(db, 'recall_activity_log'), where('user', '==', oldName)))
            actSnap.docs.forEach(d => batch.update(d.ref, { user: newName }))

            // planungRequests: username + personName (= plan key)
            const reqSnap = await getDocs(query(collection(db, 'planungRequests'), where('uid', '==', uid)))
            reqSnap.docs.forEach(d => {
              const upd: Record<string, string> = { username: newName }
              if (d.data().personName === oldName) upd.personName = newName
              batch.update(d.ref, upd)
            })
            // planungRequests by personName (requests submitted by others for this person)
            const reqByName = await getDocs(query(collection(db, 'planungRequests'), where('personName', '==', oldName)))
            reqByName.docs.forEach(d => batch.update(d.ref, { personName: newName }))

            await batch.commit()

            // Einsatzplanung: rename person key in schedule + sections across all years
            const years = (await loadYearListFirestore()) ?? [new Date().getFullYear()]
            await Promise.all(years.map(async year => {
              const data = await loadPlanung(year)
              if (!data) return
              if (!data.sections.some(s => s.persons.includes(oldName))) return
              // Rename in sections
              data.sections = data.sections.map(s => ({
                ...s,
                persons: s.persons.map(p => p === oldName ? newName : p),
              }))
              // Rename schedule key
              if (data.schedule[oldName]) {
                data.schedule[newName] = data.schedule[oldName]
                delete data.schedule[oldName]
              }
              // Rename comments key
              if ((data as any).comments?.[oldName]) {
                ;(data as any).comments[newName] = (data as any).comments[oldName]
                delete (data as any).comments[oldName]
              }
              await savePlanung(year, data)
            }))
          } catch (e) {
            console.error('Name propagation error:', e)
          }
        })()
      }
    } catch {
      setEditErr('Fehler beim Speichern.')
    } finally {
      setEditSaving(false)
    }
  }

  const addUser = async () => {
    if (!addForm.name.trim() || !addForm.username.trim() || !addForm.email.trim() || addForm.password.length < 6) {
      setAddErr('Bitte Name, Benutzername, E-Mail und Passwort (min. 6 Zeichen) eingeben.')
      return
    }
    setAdding(true); setAddErr('')
    try {
      const secondaryApp = getApps().find(a => a.name === 'secondary') ?? initializeApp(firebaseConfig, 'secondary')
      const secondaryAuth = getAuth(secondaryApp)
      const cred = await createUserWithEmailAndPassword(secondaryAuth, addForm.email.trim(), addForm.password)
      await fbSignOut(secondaryAuth)
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid,
        email: addForm.email.trim(),
        authEmail: addForm.email.trim().toLowerCase(),
        displayName: addForm.name.trim(),
        username: addForm.username.trim(),
        role:            addForm.role,
        additionalRoles: addForm.additionalRoles,
        status: 'approved',
        mustChangePassword: true,
        createdAt: serverTimestamp(),
        approvedBy: me?.displayName ?? 'Admin',
        approvedAt: serverTimestamp(),
      })
      // Send password-reset email so the new user gets notified and can set their own password
      try { await sendResetEmail(addForm.email.trim()) } catch { /* ignore if email sending fails */ }
      // Dismiss the login request if this user was created from one
      if (loginRequestId) {
        try { await updateDoc(doc(db, 'adminMessages', loginRequestId), { status: 'done' }) } catch {}
        setLoginRequestId(null)
      }
      setShowAdd(false)
      setAddForm({ name: '', username: '', email: '', password: '', role: 'mpa', additionalRoles: [] })
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/email-already-in-use') setAddErr('Diese E-Mail-Adresse ist bereits registriert.')
      else if (code === 'auth/invalid-email') setAddErr('Ungültige E-Mail-Adresse.')
      else setAddErr('Fehler beim Erstellen des Benutzers.')
    } finally {
      setAdding(false)
    }
  }

  const [userSearch,     setUserSearch]     = useState('')
  const [filterStatus,   setFilterStatus]   = useState<string>('all')
  const [sortCol,        setSortCol]        = useState<'name'|'email'|'role'|'status'|null>(null)
  const [sortDir,        setSortDir]        = useState<'asc'|'desc'>('asc')

  function toggleSort(col: 'name'|'email'|'role'|'status') {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const pending = users.filter(u => u.status === 'pending')
  const rest    = users.filter(u => u.status !== 'pending')

  const filteredUsers = rest.filter(u => {
    const q = userSearch.toLowerCase()
    if (q && !u.displayName.toLowerCase().includes(q) && !u.username.toLowerCase().includes(q) && !(u.email ?? '').toLowerCase().includes(q)) return false
    if (filterStatus !== 'all') {
      if (filterStatus === 'online' && !isOnline(u)) return false
      if (filterStatus === 'locked' && !u.locked) return false
      if (filterStatus === 'approved' && (u.status !== 'approved' || u.locked)) return false
      if (filterStatus === 'rejected' && u.status !== 'rejected') return false
    }
    return true
  })
  if (sortCol) {
    filteredUsers.sort((a, b) => {
      let av = '', bv = ''
      if (sortCol === 'name')   { av = (a.displayName || a.username).toLowerCase(); bv = (b.displayName || b.username).toLowerCase() }
      if (sortCol === 'email')  { av = (a.email ?? '').toLowerCase(); bv = (b.email ?? '').toLowerCase() }
      if (sortCol === 'status') { av = STATUS_LABEL[a.status]; bv = STATUS_LABEL[b.status] }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }

  // Group by primary role in defined order
  const groupedUsers = ROLE_GROUPS
    .map(g => ({ ...g, users: filteredUsers.filter(u => u.role === g.role) }))
    .filter(g => g.users.length > 0)

  const userToDelete = confirmDelete ? users.find(u => u.uid === confirmDelete) : null

  return (
    <div className="p-3 sm:p-6 w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <BackButton />
        <div className="p-2 bg-primary-50 rounded-xl">
          <Users className="w-5 h-5 text-primary-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Benutzerverwaltung</h1>
          <p className="text-sm text-gray-500">{users.length} Benutzer total</p>
        </div>
        {activeTab === 'users' && (
          <button
            onClick={() => { setShowAdd(true); setAddErr(''); setLoginRequestId(null) }}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700
              text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Benutzer hinzufügen</span>
            <span className="sm:hidden">Hinzufügen</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px
            ${activeTab === 'users' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          <Users className="w-4 h-4" /> Benutzer
        </button>
        <button
          onClick={() => setActiveTab('log')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px
            ${activeTab === 'log' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          <ClipboardList className="w-4 h-4" /> Antragsprotokoll
        </button>
      </div>

      {/* Log tab */}
      {activeTab === 'log' && <RequestLogTab isAdmin={canManageUsers} />}

      {/* Users tab — all existing content below */}
      {activeTab !== 'users' ? null : <>

      {/* Delete confirmation modal */}
      {confirmDelete && userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Benutzer löschen?</h2>
            <p className="text-sm text-gray-500 mb-1">
              <span className="font-medium text-gray-800">{userToDelete.username || userToDelete.displayName}</span> wird dauerhaft entfernt.
            </p>
            <p className="text-xs text-gray-400 mb-5">Der Benutzer kann sich danach nicht mehr anmelden.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                Abbrechen
              </button>
              <button onClick={() => deleteUser(confirmDelete)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors">
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Profil bearbeiten</h2>
              <button onClick={() => setEditUser(null)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vor- und Nachname</label>
                <input type="text" value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Vorname Nachname" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Benutzername</label>
                <input type="text" value={editForm.username}
                  onChange={e => setEditForm(f => ({ ...f, username: e.target.value.replace(/\s/g, '') }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="z.B. mmueller" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hauptfunktion</label>
                <select value={editForm.role}
                  onChange={e => setEditForm(f => ({ ...f, role: e.target.value as UserRole, additionalRoles: f.additionalRoles.filter(r => r !== e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white">
                  <option value="mpa">MPA</option>
                  <option value="arzt">Arzt/Ärztin</option>
                  <option value="gast">Gast (nur lesen)</option>
                  <option value="geschaeftsleitung">Geschäftsleitung</option>
                  {(isSuperAdmin || isAdmin || isGeschaeftsleitung) && <option value="admin">Admin</option>}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Weitere Funktionen</label>
                <div className="flex flex-wrap gap-2">
                  {(['mpa', 'arzt', 'geschaeftsleitung', ...((isSuperAdmin || isAdmin || isGeschaeftsleitung) ? ['admin'] : [])] as UserRole[])
                    .filter(r => r !== editForm.role)
                    .map(r => {
                      const labels: Record<string, string> = { mpa: 'MPA', arzt: 'Arzt/Ärztin', geschaeftsleitung: 'Geschäftsleitung', admin: 'Admin' }
                      const checked = editForm.additionalRoles.includes(r)
                      return (
                        <label key={r} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${checked ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                          <input type="checkbox" className="sr-only" checked={checked}
                            onChange={e => setEditForm(f => ({ ...f, additionalRoles: e.target.checked ? [...f.additionalRoles, r] : f.additionalRoles.filter(x => x !== r) }))} />
                          {labels[r]}
                        </label>
                      )
                    })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail (Kontakt / Benachrichtigungen)</label>
                <input type="email" value={editForm.email}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="name@praxis.ch" />
                <p className="mt-1 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 leading-snug">
                  ℹ Eingeloggt wird über den Benutzernamen — diese E-Mail dient nur zur Identifikation und für
                  Benachrichtigungen. Kann jederzeit gefahrlos geändert werden, der Login bleibt davon unberührt.
                </p>
                <label className="mt-2 flex items-start gap-2 text-[12px] text-gray-700 cursor-pointer select-none">
                  <input type="checkbox" checked={editForm.mustSetRealEmail}
                    onChange={e => setEditForm(f => ({ ...f, mustSetRealEmail: e.target.checked }))}
                    className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span>
                    User muss beim nächsten Login eine echte E-Mail eingeben
                    <span className="block text-[10px] text-gray-500 leading-snug">
                      (für Konten die ursprünglich mit fiktiver Adresse angelegt wurden — sonst funktioniert
                      „Passwort vergessen" nicht)
                    </span>
                  </span>
                </label>
              </div>
              {(editForm.role === 'arzt' || editForm.additionalRoles.includes('arzt')) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fachtitel <span className="text-gray-400 font-normal">(erscheint im Briefkopf)</span>
                  </label>
                  <input type="text" value={editForm.fachtitel}
                    onChange={e => setEditForm(f => ({ ...f, fachtitel: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="z.B. Fachärztin FMH für Ophthalmologie" />
                </div>
              )}
              {editErr && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{editErr}</p>}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-200">
              <button onClick={() => setEditUser(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                Abbrechen
              </button>
              <button onClick={saveEdit} disabled={editSaving}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
                <Save className="w-4 h-4" />
                {editSaving ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Neuer Benutzer</h2>
              <button onClick={() => { setShowAdd(false); setLoginRequestId(null) }} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vor- und Nachname *</label>
                <input type="text" value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Vorname Nachname" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Benutzername *</label>
                <input type="text" value={addForm.username}
                  onChange={e => setAddForm(f => ({ ...f, username: e.target.value.replace(/\s/g, '') }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="z.B. mmueller (kein Leerzeichen)" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail *</label>
                <input type="email" value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="name@praxis.ch" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Passwort *</label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} value={addForm.password}
                    onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Mindestens 6 Zeichen" />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hauptfunktion</label>
                <select value={addForm.role}
                  onChange={e => setAddForm(f => ({ ...f, role: e.target.value as UserRole, additionalRoles: f.additionalRoles.filter(r => r !== e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white">
                  <option value="mpa">MPA</option>
                  <option value="arzt">Arzt/Ärztin</option>
                  <option value="gast">Gast (nur lesen)</option>
                  <option value="geschaeftsleitung">Geschäftsleitung</option>
                  {(isSuperAdmin || isAdmin || isGeschaeftsleitung) && <option value="admin">Admin</option>}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Weitere Funktionen</label>
                <div className="flex flex-wrap gap-2">
                  {(['mpa', 'arzt', 'geschaeftsleitung', ...((isSuperAdmin || isAdmin || isGeschaeftsleitung) ? ['admin'] : [])] as UserRole[])
                    .filter(r => r !== addForm.role)
                    .map(r => {
                      const labels: Record<string, string> = { mpa: 'MPA', arzt: 'Arzt/Ärztin', geschaeftsleitung: 'Geschäftsleitung', admin: 'Admin' }
                      const checked = addForm.additionalRoles.includes(r)
                      return (
                        <label key={r} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${checked ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                          <input type="checkbox" className="sr-only" checked={checked}
                            onChange={e => setAddForm(f => ({ ...f, additionalRoles: e.target.checked ? [...f.additionalRoles, r] : f.additionalRoles.filter(x => x !== r) }))} />
                          {labels[r]}
                        </label>
                      )
                    })}
                </div>
              </div>
              {addErr && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{addErr}</p>}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-200">
              <button onClick={() => { setShowAdd(false); setLoginRequestId(null) }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                Abbrechen
              </button>
              <button onClick={addUser} disabled={adding}
                className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
                {adding ? 'Wird erstellt…' : 'Benutzer erstellen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Offene Loginanfragen */}
          {loginRequests.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-4 h-4 text-green-600" />
                <h2 className="text-sm font-semibold text-gray-700">Offene Loginanfragen ({loginRequests.length})</h2>
              </div>
              <div className="space-y-2">
                {loginRequests.map(r => (
                  <div key={r.id}
                    className="flex flex-wrap sm:flex-nowrap items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                      <MessageSquare className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 text-sm truncate">{r.senderName || '(kein Name)'}</p>
                      {r.email && <p className="text-xs text-gray-500 truncate">{r.email}</p>}
                    </div>
                    <button
                      onClick={() => {
                        setLoginRequestId(r.id)
                        setAddForm(f => ({ ...f, name: r.senderName ?? '', email: r.email ?? '' }))
                        setShowAdd(true)
                        setAddErr('')
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700
                        text-white text-xs font-semibold rounded-lg transition-colors">
                      <UserPlus className="w-3.5 h-3.5" />
                      Konto erstellen
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Pending */}
          {pending.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-gray-700">Ausstehende Freigaben ({pending.length})</h2>
              </div>
              <div className="space-y-2">
                {pending.map(u => (
                  <div key={u.uid}
                    className="flex flex-wrap sm:flex-nowrap items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-amber-700">
                        {(u.username || u.displayName)?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 text-sm truncate">{u.username || u.displayName}</p>
                      <p className="text-xs text-gray-500 truncate">{u.email}</p>
                    </div>
                    {canModify(u) && (
                      <select value={u.role} onChange={e => updateRole(u.uid, e.target.value as UserRole)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700">
                        <option value="mpa">MPA</option>
                        <option value="arzt">Arzt/Ärztin</option>
                        <option value="gast">Gast</option>
                        <option value="geschaeftsleitung">Geschäftsleitung</option>
                        {(isSuperAdmin || isAdmin || isGeschaeftsleitung) && <option value="admin">Admin</option>}
                      </select>
                    )}
                    {canModify(u) && (
                      <div className="flex gap-2">
                        <button onClick={() => updateStatus(u.uid, 'approved')} disabled={saving === u.uid}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700
                            text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                          <Check className="w-3.5 h-3.5" />
                          {saving === u.uid ? '…' : 'Freigeben'}
                        </button>
                        <button onClick={() => updateStatus(u.uid, 'rejected')} disabled={saving === u.uid}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200
                            text-red-700 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                          <X className="w-3.5 h-3.5" /> Ablehnen
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {pending.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <UserCheck className="w-4 h-4" />
              Keine ausstehenden Freigaben.
            </div>
          )}

          {/* All users */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-700">
                  Alle Benutzer ({filteredUsers.length}{filteredUsers.length !== rest.length ? ` / ${rest.length}` : ''})
                </h2>
              </div>
              {users.filter(isOnline).length > 0 && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  {users.filter(isOnline).length} online
                </span>
              )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 mb-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input value={userSearch} onChange={e => setUserSearch(e.target.value)}
                  placeholder="Name, Benutzername oder E-Mail…"
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
              </div>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 text-gray-600">
                <option value="all">Alle Status</option>
                <option value="approved">Aktiv</option>
                <option value="online">Online</option>
                <option value="locked">Gesperrt</option>
                <option value="rejected">Abgelehnt</option>
              </select>
              {(userSearch || filterStatus !== 'all') && (
                <button onClick={() => { setUserSearch(''); setFilterStatus('all') }}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <X className="w-3 h-3" /> Zurücksetzen
                </button>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {([ ['name','Name',''], ['email','E-Mail','hidden sm:table-cell'] ] as [typeof sortCol & string, string, string][]).map(([col, label, cls]) => {
                        const active = sortCol === col
                        const Icon = active ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
                        return (
                          <th key={col} className={`px-4 py-2.5 text-left ${cls}`}>
                            <button onClick={() => toggleSort(col as 'name'|'email'|'status')}
                              className={`inline-flex items-center gap-1 text-xs font-semibold transition-colors ${active ? 'text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}>
                              {label}<Icon className="w-3 h-3" />
                            </button>
                          </th>
                        )
                      })}
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Funktion</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Berechtigungen</th>
                      <th className="px-4 py-2.5 text-left">
                        <button onClick={() => toggleSort('status')}
                          className={`inline-flex items-center gap-1 text-xs font-semibold transition-colors ${sortCol === 'status' ? 'text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}>
                          Status{sortCol === 'status' ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3"/> : <ChevronDown className="w-3 h-3"/>) : <ChevronsUpDown className="w-3 h-3"/>}
                        </button>
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredUsers.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Keine Benutzer gefunden.</td></tr>
                    ) : groupedUsers.map(group => (
                      <Fragment key={group.role}>
                        <tr>
                          <td colSpan={6} className="px-4 py-2 bg-gray-50/80 border-b border-gray-100">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                              {group.label}
                              <span className="ml-1.5 font-normal normal-case text-gray-400">({group.users.length})</span>
                            </span>
                          </td>
                        </tr>
                        {group.users.map(u => (
                      <Fragment key={u.uid}>
                      <tr className="hover:bg-gray-50/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center shrink-0 relative">
                              <span className="text-[11px] font-bold text-primary-700">
                                {(u.displayName || u.username)?.split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0].toUpperCase()).join('')}
                              </span>
                              {u.isSuperAdmin && (
                                <Crown className="w-3 h-3 text-amber-500 absolute -top-1 -right-1" />
                              )}
                              {isOnline(u) && (
                                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full" title="Online" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="font-medium text-gray-800 text-sm leading-tight">{u.displayName || u.username}</p>
                                {isOnline(u) && <span className="text-[9px] font-semibold text-green-600 bg-green-50 border border-green-200 px-1 py-0.5 rounded-full leading-none">Online</span>}
                              </div>
                              {u.username && <p className="text-xs text-gray-400 leading-tight">{u.username}</p>}
                              <p className="text-[11px] text-gray-400 leading-tight mt-0.5" title="Letzter Login">
                                {u.lastLogin ? formatTimestamp(u.lastLogin) : <span className="italic">Noch nie eingeloggt</span>}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs hidden sm:table-cell">{u.email}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {canModify(u) ? (
                              <select value={u.role} onChange={e => updateRole(u.uid, e.target.value as UserRole)}
                                className="text-xs border border-gray-200 rounded-lg px-2 py-0.5 bg-white text-gray-700">
                                <option value="mpa">MPA</option>
                                <option value="arzt">Arzt/Ärztin</option>
                                <option value="gast">Gast</option>
                                <option value="geschaeftsleitung">Geschäftsleitung</option>
                                {(isSuperAdmin || isAdmin || isGeschaeftsleitung) && <option value="admin">Admin</option>}
                              </select>
                            ) : (
                              <span className="text-xs text-gray-600">{ROLE_LABEL[u.role]}</span>
                            )}
                            {u.additionalRoles && u.additionalRoles.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {u.additionalRoles.map(r => (
                                  <span key={r} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary-50 text-primary-600 border border-primary-200">
                                    +{ROLE_LABEL[r]}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        {/* Berechtigungen — Icons, direkt anklickbar für Admin/GL */}
                        <td className="px-4 py-3">
                          {u.role === 'admin' ? (
                            <span className="text-xs text-gray-400 italic">Voll</span>
                          ) : (
                            <div className="flex items-center gap-0.5">
                              {PERMISSION_AREAS.map(({ key, label, Icon }) => {
                                const active = effectivePerm(u, key)
                                const editable = (isAdmin || isGeschaeftsleitung) && canModify(u)
                                const tooltip = editable
                                  ? `${label}: ${active ? 'aktiv – klicken zum Entziehen' : 'inaktiv – klicken zum Aktivieren'}`
                                  : `${label}: ${active ? 'aktiv' : 'inaktiv'}`
                                return editable ? (
                                  <button
                                    key={key}
                                    onClick={() => togglePermissionForAll(u, key)}
                                    title={tooltip}
                                    className={`p-1 rounded transition-colors ${
                                      active
                                        ? 'text-primary-600 hover:text-red-500 hover:bg-red-50'
                                        : 'text-gray-300 hover:text-green-600 hover:bg-green-50'
                                    }`}>
                                    <Icon className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <span key={key} title={tooltip}
                                    className={`p-1 ${active ? 'text-primary-400' : 'text-gray-200'}`}>
                                    <Icon className="w-3.5 h-3.5" />
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_STYLE[u.status]}`}>
                            {STATUS_LABEL[u.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {canModify(u) ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              {/* Arbeitszeit — nur für Ärzte */}
                              {(u.role === 'arzt' || u.additionalRoles?.includes('arzt')) && (isAdmin || isGeschaeftsleitung) && (
                                <button onClick={() => openAz(u)}
                                  className={`p-1 rounded transition-colors ${editingAz === u.uid ? 'text-primary-600 bg-primary-50' : 'text-gray-400 hover:text-primary-600 hover:bg-primary-50'}`}
                                  title="Arbeitszeit bearbeiten">
                                  <Clock className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {/* Berechtigungen — nur Admin/GL, nur auf Mobile (md+ = direkte Chips) */}
                              {(isAdmin || isGeschaeftsleitung) && (
                                <button
                                  onClick={() => setEditingPerms(editingPerms === u.uid ? null : u.uid)}
                                  className={`md:hidden p-1 rounded transition-colors ${editingPerms === u.uid ? 'text-violet-600 bg-violet-50' : 'text-gray-400 hover:text-violet-600 hover:bg-violet-50'}`}
                                  title="Berechtigungen bearbeiten">
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {/* Edit profile */}
                              <button onClick={() => openEdit(u)}
                                className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                                title="Profil bearbeiten">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {/* Locked by system/admin → unlock */}
                              {u.locked && (
                                <button onClick={() => unlockUser(u.uid)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                                  title="Entsperren">
                                  <Unlock className="w-3 h-3" /> Entsperren
                                </button>
                              )}
                              {!u.locked && u.status !== 'approved' && (
                                <button onClick={() => updateStatus(u.uid, 'approved')}
                                  className="p-1 text-green-500 hover:text-green-700 hover:bg-green-50 rounded transition-colors"
                                  title="Freigeben">
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {!u.locked && u.status === 'approved' && (
                                <button onClick={() => updateStatus(u.uid, 'rejected')}
                                  className="p-1 text-amber-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                                  title="Sperren">
                                  <Lock className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {/* Password reset email — only if real email set */}
                              {u.email && (
                                <button onClick={() => sendPasswordReset(u.email, u.uid)}
                                  className="p-1 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                  title="Passwort-Reset E-Mail senden">
                                  <Mail className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button onClick={() => setConfirmDelete(u.uid)}
                                className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="Benutzer löschen">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">
                              {u.uid === me?.uid ? 'Eigenes Konto' : u.isSuperAdmin ? 'System-Admin' : 'Kein Zugriff'}
                            </span>
                          )}
                        </td>
                      </tr>
                      {editingAz === u.uid && (
                        <tr className="bg-blue-50 border-t border-blue-100">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="flex items-center gap-1.5 mb-2">
                              <Clock className="w-3.5 h-3.5 text-primary-600" />
                              <span className="text-xs font-semibold text-gray-700">Arbeitszeit — {u.displayName || u.username}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {AZ_DAYS.map(({ key, label }) => {
                                const day = azDraft[key]
                                return (
                                  <div key={key} className="flex items-center gap-1.5 bg-white rounded-lg border border-gray-200 px-2.5 py-1.5">
                                    <input type="checkbox" checked={!!day}
                                      onChange={e => toggleAzDay(u.uid, key, e.target.checked)}
                                      className="w-3.5 h-3.5 accent-primary-600 cursor-pointer" />
                                    <span className="text-xs font-semibold text-gray-600 w-5">{label}</span>
                                    {day ? (
                                      <>
                                        <input type="time" value={day.von}
                                          onChange={e => updateAzTime(key, 'von', e.target.value)}
                                          onBlur={() => saveAz(u.uid, azDraft)}
                                          className="text-xs border border-gray-200 rounded px-1.5 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-primary-400" />
                                        <span className="text-xs text-gray-400">–</span>
                                        <input type="time" value={day.bis}
                                          onChange={e => updateAzTime(key, 'bis', e.target.value)}
                                          onBlur={() => saveAz(u.uid, azDraft)}
                                          className="text-xs border border-gray-200 rounded px-1.5 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-primary-400" />
                                      </>
                                    ) : (
                                      <span className="text-xs text-gray-400 italic">Frei</span>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                      {/* ── Berechtigungen-Panel ── */}
                      {editingPerms === u.uid && (
                        <tr className="border-t border-violet-100">
                          <td colSpan={6} className="px-4 py-4 bg-violet-50/40">
                            <div className="flex items-center gap-2 mb-3">
                              <ShieldCheck className="w-3.5 h-3.5 text-violet-600" />
                              <span className="text-xs font-semibold text-gray-700">
                                Berechtigungen — {u.displayName || u.username}
                              </span>
                              {u.role === 'admin' && (
                                <span className="text-[10px] text-gray-400 ml-1">(Admin hat immer vollen Zugriff)</span>
                              )}
                            </div>
                            {u.role === 'admin' ? (
                              <p className="text-xs text-gray-400 italic">Admins haben automatisch vollen Zugriff auf alle Bereiche.</p>
                            ) : (
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                                {PERMISSION_AREAS.map(({ key, label, Icon }) => {
                                  const active = effectivePerm(u, key)
                                  return (
                                    <button
                                      key={key}
                                      onClick={() => togglePermissionForAll(u, key)}
                                      title={active ? `${label} entziehen` : `${label} gewähren`}
                                      className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                                        active
                                          ? 'border-violet-300 bg-white text-gray-800 hover:bg-violet-50'
                                          : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50'
                                      }`}
                                    >
                                      <span className="flex items-center gap-2 text-xs font-medium">
                                        <Icon className="w-3.5 h-3.5 shrink-0" />
                                        {label}
                                      </span>
                                      {/* Toggle switch */}
                                      <span className={`flex-shrink-0 w-9 h-5 rounded-full transition-colors relative ${active ? 'bg-violet-500' : 'bg-gray-300'}`}>
                                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                        </Fragment>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>

                </table>
              </div>
            </div>
            {isSuperAdmin && (
              <p className="text-xs text-gray-400 mt-2 px-1">
                * System-Admin-Status wird direkt in der Datenbank gesetzt (<code>isSuperAdmin: true</code>).
              </p>
            )}
          </section>
        </div>
      )}
      </>}
    </div>
  )
}

// ── Antragsprotokoll tab — uses shared component ──────────────────────────────

import RequestLogContent from '../components/RequestLogContent'

function RequestLogTab({ isAdmin }: { isAdmin: boolean }) {
  return <RequestLogContent isAdmin={isAdmin} />
}
