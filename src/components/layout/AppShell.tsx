import { useState, useEffect, useRef } from 'react'
import { Outlet, useLocation, NavLink, useNavigate } from 'react-router-dom'
import { Eye, Package, CalendarDays, Users, LogOut, Menu, X, ChevronDown, Bell, Check, UserX, Scissors, Layers, UserCog, KeyRound, Save, Mail, MessageSquare, HelpCircle, BookOpen, ClipboardList, LayoutList, Phone, ArrowRightLeft } from 'lucide-react'
import { HelpModeOverlay } from '../HelpMode'
import type { HelpEntry } from '../../lib/helpTexts'
import { cn } from '../../utils/cn'
import { version } from '../../../package.json'
import { useAuth, UserProfile } from '../../lib/AuthContext'
import { collection, addDoc, onSnapshot, query, where, doc, updateDoc, serverTimestamp, orderBy, deleteField } from 'firebase/firestore'
import { db, auth } from '../../lib/firebase'
import { manageFerienPlan, removePlanEntry, updatePlanComment } from '../../lib/firestorePlanung'
import { TaskNotification, subscribeTaskNotifications, markTaskNotifRead } from '../../lib/firestoreTasks'
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail } from 'firebase/auth'

interface PlanungRequest {
  id: string
  type: 'eintrag' | 'ferien' | 'tausch' | 'absage'
  uid: string
  username: string
  personName?: string   // Plan-Schlüssel (Display-Name), gesetzt bei eintrag/absage
  dates?: string[]
  code?: string
  fromDate?: string
  toDate?: string
  note?: string
  ferienType?: string
  // tausch fields
  myDate?: string
  myCode?: string
  myPerson?: string
  theirDate?: string
  theirCode?: string
  theirPerson?: string
  year?: number
  newCode?: string | null
  status: 'pending' | 'approved' | 'provisional' | 'rejected' | 'adjustment' | 'dismissed' | 'withdrawn'
  adminArchived?: boolean
  userArchived?: boolean
  createdAt?: unknown
  adminNote?: string
  actionBy?: string
  actionAt?: unknown
  adjustmentSuggestions?: {fromDate:string; toDate:string}[]
  readByUser?: boolean
}

interface PlanungData {
  sections: Array<{ id: string; label: string; persons: string[] }>
  schedule: Record<string, Record<string, string>>
  feiertage: Record<string, string>
}

const FERIEN_TYPE_LABELS: Record<string, {label:string; emoji:string; code:string}> = {
  ferien:       { label: 'Ferien',                    emoji: '🏖️', code: 'Fer' },
  kurs:         { label: 'Kurs / Weiterbildung',      emoji: '📚', code: 'W'   },
  kongress:     { label: 'Kongress / Tagung',         emoji: '🏛️', code: 'W'   },
  militaer:     { label: 'Militär / Zivildienst',     emoji: '🎖️', code: 'M'   },
  ausgleich:    { label: 'Ausgleich',                 emoji: '⚖️', code: 'AG'  },
  mutterschaft: { label: 'Mutterschaft / Vaterschaft',emoji: '👶', code: 'MV'  },
  umzug:        { label: 'Umzug',                     emoji: '📦', code: 'UZ'  },
  sonstiges:    { label: 'Sonstiges',                 emoji: '📝', code: 'A'   },
}
function ferienTypeCode(ferienType?: string): string {
  return FERIEN_TYPE_LABELS[ferienType ?? 'ferien']?.code ?? 'Fer'
}

// OP sub-items
const opItems = [
  { to: '/ivom', label: 'IVI',  icon: Eye },
  { to: '/lid',  label: 'Lid',  icon: Scissors },
  { to: '/kat',  label: 'KAT',  icon: Layers },
]

// Top-level sections
const sections = [
  {
    label: 'OP',
    children: opItems,
  },
  { to: '/lager',   label: 'Lager',   icon: Package },
  { to: '/planung', label: 'Einsatz', icon: CalendarDays },
]

function navLinkClass(isActive: boolean) {
  return cn(
    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
    isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
  )
}
function mobileNavLinkClass(isActive: boolean) {
  return cn(
    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
    isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
  )
}

interface FerienEditData {
  id?: string          // undefined = new request
  fromDate?: string
  toDate?: string
  note?: string
  ferienType?: string
  adjustmentSuggestions?: {fromDate:string; toDate:string}[]
}

