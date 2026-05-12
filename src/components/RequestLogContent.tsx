import { useEffect, useState, useMemo } from 'react'
import { collection, onSnapshot, orderBy, query, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { Search, Trash2, ChevronDown, ChevronUp, X } from 'lucide-react'

// ── Unified log entry ─────────────────────────────────────────────────────────

export interface AnyLogEntry {
  id: string
  logType: 'planung' | 'registration' | 'password_reset'
  status: string
  createdAt?: { seconds: number }
  actionAt?: { seconds: number }
  actionBy?: string
  adminNote?: string
  // planung fields
  type?: string
  username?: string
  fromDate?: string; toDate?: string; note?: string; ferienType?: string
  adjustmentSuggestions?: { fromDate: string; toDate: string }[]
  dates?: string[]; code?: string; section?: string
  myDate?: string; myCode?: string; myPerson?: string; newCode?: string | null
  theirDate?: string; theirPerson?: string; year?: number
  // registration fields (adminMessages)
  senderName?: string
  email?: string
  topic?: string
  // password_reset fields
  approvedAt?: { seconds: number }
}

// ── Label / style maps ────────────────────────────────────────────────────────

const PLANUNG_TYPE_LABEL: Record<string, string> = {
  ferien: 'Ferien', eintrag: 'Einsatz', tausch: 'Einsatztausch', absage: 'Absage / Änderung',
}
const PLANUNG_TYPE_COLOR: Record<string, string> = {
  ferien: 'bg-slate-100 text-slate-700', eintrag: 'bg-blue-100 text-blue-700',
  tausch: 'bg-teal-100 text-teal-700',   absage:  'bg-red-100 text-red-700',
}

function entryTypeLabel(r: AnyLogEntry): string {
  if (r.logType === 'registration')   return 'Registrierung'
  if (r.logType === 'password_reset') return 'Passwort vergessen'
  return PLANUNG_TYPE_LABEL[r.type ?? ''] ?? r.type ?? '—'
}
function entryTypeColor(r: AnyLogEntry): string {
  if (r.logType === 'registration')   return 'bg-purple-100 text-purple-700'
  if (r.logType === 'password_reset') return 'bg-amber-100 text-amber-700'
  return PLANUNG_TYPE_COLOR[r.type ?? ''] ?? 'bg-gray-100 text-gray-600'
}

const STATUS_COLOR: Record<string, string> = {
  pending:     'bg-amber-50 text-amber-700 border-amber-200',
  approved:    'bg-green-50 text-green-700 border-green-200',
  provisional: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  rejected:    'bg-red-50 text-red-600 border-red-200',
  adjustment:  'bg-orange-50 text-orange-700 border-orange-200',
  dismissed:   'bg-gray-50 text-gray-400 border-gray-200',
  withdrawn:   'bg-gray-50 text-gray-400 border-gray-200',
  done:        'bg-green-50 text-green-700 border-green-200',
}
const STATUS_LABEL: Record<string, string> = {
  pending:     'Ausstehend',
  approved:    'Genehmigt',
  provisional: 'Provisorisch',
  rejected:    'Abgelehnt',
  adjustment:  'Anpassung nötig',
  dismissed:   'Erledigt',
  withdrawn:   'Zurückgezogen',
  done:        'Erledigt',
}
const FERIEN_TYPE: Record<string, string> = {
  ferien: 'Ferien', kurs: 'Kurs / Weiterbildung', kongress: 'Kongress / Tagung',
  militaer: 'Militär / Zivildienst', sonstiges: 'Sonstiges',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts?: { seconds: number }): string {
  if (!ts) return '—'
  return new Date(ts.seconds * 1000).toLocaleString('de-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
function fmtDate(d?: string): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-'); return `${day}.${m}.${y}`
}

function entryDates(r: AnyLogEntry): string {
  if (r.logType === 'registration')   return r.email ?? '—'
  if (r.logType === 'password_reset') return r.email ?? '—'
  if (r.type === 'ferien')  return `${fmtDate(r.fromDate)} – ${fmtDate(r.toDate)}`
  if (r.type === 'eintrag') {
    if (!r.dates?.length) return '—'
    return r.dates.length === 1 ? fmtDate(r.dates[0])
      : `${r.dates.length} Tage: ${r.dates.slice(0, 2).map(fmtDate).join(', ')}${r.dates.length > 2 ? ` +${r.dates.length - 2}` : ''}`
  }
  if (r.type === 'tausch') return `${fmtDate(r.myDate)} ⇄ ${fmtDate(r.theirDate)}${r.theirPerson ? ` (${r.theirPerson})` : ''}`
  if (r.type === 'absage') return `${fmtDate(r.myDate)}${r.myCode ? ` · ${r.myCode}` : ''}${r.newCode ? ` → ${r.newCode}` : ''}`
  return '—'
}

function entryName(r: AnyLogEntry): string {
  if (r.logType === 'registration')   return r.senderName ?? r.email ?? '—'
  if (r.logType === 'password_reset') return r.username ?? r.email ?? '—'
  return r.username ?? '—'
}

function matchesSearch(r: AnyLogEntry, q: string): boolean {
  if (!q) return true
  const lq = q.toLowerCase()
  return [
    r.username, r.senderName, r.email, r.type, r.logType, r.status,
    r.adminNote, r.actionBy, r.fromDate, r.toDate, r.myDate, r.theirDate,
    r.code, r.myCode, r.newCode, r.ferienType, r.note, r.section, r.topic,
    ...(r.dates ?? []),
  ].some(v => v?.toLowerCase().includes(lq))
}

// ── Detail row ────────────────────────────────────────────────────────────────

function Detail({ label, value, full }: { label: string; value?: string | null; full?: boolean }) {
  if (!value) return null
  return (
    <div className={full ? 'col-span-full' : ''}>
      <span className="font-semibold text-gray-500 mr-1">{label}:</span>
      <span className="text-gray-700">{value}</span>
    </div>
  )
}

// ── Log row ───────────────────────────────────────────────────────────────────

function LogRow({ r, isAdmin, onDelete }: {
  r: AnyLogEntry; isAdmin: boolean; onDelete: (logType: AnyLogEntry['logType'], id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  return (
    <div className={`border rounded-xl overflow-hidden ${expanded ? 'border-gray-300 shadow-sm' : 'border-gray-200'}`}>
      {/* Compact row */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-gray-50 select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded shrink-0 ${entryTypeColor(r)}`}>
          {entryTypeLabel(r)}
        </span>
        <span className="text-sm font-semibold text-gray-800 truncate min-w-0 flex-1">{entryName(r)}</span>
        <span className="text-xs text-gray-500 shrink-0 hidden sm:block max-w-[180px] truncate">{entryDates(r)}</span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${STATUS_COLOR[r.status] ?? 'bg-gray-50 text-gray-400 border-gray-200'}`}>
          {STATUS_LABEL[r.status] ?? r.status}
        </span>
        <span className="text-xs text-gray-400 shrink-0 hidden md:block">{fmtTs(r.createdAt)}</span>
        <span className="text-gray-300 shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 bg-gray-50/40 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600">

            {r.logType === 'registration' && <>
              <Detail label="Name"        value={r.senderName} />
              <Detail label="E-Mail"      value={r.email} />
              <Detail label="Notiz"       value={r.note} full />
              <Detail label="Status"      value={STATUS_LABEL[r.status] ?? r.status} />
              <Detail label="Eingereicht" value={fmtTs(r.createdAt)} />
            </>}

            {r.logType === 'password_reset' && <>
              <Detail label="Benutzer"    value={r.username} />
              <Detail label="E-Mail"      value={r.email} />
              <Detail label="Status"      value={STATUS_LABEL[r.status] ?? r.status} />
              <Detail label="Eingereicht" value={fmtTs(r.createdAt)} />
              {r.approvedAt && <Detail label="Bearbeitet am" value={fmtTs(r.approvedAt)} />}
            </>}

            {r.logType === 'planung' && <>
              <Detail label="Benutzer"   value={r.username} />
              <Detail label="Typ"        value={PLANUNG_TYPE_LABEL[r.type ?? ''] ?? r.type} />
              <Detail label="Status"     value={STATUS_LABEL[r.status] ?? r.status} />
              <Detail label="Erstellt"   value={fmtTs(r.createdAt)} />
              {r.type === 'ferien' && <>
                <Detail label="Von"  value={fmtDate(r.fromDate)} />
                <Detail label="Bis"  value={fmtDate(r.toDate)} />
                <Detail label="Art"  value={FERIEN_TYPE[r.ferienType ?? ''] ?? r.ferienType} />
                {r.note && <Detail label="Notiz" value={r.note} />}
              </>}
              {r.type === 'eintrag' && <>
                <Detail label="Kürzel"  value={r.code} />
                <Detail label="Tage"    value={r.dates?.join(', ')} />
                {r.section && <Detail label="Bereich" value={r.section} />}
              </>}
              {r.type === 'absage' && <>
                <Detail label="Datum"  value={fmtDate(r.myDate)} />
                <Detail label="Kürzel" value={r.myCode} />
                {r.newCode && <Detail label="Neu" value={r.newCode} />}
                {r.myPerson && <Detail label="Person" value={r.myPerson} />}
              </>}
              {r.type === 'tausch' && <>
                <Detail label="Eigenes Datum" value={fmtDate(r.myDate)} />
                <Detail label="Tausch-Datum"  value={fmtDate(r.theirDate)} />
                <Detail label="Tausch-Person" value={r.theirPerson} />
              </>}
              {r.actionBy  && <Detail label="Bearbeitet von" value={r.actionBy} />}
              {r.actionAt  && <Detail label="Bearbeitet am"  value={fmtTs(r.actionAt)} />}
              {r.adminNote && <Detail label="Admin-Notiz"    value={r.adminNote} full />}
              {r.adjustmentSuggestions && r.adjustmentSuggestions.length > 0 && (
                <Detail label="Alternativvorschläge"
                  value={r.adjustmentSuggestions.map(s => `${fmtDate(s.fromDate)} – ${fmtDate(s.toDate)}`).join(', ')}
                  full />
              )}
            </>}
          </div>

          {isAdmin && (
            <div className="pt-1 flex justify-end">
              {confirmDel ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 font-medium">Wirklich löschen?</span>
                  <button onClick={() => onDelete(r.logType, r.id)}
                    className="text-xs px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold transition-colors">
                    Ja, löschen
                  </button>
                  <button onClick={() => setConfirmDel(false)}
                    className="text-xs px-3 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 font-semibold transition-colors">
                    Abbrechen
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDel(true)}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Eintrag löschen
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Collection names for delete ───────────────────────────────────────────────

const COLLECTION: Record<AnyLogEntry['logType'], string> = {
  planung:        'planungRequests',
  registration:   'adminMessages',
  password_reset: 'passwordResetRequests',
}

// ── Main exported component ───────────────────────────────────────────────────

const LOG_TYPE_FILTER_OPTIONS = [
  { value: '',               label: 'Alle Typen' },
  { value: 'ferien',         label: 'Ferien' },
  { value: 'eintrag',        label: 'Einsatz' },
  { value: 'tausch',         label: 'Einsatztausch' },
  { value: 'absage',         label: 'Absage / Änderung' },
  { value: 'registration',   label: 'Registrierung' },
  { value: 'password_reset', label: 'Passwort vergessen' },
]
const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Alle Status' },
  ...['pending','approved','provisional','rejected','adjustment','dismissed','withdrawn','done']
    .map(s => ({ value: s, label: STATUS_LABEL[s] ?? s })),
]

export default function RequestLogContent({ isAdmin }: { isAdmin: boolean }) {
  const [planungLogs, setPlanungLogs] = useState<AnyLogEntry[]>([])
  const [regLogs,     setRegLogs]     = useState<AnyLogEntry[]>([])
  const [pwLogs,      setPwLogs]      = useState<AnyLogEntry[]>([])
  const [loadingCount, setLoadingCount] = useState(3)

  const [search,       setSearch]       = useState('')
  const [filterType,   setFilterType]   = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  // Planung requests
  useEffect(() => {
    const q = query(collection(db, 'planungRequests'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setPlanungLogs(snap.docs.map(d => ({ logType: 'planung', id: d.id, ...d.data() } as AnyLogEntry)))
      setLoadingCount(c => c - 1)
    })
  }, [])

  // Registration requests (adminMessages with topic=login)
  useEffect(() => {
    const q = query(collection(db, 'adminMessages'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setRegLogs(
        snap.docs
          .map(d => ({ logType: 'registration' as const, id: d.id, ...d.data() } as AnyLogEntry))
          .filter(d => d.topic === 'login')
      )
      setLoadingCount(c => c - 1)
    })
  }, [])

  // Password reset requests
  useEffect(() => {
    const q = query(collection(db, 'passwordResetRequests'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setPwLogs(snap.docs.map(d => ({ logType: 'password_reset', id: d.id, ...d.data() } as AnyLogEntry)))
      setLoadingCount(c => c - 1)
    })
  }, [])

  const loading = loadingCount > 0

  // Merge & sort by createdAt desc
  const allLogs = useMemo(() => {
    return [...planungLogs, ...regLogs, ...pwLogs].sort(
      (a, b) => ((b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
    )
  }, [planungLogs, regLogs, pwLogs])

  const filtered = useMemo(() => {
    return allLogs.filter(r => {
      // Type filter: for planung use r.type, for others use r.logType
      if (filterType) {
        const matchesPlanungType = r.logType === 'planung' && r.type === filterType
        const matchesLogType     = r.logType === filterType
        if (!matchesPlanungType && !matchesLogType) return false
      }
      if (filterStatus && r.status !== filterStatus) return false
      return matchesSearch(r, search)
    })
  }, [allLogs, search, filterType, filterStatus])

  const handleDelete = async (logType: AnyLogEntry['logType'], id: string) => {
    await deleteDoc(doc(db, COLLECTION[logType], id))
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suche nach Name, E-Mail, Datum, Status…"
            className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-400">
          {LOG_TYPE_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-400">
          {STATUS_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Count */}
      <p className="text-xs text-gray-400 mb-3">
        {loading ? 'Lädt…' : `${filtered.length} von ${allLogs.length} Einträge`}
        {(filterType || filterStatus || search) && (
          <button
            onClick={() => { setSearch(''); setFilterType(''); setFilterStatus('') }}
            className="ml-2 text-primary-600 hover:underline"
          >
            Filter zurücksetzen
          </button>
        )}
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">Keine Einträge gefunden.</div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(r => (
            <LogRow key={`${r.logType}-${r.id}`} r={r} isAdmin={isAdmin} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