function FerienAntragModal({ editData, onClose }: { editData: FerienEditData; onClose: () => void }) {
  const { profile } = useAuth()
  const [ferienType, setFerienType] = useState(editData.ferienType ?? 'ferien')
  const [fromDate,   setFromDate]   = useState(editData.fromDate ?? '')
  const [toDate,     setToDate]     = useState(editData.toDate ?? '')
  const [note,       setNote]       = useState(editData.note ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [success,    setSuccess]    = useState(false)
  const [error,      setError]      = useState('')

  const isEdit = !!editData.id

  async function handleSave() {
    if (!profile || !fromDate || !toDate) return
    setError(''); setSubmitting(true)
    const username = profile.displayName || profile.username || ''
    try {
      if (isEdit) {
        // Remove old plan entries, then write new ones
        if (username && editData.fromDate && editData.toDate) {
          await manageFerienPlan(username, editData.fromDate, editData.toDate, 'remove')
        }
        await updateDoc(doc(db, 'planungRequests', editData.id!), {
          fromDate, toDate, note, ferienType, status: 'pending',
          adminNote: deleteField(), actionBy: deleteField(), actionAt: deleteField(), adjustmentSuggestions: deleteField()
        })
      } else {
        await addDoc(collection(db, 'planungRequests'), {
          type: 'ferien',
          uid: profile.uid,
          username,
          fromDate, toDate, note, ferienType,
          status: 'pending',
          createdAt: serverTimestamp(),
        })
      }
      // Write new entries to plan with "warten auf Freigabe" comment
      if (username) {
        await manageFerienPlan(username, fromDate, toDate, 'write', 'warten auf Freigabe', ferienTypeCode(ferienType))
      }
      setSuccess(true)
      setTimeout(onClose, 1200)
    } catch (e: any) {
      setError(e?.message || 'Fehler beim Speichern.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleWithdraw() {
    if (!editData.id || !profile) return
    const username = profile.displayName || profile.username || ''
    if (username && editData.fromDate && editData.toDate) {
      await manageFerienPlan(username, editData.fromDate, editData.toDate, 'remove')
    }
    await updateDoc(doc(db, 'planungRequests', editData.id), { status: 'withdrawn' })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? 'Absenheitsmeldung bearbeiten' : 'Absenheitsmeldung stellen'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"><X className="w-4 h-4"/></button>
        </div>

        {success ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <span className="text-4xl">✅</span>
            <p className="text-base font-semibold text-gray-700">{isEdit ? 'Antrag aktualisiert!' : 'Antrag eingereicht!'}</p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 p-5 space-y-4">
            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}

            {/* Adjustment suggestions */}
            {editData.adjustmentSuggestions && editData.adjustmentSuggestions.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-orange-700">Vorgeschlagene Alternativdaten:</p>
                {editData.adjustmentSuggestions.map((s, i) => (
                  <button key={i} onClick={() => { setFromDate(s.fromDate); setToDate(s.toDate) }}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-all ${fromDate === s.fromDate && toDate === s.toDate ? 'border-orange-400 bg-orange-100 text-orange-800 font-semibold ring-1 ring-orange-300' : 'border-orange-200 bg-white text-orange-700 hover:bg-orange-50'}`}>
                    {s.fromDate} – {s.toDate}
                  </button>
                ))}
              </div>
            )}

            {/* Type selector */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Art der Abwesenheit</p>
              <div className="grid grid-cols-1 gap-1.5">
                {Object.entries(FERIEN_TYPE_LABELS).map(([v, ft]) => (
                  <button key={v} onClick={() => setFerienType(v)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all text-left ${ferienType === v ? 'border-purple-500 bg-purple-50 text-purple-800 ring-1 ring-purple-400' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>
                    <span className="text-base leading-none">{ft.emoji}</span>
                    <span>{ft.label}</span>
                    {ferienType === v && <span className="ml-auto text-purple-500 text-xs">✓</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Von</span>
                <input type="date" value={fromDate}
                  onChange={e => { setFromDate(e.target.value); if (toDate && e.target.value > toDate) setToDate(e.target.value) }}
                  className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"/>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Bis</span>
                <input type="date" value={toDate} min={fromDate}
                  onChange={e => setToDate(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"/>
              </label>
            </div>

            {/* Note */}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Bemerkung (optional)</span>
              <textarea value={note} onChange={e => setNote(e.target.value)}
                placeholder="z.B. Familienurlaub, Hochzeit…"
                rows={2} className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-400"/>
            </label>
          </div>
        )}

        {/* Footer */}
        {!success && (
          <div className="px-5 py-4 border-t border-gray-100 flex items-center gap-2 shrink-0">
            {isEdit && (
              <button onClick={handleWithdraw}
                className="px-3 py-2 text-sm text-red-500 border border-red-200 bg-red-50 hover:bg-red-100 rounded-xl transition-colors font-medium">
                Zurückziehen
              </button>
            )}
            <button onClick={onClose} className="px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-xl transition-colors ml-auto">Abbrechen</button>
            <button onClick={handleSave} disabled={!fromDate || !toDate || submitting}
              className="px-4 py-2 text-sm bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-semibold">
              {submitting ? 'Wird gespeichert…' : isEdit ? 'Aktualisieren' : 'Antrag stellen'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AppShell() {
  const [menuOpen,      setMenuOpen]      = useState(false)
  const [opOpen,        setOpOpen]        = useState(false)
  const [userOpen,      setUserOpen]      = useState(false)
  const [bellOpen,      setBellOpen]      = useState(false)
  const [showProfile,   setShowProfile]   = useState(false)
  const [approvingId,   setApprovingId]   = useState<string|null>(null)
  const [approveError,  setApproveError]  = useState<string|null>(null)
  const [pendingRequests,     setPendingRequests]     = useState<PlanungRequest[]>([])
  const [pendingPwResets,     setPendingPwResets]     = useState<{id:string; email:string; createdAt?: unknown}[]>([])
  const [pendingMessages,     setPendingMessages]     = useState<{id:string; topic:string; senderName?:string; email?:string; note?:string; createdAt?:unknown}[]>([])
  const [myRequests,           setMyRequests]          = useState<PlanungRequest[]>([])
  const [allMyRequests,        setAllMyRequests]        = useState<PlanungRequest[]>([])
  const [showHistory,          setShowHistory]          = useState(false)
  const [adjustingId,         setAdjustingId]         = useState<string|null>(null)
  const [adjustNote,          setAdjustNote]          = useState('')
  const [adjustSuggestions,   setAdjustSuggestions]   = useState<{fromDate:string;toDate:string}[]>([])
  const [editingRequestId,    setEditingRequestId]    = useState<string|null>(null)
  const [editDraft,           setEditDraft]           = useState<Partial<PlanungRequest>>({})
  const [ferienModal,         setFerienModal]         = useState<FerienEditData|null>(null)
  const [taskNotifications,   setTaskNotifications]   = useState<TaskNotification[]>([])
  const [helpMode,            setHelpMode]            = useState(false)
  const [helpTooltip,         setHelpTooltip]         = useState<{entry: HelpEntry; position: {x:number;y:number}}|null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const userRef   = useRef<HTMLDivElement>(null)
  const bellRef   = useRef<HTMLDivElement>(null)
  const opRef     = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const { profile, isAdmin, isArzt, isGuest, isGeschaeftsleitung, logout,
          canAccessIvom, canAccessLager, canAccessPlanung, canAccessSOP, canAccessAufgaben,
          canAccessRecall, canAccessAkv,
          canAccessBenutzerverwaltung } = useAuth()

  // Close mobile menu on route change
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  // Auto-logout after 10 minutes of inactivity
  useEffect(() => {
    const TIMEOUT = 10 * 60 * 1000
    let timer: ReturnType<typeof setTimeout>
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => logout(), TIMEOUT) }
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => { clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)) }
  }, [logout])

  // Real-time listener for pending + provisional + approved planungRequests (admin + Geschäftsleitung)
  useEffect(() => {
    if (!isAdmin && !isGeschaeftsleitung) return
    const q = query(
      collection(db, 'planungRequests'),
      where('status', 'in', ['pending', 'provisional', 'approved'])
    )
    return onSnapshot(q, snap => {
      const reqs = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as PlanungRequest))
        .sort((a,b) => ((b.createdAt as any)?.seconds ?? 0) - ((a.createdAt as any)?.seconds ?? 0))
      setPendingRequests(reqs)
    })
  }, [isAdmin, isGeschaeftsleitung])

  // Real-time listener for own requests (non-admin users)
  useEffect(() => {
    if (isAdmin || isGeschaeftsleitung || !profile?.uid) return
    const q = query(
      collection(db, 'planungRequests'),
      where('uid', '==', profile.uid)
    )
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as PlanungRequest))
        .sort((a,b) => ((b.createdAt as any)?.seconds ?? 0) - ((a.createdAt as any)?.seconds ?? 0))
      // Active: exclude userArchived (bell-dismissed) & withdrawn
      const filtered = all.filter(r => !r.userArchived && r.status !== 'withdrawn')
      setMyRequests(filtered)
      setAllMyRequests(all)
    })
  }, [isAdmin, isGeschaeftsleitung, profile?.uid])

  // Real-time listener for pending password reset requests (admin only)
  useEffect(() => {
    if (!isAdmin && !isGeschaeftsleitung) return
    const q = query(collection(db, 'passwordResetRequests'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setPendingPwResets(snap.docs.map(d => ({ id: d.id, ...d.data() } as {id:string; email:string; createdAt?: unknown})))
    })
  }, [isAdmin])

  // Real-time listener for admin contact messages (admin only)
  useEffect(() => {
    if (!isAdmin && !isGeschaeftsleitung) return
    const q = query(collection(db, 'adminMessages'), where('status', '==', 'pending'))
    return onSnapshot(q, snap => {
      const msgs = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as {id:string; topic:string; senderName?:string; email?:string; note?:string; createdAt?:any}))
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
      setPendingMessages(msgs)
    })
  }, [isAdmin])

  // Task notifications for all non-guest users (assignments + comment replies)
  useEffect(() => {
    if (!profile?.uid || isGuest) return
    return subscribeTaskNotifications(profile.uid, setTaskNotifications)
  }, [profile?.uid, isGuest])

  async function approveRequest(req: PlanungRequest, mode: 'provisional' | 'approved' = 'approved', note?: string) {
    setApprovingId(req.id)
    setApproveError(null)
    try {
      // Plan entries were already written on request creation — only manage comments here
      const newComment = mode === 'provisional' ? (note ? `prov. – ${note}` : 'prov.') : null

      if (req.type === 'ferien' && req.fromDate && req.toDate && req.username) {
        await manageFerienPlan(req.username, req.fromDate, req.toDate, 'update-comment', newComment ?? undefined)
      } else if (req.type === 'eintrag' && req.dates && req.dates.length > 0 && req.username) {
        await updatePlanComment(req.personName || req.username, req.dates, newComment)
      } else if (req.type === 'absage' && req.year && req.myPerson && req.myDate) {
        await updatePlanComment(req.myPerson, [req.myDate], newComment, req.year)
      } else if (req.type === 'tausch' && req.year && req.myPerson && req.myDate) {
        const planRef = doc(db, 'planung', String(req.year))
        const update: Record<string, unknown> = {}
        if (mode === 'approved') {
          // Definitiv genehmigen: alte Einträge atomisch löschen
          update[`schedule.${req.myPerson}.${req.myDate}`] = deleteField()
          update[`comments.${req.myPerson}.${req.myDate}`] = deleteField()
        }
        // Kommentar auf neuem Eintrag setzen/löschen
        if (req.theirDate) {
          update[`comments.${req.myPerson}.${req.theirDate}`] = newComment ?? deleteField()
        }
        if (req.theirPerson && req.theirDate) {
          if (mode === 'approved') {
            update[`schedule.${req.theirPerson}.${req.theirDate}`] = deleteField()
            update[`comments.${req.theirPerson}.${req.theirDate}`] = deleteField()
          }
          update[`comments.${req.theirPerson}.${req.myDate}`] = newComment ?? deleteField()
        }
        if (Object.keys(update).length > 0) await updateDoc(planRef, update)
      }

      const actor = profile?.displayName || profile?.username || 'Admin'
      const approveUpdate: Record<string, unknown> = { status: mode, actionBy: actor, actionAt: serverTimestamp(), readByUser: false }
      if (mode === 'provisional' && note) approveUpdate.adminNote = note
      else approveUpdate.adminNote = deleteField()
      await updateDoc(doc(db, 'planungRequests', req.id), approveUpdate)
    } catch (e: any) {
      console.error('approveRequest error:', e)
      setApproveError(e?.message || 'Unbekannter Fehler')
    } finally {
      setApprovingId(null)
    }
  }
  async function rejectRequest(req: PlanungRequest) {
    const isRevoke = req.status === 'approved' || req.status === 'provisional'

    if (isRevoke) {
      // Widerrufen einer genehmigten/provisorischen Genehmigung:
      // Plan-Eintrag bleibt, nur Kommentar zurück auf "warten auf Freigabe"
      if (req.type === 'ferien' && req.fromDate && req.toDate && req.username) {
        await manageFerienPlan(req.username, req.fromDate, req.toDate, 'update-comment', 'warten auf Freigabe')
      } else if (req.type === 'eintrag' && req.dates && req.dates.length > 0 && req.username) {
        await updatePlanComment(req.personName || req.username, req.dates, 'warten auf Freigabe')
      } else if (req.type === 'absage' && req.year && req.myPerson && req.myDate) {
        await updatePlanComment(req.myPerson, [req.myDate], 'warten auf Freigabe', req.year)
      } else if (req.type === 'tausch' && req.year && req.myPerson && req.myDate) {
        // Revoke: restore old entries + reset comments to "warten auf Freigabe" — atomic dot-notation
        const planRef = doc(db, 'planung', String(req.year))
        const update: Record<string, unknown> = {}
        if (req.myCode) update[`schedule.${req.myPerson}.${req.myDate}`] = req.myCode
        if (req.theirDate) update[`comments.${req.myPerson}.${req.theirDate}`] = 'warten auf Freigabe'
        if (req.theirPerson && req.theirDate) {
          if (req.theirCode) update[`schedule.${req.theirPerson}.${req.theirDate}`] = req.theirCode
          update[`comments.${req.theirPerson}.${req.myDate}`] = 'warten auf Freigabe'
        }
        if (Object.keys(update).length > 0) await updateDoc(planRef, update)
      }
      await updateDoc(doc(db, 'planungRequests', req.id), {
        status: 'pending',
        adminNote: deleteField(), actionBy: deleteField(), actionAt: deleteField(),
        readByUser: false,
      })
    } else {
      // Ablehnen eines neuen (pending) Antrags: Plan-Einträge entfernen / rückgängig machen
      if (req.type === 'ferien' && req.fromDate && req.toDate && req.username) {
        await manageFerienPlan(req.username, req.fromDate, req.toDate, 'remove')
      }
      if (req.type === 'eintrag' && req.dates && req.dates.length > 0 && req.username) {
        await removePlanEntry(req.personName || req.username, req.dates)
      }
      if (req.type === 'absage' && req.year && req.myPerson && req.myDate) {
        // Atomic dot-notation: restore old code or delete entry, clear comment
        const planRef = doc(db, 'planung', String(req.year))
        const update: Record<string, unknown> = {}
        update[`schedule.${req.myPerson}.${req.myDate}`] = req.myCode ?? deleteField()
        update[`comments.${req.myPerson}.${req.myDate}`] = deleteField()
        await updateDoc(planRef, update)
      }
      if (req.type === 'tausch' && req.year && req.myPerson && req.myDate) {
        // Reject pending: remove only the new entries — old entries were kept and stay
        const planRef = doc(db, 'planung', String(req.year))
        const update: Record<string, unknown> = {}
        if (req.theirDate && req.theirPerson) {
          update[`schedule.${req.myPerson}.${req.theirDate}`] = deleteField()
          update[`schedule.${req.theirPerson}.${req.myDate}`] = deleteField()
          update[`comments.${req.myPerson}.${req.theirDate}`] = deleteField()
          update[`comments.${req.theirPerson}.${req.myDate}`] = deleteField()
        } else if (req.theirDate) {
          update[`schedule.${req.myPerson}.${req.theirDate}`] = deleteField()
          update[`comments.${req.myPerson}.${req.theirDate}`] = deleteField()
        }
        if (Object.keys(update).length > 0) await updateDoc(planRef, update)
      }
      const actor = profile?.displayName || profile?.username || 'Admin'
      await updateDoc(doc(db, 'planungRequests', req.id), { status: 'rejected', actionBy: actor, actionAt: serverTimestamp(), readByUser: false })
    }
  }
  async function requestAdjustment(id: string, note: string, suggestions?: {fromDate:string;toDate:string}[]) {
    const actor = profile?.displayName || profile?.username || 'Admin'
    const update: Record<string,unknown> = { status: 'adjustment', adminNote: note || 'Bitte Antrag anpassen.', actionBy: actor, actionAt: serverTimestamp(), readByUser: false }
    if (suggestions && suggestions.length > 0) update.adjustmentSuggestions = suggestions
    await updateDoc(doc(db, 'planungRequests', id), update)
  }

  async function handlePwReset(req: {id: string; email: string}) {
    try {
      await sendPasswordResetEmail(auth, req.email)
      const { getDocs, collection: col, query: q2, where: wh } = await import('firebase/firestore')
      const snap = await getDocs(q2(col(db, 'users'), wh('email', '==', req.email)))
      if (!snap.empty) {
        await updateDoc(snap.docs[0].ref, { mustChangePassword: true })
      }
      await updateDoc(doc(db, 'passwordResetRequests', req.id), { status: 'approved', approvedAt: serverTimestamp() })
    } catch {
      alert('Fehler beim Senden der Reset-E-Mail.')
    }
  }

  async function dismissPwReset(id: string) {
    await updateDoc(doc(db, 'passwordResetRequests', id), { status: 'rejected' })
  }

  async function dismissMessage(id: string) {
    await updateDoc(doc(db, 'adminMessages', id), { status: 'done' })
  }

  async function dismissMyRequest(id: string) {
    await updateDoc(doc(db, 'planungRequests', id), { userArchived: true })
  }

  async function markAllRead() {
    const unread = allMyRequests.filter(r => r.readByUser === false)
    await Promise.all(unread.map(r => updateDoc(doc(db, 'planungRequests', r.id), { readByUser: true })))
  }

  async function withdrawRequest(req: PlanungRequest) {
    // Ferien & Eintrag: delete entries + comments (new additions)
    if (req.type === 'ferien' && req.fromDate && req.toDate && req.username) {
      await manageFerienPlan(req.username, req.fromDate, req.toDate, 'remove')
    }
    if (req.type === 'eintrag' && req.dates && req.dates.length > 0 && req.username) {
      await removePlanEntry(req.username, req.dates)
    }
    // Absage: restore original code + remove comment — atomic dot-notation
    if (req.type === 'absage' && req.year && req.myPerson && req.myDate) {
      const planRef = doc(db, 'planung', String(req.year))
      const update: Record<string, unknown> = {}
      update[`schedule.${req.myPerson}.${req.myDate}`] = req.myCode ?? deleteField()
      update[`comments.${req.myPerson}.${req.myDate}`] = deleteField()
      await updateDoc(planRef, update)
    }
    // Tausch: undo swap + remove comments — atomic dot-notation
    if (req.type === 'tausch' && req.year && req.myPerson && req.myDate) {
      const planRef = doc(db, 'planung', String(req.year))
      const update: Record<string, unknown> = {}
      if (req.theirDate && req.theirPerson) {
        update[`schedule.${req.myPerson}.${req.myDate}`] = req.myCode ?? deleteField()
        update[`schedule.${req.theirPerson}.${req.theirDate}`] = req.theirCode ?? deleteField()
        update[`schedule.${req.myPerson}.${req.theirDate}`] = deleteField()
        update[`schedule.${req.theirPerson}.${req.myDate}`] = deleteField()
        update[`comments.${req.myPerson}.${req.theirDate}`] = deleteField()
        update[`comments.${req.theirPerson}.${req.myDate}`] = deleteField()
      } else if (req.theirDate) {
        update[`schedule.${req.myPerson}.${req.myDate}`] = req.myCode ?? deleteField()
        update[`schedule.${req.myPerson}.${req.theirDate}`] = deleteField()
        update[`comments.${req.myPerson}.${req.theirDate}`] = deleteField()
      }
      if (Object.keys(update).length > 0) await updateDoc(planRef, update)
    }
    await updateDoc(doc(db, 'planungRequests', req.id), { status: 'withdrawn' })
  }

  async function saveEditedRequest(id: string, patch: Partial<PlanungRequest>) {
    await updateDoc(doc(db, 'planungRequests', id), {
      ...patch, status: 'pending',
      adminNote: deleteField(), actionBy: deleteField(), actionAt: deleteField(), adjustmentSuggestions: deleteField()
    })
  }

  // Close menus on navigation
  useEffect(() => { setMenuOpen(false); setUserOpen(false); setOpOpen(false) }, [location.pathname])

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userRef.current   && !userRef.current.contains(e.target as Node))   setUserOpen(false)
      if (bellRef.current   && !bellRef.current.contains(e.target as Node))   setBellOpen(false)
      if (opRef.current     && !opRef.current.contains(e.target as Node))     setOpOpen(false)
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const initials  = (profile?.displayName || profile?.username)
    ?.split(' ').filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('') ?? '?'
  const roleLabel = isGuest ? 'Gast' : isGeschaeftsleitung ? 'Geschäftsleitung' : isArzt ? 'Arzt/Ärztin' : profile?.role === 'mpa' ? 'MPA' : 'Admin'
  const opActive  = opItems.some(i => location.pathname.startsWith(i.to))

  return (
    <div className="flex flex-col h-screen h-dvh bg-gray-50 overflow-hidden">
      <HelpModeOverlay
        active={helpMode}
        tooltip={helpTooltip}
        onTooltipClose={() => setHelpTooltip(null)}
        onTooltipOpen={(entry, position) => setHelpTooltip({ entry, position })}
      />
      {/* ── Top Navigation Bar ── */}
      <header ref={headerRef} className="bg-white border-b border-gray-200 shrink-0 z-30">
        <div className="flex items-center gap-2 px-4 h-14">

          {/* Logo (click → home) */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 shrink-0 mr-4 hover:opacity-80 transition-opacity"
          >
            <img src="/logo.png" alt="Augenzentrum Suhr" className="h-10 w-auto" />
          </button>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-0.5 flex-1">

            {/* OP dropdown */}
            {canAccessIvom && <div className="relative" ref={opRef}>
              <button
                data-help="nav-op"
                onClick={() => setOpOpen(v => !v)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                  opActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                OP
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', opOpen && 'rotate-180')} />
              </button>
              {opOpen && (
                <div className="absolute left-0 top-full mt-1 w-40 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">OP-Bereiche</div>
                  {opItems.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} className={({ isActive }) =>
                      cn('flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'text-primary-700 bg-primary-50' : 'text-gray-700 hover:bg-gray-100')}>
                      <Icon className="w-4 h-4 shrink-0" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>}

            {/* Lager */}
            {canAccessLager && (
              <NavLink data-help="nav-lager" to="/lager" className={({ isActive }) => navLinkClass(isActive)}>
                <Package className="w-4 h-4 shrink-0" />
                Lager
              </NavLink>
            )}

            {/* Einsatz */}
            {canAccessPlanung && (
              <NavLink data-help="nav-planung" to="/planung" className={({ isActive }) => navLinkClass(isActive)}>
                <CalendarDays className="w-4 h-4 shrink-0" />
                Einsatz
              </NavLink>
            )}

            {/* SOP */}
            {canAccessSOP && (
              <NavLink to="/sop" className={({ isActive }) => navLinkClass(isActive)}>
                <BookOpen className="w-4 h-4 shrink-0" />
                SOP
              </NavLink>
            )}

            {/* Admin + Benutzerverwaltung-Berechtigung */}
            {canAccessBenutzerverwaltung && (
              <NavLink data-help="nav-benutzer" to="/admin/users" className={({ isActive }) => navLinkClass(isActive)}>
                <Users className="w-4 h-4 shrink-0" />
                Benutzer
              </NavLink>
            )}

            {/* GL only: Antragsprotokoll (Admin sees it as tab in Benutzerverwaltung) */}
            {!isAdmin && isGeschaeftsleitung && (
              <NavLink to="/admin/log" className={({ isActive }) => navLinkClass(isActive)}>
                <ClipboardList className="w-4 h-4 shrink-0" />
                Protokoll
              </NavLink>
            )}

            {canAccessAufgaben && (
              <NavLink to="/aufgaben" className={({ isActive }) => navLinkClass(isActive)}>
                <LayoutList className="w-4 h-4 shrink-0" />
                Aufgaben
              </NavLink>
            )}

            {/* Recall */}
            {canAccessRecall && (
              <div className="flex flex-col">
                <NavLink to="/recall" className={({ isActive }) => navLinkClass(isActive)}>
                  <Phone className="w-4 h-4 shrink-0" />
                  Recall
                </NavLink>
                <NavLink to="/zuweisungen" className={({ isActive }) => cn(
                  'flex items-center gap-2 pl-7 pr-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                  isActive ? 'text-primary-700 bg-primary-50' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                )}>
                  <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />
                  Zuweisungen
                </NavLink>
              </div>
            )}

            {/* AKV */}
            {canAccessAkv && (
              <NavLink to="/akv" className={({ isActive }) => navLinkClass(isActive)}>
                <ClipboardList className="w-4 h-4 shrink-0" />
                AKV
              </NavLink>
            )}
          </nav>

          {/* Spacer on mobile */}
          <div className="flex-1 lg:hidden" />

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {/* Help button */}
            <div className="flex items-center gap-1">
              <button
                data-help-toggle
                onClick={() => { setHelpMode(v => !v); setHelpTooltip(null) }}
                className={`p-2 rounded-lg transition-colors ${helpMode ? 'bg-primary-100 text-primary-700' : 'text-gray-500 hover:bg-gray-100'}`}
                title={helpMode ? 'Hilfe-Modus beenden' : 'Hilfe-Modus'}
              >
                <HelpCircle className="w-5 h-5" />
              </button>
              <NavLink to="/hilfe" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" title="Benutzerhandbuch">
                <BookOpen className="w-5 h-5" />
              </NavLink>
            </div>
            {/* Bell (non-admin: own requests) */}
            {!isAdmin && !isGeschaeftsleitung && (isArzt || profile?.role === 'mpa') && (
              <div className="relative" ref={bellRef}>
                <button
                  onClick={() => {
                    setBellOpen(v => {
                      if (!v) markAllRead()
                      return !v
                    })
                    setUserOpen(false)
                  }}
                  className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  <Bell className="w-5 h-5" />
                  {(allMyRequests.some(r => r.readByUser === false) || taskNotifications.some(n => !n.read)) && (
                    <span className={`absolute -top-0.5 -right-0.5 w-4 h-4 text-white text-[10px] font-bold rounded-full flex items-center justify-center ${allMyRequests.some(r => r.readByUser === false && r.status === 'adjustment') ? 'bg-red-500' : allMyRequests.some(r => r.readByUser === false && r.status === 'provisional') ? 'bg-yellow-500' : 'bg-blue-500'}`}>
                      {allMyRequests.filter(r => r.readByUser === false).length + taskNotifications.filter(n => !n.read).length}
                    </span>
                  )}
                </button>
                {bellOpen && (
                  <div className="absolute right-0 top-full mt-1 w-80 max-w-[calc(100vw-1rem)] bg-white rounded-xl shadow-lg border border-gray-200 z-50 max-h-[80vh] overflow-y-auto">
                    {/* Task notifications — only unread, dismissed on Öffnen */}
                    {taskNotifications.filter(n => !n.read).length > 0 && (
                      <>
                        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                          <p className="text-sm font-semibold text-gray-800">Aufgaben</p>
                          <span className="text-xs text-gray-400">{taskNotifications.filter(n => !n.read).length} neu</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {taskNotifications.filter(n => !n.read).map(n => (
                            <div key={n.id} className="px-4 py-3 bg-blue-50/50 border-l-2 border-blue-400">
                              <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
                                  <LayoutList className="w-4 h-4 text-primary-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-gray-900 truncate">
                                    {n.type === 'comment' ? `${n.assignerName} hat kommentiert` : n.type === 'board_assignment' ? n.boardName : n.type === 'poll_assignment' ? n.cardTitle : n.cardTitle}
                                  </p>
                                  <p className="text-xs text-gray-500 truncate">
                                    {n.type === 'comment' ? n.cardTitle : n.type === 'board_assignment' ? `Board freigegeben · von ${n.assignerName}` : n.type === 'poll_assignment' ? `Umfrage freigegeben · von ${n.assignerName}` : `Zugewiesen · von ${n.assignerName}`}
                                  </p>
                                  {!!(n.createdAt) && (
                                    <p className="text-[10px] text-gray-400">
                                      {new Date(((n.createdAt as { seconds: number }).seconds) * 1000).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                  )}
                                </div>
                                <button onClick={() => { markTaskNotifRead(n.id); setBellOpen(false); navigate(n.type === 'poll_assignment' ? '/aufgaben' : n.type === 'board_assignment' ? `/aufgaben/${n.boardId}` : `/aufgaben/${n.boardId}?card=${n.cardId}`) }}
                                  className="text-xs text-primary-600 hover:text-primary-700 font-medium shrink-0 whitespace-nowrap">
                                  Öffnen →
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold text-gray-800">Meine Anträge</p>
                        <span className="text-xs text-gray-400">{(showHistory ? allMyRequests : myRequests).length} Einträge</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setShowHistory(false)}
                          className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors ${!showHistory ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                          Aktiv
                        </button>
                        <button onClick={() => setShowHistory(true)}
                          className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors ${showHistory ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                          Verlauf
                        </button>
                      </div>
                    </div>
                    {(showHistory ? allMyRequests : myRequests).length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-gray-400">{showHistory ? 'Kein Verlauf vorhanden' : 'Keine aktiven Anträge'}</div>
                    ) : (
                      <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                        {(showHistory ? allMyRequests : myRequests).map(r => {
                          const statusColor =
                            r.status === 'approved'     ? 'bg-green-100 text-green-700' :
                            r.status === 'provisional'  ? 'bg-yellow-100 text-yellow-700' :
                            r.status === 'rejected'     ? 'bg-red-100 text-red-700' :
                            r.status === 'adjustment'   ? 'bg-orange-100 text-orange-700' :
                            r.status === 'withdrawn'    ? 'bg-gray-100 text-gray-400' :
                                                          'bg-blue-100 text-blue-700'
                          const statusLabel =
                            r.status === 'approved'     ? 'Genehmigt' :
                            r.status === 'provisional'  ? 'Provisorisch' :
                            r.status === 'rejected'     ? 'Abgelehnt' :
                            r.status === 'adjustment'   ? 'Anpassung' :
                            r.status === 'withdrawn'    ? 'Zurückgezogen' :
                                                          'Ausstehend'
                          const canEdit = r.status === 'pending' || r.status === 'adjustment'
                          const isEditing = editingRequestId === r.id
                          const ferienInfo = r.type === 'ferien' && r.ferienType ? FERIEN_TYPE_LABELS[r.ferienType] : null
                          const typeLabel =
                            r.type === 'ferien'  ? (ferienInfo ? `${ferienInfo.emoji} ${ferienInfo.label}` : '🏖️ Ferien') :
                            r.type === 'tausch'  ? 'Einsatztausch' :
                            r.type === 'absage'  ? (r.newCode ? 'Änderung' : 'Absage') :
                                                   'Einsatz'
                          const isDimmed = r.status === 'withdrawn'
                          const isUnread = r.readByUser === false
                          const unreadBorder =
                            isUnread && r.status === 'adjustment'  ? 'border-l-2 border-orange-400 bg-orange-50/40' :
                            isUnread && r.status === 'provisional' ? 'border-l-2 border-yellow-400 bg-yellow-50/40' :
                            isUnread && r.status === 'rejected'    ? 'border-l-2 border-red-400 bg-red-50/30' :
                            isUnread                               ? 'border-l-2 border-blue-400 bg-blue-50/30' : ''
                          return (
                            <div key={r.id} className={`px-4 py-3 ${isDimmed ? 'opacity-50' : ''} ${unreadBorder}`}>
                              <div className="flex items-start gap-3">
                                <div className="relative w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0 mt-0.5">
                                  <CalendarDays className="w-4 h-4 text-purple-600" />
                                  {isUnread && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-blue-500 border border-white"/>}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className={`text-sm text-gray-800 ${isUnread ? 'font-bold' : 'font-medium'}`}>{typeLabel}</p>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${statusColor}`}>{statusLabel}</span>
                                    {!!(r.createdAt) && <span className="text-[10px] text-gray-400">{new Date(((r.createdAt as any).seconds)*1000).toLocaleDateString('de-CH',{day:'2-digit',month:'2-digit',year:'2-digit'})}</span>}
                                  </div>
                                  {r.type === 'eintrag' && r.dates && (
                                    <p className="text-xs text-gray-400 mt-0.5">
                                      {r.code} · {r.dates.length} Tag{r.dates.length !== 1 ? 'e' : ''}
                                      {r.dates.length > 0 && `: ${r.dates.slice(0,2).join(', ')}${r.dates.length > 2 ? ' …' : ''}`}
                                    </p>
                                  )}
                                  {r.type === 'ferien' && (
                                    <p className="text-xs text-gray-400 mt-0.5">{r.fromDate} – {r.toDate}</p>
                                  )}
                                  {r.type === 'tausch' && (
                                    <p className="text-xs text-gray-400 mt-0.5">{r.myDate} ↔ {r.theirDate}</p>
                                  )}
                                  {r.type === 'absage' && (
                                    <p className="text-xs text-gray-400 mt-0.5">{r.myCode} · {r.myDate}{r.newCode && ` → ${r.newCode}`}</p>
                                  )}
                                  {r.actionBy && r.status !== 'pending' && (()=>{
                                    const actionDate = r.actionAt ? new Date(((r.actionAt as {seconds:number}).seconds)*1000).toLocaleDateString('de-CH',{day:'2-digit',month:'2-digit'}) : ''
                                    const verb = r.status==='approved'?'Freigegeben':r.status==='provisional'?'Provisorisch':r.status==='rejected'?'Abgelehnt':'Angepasst'
                                    return(
                                      <p className="text-xs text-gray-400 mt-0.5">
                                        {verb} von <span className="font-medium text-gray-600">{r.actionBy}</span>{actionDate && ` · ${actionDate}`}
                                      </p>
                                    )
                                  })()}
                                  {(r.status === 'adjustment' || r.status === 'provisional') && r.adminNote && (
                                    <p className={`text-xs mt-1 italic ${r.status==='provisional'?'text-yellow-700':'text-orange-600'}`}>„{r.adminNote}"</p>
                                  )}
                                  {r.status === 'adjustment' && r.adjustmentSuggestions && r.adjustmentSuggestions.length > 0 && (
                                    <div className="mt-1.5 space-y-0.5">
                                      <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wide">Vorschläge:</p>
                                      {r.adjustmentSuggestions.map((s,i)=>(
                                        <p key={i} className="text-xs text-orange-700 bg-orange-50 rounded px-2 py-0.5">
                                          {s.fromDate} – {s.toDate}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                  {/* Inline edit form for ferien/tausch/absage */}
                                  {isEditing && r.type !== 'eintrag' && r.type !== 'ferien' && (
                                    <div className="mt-2 flex flex-col gap-1.5 bg-gray-50 rounded-lg p-2 border border-gray-200">
                                      <div>
                                        <label className="text-[10px] text-gray-500">Notiz:</label>
                                        <input className="w-full text-xs border border-gray-200 rounded px-2 py-1 mt-0.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
                                          placeholder="Optionale Bemerkung…"
                                          value={editDraft.note ?? r.note ?? ''}
                                          onChange={e => setEditDraft(d => ({...d, note: e.target.value}))}
                                        />
                                      </div>
                                      <div className="flex gap-1.5 mt-0.5">
                                        <button onClick={async () => { await saveEditedRequest(r.id, editDraft); setEditingRequestId(null); setEditDraft({}) }}
                                          className="flex-1 py-1 text-xs font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">
                                          Speichern
                                        </button>
                                        <button onClick={() => { setEditingRequestId(null); setEditDraft({}) }}
                                          className="px-3 py-1 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                                          Abbrechen
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-col gap-1 shrink-0">
                                  {canEdit && !isEditing && (
                                    <button onClick={() => {
                                        if (r.type === 'eintrag') {
                                          setBellOpen(false)
                                          navigate('/planung', { state: { editRequest: { id: r.id, dates: r.dates, code: r.code, username: r.username } } })
                                        } else if (r.type === 'ferien') {
                                          setBellOpen(false)
                                          setFerienModal({ id: r.id, fromDate: r.fromDate, toDate: r.toDate, note: r.note, ferienType: r.ferienType, adjustmentSuggestions: r.adjustmentSuggestions })
                                        } else {
                                          setEditingRequestId(r.id); setEditDraft({})
                                        }
                                      }}
                                      className="p-1.5 rounded-lg bg-blue-50 text-blue-500 hover:bg-blue-100 transition-colors" title="Bearbeiten">
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                    </button>
                                  )}
                                  {canEdit && !isEditing && (
                                    <button onClick={() => withdrawRequest(r)}
                                      className="p-1.5 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 transition-colors" title="Zurückziehen">
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  {(r.status === 'approved' || r.status === 'provisional' || r.status === 'rejected' || r.status === 'withdrawn') && (
                                    <button onClick={() => dismissMyRequest(r.id)}
                                      className="p-1.5 rounded-lg bg-gray-50 text-gray-400 hover:bg-gray-100 transition-colors" title="Entfernen">
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Bell (admin + Geschäftsleitung) */}
            {(isAdmin || isGeschaeftsleitung) && (
              <div className="relative" ref={bellRef}>
                <button
                  data-help="header-bell"
                  onClick={() => {
                    setBellOpen(v => !v)
                    setUserOpen(false)
                  }}
                  className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  <Bell className="w-5 h-5" />
                  {(pendingRequests.filter(r=>r.status!=='approved').length + pendingPwResets.length + pendingMessages.length + taskNotifications.filter(n=>!n.read).length) > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {pendingRequests.filter(r=>r.status!=='approved').length + pendingPwResets.length + pendingMessages.length + taskNotifications.filter(n=>!n.read).length}
                    </span>
                  )}
                </button>
                {bellOpen && (
                  <div className="absolute right-0 top-full mt-1 w-80 max-w-[calc(100vw-1rem)] bg-white rounded-xl shadow-lg border border-gray-200 z-50 max-h-[80vh] overflow-y-auto">
                    {/* Task notifications for managers — only unread, dismissed on Öffnen */}
                    {taskNotifications.filter(n => !n.read).length > 0 && (
                      <>
                        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                          <p className="text-sm font-semibold text-gray-800">Aufgaben</p>
                          <span className="text-xs text-gray-400">{taskNotifications.filter(n => !n.read).length} neu</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {taskNotifications.filter(n => !n.read).map(n => (
                            <div key={n.id} className="px-4 py-3 bg-blue-50/50 border-l-2 border-blue-400">
                              <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
                                  <LayoutList className="w-4 h-4 text-primary-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-gray-900 truncate">
                                    {n.type === 'comment' ? `${n.assignerName} hat kommentiert` : n.type === 'board_assignment' ? n.boardName : n.type === 'poll_assignment' ? n.cardTitle : n.cardTitle}
                                  </p>
                                  <p className="text-xs text-gray-500 truncate">
                                    {n.type === 'comment' ? n.cardTitle : n.type === 'board_assignment' ? `Board freigegeben · von ${n.assignerName}` : n.type === 'poll_assignment' ? `Umfrage freigegeben · von ${n.assignerName}` : `von ${n.assignerName}`}
                                  </p>
                                </div>
                                <button onClick={() => { markTaskNotifRead(n.id); setBellOpen(false); navigate(n.type === 'poll_assignment' ? '/aufgaben' : n.type === 'board_assignment' ? `/aufgaben/${n.boardId}` : `/aufgaben/${n.boardId}?card=${n.cardId}`) }}
                                  className="text-xs text-primary-600 hover:text-primary-700 font-medium shrink-0 whitespace-nowrap">
                                  Öffnen →
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {/* Admin-Nachrichten (oben) */}
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                      <p className="text-sm font-semibold text-gray-800">Nachrichten</p>
                      <span className="text-xs text-gray-400">{pendingMessages.length} ausstehend</span>
                    </div>
                    {pendingMessages.length === 0 ? (
                      <div className="px-4 py-3 text-center text-sm text-gray-400">Keine Nachrichten</div>
                    ) : (
                      <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
                        {pendingMessages.map(m => {
                          const isLogin = m.topic === 'login'
                          const topicLabel = isLogin ? 'Loginanfrage' : 'Andere'
                          return (
                            <div key={m.id} className="px-4 py-3 flex items-start gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isLogin ? 'bg-green-100' : 'bg-blue-100'}`}>
                                <MessageSquare className={`w-4 h-4 ${isLogin ? 'text-green-600' : 'text-blue-600'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800">{topicLabel}</p>
                                {m.senderName && <p className="text-xs text-gray-500">{m.senderName}</p>}
                                {m.email && <p className="text-xs text-gray-400">{m.email}</p>}
                                {m.note && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{m.note}</p>}
                              </div>
                              {isLogin ? (
                                <button
                                  onClick={() => {
                                    dismissMessage(m.id).catch(() => {})
                                    navigate(`/admin/users?addUser=1&name=${encodeURIComponent(m.senderName ?? '')}&email=${encodeURIComponent(m.email ?? '')}`)
                                  }}
                                  className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors shrink-0 font-semibold"
                                  title="Konto erstellen">
                                  <Users className="w-3.5 h-3.5" /> Konto erstellen
                                </button>
                              ) : (
                                <button onClick={() => dismissMessage(m.id)}
                                  className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors shrink-0" title="Erledigt">
                                  <Check className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Planungsanträge section */}
                    <div className="px-4 py-3 border-t border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                      <p className="text-sm font-semibold text-gray-800">Planungsanträge</p>
                      <span className="text-xs text-gray-400">{pendingRequests.filter(r=>r.status!=='approved').length} ausstehend</span>
                    </div>
                    {pendingRequests.filter(r=>r.status!=='approved').length === 0 ? (
                      <div className="px-4 py-4 text-center text-sm text-gray-400">Keine ausstehenden Anträge</div>
                    ) : (
                      <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
                        {pendingRequests.filter(r=>r.status!=='approved').map(r => (
                          <div key={r.id} className="px-4 py-3">
                            <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0 mt-0.5">
                              <span className="text-xs font-bold text-purple-700">
                                {r.username?.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{r.username}</p>
                              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
                                {r.type === 'ferien' ? (()=>{ const fi=r.ferienType?FERIEN_TYPE_LABELS[r.ferienType]:null; return fi?`${fi.emoji} ${fi.label}`:'🏖️ Ferien' })() : r.type === 'tausch' ? 'Einsatztausch' : r.type === 'absage' ? (r.newCode ? 'Änderungsanfrage' : 'Absage') : 'Einsatz'}
                              </p>
                              {r.type === 'ferien' ? (
                                <p className="text-xs text-gray-400">{r.fromDate} – {r.toDate}</p>
                              ) : r.type === 'tausch' ? (
                                <p className="text-xs text-gray-400">
                                  {r.myDate} ↔ {r.theirDate} ({r.theirPerson})
                                </p>
                              ) : r.type === 'absage' ? (
                                <p className="text-xs text-gray-400">
                                  {r.myCode} · {r.myDate}
                                  {r.newCode && <> → <span className="font-semibold text-orange-600">{r.newCode}</span></>}
                                  {r.note && <> · <span className="italic">{r.note}</span></>}
                                </p>
                              ) : (
                                <p className="text-xs text-gray-400">
                                  {r.code} · {r.dates?.length ?? 0} Tag{(r.dates?.length ?? 0) !== 1 ? 'e' : ''}
                                  {r.dates && r.dates.length > 0 && `: ${r.dates.slice(0,2).join(', ')}${r.dates.length > 2 ? ' …' : ''}`}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              {approvingId === r.id ? (
                                <span className="text-xs text-gray-400 self-center px-1">…</span>
                              ) : (<>
                                {r.status !== 'provisional' && (
                                  <button onClick={() => approveRequest(r, 'provisional')}
                                    className="p-1.5 rounded-lg transition-colors bg-yellow-50 text-yellow-600 hover:bg-yellow-100" title="Provisorisch genehmigen">
                                    <span className="text-[10px] font-bold leading-none px-0.5">P</span>
                                  </button>
                                )}
                                <button onClick={() => approveRequest(r, 'approved')}
                                  className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors" title={r.status === 'provisional' ? 'Definitiv genehmigen' : 'Genehmigen'}>
                                  <Check className="w-4 h-4" />
                                </button>
                                {r.status !== 'provisional' && (
                                  <button onClick={() => { setAdjustingId(adjustingId===r.id?null:r.id); setAdjustNote(''); setAdjustSuggestions([]) }}
                                    className={`p-1.5 rounded-lg transition-colors ${adjustingId===r.id?'bg-orange-200 text-orange-700':'bg-orange-50 text-orange-500 hover:bg-orange-100'}`} title="Anpassung anfordern">
                                    <span className="text-xs font-bold px-0.5">↩</span>
                                  </button>
                                )}
                                <button onClick={() => rejectRequest(r)}
                                  className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors" title="Ablehnen">
                                  <UserX className="w-4 h-4" />
                                </button>
                              </>)}
                            </div>
                            {approveError && approvingId === null && (
                              <p className="text-xs text-red-500 mt-1">{approveError}</p>
                            )}
                            </div>
                            {adjustingId===r.id&&(
                              <div className="mt-2 space-y-2">
                                <input
                                  type="text"
                                  value={adjustNote}
                                  onChange={e=>setAdjustNote(e.target.value)}
                                  placeholder="Hinweis für Anpassung…"
                                  className="w-full text-xs border border-orange-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
                                  autoFocus
                                />
                                {r.type==='ferien'&&(
                                  <div className="space-y-1.5">
                                    <p className="text-[10px] font-semibold text-orange-600 uppercase tracking-wide">Vorschläge (optional)</p>
                                    {adjustSuggestions.map((s,i)=>(
                                      <div key={i} className="flex items-center gap-1.5">
                                        <input type="date" value={s.fromDate}
                                          onChange={e=>setAdjustSuggestions(prev=>prev.map((x,j)=>j===i?{...x,fromDate:e.target.value}:x))}
                                          className="flex-1 text-xs border border-orange-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"/>
                                        <span className="text-[10px] text-gray-400">–</span>
                                        <input type="date" value={s.toDate} min={s.fromDate}
                                          onChange={e=>setAdjustSuggestions(prev=>prev.map((x,j)=>j===i?{...x,toDate:e.target.value}:x))}
                                          className="flex-1 text-xs border border-orange-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"/>
                                        <button onClick={()=>setAdjustSuggestions(prev=>prev.filter((_,j)=>j!==i))}
                                          className="p-0.5 text-red-400 hover:text-red-600 transition-colors">
                                          <X className="w-3 h-3"/>
                                        </button>
                                      </div>
                                    ))}
                                    <button onClick={()=>setAdjustSuggestions(prev=>[...prev,{fromDate:'',toDate:''}])}
                                      className="text-[10px] text-orange-500 hover:text-orange-700 font-semibold flex items-center gap-1 transition-colors">
                                      <span>+ Vorschlag hinzufügen</span>
                                    </button>
                                  </div>
                                )}
                                <button
                                  onClick={()=>{
                                    const validSuggestions=adjustSuggestions.filter(s=>s.fromDate&&s.toDate)
                                    requestAdjustment(r.id,adjustNote,r.type==='ferien'?validSuggestions:undefined)
                                    setAdjustingId(null); setAdjustNote(''); setAdjustSuggestions([])
                                  }}
                                  className="w-full text-xs px-3 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold">
                                  Anpassung senden
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Genehmigte Anträge → Link zum Antragsprotokoll */}
                    {pendingRequests.filter(r=>r.status==='approved').length > 0 && (
                      <div className="px-4 py-3 border-t border-gray-100">
                        <button
                          onClick={()=>{ setBellOpen(false); navigate('/admin/users?tab=log') }}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-green-50 border border-green-200 hover:bg-green-100 transition-colors">
                          <div className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-green-600 shrink-0"/>
                            <span className="text-sm font-semibold text-green-800">
                              {pendingRequests.filter(r=>r.status==='approved').length} genehmigte Anträge
                            </span>
                          </div>
                          <span className="text-xs text-green-600 font-medium">Antragsprotokoll →</span>
                        </button>
                      </div>
                    )}

                    {/* Passwort-Reset-Anfragen */}
                    <div className="px-4 py-3 border-t border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                      <p className="text-sm font-semibold text-gray-800">Passwort vergessen</p>
                      <span className="text-xs text-gray-400">{pendingPwResets.length} ausstehend</span>
                    </div>
                    {pendingPwResets.length === 0 ? (
                      <div className="px-4 py-3 text-center text-sm text-gray-400">Keine Anfragen</div>
                    ) : (
                      <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
                        {pendingPwResets.map(r => (
                          <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                              <KeyRound className="w-4 h-4 text-amber-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{r.email}</p>
                              <p className="text-xs text-gray-400">Passwort-Reset angefragt</p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button onClick={() => handlePwReset(r)}
                                className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                                title="Reset-E-Mail senden">
                                <Mail className="w-4 h-4" />
                              </button>
                              <button onClick={() => dismissPwReset(r.id)}
                                className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                                title="Ablehnen">
                                <UserX className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="px-4 py-2 border-t border-gray-100">
                      <NavLink to="/admin/users"
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                        Alle Benutzer verwalten →
                      </NavLink>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User dropdown */}
            {profile && (
              <div className="relative" ref={userRef}>
                <button
                  data-help="header-user"
                  onClick={() => setUserOpen(v => !v)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                    <span className="text-[11px] font-bold text-primary-700">{initials}</span>
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className="text-xs font-semibold text-gray-800 leading-tight">{profile.displayName || profile.username}</p>
                    <p className="text-[10px] text-gray-400 leading-tight">{roleLabel}</p>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400 hidden sm:block" />
                </button>
                {userOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50">
                    <div className="px-3 py-2 border-b border-gray-100">
                      <p className="text-xs font-semibold text-gray-800">{profile.displayName || profile.username}</p>
                      <p className="text-[11px] text-gray-400">{roleLabel}</p>
                    </div>
                    <button
                      onClick={() => { setUserOpen(false); setShowProfile(true) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <UserCog className="w-4 h-4" />
                      Mein Profil
                    </button>
                    <button
                      onClick={() => { setUserOpen(false); logout() }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Abmelden
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Hamburger (mobile) */}
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <div className="lg:hidden border-t border-gray-200 bg-white px-4 py-3 space-y-1">
            {/* OP section */}
            {canAccessIvom && <>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 px-3 pt-1 pb-0.5">OP</p>
              {opItems.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={({ isActive }) => mobileNavLinkClass(isActive)}>
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </NavLink>
              ))}
              <div className="pt-1 border-t border-gray-100 mt-1" />
            </>}
            {canAccessLager && (
              <NavLink to="/lager" className={({ isActive }) => mobileNavLinkClass(isActive)}>
                <Package className="w-4 h-4 shrink-0" />
                Lager
              </NavLink>
            )}
            {canAccessPlanung && (
              <NavLink to="/planung" className={({ isActive }) => mobileNavLinkClass(isActive)}>
                <CalendarDays className="w-4 h-4 shrink-0" />
                Einsatz
              </NavLink>
            )}
            {canAccessSOP && (
              <NavLink to="/sop" className={({ isActive }) => mobileNavLinkClass(isActive)}>
                <BookOpen className="w-4 h-4 shrink-0" />
                SOP
              </NavLink>
            )}
            {canAccessBenutzerverwaltung && (
              <NavLink to="/admin/users" className={({ isActive }) => mobileNavLinkClass(isActive)}>
                <Users className="w-4 h-4 shrink-0" />
                Benutzerverwaltung
              </NavLink>
            )}
            {!isAdmin && isGeschaeftsleitung && (
              <NavLink to="/admin/log" className={({ isActive }) => mobileNavLinkClass(isActive)}>
                <ClipboardList className="w-4 h-4 shrink-0" />
                Antragsprotokoll
              </NavLink>
            )}
            {canAccessAufgaben && (
              <NavLink to="/aufgaben" className={({ isActive }) => mobileNavLinkClass(isActive)}>
                <LayoutList className="w-4 h-4 shrink-0" />
                Aufgaben
              </NavLink>
            )}
            {canAccessRecall && (
              <>
                <NavLink to="/recall" className={({ isActive }) => mobileNavLinkClass(isActive)}>
                  <Phone className="w-4 h-4 shrink-0" />
                  Recall
                </NavLink>
                <NavLink to="/zuweisungen" className={({ isActive }) => cn(
                  'flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                )}>
                  <ArrowRightLeft className="w-4 h-4 shrink-0" />
                  Zuweisungen
                </NavLink>
              </>
            )}
            {canAccessAkv && (
              <NavLink to="/akv" className={({ isActive }) => mobileNavLinkClass(isActive)}>
                <ClipboardList className="w-4 h-4 shrink-0" />
                AKV
              </NavLink>
            )}
            <div className="pt-2 border-t border-gray-100">
              <button
                onClick={() => { setMenuOpen(false); logout() }}
                className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                Abmelden
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── Page Content ── */}
      <main className="flex-1 overflow-auto min-w-0">
        <Outlet />
      </main>

      {/* Profile modal */}
      {showProfile && profile && (
        <ProfileModal profile={profile} onClose={() => setShowProfile(false)} onSaved={(u) => { /* profile update handled inside */ }} />
      )}
      {ferienModal && (
        <FerienAntragModal editData={ferienModal} onClose={() => setFerienModal(null)} />
      )}
    </div>
  )
}

// ── Profile Modal ──────────────────────────────────────────────────────────────

const ROLE_LABEL_MAP: Record<string, string> = {
  admin: 'Admin', arzt: 'Arzt/Ärztin', mpa: 'MPA', gast: 'Gast (nur lesen)'
}

function ProfileModal({ profile, onClose }: { profile: import('../../lib/AuthContext').UserProfile; onClose: () => void; onSaved: (u: import('../../lib/AuthContext').UserProfile) => void }) {
  const { refreshProfile } = useAuth()
  const [tab, setTab] = useState<'info' | 'pw'>('info')
  // Info tab
  const [username,    setUsername]    = useState(profile.username || '')
  const [displayName, setDisplayName] = useState(profile.displayName || '')
  const [infoMsg,     setInfoMsg]     = useState('')
  const [infoErr,     setInfoErr]     = useState('')
  const [infoSaving,  setInfoSaving]  = useState(false)
  // Password tab
  const [currentPw, setCurrentPw] = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [newPw2,    setNewPw2]    = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [pwMsg,     setPwMsg]     = useState('')
  const [pwErr,     setPwErr]     = useState('')
  const [pwSaving,  setPwSaving]  = useState(false)

  const saveInfo = async () => {
    if (!username.trim()) { setInfoErr('Benutzername darf nicht leer sein.'); return }
    setInfoSaving(true); setInfoErr(''); setInfoMsg('')
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
      })
      await refreshProfile()
      setInfoMsg('Angaben gespeichert.')
    } catch { setInfoErr('Fehler beim Speichern.') }
    finally { setInfoSaving(false) }
  }

  const savePw = async () => {
    setPwErr(''); setPwMsg('')
    if (newPw.length < 6) { setPwErr('Neues Passwort muss mind. 6 Zeichen haben.'); return }
    if (newPw !== newPw2) { setPwErr('Passwörter stimmen nicht überein.'); return }
    if (!currentPw) { setPwErr('Bitte aktuelles Passwort eingeben.'); return }
    setPwSaving(true)
    try {
      const user = auth.currentUser
      if (!user || !user.email) throw new Error('no user')
      const cred = EmailAuthProvider.credential(user.email, currentPw)
      await reauthenticateWithCredential(user, cred)
      await updatePassword(user, newPw)
      setPwMsg('Passwort erfolgreich geändert.')
      setCurrentPw(''); setNewPw(''); setNewPw2('')
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') setPwErr('Aktuelles Passwort falsch.')
      else setPwErr('Fehler beim Ändern des Passworts.')
    } finally { setPwSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
              <span className="text-sm font-bold text-primary-700">
                {(profile.username || profile.displayName)?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="font-semibold text-gray-900">{profile.username || profile.displayName}</p>
              <p className="text-xs text-gray-400">{ROLE_LABEL_MAP[profile.role] ?? profile.role}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-4 pt-2">
          {(['info', 'pw'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors mr-1
                ${tab === t ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {t === 'info' ? 'Meine Angaben' : 'Passwort ändern'}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 space-y-4">
          {tab === 'info' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Benutzername *</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Vollständiger Name</label>
                <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Vorname Nachname" />
              </div>
              <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500 space-y-1">
                <p><span className="font-medium">E-Mail:</span> {profile.email}</p>
                <p><span className="font-medium">Funktion:</span> {ROLE_LABEL_MAP[profile.role] ?? profile.role}</p>
              </div>
              {infoErr && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{infoErr}</p>}
              {infoMsg && <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">{infoMsg}</p>}
              <button onClick={saveInfo} disabled={infoSaving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700
                  text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
                <Save className="w-4 h-4" />
                {infoSaving ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </>
          )}

          {tab === 'pw' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Aktuelles Passwort</label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw ? <X className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Neues Passwort</label>
                <input type={showPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Mindestens 6 Zeichen" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Passwort bestätigen</label>
                <input type={showPw ? 'text' : 'password'} value={newPw2} onChange={e => setNewPw2(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Wiederholen" />
              </div>
              {pwErr && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{pwErr}</p>}
              {pwMsg && <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">{pwMsg}</p>}
              <button onClick={savePw} disabled={pwSaving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700
                  text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
                <KeyRound className="w-4 h-4" />
                {pwSaving ? 'Wird geändert…' : 'Passwort ändern'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
