import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { LOGO_AZS_BASE64 } from '../lib/logoBase64'
import { Search, ChevronLeft, ChevronRight, AlertTriangle, X, Pencil, Plus, Loader2, UserRound, Mail, Phone, Building2, Info, BarChart2, CalendarClock, TrendingUp, CheckCircle2, MinusCircle, Bell, BellOff, Copy, Check, Download, CalendarDays, ListChecks, Printer, PhoneMissed, PhoneCall, UserX, Clock, FileSpreadsheet, ArrowRightLeft } from 'lucide-react'
import BackButton from '../components/ui/BackButton'
import {
  RecallPatient,
  Zuweisung,
  ZuweisungConfig,
  VerlaufEntry,
  zuBearbStableId,
  getRecallPatients,
  updateRecallPatient,
  createRecallPatient,
  deleteRecallPatient,
  assignRecallPatient,
  hasRecallData,
  importRecallData,
  applyPidSync,
  importUnmatched,
  deduplicateZuBearbeiten,
  getZuweisungConfig,
  saveZuweisungConfig,
  ZUWEISUNG_DEFAULT_PRAXEN,
  ZUWEISUNG_DEFAULT_GRUENDE,
} from '../lib/firestoreRecall'
import { loadPlanungDoctorNames } from '../lib/firestorePlanung'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/ToastContext'
import { collection, getDocs } from 'firebase/firestore'
import { db, storage } from '../lib/firebase'
import { ref as storageRef, uploadBytes } from 'firebase/storage'

const DOCTORS_DEFAULT = ['Artemiev', 'Menke', 'Malinina', 'Tschopp', 'Trachsler', 'Kirr', 'Papazoglou']
const ZU_BEARB   = 'Zu bearbeiten'
const PAGE_SIZE  = 50

const STORNO_GRUENDE = ['kein Bedarf', 'Selbstmeldung', 'Wegzug', 'Verstorben', 'Arztwechsel', 'no Show', 'Brief ungeöffnet retourniert', 'Krankheit']

const AUFGEBOT_OPTIONS = [
  { value: 'Brief',    Icon: Mail,      label: 'Briefaufgebot' },
  { value: 'Reminder', Icon: Bell,      label: 'Reminder'      },
  { value: 'Tel',      Icon: Phone,     label: 'Tel.'          },
  { value: 'Praxis',   Icon: Building2, label: 'Praxis'        },
] as const

// Doctor display names for letters (last name → full name with title)
const DOCTOR_NAMES: Record<string, string> = {
  Artemiev:   'Dr. med. Dmitri Artemiev',
  Menke:      'Prof. Dr. med. univ. Marcel N. Menke',
  Malinina:   'Dr. med. Svetlana Malinina',
  Tschopp:    'Dr. med. Markus Tschopp',
  Trachsler:  'Dr. med. Stefan Trachsler',
  Kirr:       'Dr. med. Jörg-Christian Kirr',
  Papazoglou: 'Dr. med. Anthia Papazoglou',
}
function doctorFullName(doctor: string): string {
  return DOCTOR_NAMES[doctor] ?? doctor
}

const VORUNTERSUCHUNGEN = [
  'Perimetrie', 'Biometrie', 'Zykloplegie', 'Pachymetrie',
  'Hornhaut-Topographie', 'Tränenfilm-Analyse', 'Funduskopie', 'Tonometrie',
] as const

/** Additional time per examination (Zykloplegie dominates when selected) */
const VU_DAUER: Record<string, string> = {
  'Perimetrie':           '+15 Min.',
  'Biometrie':            '+15 Min.',
  'Zykloplegie':          'bis 2 Std.',
  'Pachymetrie':          '+15 Min.',
  'Hornhaut-Topographie': '+15 Min.',
  'Tränenfilm-Analyse':   '+15 Min.',
  'Funduskopie':          '+15 Min.',
  'Tonometrie':           '+15 Min.',
}

type FilterTermin = 'heute' | 'week' | 'month' | 'overdue' | 'inPlanung' | 'ohneTermin'
type FilterStatus = 'storniert' | 'inaktiv'
const TERMIN_FILTER_LABELS: Record<FilterTermin, string> = {
  heute:      'Heute',
  week:       'Nächste 7 Tage',
  month:      'Nächste 30 Tage',
  overdue:    'Überfällig',
  inPlanung:  'Im Recall',
  ohneTermin: 'Ohne Termin',
}

function formatDate(val: string | null): string {
  if (!val) return '—'
  if (val === 'kein Termin') return 'Im Recall'   // stored value → display label
  if (val === 'NaT' || val === 'nan') return '—'
  // datetime: YYYY-MM-DDTHH:MM
  const mDT = val.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/)
  if (mDT) return `${mDT[3]}.${mDT[2]}.${mDT[1]} ${mDT[4]}`
  const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}.${m[2]}.${m[1]}`
  return val
}

function isKeinTermin(val: string | null): boolean { return val === 'kein Termin' }

/** Normalize Liris address format (Name / PLZ / Strasse / Ort) → Swiss standard (Name / Strasse / PLZ Ort) */
function normalizeLirisAddress(raw: string): string {
  const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean)
  // Liris exports: line 0 = Name, line 1 = PLZ (digits only), line 2 = Street, line 3 = City
  if (lines.length === 4 && /^\d{4,5}$/.test(lines[1])) {
    return `${lines[0]}\n${lines[2]}\n${lines[1]} ${lines[3]}`
  }
  return raw.trim()
}
function isStorniert(row: RecallPatient): boolean   { return s(row.storniert).toLowerCase() === 'ja' }

/** True if the patient already has a real next-consult date booked (not «kein Termin», not empty). */
function hasScheduledNextKons(p: { naechsteKons?: string | null }): boolean {
  const nk = p.naechsteKons
  return !!nk && nk !== 'kein Termin'
}

/** Returns { reminderDate, newDate } if a 2nd reminder is due (6 months without response), else null */
function getOverdueReminderInfo(p: RecallPatient): { reminderDate: string; newDate: string } | null {
  // Mit einem terminierten Folgekonsil ist ein Reminder überflüssig — Pille unterdrücken
  if (hasScheduledNextKons(p)) return null
  const verlauf: VerlaufEntry[] = p.verlauf ?? []
  // Last MANUAL reminder (not System-generated)
  const manualReminders = verlauf.filter(e => e.aktion === 'Reminder' && e.von !== 'System')
  if (!manualReminders.length) return null
  const lastManual = manualReminders[manualReminders.length - 1]
  const match = (lastManual.ergebnis || '').match(/Geplant: (\d{4}-\d{2}-\d{2})/)
  if (!match) return null
  const reminderDate = match[1]
  // Check if 6 months have passed since planned reminder date
  const sixMonthsAfter = new Date(reminderDate + 'T00:00:00')
  sixMonthsAfter.setMonth(sixMonthsAfter.getMonth() + 6)
  if (new Date() < sixMonthsAfter) return null
  // Check if no new aufgebotErstellt after reminder was set
  const erstelltDate = p.aufgebotErstellt ? new Date(p.aufgebotErstellt + 'T00:00:00') : null
  if (erstelltDate && erstelltDate > new Date(reminderDate + 'T00:00:00')) return null
  // Check if system already handled this
  const alreadyHandled = verlauf.some(e => e.aktion === 'Reminder' && e.von === 'System' && e.datum > lastManual.datum)
  if (alreadyHandled) return null
  const newDate = new Date(reminderDate + 'T00:00:00')
  newDate.setMonth(newDate.getMonth() + 6)
  return { reminderDate, newDate: newDate.toISOString().slice(0, 10) }
}

function isFutureDate(val: string | null): boolean {
  if (!val) return false
  // datetime-local string (has T separator) — compare directly
  if (val.includes('T')) return new Date(val) > new Date()
  const m = val.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? new Date(m[1]) > new Date() : false
}
function toInputDate(val: string | null | undefined): string {
  if (!val || val === 'kein Termin') return ''
  const m = val.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

/** Convert stored datetime string to datetime-local input value (YYYY-MM-DDTHH:MM) */
function toInputDatetime(val: string | null | undefined): string {
  if (!val || val === 'kein Termin') return ''
  const mDT = val.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  if (mDT) return `${mDT[1]}T${mDT[2]}`
  const mD = val.match(/^(\d{4}-\d{2}-\d{2})/)
  if (mD) return `${mD[1]}T00:00`
  return ''
}

// Safe coercion – Firestore may store numbers where we expect strings
function s(v: unknown): string { return v == null ? '' : String(v) }

/** Parse a recallTimestamp string "26.04.2026 14:30 – Username" */
function parseStamp(ts: string | null): { dateStr: string; isoDate: string; user: string } | null {
  if (!ts) return null
  const m = ts.match(/^(\d{2})\.(\d{2})\.(\d{4}).*?–\s*(.+)$/)
  if (!m) return null
  return { dateStr: `${m[1]}.${m[2]}.${m[3]}`, isoDate: `${m[3]}-${m[2]}-${m[1]}`, user: m[4].trim() }
}

/** Convert any embedded ISO date (YYYY-MM-DD) in a string to Swiss format (DD.MM.YYYY) */
function formatErgebnis(val: string): string {
  return val.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3.$2.$1')
}

/** Returns a human-readable label for the pending contact tasks of a patient. */
function pendingVorgehenLabel(patient: { verlauf?: { aktion: string; ergebnis: string }[] | null }): string {
  const types = (patient.verlauf ?? [])
    .filter(v => v.ergebnis === 'noch zu erledigen')
    .map(v => v.aktion)
  const hasTel   = types.includes('Telefonanruf')
  const hasEmail = types.includes('E-Mail')
  if (hasTel && hasEmail) return 'Patient anrufen & E-Mail senden'
  if (hasTel)             return 'Patient anrufen'
  if (hasEmail)           return 'E-Mail senden'
  return 'Noch zu erledigen'
}

/** Strip leading # and leading zeros from a PID string.  "01722" → "1722", "#007" → "7" */
function normalizePid(val: string | null | undefined): string {
  return s(val).replace(/^#+/, '').replace(/^0+(\d)/, '$1')
}

/** Returns true if the recallTimestamp is within the last 7 days */
function isWithin7Days(erstelltStamp: string | null | undefined): boolean {
  const ps = parseStamp(erstelltStamp ?? null)
  if (!ps) return false
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7)
  return new Date(ps.isoDate) >= cutoff
}

/** Returns the latest planned future reminder date (YYYY-MM-DD), or null if none upcoming */
function getUpcomingReminderDate(p: RecallPatient): string | null {
  if (hasScheduledNextKons(p)) return null
  if (!p.verlauf) return null
  const today = new Date().toISOString().slice(0, 10)
  let latest: string | null = null
  for (const v of p.verlauf) {
    if (v.aktion !== 'Reminder') continue
    const m = v.ergebnis?.match(/^Geplant:\s*(\d{4}-\d{2}-\d{2})/)
    if (!m) continue
    if (m[1] > today && (!latest || m[1] > latest)) latest = m[1]
  }
  return latest
}

/** Returns the due reminder date (YYYY-MM-DD) if any Reminder entry is past-due, else null */
function getReminderDueDate(p: RecallPatient): string | null {
  if (hasScheduledNextKons(p)) return null
  if (!p.verlauf) return null
  const today = new Date().toISOString().slice(0, 10)
  let latest: string | null = null
  for (const v of p.verlauf) {
    if (v.aktion !== 'Reminder') continue
    const m = v.ergebnis?.match(/^Geplant:\s*(\d{4}-\d{2}-\d{2})/)
    if (!m) continue
    if (!latest || m[1] > latest) latest = m[1]
  }
  if (!latest) return null
  return latest <= today ? latest : null
}

// Highlight matching substring in a string
function Highlighted({ text, query }: { text: string | null | undefined; query: string }) {
  const str = s(text)
  if (!str) return <span className="text-gray-400">—</span>
  if (!query) return <>{str}</>
  const idx = str.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{str}</>
  return (
    <>
      {str.slice(0, idx)}
      <mark className="bg-yellow-100 text-yellow-900 rounded px-0.5">{str.slice(idx, idx + query.length)}</mark>
      {str.slice(idx + query.length)}
    </>
  )
}

type EditForm = {
  pid: string
  vorname: string
  gebDatum: string
  letzteKons: string
  keinTermin: boolean
  naechsteKons: string      // date format: YYYY-MM-DD
  storniert: string
  grundStornierung: string
  aufgebotFuer: string
  aufgebotErstellt: string  // date when Aufgebot was actually sent
  aufgebotArt: string       // '' | 'Brief' | 'Tel' | 'Praxis'
  patientenStatus: string   // '' | 'inaktiv' | 'verstorben' | 'Reminder' | 'kein Aufgebot'
  neupatient: boolean       // true = Neupatient, false = bestehender Patient
  rcErstellt: boolean
  excelAbgeglichen: boolean // true = mit Excel abgeglichen
  konsInterval: string     // UI only – not saved to Firestore
  nachfassAdresse: string  // '' | 'korrekt' | 'veraltet'
  nachfassTel: string      // '' | 'erreicht' | 'nicht_erreicht'
  nachfassTelDatum: string // YYYY-MM-DD
  verlauf: VerlaufEntry[]  // chronological log
  // Zuweisung
  zuweisungAktiv: boolean
  zuweisungTyp: 'intern' | 'extern'
  zuweisungZiel: string
  zuweisungGrund: string
  zuweisungDatum: string
  zuweisungStatus: 'pendent' | 'erledigt'
  zuweisungErledigtAm: string
  zuweisungBerichtErhalten: boolean
  zuweisungNotiz: string
}

function initForm(p?: RecallPatient): EditForm {
  return {
    pid:              normalizePid(p?.pid),
    vorname:          p?.vorname          ?? '',
    gebDatum:         toInputDate(p?.gebDatum),
    letzteKons:       toInputDate(p?.letzteKons),
    keinTermin:       p?.naechsteKons === 'kein Termin',
    naechsteKons:     p?.naechsteKons === 'kein Termin' ? '' : toInputDate(p?.naechsteKons),
    storniert:        p?.storniert        ?? '',
    grundStornierung: p?.grundStornierung ?? '',
    aufgebotFuer:     toInputDate(p?.aufgebotFuer),
    aufgebotErstellt: toInputDate(p?.aufgebotErstellt),
    aufgebotArt:      p?.aufgebotArt      ?? '',
    patientenStatus:  p?.patientenStatus  ?? 'aktiv',
    // Raw stored value — auto-display in table disappears after 7 days via isWithin7Days()
    neupatient:       p?.neupatient === true,
    rcErstellt:       (p as any)?.rcErstellt === true,
    excelAbgeglichen: (p as any)?.excelAbgeglichen === true,
    konsInterval:     '',
    nachfassAdresse:  p?.nachfassAdresse  ?? '',
    nachfassTel:      p?.nachfassTel      ?? '',
    nachfassTelDatum: p?.nachfassTelDatum ?? '',
    verlauf:          p?.verlauf          ?? [],
    zuweisungAktiv:     !!p?.zuweisung,
    zuweisungTyp:       p?.zuweisung?.typ       ?? 'extern',
    zuweisungZiel:      p?.zuweisung?.ziel       ?? '',
    zuweisungGrund:     p?.zuweisung?.grund      ?? '',
    zuweisungDatum:     p?.zuweisung?.datum      || toInputDate(p?.letzteKons) || new Date().toISOString().slice(0, 10),
    zuweisungStatus:    ((p?.zuweisung?.status as string) === 'ausstehend' ? 'pendent' : p?.zuweisung?.status) ?? 'pendent',
    zuweisungErledigtAm: p?.zuweisung?.erledigtAm    ?? '',
    zuweisungBerichtErhalten: p?.zuweisung?.berichtErhalten ?? false,
    zuweisungNotiz:     p?.zuweisung?.notiz            ?? '',
  }
}

type EditTarget = RecallPatient | 'new' | null
type PageStatus = 'checking' | 'empty' | 'loading' | 'ready'

/** Parse pasted patient text, e.g. "Müller Hans , 01.01.1970 (55 Jahre) , Aarau\n  #12345" */
function parsePastedPatient(text: string): Partial<Pick<EditForm, 'vorname' | 'gebDatum' | 'pid'>> {
  const result: Partial<Pick<EditForm, 'vorname' | 'gebDatum' | 'pid'>> = {}

  // PID: # followed by digits (allow spaces between # and digits)
  const pidMatch = text.match(/#\s*(\d+)/)
  if (pidMatch) result.pid = normalizePid(pidMatch[1])

  // Date: DD.MM.YYYY
  const dateMatch = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (dateMatch) {
    result.gebDatum = `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`
  }

  // Vorname: first comma-separated segment → strip salutation → "NACHNAME Vorname" → take Vorname only
  const firstPart = text.split(',')[0].trim()
  const withoutSalutation = firstPart.replace(/^(Herr|Frau|Frl\.?|Dr\.?|Prof\.?)\s+/i, '').trim()
  const nameParts = withoutSalutation.split(/\s+/).filter(Boolean)
  if (nameParts.length >= 2) {
    result.vorname = nameParts.slice(1).join(' ')
  }

  return result
}

/** Parse an interval string like "1j", "6m", "2w", "10t" */
function parseKonsInterval(val: string): { n: number; unit: 'year' | 'month' | 'week' | 'day' } | null {
  const m = val.trim().match(/^(\d+)\s*([jJmMwWtT])$/)
  if (!m) return null
  const n = parseInt(m[1])
  if (n <= 0 || n > 120) return null
  const u = m[2].toLowerCase()
  return { n, unit: u === 'j' ? 'year' : u === 'm' ? 'month' : u === 'w' ? 'week' : 'day' }
}

/** Compute ISO date string from base date + interval string, or null if not parseable */
function computeNextKons(base: string, interval: string): string | null {
  if (!base || !interval.trim()) return null
  const parsed = parseKonsInterval(interval)
  if (!parsed) return null
  const d = new Date(base + 'T00:00:00Z')
  if (isNaN(d.getTime())) return null
  const { n, unit } = parsed
  if (unit === 'year')  d.setUTCFullYear(d.getUTCFullYear() + n)
  if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + n)
  if (unit === 'week')  d.setUTCDate(d.getUTCDate() + n * 7)
  if (unit === 'day')   d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const inputCls    = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-300 disabled:bg-gray-50 disabled:text-gray-400'
const inputClsErr = 'w-full px-3 py-2 text-sm border border-red-400 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-red-300 disabled:bg-gray-50'
const labelCls    = 'block text-xs font-semibold text-gray-600 mb-1'
const reqStar     = <span className="text-red-500 ml-0.5">*</span>

function ClearBtn({ show, onClear }: { show: boolean; onClear: () => void }) {
  if (!show) return null
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClear}
      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors z-10"
    >
      <X className="w-3 h-3" />
    </button>
  )
}

export default function RecallPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const navigate     = useNavigate()
  const username     = profile?.username || profile?.displayName || 'System'
  const displayLabel = profile?.displayName || profile?.username || 'System'

  const [doctors, setDoctors] = useState<string[]>(DOCTORS_DEFAULT)
  const allTabs = useMemo(() => [...doctors, ZU_BEARB], [doctors])

  // Zuweisung-Konfiguration (Praxen & Gründe)
  const [zuweisungPraxen,  setZuweisungPraxen]  = useState<string[]>(ZUWEISUNG_DEFAULT_PRAXEN)
  const [zuweisungGruende, setZuweisungGruende] = useState<string[]>(ZUWEISUNG_DEFAULT_GRUENDE)
  const [addingPraxis,  setAddingPraxis]  = useState(false)
  const [newPraxisText, setNewPraxisText] = useState('')
  const [addingGrund,   setAddingGrund]   = useState(false)
  const [newGrundText,  setNewGrundText]  = useState('')

  const [allData, setAllData] = useState<Map<string, RecallPatient[]>>(new Map())
  const [activeTab, setActiveTab] = useState(DOCTORS_DEFAULT[0])
  const [page, setPage]       = useState(1)
  const [status, setStatus]   = useState<PageStatus>('checking')
  const [importing, setImporting] = useState(false)
  const [importingZuBearb, setImportingZuBearb] = useState(false)
  const [syncMsg, setSyncMsg]     = useState('')   // shown inside the loading screen
  const [loadError, setLoadError] = useState(false)

  // Search
  const [search, setSearch]         = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const popupRef  = useRef<HTMLDivElement>(null)
  const [inputRect, setInputRect] = useState<{ top: number; left: number; width: number } | null>(null)

  function captureRect() {
    if (searchRef.current) {
      const r = searchRef.current.getBoundingClientRect()
      setInputRect({ top: r.bottom + 6, left: r.left, width: r.width })
    }
  }

  // Edit modal
  const [editTarget, setEditTarget] = useState<EditTarget>(null)
  const [form, setForm] = useState<EditForm>(initForm())
  const [saving, setSaving] = useState(false)
  const [assignDoctor, setAssignDoctor] = useState('')
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({})
  const [quickInput, setQuickInput] = useState('')
  const [pidDup, setPidDup] = useState<RecallPatient | null>(null)
  const naechsteKonsRef = useRef<HTMLInputElement>(null)
  const [copiedCell, setCopiedCell] = useState<string | null>(null)
  const [filterNeupatient, setFilterNeupatient] = useState(false)
  const [filterTermin, setFilterTermin] = useState<FilterTermin | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus | null>(null)
  const [filterAufgebotArt, setFilterAufgebotArt] = useState<string | null>(null)
  const [filterNochZuErledigen, setFilterNochZuErledigen] = useState(false)
  const [filterReminderFaellig, setFilterReminderFaellig] = useState(false)
  const [filterReminderGeplant, setFilterReminderGeplant] = useState(false)

  // ── Weiteres Vorgehen (Kontakt-Protokoll UI state) ───────────────────────────
  const [vorgehenTelOpen,       setVorgehenTelOpen]       = useState(false)
  const [vorgehenEmailOpen,     setVorgehenEmailOpen]     = useState(false)
  const [vorgehenReminderOpen,  setVorgehenReminderOpen]  = useState(false)
  const [vorgehenTelDatum,      setVorgehenTelDatum]      = useState('')
  const [vorgehenEmailDatum,    setVorgehenEmailDatum]    = useState('')
  const [vorgehenReminderDatum, setVorgehenReminderDatum] = useState('')
  const [vorgehenTelGrund,      setVorgehenTelGrund]      = useState('')
  const [vorgehenEmailGrund,    setVorgehenEmailGrund]    = useState('')
  const [vorgehenReminderGrund, setVorgehenReminderGrund] = useState('')

  // ── Aufgebot-Wochenplan ───────────────────────────────────────────────────────
  const [wochenplanOpen, setWochenplanOpen] = useState(false)
  const [wochenplanWeekOffset, setWochenplanWeekOffset] = useState(0)

  // ── Aufgebot-Dialog ───────────────────────────────────────────────────────────
  type AufgebotArt = 'Brief' | 'Tel' | 'Reminder'
  type AufgebotForm = {
    art: AufgebotArt | null
    // Brief/Reminder: full address block (NOT saved, DSGVO)
    pupille: boolean
    anrede: 'Herr' | 'Frau' | 'Familie' | ''
    adressBlock: string   // multi-line or email, NOT saved
    // Appointment date + time for letter (NOT saved)
    terminDatum: string   // YYYY-MM-DD
    terminZeit: string    // HH:MM
    // Doctor name override
    arztName: string
    // Telefon
    notiz: string
    // All: how was it sent
    versand: 'Post' | 'Email' | ''
    terminFixiert: string            // YYYY-MM-DD – when appointment was confirmed
    // Voruntersuchungen (Brief only, NOT saved)
    voruntersuchungen: string[]      // selected items from VORUNTERSUCHUNGEN + 'Sonstige'
    voruntersuchungenSonstige: string
    fachtitel: string                // from doctor profile, editable (NOT saved)
  }
  const emptyAufgebotForm = (): AufgebotForm => ({
    art: null, pupille: false, anrede: '', adressBlock: '',
    terminDatum: '', terminZeit: '',
    arztName: '', notiz: '', versand: '', terminFixiert: '',
    voruntersuchungen: [], voruntersuchungenSonstige: '', fachtitel: '',
  })
  const [aufgebotTarget, setAufgebotTarget] = useState<WPEntry | null>(null)
  const [aufgebotForm, setAufgebotForm] = useState<AufgebotForm>(emptyAufgebotForm())
  const [aufgebotPdfCreated, setAufgebotPdfCreated] = useState(false)
  const [emailCopied,       setEmailCopied]       = useState(false)
  const [aufgebotSaving,        setAufgebotSaving]        = useState(false)
  const [aufgebotConfirmPending, setAufgebotConfirmPending] = useState(false)
  const [briefPreview, setBriefPreview] = useState<string | null>(null)
  const [doctorFachtitelMap, setDoctorFachtitelMap] = useState<Record<string, string>>({})
  const briefIframeRef = useRef<HTMLIFrameElement>(null)
  function copyToClipboard(val: string, key: string) {
    navigator.clipboard.writeText(val).then(() => {
      setCopiedCell(key)
      setTimeout(() => setCopiedCell(null), 1500)
    }).catch(() => {})
  }

  // ── Table sort (multi-column: Shift+Click adds secondary key) ───────────────
  type SortCol = 'pid'|'vorname'|'gebDatum'|'letzteKons'|'naechsteKons'|'aufgebotFuer'|'aufgebotArt'|'storniert'|'patientenStatus'|'aktualisiert'
  type SortKey = { col: SortCol; dir: 'asc'|'desc' }
  const [sortKeys, setSortKeys] = useState<SortKey[]>([{ col: 'vorname', dir: 'asc' }])
  function handleSort(col: SortCol, shiftKey: boolean) {
    setSortKeys(prev => {
      const idx = prev.findIndex(k => k.col === col)
      if (shiftKey) {
        if (idx >= 0) {
          if (prev[idx].dir === 'asc') return prev.map((k, i) => i === idx ? { ...k, dir: 'desc' } : k)
          return prev.filter((_, i) => i !== idx)
        }
        return [...prev, { col, dir: 'asc' }]
      } else {
        if (idx >= 0 && prev.length === 1) return [{ col, dir: prev[0].dir === 'asc' ? 'desc' : 'asc' }]
        return [{ col, dir: 'asc' }]
      }
    })
    setPage(1)
  }
  function sortIcon(col: SortCol) {
    const idx = sortKeys.findIndex(k => k.col === col)
    if (idx < 0) return <span className="ml-0.5 opacity-30">↕</span>
    return (
      <span className="ml-0.5 text-primary-500 inline-flex items-center gap-px">
        {sortKeys[idx].dir === 'asc' ? '↑' : '↓'}
        {sortKeys.length > 1 && <span className="text-[9px] leading-none">{idx + 1}</span>}
      </span>
    )
  }
  function sortVal(p: RecallPatient, col: SortCol): string {
    const s = (v: unknown) => String(v ?? '')
    switch (col) {
      case 'pid':            return normalizePid(p.pid)
      case 'vorname':        return s(p.vorname)
      case 'gebDatum':       return s(p.gebDatum)
      case 'letzteKons':     return s(p.letzteKons)
      case 'naechsteKons':   return (p.naechsteKons && p.naechsteKons !== 'kein Termin') ? String(p.naechsteKons) : ''
      case 'aufgebotFuer':   return s(p.aufgebotFuer)
      case 'aufgebotArt':    return s(p.aufgebotArt)
      case 'storniert':      return s(p.storniert)
      case 'patientenStatus':return s(p.patientenStatus)
      case 'aktualisiert':   return parseStamp(p.aktualisiert || p.erstellt)?.isoDate ?? ''
    }
  }

  // Draggable modal
  const modalRef    = useRef<HTMLDivElement>(null)
  const [modalPos, setModalPos]     = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragOrigin  = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null)

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragOrigin.current) return
      const dx = e.clientX - dragOrigin.current.mouseX
      const dy = e.clientY - dragOrigin.current.mouseY
      const w  = modalRef.current?.offsetWidth  ?? 512
      const h  = modalRef.current?.offsetHeight ?? 300
      setModalPos({
        x: Math.max(0, Math.min(window.innerWidth  - w,  dragOrigin.current.elemX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - h,  dragOrigin.current.elemY + dy)),
      })
    }
    function onUp() {
      if (!dragOrigin.current) return
      dragOrigin.current = null
      setIsDragging(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
  }, [])

  function onModalDragStart(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button,input,select,textarea,label')) return
    const rect = modalRef.current?.getBoundingClientRect()
    if (!rect) return
    dragOrigin.current = { mouseX: e.clientX, mouseY: e.clientY, elemX: rect.left, elemY: rect.top }
    setIsDragging(true)
    e.preventDefault()
  }

  // ── Initial load: doctors from Einsatzplanung, then recall data ─────────────
  // Load doctor fachtitel from user profiles
  // Indexed by last name from displayName (matches recall doctor keys like "Artemiev")
  // AND by username as fallback
  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      const map: Record<string, string> = {}
      for (const d of snap.docs) {
        const data = d.data()
        if (!data.fachtitel) continue
        // Key by last word of displayName → matches recall keys ("Artemiev", "Menke" …)
        const lastName = String(data.displayName ?? '').trim().split(/\s+/).pop()
        if (lastName) map[lastName] = data.fachtitel
        // Also key by username as additional fallback
        if (data.username) map[data.username] = data.fachtitel
      }
      setDoctorFachtitelMap(map)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    getZuweisungConfig().then(cfg => {
      setZuweisungPraxen(cfg.praxen)
      setZuweisungGruende(cfg.gruende)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    async function init() {
      // Load doctor names (last names) from current year's Einsatzplanung
      let docList = DOCTORS_DEFAULT
      try {
        const names = await loadPlanungDoctorNames(new Date().getFullYear())
        if (names.length > 0) { docList = names; setDoctors(names) }
      } catch { /* keep default */ }

      const exists = await hasRecallData()
      if (!exists) { setStatus('empty'); return }
      loadAll([...docList, ZU_BEARB])
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll(tabs = allTabs) {
    setStatus('loading')
    setSyncMsg('')
    setLoadError(false)
    try {
      // Use allSettled so one failing doctor query doesn't wipe all data
      const settled = await Promise.allSettled(
        tabs.map(d => getRecallPatients(d).then(r => [d, r] as const))
      )
      const map = new Map<string, RecallPatient[]>()
      let anyError = false
      let zuBearbFailed = false
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') map.set(r.value[0], r.value[1])
        else { anyError = true; if (tabs[i] === ZU_BEARB) zuBearbFailed = true }
      })
      if (anyError && map.size === 0) { setLoadError(true); setStatus('ready'); return }

      // Auto-sync: only if query succeeded AND returned 0 AND hasn't run today already
      const syncKey = 'recall_autosync_date'
      const todayStr = new Date().toISOString().slice(0, 10)
      const lastSync = localStorage.getItem(syncKey)
      const syncRanToday = lastSync === todayStr

      if (!zuBearbFailed && (map.get(ZU_BEARB) ?? []).length === 0 && !syncRanToday) {
        try {
          // Try new Kimenda export format first (plain array), then legacy pid-sync format
          const resZb = await fetch('./recall-zu-bearbeiten.json')
          if (resZb.ok) {
            const patients = await resZb.json()
            setSyncMsg(`Patientenliste wird importiert… (${patients.length} Einträge)`)
            await importUnmatched(patients, displayLabel)
            localStorage.setItem(syncKey, todayStr)
          } else {
            const res = await fetch('./recall-pid-sync.json')
            if (res.ok) {
              const json = await res.json()
              setSyncMsg(`PID-Abgleich läuft… (${json.matches?.length ?? 0} Treffer, ${json.unmatched?.length ?? 0} neu)`)
              await applyPidSync(json.matches ?? [], map)
              await importUnmatched(json.unmatched ?? [], displayLabel)
              localStorage.setItem(syncKey, todayStr)
            }
          }
          // Reload Zu bearbeiten after import
          try {
            const zuBearb = await getRecallPatients(ZU_BEARB)
            map.set(ZU_BEARB, zuBearb)
            setSyncMsg(`✓ ${zuBearb.length} Patienten in "Zu bearbeiten" geladen`)
          } catch (e) {
            console.error('[Recall] Zu bearbeiten reload nach Import fehlgeschlagen:', e)
            setSyncMsg('Import abgeschlossen – bitte Seite neu laden (F5)')
          }
        } catch (e) {
          console.error('[Recall] Sync fehlgeschlagen:', e)
          setSyncMsg('Sync fehlgeschlagen – bitte F5 drücken')
        }
      }

      // Auto-dedup: run once ever (stable IDs prevent new duplicates going forward)
      const dedupKey = 'recall_dedup_done'
      if (!localStorage.getItem(dedupKey) && (map.get(ZU_BEARB) ?? []).length > 0) {
        try {
          setSyncMsg('Duplikate werden bereinigt…')
          const deleted = await deduplicateZuBearbeiten()
          if (deleted > 0) {
            const fresh = await getRecallPatients(ZU_BEARB)
            map.set(ZU_BEARB, fresh)
            setSyncMsg(`✓ ${deleted} Duplikate entfernt`)
          }
          localStorage.setItem(dedupKey, '1')
        } catch (e) {
          console.error('[Recall] Auto-Dedup fehlgeschlagen:', e)
        }
      }

      setAllData(map)
      setStatus('ready')
      // Option A: auto 2nd reminder check (once per day, fire-and-forget)
      autoSecondReminder(map).catch(e => console.error('[Recall] autoSecondReminder:', e))
    } catch {
      setLoadError(true)
      setStatus('ready')
    } finally {
      setTimeout(() => setSyncMsg(''), 4000)
    }
  }

  async function reloadTab(doctor: string) {
    const fresh = await getRecallPatients(doctor)
    setAllData(prev => new Map(prev).set(doctor, fresh))
  }

  /** Option A: auto-create 2nd reminder after 6 months without response — runs once per day */
  async function autoSecondReminder(dataMap: Map<string, RecallPatient[]>) {
    const today = new Date().toISOString().slice(0, 10)
    const key = 'recall_auto2reminder_date'
    if (localStorage.getItem(key) === today) return
    localStorage.setItem(key, today)
    const toUpdate: Array<{ patient: RecallPatient; newAufgebotFuer: string }> = []
    dataMap.forEach(patients => {
      patients.forEach(p => {
        if (isStorniert(p) || p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben') return
        const info = getOverdueReminderInfo(p)
        if (info) toUpdate.push({ patient: p, newAufgebotFuer: info.newDate })
      })
    })
    if (!toUpdate.length) return
    const affectedTabs = new Set<string>()
    for (const { patient, newAufgebotFuer } of toUpdate) {
      const autoEntry: VerlaufEntry = {
        datum: today,
        aktion: 'Reminder',
        ergebnis: 'Automatisch: 2. Reminder (6 Monate ohne Rückmeldung)',
        von: 'System',
      }
      try {
        await updateRecallPatient(patient.id, {
          aufgebotFuer: newAufgebotFuer,
          verlauf: [...(patient.verlauf ?? []), autoEntry],
        } as any, 'System')
        affectedTabs.add(patient.doctor)
      } catch (e) { console.error('[Recall] autoSecondReminder Fehler:', e) }
    }
    for (const tab of affectedTabs) await reloadTab(tab)
  }

  async function handleImport() {
    setImporting(true)
    try {
      const res  = await fetch('./recall-data.json')
      const json = await res.json()
      await importRecallData(json, displayLabel)
      await loadAll()
    } catch {
      toast.error('Import fehlgeschlagen. Bitte erneut versuchen.')
    } finally {
      setImporting(false)
    }
  }

  const kimendaInputRef = useRef<HTMLInputElement>(null)

  const handleKimendaFile = useCallback(async (file: File) => {
    setImportingZuBearb(true)
    setSyncMsg('Excel wird eingelesen…')
    try {
      // 0. Archiv-Upload (parallel, blockiert Import nicht) — Original-Excel in Firebase Storage sichern
      //    Pfad: recall-uploads/YYYY-MM-DD_HH-MM-SS_originalname.xlsx
      ;(async () => {
        try {
          const now = new Date()
          const ts =
            now.toISOString().slice(0, 10) + '_' +
            String(now.getHours()).padStart(2, '0') + '-' +
            String(now.getMinutes()).padStart(2, '0') + '-' +
            String(now.getSeconds()).padStart(2, '0')
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
          const path = `recall-uploads/${ts}_${safeName}`
          await uploadBytes(storageRef(storage, path), file, {
            customMetadata: { uploadedBy: username, originalName: file.name },
          })
          console.log('[Recall] Excel-Upload archiviert:', path)
        } catch (err) {
          console.warn('[Recall] Excel-Archivierung fehlgeschlagen (Import läuft trotzdem weiter):', err)
        }
      })()

      // 1. Parse Excel
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: null })

      // 2. Build set of PIDs already assigned to a doctor (exclude Zu bearbeiten)
      const assignedPids = new Set<string>()
      for (const [tabDoc, pts] of allData.entries()) {
        if (tabDoc === ZU_BEARB) continue
        for (const p of pts) { if (p.pid) assignedPids.add(p.pid) }
      }

      // 3. Map Excel rows → RecallPatient shape, skip already-assigned
      const toImport: Omit<RecallPatient, 'id' | 'doctor'>[] = []
      for (const r of rows) {
        const pid = r['#'] ? String(r['#']).trim() : null
        if (pid && assignedPids.has(pid)) continue

        let gebDatum: string | null = null
        const raw = r['Geburtsdatum']
        if (raw instanceof Date) {
          gebDatum = raw.toISOString().slice(0, 10)
        } else if (typeof raw === 'string' && raw.match(/\d{4}-\d{2}-\d{2}/)) {
          gebDatum = raw.slice(0, 10)
        }

        const verstorben = r['Verstorben'] === true || r['Verstorben'] === 'True'
        const inaktiv    = r['Inaktiv']    === true || r['Inaktiv']    === 'True'

        toImport.push({
          pid,
          vorname:          r['Vorname'] ? String(r['Vorname']).trim() : null,
          gebDatum,
          letzteKons:       null,
          naechsteKons:     null,
          storniert:        null,
          grundStornierung: null,
          aufgebotFuer:     null,
          aufgebotErstellt: null,
          aufgebotArt:      null,
          aufgebotVersand:  null,
          aufgebotNotiz:    null,
          terminFixiert:    null,
          patientenStatus:  verstorben ? 'verstorben' : inaktiv ? 'inaktiv' : null,
          neupatient:       null,
          nachfassAdresse:  null,
          nachfassTel:      null,
          nachfassTelDatum: null,
          verlauf:          null,
          erstellt:         null,
          aktualisiert:     null,
        })
      }

      if (toImport.length === 0) {
        setSyncMsg('Keine neuen Patienten gefunden (alle bereits zugewiesen)')
        return
      }

      // 4. Write to Firestore with progress feedback
      setSyncMsg(`${toImport.length} Patienten werden in Datenbank geschrieben…`)
      await importUnmatched(toImport, username)

      // 5. Verify by reading back from Firestore (source: server)
      setSyncMsg('Überprüfe Datenbank…')
      const fresh = await getRecallPatients(ZU_BEARB)

      if (fresh.length > 0) {
        // Firestore confirmed — use server data as source of truth
        setAllData(prev => new Map(prev).set(ZU_BEARB, fresh))
        setSyncMsg(`✓ ${fresh.length} Patienten in Datenbank gespeichert`)
      } else {
        // Firestore returned 0 despite successful writes — update UI from local data
        // (will be fixed on next page reload once Firestore indexing catches up)
        const existingZuBearb = allData.get(ZU_BEARB) ?? []
        const existingIdSet   = new Set(existingZuBearb.map(p => p.id))
        const newPatients: RecallPatient[] = toImport
          .map(p => ({ ...p, id: zuBearbStableId(p), doctor: ZU_BEARB } as RecallPatient))
          .filter(p => !existingIdSet.has(p.id))
        const merged = [...existingZuBearb, ...newPatients]
          .sort((a, b) => String(a.vorname ?? '').localeCompare(String(b.vorname ?? ''), 'de'))
        setAllData(prev => new Map(prev).set(ZU_BEARB, merged))
        setSyncMsg(`⚠ ${toImport.length} geschrieben, Datenbankabfrage gibt 0 zurück – bitte F5`)
        console.warn('[Recall] Write OK aber Read gibt 0 zurück – möglicherweise Firestore-Kontingent erschöpft')
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      setSyncMsg(`Import fehlgeschlagen: ${msg}`)
      console.error('[Recall] Kimenda-Import fehlgeschlagen:', e)
    } finally {
      setImportingZuBearb(false)
      setTimeout(() => setSyncMsg(''), 10000)
      if (kimendaInputRef.current) kimendaInputRef.current.value = ''
    }
  }, [allData, username]) // eslint-disable-line react-hooks/exhaustive-deps


  // ── Search: cross-doctor results ────────────────────────────────────────────
  const searchResults = useMemo(() => {
    const q = search.trim()
    if (q.length < 2) return []
    const ql = q.toLowerCase()
    // Split into parts so "Mü Rob" matches name="Müller" + vorname="Robert"
    const parts = ql.split(/\s+/).filter(Boolean)
    // Normalize query for PID matching: strip leading # and leading zeros
    const pidQuery = normalizePid(q)
    const out: RecallPatient[] = []
    for (const patients of allData.values()) {
      for (const p of patients) {
        const fullName = s(p.vorname).toLowerCase()
        const nameMatch = parts.every(part => fullName.includes(part))
        if (
          nameMatch ||
          normalizePid(p.pid).includes(pidQuery) ||
          s(p.gebDatum).includes(q) || formatDate(p.gebDatum).includes(q) ||
          s(p.aufgebotFuer).includes(q) || formatDate(p.aufgebotFuer).includes(q)
        ) {
          out.push(p)
        }
      }
    }
    return out.slice(0, 80)
  }, [search, allData])

  // ── Auswertung ───────────────────────────────────────────────────────────────
  const [auswertungOpen, setAuswertungOpen] = useState(false)
  type ActPeriod = 'today' | 'week' | 'month' | 'all'
  const [actPeriod, setActPeriod] = useState<ActPeriod>('week')

  const auswertungStats = useMemo(() => {
    const all: RecallPatient[] = []
    for (const pts of allData.values()) all.push(...pts)

    // ── Activity log ────────────────────────────────────────────────────────
    const now = new Date()
    function inPeriod(iso: string): boolean {
      const d = new Date(iso)
      if (actPeriod === 'today') return d.toDateString() === now.toDateString()
      if (actPeriod === 'week')  { const w = new Date(now); w.setDate(w.getDate() - 7);  return d >= w }
      if (actPeriod === 'month') { const m = new Date(now); m.setDate(m.getDate() - 30); return d >= m }
      return true
    }
    // Aufgebot-Aufschlüsselung aus verlauf: aktion → Art-Bucket.
    // System-generierte Reminder (von === 'System') zählen NICHT — die kommen
    // aus Auto-Logik, nicht aus User-Aktion.
    type AufgebotBucket = 'Brief' | 'Tel' | 'Praxis' | 'Reminder'
    const VERLAUF_TO_ART: Record<string, AufgebotBucket> = {
      Briefaufgebot:    'Brief',
      Telefonaufgebot:  'Tel',
      Praxisaufgebot:   'Praxis',
      Reminder:         'Reminder',
    }
    function emptyAufgebote() {
      return { Brief: 0, Tel: 0, Praxis: 0, Reminder: 0 }
    }

    type UA = { updated: number; created: number; displayName: string; aufgebote: ReturnType<typeof emptyAufgebote> }
    const actMap: Record<string, Record<string, UA>> = {}
    function ensureCell(isoDate: string, userKey: string, displayName: string): UA {
      if (!actMap[isoDate]) actMap[isoDate] = {}
      if (!actMap[isoDate][userKey]) actMap[isoDate][userKey] = { updated: 0, created: 0, displayName, aufgebote: emptyAufgebote() }
      return actMap[isoDate][userKey]
    }
    function bump(ts: string | null, field: 'created' | 'updated') {
      const p = parseStamp(ts); if (!p || !inPeriod(p.isoDate)) return
      ensureCell(p.isoDate, p.user.trim().toLowerCase(), p.user.trim())[field]++
    }
    for (const p of all) {
      bump(p.erstellt,     'created')
      const ce = parseStamp(p.erstellt)
      const cu = parseStamp(p.aktualisiert)
      if (cu && (cu.isoDate !== ce?.isoDate || cu.user.trim().toLowerCase() !== ce?.user.trim().toLowerCase())) bump(p.aktualisiert, 'updated')

      // Aufgebote aus verlauf-Entries des Patienten
      for (const v of (p.verlauf ?? [])) {
        if (!v?.aktion || !v?.datum || !v?.von) continue
        const bucket = VERLAUF_TO_ART[v.aktion]
        if (!bucket) continue
        if (bucket === 'Reminder' && v.von === 'System') continue   // Auto-Reminder ignorieren
        if (!inPeriod(v.datum)) continue
        const userName = v.von.trim()
        const userKey = userName.toLowerCase()
        ensureCell(v.datum, userKey, userName).aufgebote[bucket]++
      }
    }
    const actRows = Object.entries(actMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .flatMap(([iso, users]) =>
        Object.entries(users)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, { updated, created, displayName, aufgebote }]) => ({
            iso, dateStr: iso.split('-').reverse().join('.'), user: displayName, updated, created, aufgebote,
          }))
      )

    // ── Neupatienten ────────────────────────────────────────────────────────
    const yearStart  = new Date(now.getFullYear(), 0, 1)
    const monthStart = new Date(now); monthStart.setDate(now.getDate() - 30)
    const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 7)
    const neuAll = all.filter(p => p.neupatient === true)
    function neupDate(p: RecallPatient): Date | null {
      const ps = parseStamp(p.erstellt); return ps ? new Date(ps.isoDate) : null
    }
    const neupatienten = {
      week:  neuAll.filter(p => { const d = neupDate(p); return d && d >= weekStart  }).length,
      month: neuAll.filter(p => { const d = neupDate(p); return d && d >= monthStart }).length,
      year:  neuAll.filter(p => { const d = neupDate(p); return d && d >= yearStart  }).length,
      total: neuAll.length,
    }

    // Neupatient detail rows — grouped by creation date + user for history table
    const neuHistMap: Record<string, Record<string, { count: number; names: string[]; displayName: string }>> = {}
    for (const p of neuAll) {
      const ps = parseStamp(p.erstellt)
      if (!ps) continue
      const userKey = ps.user.trim().toLowerCase()
      if (!neuHistMap[ps.isoDate]) neuHistMap[ps.isoDate] = {}
      if (!neuHistMap[ps.isoDate][userKey]) neuHistMap[ps.isoDate][userKey] = { count: 0, names: [], displayName: ps.user.trim() }
      neuHistMap[ps.isoDate][userKey].count++
      const fullName = p.vorname || ''
      if (fullName) neuHistMap[ps.isoDate][userKey].names.push(fullName)
    }
    const neupatientRows = Object.entries(neuHistMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .flatMap(([iso, users]) =>
        Object.entries(users).map(([, { count, names, displayName }]) => ({
          dateStr: iso.split('-').reverse().join('.'), isoDate: iso, user: displayName, count, names,
        }))
      )

    // ── Per-doctor stats ────────────────────────────────────────────────────
    const docStats = [...doctors, ZU_BEARB].map(doc => {
      const pts = allData.get(doc) ?? []
      const active = pts.filter(p => p.patientenStatus !== 'inaktiv' && p.patientenStatus !== 'verstorben' && !isStorniert(p))
      return {
        name:        doc,
        total:       pts.length,
        mitTermin:   active.filter(p => p.naechsteKons && p.naechsteKons !== 'kein Termin' && isFutureDate(p.naechsteKons)).length,
        inPlanung:   active.filter(p => p.naechsteKons === 'kein Termin').length,
        inaktiv:     pts.filter(p => p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben').length,
        storniert:   pts.filter(isStorniert).length,
        offen:       active.filter(p => !p.naechsteKons).length,
        neupatient:  pts.filter(p => p.neupatient === true).length,
      }
    }).filter(d => d.total > 0)

    // ── Aufgebot Art ────────────────────────────────────────────────────────
    const aufgebot = { Brief: 0, Tel: 0, Praxis: 0, kein: 0 }
    for (const p of all) {
      if      (p.aufgebotArt === 'Brief')  aufgebot.Brief++
      else if (p.aufgebotArt === 'Tel')    aufgebot.Tel++
      else if (p.aufgebotArt === 'Praxis') aufgebot.Praxis++
      else aufgebot.kein++
    }
    const aufgebotMax = Math.max(aufgebot.Brief, aufgebot.Tel, aufgebot.Praxis, aufgebot.kein, 1)

    // ── Upcoming appointments ───────────────────────────────────────────────
    const in7  = new Date(now); in7.setDate(now.getDate() + 7)
    const in30 = new Date(now); in30.setDate(now.getDate() + 30)
    const activeAll = all.filter(p => p.patientenStatus !== 'inaktiv' && p.patientenStatus !== 'verstorben' && !isStorniert(p))
    const upcoming = {
      today:     activeAll.filter(p => { const d = new Date(s(p.naechsteKons)); return p.naechsteKons && p.naechsteKons !== 'kein Termin' && d.toDateString() === now.toDateString() }).length,
      week:      activeAll.filter(p => { const d = new Date(s(p.naechsteKons)); return p.naechsteKons && p.naechsteKons !== 'kein Termin' && d > now && d <= in7 }).length,
      month:     activeAll.filter(p => { const d = new Date(s(p.naechsteKons)); return p.naechsteKons && p.naechsteKons !== 'kein Termin' && d > now && d <= in30 }).length,
      overdue:   activeAll.filter(p => p.naechsteKons && p.naechsteKons !== 'kein Termin' && !isFutureDate(p.naechsteKons)).length,
      inPlanung: activeAll.filter(p => p.naechsteKons === 'kein Termin').length,
      ohneTermin:activeAll.filter(p => !p.naechsteKons).length,
    }

    return { actRows, docStats, aufgebot, aufgebotMax, upcoming, neupatienten, neupatientRows, total: all.length }
  }, [allData, actPeriod, doctors]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close popup on click outside (checks both the input wrapper AND the popup itself)
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node
      const inSearch = searchRef.current?.contains(t) ?? false
      const inPopup  = popupRef.current?.contains(t)  ?? false
      if (!inSearch && !inPopup) setSearchOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  // Close popup on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setSearchOpen(false); setSearch('') }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── Tab helpers ──────────────────────────────────────────────────────────────
  function switchTab(doctor: string) { setActiveTab(doctor); setPage(1); setFilterTermin(null); setFilterNeupatient(false); setFilterStatus(null); setFilterAufgebotArt(null); setFilterNochZuErledigen(false); setFilterReminderFaellig(false) }

  const rows = useMemo(() => {
    // When searching (≥2 chars), show cross-doctor results in the table
    if (search.trim().length >= 2) return searchResults

    let base = allData.get(activeTab) ?? []
    if (filterNeupatient) base = base.filter(p => p.neupatient === true)
    if (filterStatus === 'storniert') {
      base = base.filter(isStorniert)
    } else if (filterStatus === 'inaktiv') {
      base = base.filter(p => p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben')
    } else {
      // Standard: inaktive/verstorbene ausblenden
      base = base.filter(p => p.patientenStatus !== 'inaktiv' && p.patientenStatus !== 'verstorben')
    }
    if (filterAufgebotArt === 'kein') base = base.filter(p => !p.aufgebotArt)
    else if (filterAufgebotArt) base = base.filter(p => p.aufgebotArt === filterAufgebotArt)
    if (filterNochZuErledigen) base = base.filter(p => p.verlauf?.some(v => v.ergebnis === 'noch zu erledigen'))
    if (filterReminderFaellig) base = base.filter(p => getReminderDueDate(p) !== null)
    if (filterReminderGeplant) base = base.filter(p => getUpcomingReminderDate(p) !== null)
    if (filterTermin) {
      const now = new Date()
      const in7  = new Date(now); in7.setDate(now.getDate() + 7)
      const in30 = new Date(now); in30.setDate(now.getDate() + 30)
      base = base.filter(p => {
        if (p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben' || isStorniert(p)) return false
        const nk = p.naechsteKons
        switch (filterTermin) {
          case 'heute':      { if (!nk || nk === 'kein Termin') return false; const d = new Date(s(nk)); return d.toDateString() === now.toDateString() }
          case 'week':       { if (!nk || nk === 'kein Termin') return false; const d = new Date(s(nk)); return d > now && d <= in7 }
          case 'month':      { if (!nk || nk === 'kein Termin') return false; const d = new Date(s(nk)); return d > now && d <= in30 }
          case 'overdue':    return !!(nk && nk !== 'kein Termin' && !isFutureDate(nk))
          case 'inPlanung':  return nk === 'kein Termin'
          case 'ohneTermin': return !nk
        }
      })
    }
    return [...base].sort((a, b) => {
      for (const { col, dir } of sortKeys) {
        const av = sortVal(a, col)
        const bv = sortVal(b, col)
        if (!av && !bv) continue
        if (!av) return 1
        if (!bv) return -1
        const cmp = av.localeCompare(bv, 'de', { numeric: true })
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
      }
      return 0
    })
  }, [allData, activeTab, sortKeys, filterNeupatient, filterTermin, filterStatus, filterAufgebotArt, filterNochZuErledigen, filterReminderFaellig, filterReminderGeplant, search, searchResults]) // eslint-disable-line react-hooks/exhaustive-deps

  // Per-tab statistics for the filter bar chips
  const tabStats = useMemo(() => {
    const base = allData.get(activeTab) ?? []
    const now = new Date()
    const in7  = new Date(now); in7.setDate(now.getDate() + 7)
    const in30 = new Date(now); in30.setDate(now.getDate() + 30)
    const active = base.filter(p => p.patientenStatus !== 'inaktiv' && p.patientenStatus !== 'verstorben' && !isStorniert(p))
    return {
      heute:      active.filter(p => { const nk = p.naechsteKons; if (!nk || nk === 'kein Termin') return false; const d = new Date(s(nk)); return d.toDateString() === now.toDateString() }).length,
      week:       active.filter(p => { const nk = p.naechsteKons; if (!nk || nk === 'kein Termin') return false; const d = new Date(s(nk)); return d > now && d <= in7 }).length,
      month:      active.filter(p => { const nk = p.naechsteKons; if (!nk || nk === 'kein Termin') return false; const d = new Date(s(nk)); return d > now && d <= in30 }).length,
      overdue:    active.filter(p => !!(p.naechsteKons && p.naechsteKons !== 'kein Termin' && !isFutureDate(p.naechsteKons))).length,
      inPlanung:  active.filter(p => p.naechsteKons === 'kein Termin').length,
      ohneTermin: active.filter(p => !p.naechsteKons).length,
      neupatient:        base.filter(p => p.neupatient === true).length,
      storniert:         base.filter(isStorniert).length,
      inaktiv:           base.filter(p => p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben').length,
      nochZuErledigen:   base.filter(p => p.verlauf?.some(v => v.ergebnis === 'noch zu erledigen')).length,
      reminderFaellig:   active.filter(p => getReminderDueDate(p) !== null).length,
      reminderGeplant:   active.filter(p => getUpcomingReminderDate(p) !== null).length,
    }
  }, [allData, activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Aufgebot-Wochenplan helpers & data ───────────────────────────────────────
  function getWeekBounds(offset: number): { start: Date; end: Date } {
    const now = new Date()
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1 // Mon=0 … Sun=6
    const mon = new Date(now)
    mon.setDate(now.getDate() - dayOfWeek + offset * 7)
    mon.setHours(0, 0, 0, 0)
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    sun.setHours(23, 59, 59, 999)
    return { start: mon, end: sun }
  }
  function fmtWeekLabel(start: Date, end: Date): string {
    const f = (d: Date) => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`
    return `${f(start)} – ${f(end)}`
  }

  type WPEntry = { patient: RecallPatient }
  const wochenplanData = useMemo(() => {
    const { start, end } = getWeekBounds(wochenplanWeekOffset)
    const thisWeek: WPEntry[] = []
    const overdue:  WPEntry[] = []

    for (const patients of allData.values()) {
      for (const p of patients) {
        if (isStorniert(p) || p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben') continue
        if (!p.aufgebotFuer || p.aufgebotErstellt) continue
        const d = new Date(p.aufgebotFuer + 'T00:00:00')
        if (d >= start && d <= end) thisWeek.push({ patient: p })
        else if (d < start && wochenplanWeekOffset === 0) overdue.push({ patient: p })
      }
    }
    const sortFn = (a: WPEntry, b: WPEntry) => {
      const dc = s(a.patient.doctor).localeCompare(s(b.patient.doctor), 'de')
      if (dc !== 0) return dc
      return s(a.patient.vorname).localeCompare(s(b.patient.vorname), 'de')
    }
    type Groups = Record<string, WPEntry[]>
    function groupByArt(entries: WPEntry[]): Groups {
      const g: Groups = {}
      for (const e of entries) {
        const art = e.patient.aufgebotArt ?? 'kein'
        if (!g[art]) g[art] = []
        g[art].push(e)
      }
      for (const k of Object.keys(g)) g[k].sort(sortFn)
      return g
    }
    return {
      grouped: groupByArt(thisWeek),
      overdue: overdue.sort(sortFn),
      total: thisWeek.length,
      overdueCount: overdue.length,
      weekLabel: fmtWeekLabel(start, end),
    }
  }, [allData, wochenplanWeekOffset]) // eslint-disable-line react-hooks/exhaustive-deps

  function openAufgebotDialog(entry: WPEntry) {
    setAufgebotTarget(entry)
    const doctor = entry.patient.doctor
    setAufgebotForm({
      ...emptyAufgebotForm(),
      arztName:  doctorFullName(doctor),
      fachtitel: doctorFachtitelMap[doctor] ?? '',
    })
    setAufgebotPdfCreated(false)
  }

  function buildBriefHtml(patient: RecallPatient, form: AufgebotForm): string {
    const GERMAN_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
    const GERMAN_DAYS   = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag']
    const FEMALE_DOCTORS = new Set(['Malinina','Papazoglou'])

    // Address block: Liris format after normalization = "Nachname Vorname / Strasse / PLZ Ort"
    const adressLines = form.adressBlock.trim().split('\n').map(l => l.trim()).filter(Boolean)
    const nameLine    = adressLines[0] || ''
    const nachname    = nameLine.split(/\s+/)[0] || nameLine   // first word = Nachname (for salutation)

    const anredeAnrede = form.anrede === 'Herr' ? 'geehrter Herr' : form.anrede === 'Familie' ? 'geehrte Familie' : form.anrede === 'Frau' ? 'geehrte Frau' : 'geehrte Damen und Herren'

    // Reorder name: "Nachname Vorname" → "Vorname Nachname" for address window
    const escLine    = (l: string) => l.replace(/&/g,'&amp;').replace(/</g,'&lt;')
    const nameWords  = nameLine.split(/\s+/)
    const nameDisplay = nameWords.length >= 2
      ? `${nameWords[nameWords.length - 1]} ${nameWords.slice(0, -1).join(' ')}`
      : nameLine
    // Build structured address: Anrede / Vorname Nachname / Strasse / PLZ Ort
    const adressHtml = [form.anrede, nameDisplay, adressLines[1] ?? '', adressLines[2] ?? '']
      .filter(Boolean)
      .map(escLine)
      .join('<br>')

    // Date
    const today   = new Date()
    const dateStr = `${today.getDate()}. ${GERMAN_MONTHS[today.getMonth()]} ${today.getFullYear()}`

    const isReminder = form.art === 'Reminder' || (form.art === 'Brief' && !form.terminDatum.trim())
    const arztName   = form.arztName || doctorFullName(patient.doctor)
    const isFemale    = FEMALE_DOCTORS.has(patient.doctor)
    const arztArtikel = isFemale ? 'unserer Augenärztin' : 'unserem Augenarzt'
    // Fachtitel: from form (pre-filled from user profile), fallback to gender-based default
    const fachtitelDisplay = form.fachtitel.trim()
      || (isFemale ? 'Fachärztin für Augenheilkunde' : 'Facharzt für Augenheilkunde')

    // Letterhead doctor line
    const letterheadDoctor = arztName || 'Dr. med. Svetlana Malinina'

    // Appointment formatting with weekday + German month
    let terminZeile = ''
    let hasTermin   = false
    if (!isReminder && form.terminDatum) {
      const td        = new Date(form.terminDatum + 'T00:00:00')
      const dayName   = GERMAN_DAYS[td.getDay()]
      const monthName = GERMAN_MONTHS[td.getMonth()]
      const dateFmt   = `${dayName}, ${td.getDate()}. ${monthName} ${td.getFullYear()}`
      const zeitStr   = form.terminZeit ? ` um ${form.terminZeit} Uhr` : ''
      const arztStr   = arztName ? ` mit ${arztName}` : ''
      terminZeile     = `${dateFmt}${zeitStr}${arztStr}`
      hasTermin       = true
    }

    // Voruntersuchungen list for letter
    const vuItems = form.voruntersuchungen.map(v =>
      v === 'Sonstige' && form.voruntersuchungenSonstige.trim()
        ? form.voruntersuchungenSonstige.trim()
        : v
    ).filter(v => v !== 'Sonstige' || form.voruntersuchungenSonstige.trim())
    const hasVU = vuItems.length > 0

    // Total additional time for VU note
    const hasZykloplegie   = vuItems.includes('Zykloplegie')
    const otherKnownCount  = vuItems.filter(v => v in VU_DAUER && v !== 'Zykloplegie').length
    const vuZeitHinweis    = hasZykloplegie
      ? 'bis 2 Stunden'
      : otherKnownCount > 0 ? `ca. ${otherKnownCount * 15} Minuten` : null

    const vuSatzItems = vuItems.map(v => escLine(v))
    const vuSatz = vuSatzItems.length === 1
      ? vuSatzItems[0]
      : vuSatzItems.slice(0, -1).join(', ') + ' und ' + vuSatzItems[vuSatzItems.length - 1]
    const vuBlock = hasVU
      ? `<div class="info-section">
          <p><strong>Zus&#228;tzlich geplante Voruntersuchungen:</strong> ${vuSatz}.</p>
          ${vuZeitHinweis ? `<p>Bitte planen Sie hierf&#252;r <strong>${vuZeitHinweis}</strong> mehr Zeit ein.</p>` : ''}
        </div>`
      : `<p>Die Kontrolle umfasst Autorefraktometrie, Visus und Tensio sowie je nach Befund OCT-Makula oder Funduskopie.</p>`

    // Sehleistungshinweis je nach Situation
    const sehHinweis = hasZykloplegie
      ? `<p>Bitte beachten Sie: Die Sehleistung kann nach der Zykloplegie-Untersuchung f&#252;r <strong>12&#8211;24 Stunden</strong> beeintr&#228;chtigt bleiben. <strong>Bitte kein Fahrzeug lenken</strong> und planen Sie den Tag entsprechend. Sonnenbrille empfohlen.</p>`
      : form.pupille
        ? `<p>Die Pupillen werden mit Augentropfen erweitert. Die Sehleistung ist danach f&#252;r <strong>4&#8211;6 Stunden</strong> eingeschr&#228;nkt &#8211; <strong>bitte kein Fahrzeug lenken</strong>. Sonnenbrille empfohlen.</p>`
        : ``

    const title = isReminder ? 'Erinnerung &#8211; Augenkontrolle'
      : hasTermin ? 'Terminvorschlag f&#252;r die Routine Augenkontrolle'
      : 'Einladung zur Augenkontrolle'

    const salut = `<p class="salut">Sehr ${anredeAnrede} ${nachname}</p>`

    const terminBlock = hasTermin ? `
      <div class="termin-box-wrap">
        <div class="termin-box">
          <div class="termin-box-label">Vorgeschlagener Termin</div>
          <div class="termin-box-date">${terminZeile}</div>
        </div>
      </div>
      <p>Bei Terminänderung bitten wir um R&#252;ckmeldung bis <strong>24 Stunden vorher</strong> per Tel. <strong>+41 62 842 18 46</strong> oder <a href="mailto:info@augenzentrum-suhr.ch">info@augenzentrum-suhr.ch</a>.</p>
    ` : `
      <p>Termin vereinbaren: Tel. <strong>+41 62 842 18 46</strong> oder <a href="mailto:info@augenzentrum-suhr.ch">info@augenzentrum-suhr.ch</a>.</p>
    `

    // ── Body: mit Pupillenerweiterung ────────────────────────────────────────
    const bodyMit = `
      ${salut}
      <p>Gem&#228;ss unseren Unterlagen steht eine Augenkontrolle <strong>mit Pupillenerweiterung</strong> bei ${arztArtikel}${arztName ? ` ${arztName}` : ''} an.</p>
      ${terminBlock}
      ${vuBlock}
      ${sehHinweis}
      <div class="info-section">
        <p><strong>Bitte mitbringen:</strong> Brille/Kontaktlinsen (KL vor Termin entfernen), Medikamentenliste, Krankenkassenausweis, Sonnenbrille.</p>
      </div>
    `

    // ── Body: ohne Pupillenerweiterung ───────────────────────────────────────
    const bodyOhne = `
      ${salut}
      <p>Gem&#228;ss unseren Unterlagen steht eine Augenkontrolle <strong>ohne Pupillenerweiterung</strong> bei ${arztArtikel}${arztName ? ` ${arztName}` : ''} an.</p>
      ${terminBlock}
      ${vuBlock}
      <p>Nach der Untersuchung k&#246;nnen Sie Ihren Alltag wie gewohnt fortsetzen.</p>
      <div class="info-section">
        <p><strong>Bitte mitbringen:</strong> Brille/Kontaktlinsen (KL vor Termin entfernen), Medikamentenliste, Krankenkassenausweis.</p>
      </div>
    `

    // ── Body: Reminder ───────────────────────────────────────────────────────
    const bodyReminder = `
      ${salut}
      <p>Ihre letzte augen&#228;rztliche Untersuchung liegt bereits einige Zeit zur&#252;ck. Wir bitten Sie, sich f&#252;r einen neuen Kontrolltermin zu melden.</p>
      <p>Sie erreichen uns unter <strong>062 842 18 46</strong>, <a href="mailto:info@augenzentrum-suhr.ch">info@augenzentrum-suhr.ch</a> oder <a href="https://www.augenzentrum-suhr.ch">www.augenzentrum-suhr.ch</a>.</p>
      <p>Falls Sie bereits einen Termin haben oder inzwischen anderweitig betreut werden, betrachten Sie dieses Schreiben bitte als gegenstandslos.</p>
      <p>Wir danken Ihnen f&#252;r Ihr Vertrauen.</p>
    `

    const bodyHtml = isReminder ? bodyReminder : form.pupille ? bodyMit : bodyOhne

    const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><title>Brief</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#111;background:#fff}
  .page{width:21cm;height:29.7cm;max-height:29.7cm;overflow:hidden;padding:1.2cm 2.2cm 2cm 2.5cm;margin:auto}
  .letterhead{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:-0.2cm}
  .lh-left{display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end}
  .lh-logo{height:2.2cm;width:auto;max-width:8cm;object-fit:contain;display:block;margin-bottom:.25cm}
  .lh-name{font-size:14pt;font-weight:bold;margin-bottom:.12cm}
  .lh-title{font-size:11.5pt;font-weight:bold;color:#1a3a6e;margin-bottom:.15cm}
  .lh-praxisname{font-size:12pt;font-weight:bold;color:#1a3a6e;margin-bottom:.1cm;letter-spacing:.02em}
  .lh-addr{font-size:10pt;color:#1a3a6e;margin-bottom:.1cm}
  .lh-contact-left{font-size:9.5pt;line-height:1.7;color:#1a3a6e}
  .lh-right{display:flex;flex-direction:column;align-items:flex-end}
  .lh-praxis{margin-bottom:.15cm;font-size:10.5pt;font-weight:bold;color:#1a3a6e}
  .lh-contact{font-size:9.5pt;line-height:1.7;color:#1a3a6e;text-align:right}
  .addr-row{display:flex;justify-content:flex-end;margin-bottom:.9cm}
  .addrwin{width:8.5cm;font-size:10.5pt;line-height:1.25;margin-right:-1.5cm}
  .sender-sm{font-size:6.5pt;color:#aaa;border-bottom:1px solid #e0e0e0;margin-bottom:.3cm;padding-bottom:.07cm;white-space:nowrap}
  .right-col{display:flex;justify-content:flex-end}
  .right-col-inner{width:8.5cm;margin-right:-1.5cm}
  .dateline{margin-bottom:1.4cm;font-size:10.5pt}
  .subject{font-size:11pt;font-weight:bold;margin-bottom:1cm}
  .body p{margin-bottom:.3cm;line-height:1.15}
  .salut{margin-bottom:.45cm !important}
  .termin-box-wrap{text-align:center;margin:.4cm 0 .3cm}
  .termin-box{border:1.5px solid #333;border-radius:4px;padding:.35cm .6cm;display:inline-block;text-align:left}
  .termin-box-label{font-size:8pt;font-weight:bold;text-transform:uppercase;letter-spacing:.04em;color:#1a3a6e;margin-bottom:.15cm}
  .termin-box-date{font-size:12pt;font-weight:bold;color:#111}
  .info-section{margin-top:.25cm;margin-bottom:.3cm}
  .info-section>p{margin-bottom:.1cm !important}
  .info-section ul{list-style:none;padding:0}
  .info-section ul li{margin-bottom:.08cm;line-height:1.25;padding-left:.1cm}
  .vu-dauer{font-size:9pt;color:#1a3a6e;font-weight:normal}
  .vu-total{font-size:9.5pt;color:#1a3a6e;margin-top:.2cm !important}
  .body a{color:#111;text-decoration:none}
  .sig{margin-top:1.8cm;line-height:1.7}
  .sig .gruss{margin-bottom:.4cm}
  @page{margin:0;size:A4}
  @media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body><div class="page">

  <div class="letterhead">
    <div class="lh-left">
      <div class="lh-name">${escLine(letterheadDoctor)}</div>
      <div class="lh-title">${escLine(fachtitelDisplay)}</div>
      <div class="lh-praxisname">Augenzentrum Suhr</div>
      <div class="lh-addr">Tramstrasse 2, 5034 Suhr</div>
      <div class="lh-contact-left">
        Tel. +41 62 842 18 46<br>
        info@augenzentrum-suhr.ch<br>
        www.augenzentrum-suhr.ch
      </div>
    </div>
    <div class="lh-right"></div>
  </div>

  <div class="addr-row">
    <div class="addrwin">
      ${adressHtml}
    </div>
  </div>

  <div class="right-col"><div class="right-col-inner dateline">Suhr,&nbsp; ${dateStr}</div></div>
  <div class="subject">${title}</div>

  <div class="body">
    ${bodyHtml}
  </div>

  <div class="right-col"><div class="right-col-inner sig">
    <p class="gruss">Freundliche Gr&#252;sse</p>
    <p>Augenzentrum Suhr Team</p>
  </div></div>

</div>
</body></html>`

    return html
  }

  function generateBriefPDF(patient: RecallPatient, form: AufgebotForm) {
    const html = buildBriefHtml(patient, form)
    setBriefPreview(html)
    setAufgebotPdfCreated(true)
  }

  function openEmailInOutlook(patient: RecallPatient, form: AufgebotForm) {
    const GERMAN_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
    const GERMAN_DAYS   = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag']

    const isReminder   = form.art === 'Reminder' || (form.art === 'Brief' && !form.terminDatum.trim())
    const nameLine     = (form.adressBlock.trim().split('\n')[0] || '').trim()
    const nachname     = nameLine.split(/\s+/)[0] || nameLine
    const anredeAnrede = form.anrede === 'Herr' ? 'geehrter Herr' : form.anrede === 'Familie' ? 'geehrte Familie' : 'geehrte Frau'
    const salut        = `Sehr ${anredeAnrede} ${nachname}`
    const arztName     = form.arztName || doctorFullName(patient.doctor)
    const FEMALE_DOCTORS = new Set(['Malinina','Papazoglou'])
    const isFemale     = FEMALE_DOCTORS.has(patient.doctor)
    const arztArtikel  = isFemale ? 'unserer Augenärztin' : 'unserem Augenarzt'
    const fachtitelDisplay = form.fachtitel.trim() || (isFemale ? 'Fachärztin für Augenheilkunde' : 'Facharzt für Augenheilkunde')
    const hasZykloplegie = form.voruntersuchungen.includes('Zykloplegie')

    let terminZeile = ''
    if (!isReminder && form.terminDatum) {
      const td = new Date(form.terminDatum + 'T00:00:00')
      terminZeile = `${GERMAN_DAYS[td.getDay()]}, ${td.getDate()}. ${GERMAN_MONTHS[td.getMonth()]} ${td.getFullYear()}${form.terminZeit ? ` um ${form.terminZeit} Uhr` : ''}${arztName ? ` mit ${arztName}` : ''}`
    }

    const vuItems = form.voruntersuchungen.map(v =>
      v === 'Sonstige' && form.voruntersuchungenSonstige.trim() ? form.voruntersuchungenSonstige.trim() : v
    ).filter(v => v !== 'Sonstige' || form.voruntersuchungenSonstige.trim())

    const subject = isReminder
      ? 'Erinnerung – Augenkontrolle'
      : terminZeile ? 'Terminvorschlag für die Routine Augenkontrolle' : 'Einladung zur Augenkontrolle'

    // ── Formatierter Plaintext + direkt Outlook öffnen via mailto ────────────
    const SEP = '─────────────────────────────────'
    let body: string
    if (isReminder) {
      body = [
        `${salut}`, '',
        'Wir möchten Sie daran erinnern, dass Ihre letzte augenärztliche Untersuchung bereits einige Zeit zurückliegt.',
        '',
        'Um Ihre Augengesundheit weiterhin optimal zu betreuen, bitten wir Sie, sich für einen neuen Kontrolltermin mit unserer Praxis in Verbindung zu setzen.',
        '',
        'Sie erreichen uns unter:',
        '  Tel.  +41 62 842 18 46',
        '  Mail  info@augenzentrum-suhr.ch',
        '  Web   www.augenzentrum-suhr.ch',
        '',
        'Bitte melden Sie sich zeitnah, damit wir einen passenden Termin für Sie reservieren können.',
        'Falls Sie inzwischen von einem anderen Augenarzt betreut werden, bitten wir Sie um eine kurze Abmeldung.',
        '',
        'Sollten Sie bereits einen Termin bei uns vereinbart haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.',
        '',
        'Wir danken Ihnen für Ihr Vertrauen und freuen uns auf Ihre Rückmeldung.',
      ].join('\n')
    } else {
      const pupText = form.pupille ? 'mit Pupillenerweiterung' : 'ohne Pupillenerweiterung'
      const terminSection = terminZeile ? [
        '', SEP,
        '  TERMINVORSCHLAG',
        SEP,
        `  ${terminZeile}`,
        SEP, '',
        'Bei Terminänderung bitten wir um Rückmeldung bis spätestens 24 Std. vorher:',
        '  +41 62 842 18 46  |  info@augenzentrum-suhr.ch',
      ].join('\n') : [
        '',
        'Für einen Termin erreichen Sie uns unter +41 62 842 18 46 oder info@augenzentrum-suhr.ch.',
      ].join('\n')
      const vuSection = vuItems.length > 0 ? [
        '', 'ZUSÄTZLICH GEPLANTE VORUNTERSUCHUNGEN',
        ...vuItems.map(v => `  • ${v}`),
      ].join('\n') : ''
      const sehSection = hasZykloplegie
        ? '\n⚠  HINWEIS: Die Sehleistung kann nach der Zykloplegie für 12–24 Std. beeinträchtigt sein.\n   Bitte kein Fahrzeug lenken. Sonnenbrille empfohlen.'
        : form.pupille
          ? '\n⚠  HINWEIS: Die Pupillen werden erweitert. Sehleistung ca. 4–6 Std. eingeschränkt.\n   Bitte kein Fahrzeug lenken. Sonnenbrille empfohlen.'
          : ''
      const mitbringen = [
        '', 'BITTE MITBRINGEN',
        '  • Brille oder Kontaktlinsen (Kontaktlinsen bitte vor dem Termin entfernen)',
        '  • Aktuelle Medikamentenliste',
        '  • Krankenkassenausweis',
        ...(form.pupille ? ['  • Sonnenbrille (empfohlen)'] : []),
      ].join('\n')
      body = [
        `${salut}`, '',
        `Wir freuen uns, Sie bald wieder in unserer Praxis begrüssen zu dürfen. Gemäss unseren Unterlagen steht eine Augenkontrolle ${pupText} bei ${arztArtikel}${arztName ? `, ${arztName},` : ''} an.`,
        terminSection, vuSection, sehSection, mitbringen,
      ].join('\n')
    }

    const signatur = [
      '', SEP,
      'Freundliche Grüsse',
      'Augenzentrum Suhr Team', '',
      '  Tel.  +41 62 842 18 46',
      '  Mail  info@augenzentrum-suhr.ch',
      '  HIN   augenzentrum-suhr@hin.ch',
      '  Web   www.augenzentrum-suhr.ch',
    ].join('\n')

    const adressTrimmedLocal = form.adressBlock.trim()
    const isEmailLocal = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adressTrimmedLocal)
    const to = isEmailLocal ? adressTrimmedLocal : ''
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + signatur)}`

    // ── DEAD CODE BELOW (kept as reference for HTML approach) ─────────────────
    if (false) {
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const BLUE = '#1a3a6e'

    let bodyHtml: string
    if (isReminder) {
      bodyHtml = `
        <p>${esc(salut)},</p>
        <p>Wir möchten Sie daran erinnern, dass Ihre letzte augenärztliche Untersuchung bereits einige Zeit zurückliegt.</p>
        <p>Um Ihre Augengesundheit weiterhin optimal zu betreuen, bitten wir Sie, sich für einen neuen Kontrolltermin mit unserer Praxis in Verbindung zu setzen.</p>
        <p>Sie erreichen uns telefonisch unter <strong>062 842 18 46</strong>, per E-Mail an <a href="mailto:info@augenzentrum-suhr.ch" style="color:${BLUE}">info@augenzentrum-suhr.ch</a> oder über unsere Website <a href="https://www.augenzentrum-suhr.ch" style="color:${BLUE}">www.augenzentrum-suhr.ch</a>.</p>
        <p>Bitte melden Sie sich zeitnah, damit wir einen passenden Termin für Sie reservieren können.<br>Falls Sie inzwischen von einem anderen Augenarzt betreut werden, bitten wir Sie um eine kurze Abmeldung.</p>
        <p>Sollten Sie bereits einen Termin bei uns vereinbart haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.</p>
        <p>Wir danken Ihnen für Ihr Vertrauen und freuen uns auf Ihre Rückmeldung.</p>`
    } else {
      const pupText = form.pupille ? 'mit Pupillenerweiterung' : 'ohne Pupillenerweiterung'
      const terminBoxHtml = terminZeile
        ? `<div style="background:#f0f5ff;border-left:4px solid ${BLUE};border-radius:4px;padding:16px 20px;margin:20px 0">
            <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;color:${BLUE};margin-bottom:8px">Ihr Termin</div>
            <div style="font-size:17px;font-weight:bold;color:${BLUE}">${esc(terminZeile)}</div>
            <div style="font-size:13px;color:#555;margin-top:10px">Sollte der Termin nicht passen, bitten wir Sie um eine kurze Rückmeldung bis spätestens 24 Stunden vorher per <strong>+41 62 842 18 46</strong> oder <a href="mailto:info@augenzentrum-suhr.ch" style="color:${BLUE}">info@augenzentrum-suhr.ch</a>.</div>
           </div>`
        : `<p>Für einen Termin erreichen Sie uns unter <strong>+41 62 842 18 46</strong> oder <a href="mailto:info@augenzentrum-suhr.ch" style="color:${BLUE}">info@augenzentrum-suhr.ch</a>.</p>`
      const vuHtml = vuItems.length > 0
        ? `<div style="margin:20px 0">
            <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;color:${BLUE};margin-bottom:8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px">Zusätzlich geplante Voruntersuchungen</div>
            <ul style="margin:0;padding-left:20px;color:#333">${vuItems.map(v => `<li style="margin-bottom:4px">${esc(v)}</li>`).join('')}</ul>
           </div>`
        : ''
      const sehHinweisHtml = hasZykloplegie
        ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:12px 16px;margin:16px 0;font-size:13px;color:#555">
            ⚠️ Bitte beachten Sie: Die Sehleistung kann nach der Zykloplegie-Untersuchung für <strong>12–24 Stunden</strong> beeinträchtigt bleiben. <strong>Bitte kein Fahrzeug lenken.</strong> Sonnenbrille empfohlen.
           </div>`
        : form.pupille
          ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:12px 16px;margin:16px 0;font-size:13px;color:#555">
              ⚠️ Die Pupillen werden mit Augentropfen erweitert. Die Sehleistung ist danach für <strong>4–6 Stunden</strong> eingeschränkt – <strong>bitte kein Fahrzeug lenken.</strong> Sonnenbrille empfohlen.
             </div>`
          : ''
      const mitbringenItems = [
        'Brille oder Kontaktlinsen (Kontaktlinsen bitte vor dem Termin entfernen)',
        'Aktuelle Medikamentenliste',
        'Krankenkassenausweis',
        ...(form.pupille ? ['Sonnenbrille (empfohlen)'] : []),
      ]
      const mitbringenHtml = `<div style="margin:20px 0">
        <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;color:${BLUE};margin-bottom:8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px">Bitte mitbringen</div>
        <ul style="margin:0;padding-left:20px;color:#333">${mitbringenItems.map(v => `<li style="margin-bottom:4px">${esc(v)}</li>`).join('')}</ul>
       </div>`
      bodyHtml = `
        <p>${esc(salut)},</p>
        <p>Wir freuen uns, Sie bald wieder in unserer Praxis begrüssen zu dürfen. Gemäss unseren Unterlagen steht eine Augenkontrolle <strong>${esc(pupText)}</strong> bei ${esc(arztArtikel)}${arztName ? `, <strong>${esc(arztName)}</strong>,` : ''} an.</p>
        ${terminBoxHtml}
        ${vuHtml}
        ${sehHinweisHtml}
        ${mitbringenHtml}`
    }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;color:#222">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <div style="background:${BLUE};padding:22px 28px">
    <div style="color:#fff;font-size:17px;font-weight:bold">${esc(arztName || 'Augenzentrum Suhr')}</div>
    <div style="color:#a8c4e8;font-size:12px;margin-top:3px">${esc(fachtitelDisplay)}</div>
    <div style="color:#c5d8f0;font-size:12px;margin-top:2px">Augenzentrum Suhr &nbsp;·&nbsp; Tramstrasse 2, 5034 Suhr</div>
  </div>
  <div style="padding:28px 28px 8px;font-size:14px;line-height:1.65;color:#222">
    ${bodyHtml}
  </div>
  <div style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:20px 28px;font-size:13px;color:#555;line-height:1.8">
    <div style="color:#333;margin-bottom:10px">Freundliche Grüsse<br><strong>Augenzentrum Suhr Team</strong></div>
    <div>📞 <a href="tel:+41628421846" style="color:${BLUE};text-decoration:none">+41 62 842 18 46</a></div>
    <div>✉️ <a href="mailto:info@augenzentrum-suhr.ch" style="color:${BLUE};text-decoration:none">info@augenzentrum-suhr.ch</a></div>
    <div>🌐 <a href="https://www.augenzentrum-suhr.ch" style="color:${BLUE};text-decoration:none">www.augenzentrum-suhr.ch</a></div>
  </div>
</div>
</body></html>`

    // ── EML-Datei erstellen (Multipart: E-Mail-Body + Brief als Anhang) ──────
    const briefHtml  = buildBriefHtml(patient, form)
    const briefB64   = btoa(unescape(encodeURIComponent(briefHtml)))
    const boundary   = '----=_NextPart_AZS_001'
    const eml = [
      'MIME-Version: 1.0',
      'X-Unsent: 1',
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
      '',
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8; name="Brief_${nachname || 'Patient'}.html"`,
      `Content-Disposition: attachment; filename="Brief_${nachname || 'Patient'}.html"`,
      'Content-Transfer-Encoding: base64',
      '',
      briefB64,
      '',
      `--${boundary}--`,
    ].join('\r\n')

    const blob = new Blob([eml], { type: 'message/rfc822' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `Aufgebot_${nachname || 'Patient'}.eml`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    } // end if (false)

    setEmailCopied(true)
    setTimeout(() => setEmailCopied(false), 4000)
  }

  async function handleAufgebotSave() {
    if (!aufgebotTarget || !aufgebotForm.art) return
    setAufgebotConfirmPending(false)
    setAufgebotSaving(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const existingVerlauf: VerlaufEntry[] = aufgebotTarget.patient.verlauf ?? []
      // Brief without date → save as Reminder
      const effectiveArt: AufgebotArt =
        aufgebotForm.art === 'Brief' && !aufgebotForm.terminDatum ? 'Reminder' : aufgebotForm.art
      const logEntry: VerlaufEntry = {
        datum: today,
        aktion: effectiveArt === 'Brief' ? 'Briefaufgebot' :
                effectiveArt === 'Reminder' ? 'Reminder' : 'Telefonaufgebot',
        ergebnis: effectiveArt === 'Tel'
          ? (aufgebotForm.notiz.trim() || 'Anruf')
          : aufgebotForm.versand ? `Via ${aufgebotForm.versand}` : 'Erstellt',
        von: displayLabel,
      }
      const telDate = aufgebotForm.art === 'Tel' ? aufgebotForm.terminFixiert || null : null
      await updateRecallPatient(aufgebotTarget.patient.id, {
        aufgebotArt:       effectiveArt,
        aufgebotErstellt:  today,
        aufgebotVersand:   aufgebotForm.versand       || null,
        aufgebotNotiz:     aufgebotForm.notiz          || null,
        terminFixiert:     (aufgebotForm.art === 'Brief' ? aufgebotForm.terminDatum : aufgebotForm.terminFixiert) || null,
        ...(telDate ? { naechsteKons: telDate } : {}),
        verlauf:           [...existingVerlauf, logEntry],
        excelAbgeglichen:  true,
      } as any, displayLabel)
      // Lokalen Excel-Sync-Dienst triggern (läuft nur wenn Dienst aktiv)
      fetch('http://localhost:9731/sync', { method: 'POST' }).catch(() => {})
      await reloadTab(aufgebotTarget.patient.doctor)
      setAufgebotTarget(null)
    } catch {
      toast.error('Fehler beim Speichern. Bitte erneut versuchen.')
    } finally {
      setAufgebotSaving(false)
    }
  }

  const totalPages  = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows    = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset page to 1 whenever search changes
  useEffect(() => { setPage(1) }, [search])

  // ── Edit modal ───────────────────────────────────────────────────────────────
  function resetVorgehen() { setVorgehenTelOpen(false); setVorgehenEmailOpen(false); setVorgehenReminderOpen(false); setVorgehenTelDatum(''); setVorgehenEmailDatum(''); setVorgehenReminderDatum(''); setVorgehenTelGrund(''); setVorgehenEmailGrund(''); setVorgehenReminderGrund('') }
  function openEdit(patient: RecallPatient) { setEditTarget(patient); setForm(initForm(patient)); setAssignDoctor(''); setFormErrors({}); setQuickInput(''); setPidDup(null); setModalPos(null); resetVorgehen() }
  function openNew()                        { setEditTarget('new');    setForm(initForm());          setAssignDoctor(''); setFormErrors({}); setQuickInput(''); setPidDup(null); setModalPos(null); resetVorgehen() }
  function closeEdit()                      { setEditTarget(null) }

  function checkPid(raw: string) {
    const norm = normalizePid(raw)
    if (norm.length >= 1) {
      const currentId = editTarget !== 'new' && editTarget ? editTarget.id : null
      let found: RecallPatient | null = null
      outer: for (const pts of allData.values()) {
        for (const p of pts) {
          if (p.id !== currentId && normalizePid(p.pid) === norm) { found = p; break outer }
        }
      }
      setPidDup(found)
      setForm(f => ({ ...f, neupatient: !found }))
    } else {
      setPidDup(null)
      setForm(f => ({ ...f, neupatient: false }))
    }
  }

  function handleQuickInput(text: string) {
    setQuickInput(text)
    if (!text.trim()) return
    const parsed = parsePastedPatient(text)
    if (parsed.vorname)  setForm(f => ({ ...f, vorname:  parsed.vorname! }))
    if (parsed.gebDatum) setForm(f => ({ ...f, gebDatum: parsed.gebDatum!}))
    if (parsed.pid) {
      setForm(f => ({ ...f, pid: parsed.pid! }))
      checkPid(parsed.pid!)
    }
  }

  function setField<K extends keyof EditForm>(k: K, v: EditForm[K]) {
    setForm(f => ({ ...f, [k]: v }))
    if (formErrors[k as string]) setFormErrors(prev => ({ ...prev, [k as string]: false }))
  }

  async function addPraxis(name: string) {
    const trimmed = name.trim()
    if (!trimmed || zuweisungPraxen.includes(trimmed)) return
    const updated = [...zuweisungPraxen, trimmed]
    setZuweisungPraxen(updated)
    await saveZuweisungConfig({ praxen: updated, gruende: zuweisungGruende }).catch(() => {})
  }

  async function addGrund(name: string) {
    const trimmed = name.trim()
    if (!trimmed || zuweisungGruende.includes(trimmed)) return
    const updated = [...zuweisungGruende, trimmed]
    setZuweisungGruende(updated)
    await saveZuweisungConfig({ praxen: zuweisungPraxen, gruende: updated }).catch(() => {})
  }

  async function handleSave() {
    const errors: Record<string, boolean> = {}
    if (!form.pid.trim())      errors.pid      = true
    if (!form.vorname.trim())  errors.vorname  = true
    if (!form.gebDatum)        errors.gebDatum = true
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return }
    setFormErrors({})

    setSaving(true)
    try {
      const naechsteKons = form.naechsteKons || null
      const data = {
        pid:              normalizePid(form.pid) || null,
        name:             null,
        vorname:          form.vorname           || null,
        gebDatum:         form.gebDatum          || null,
        letzteKons:       form.letzteKons        || null,
        naechsteKons,
        storniert:        form.storniert         || null,
        grundStornierung: form.grundStornierung  || null,
        nachfassAdresse:  form.nachfassAdresse   || null,
        nachfassTel:      form.nachfassTel       || null,
        nachfassTelDatum: form.nachfassTelDatum  || null,
        aufgebotFuer:     form.aufgebotFuer      || null,
        aufgebotErstellt: form.aufgebotErstellt  || null,
        aufgebotArt:      form.aufgebotArt       || null,
        aufgebotVersand:  null,
        aufgebotNotiz:    null,
        terminFixiert:    null,
        patientenStatus:  form.patientenStatus   || null,
        neupatient:       (editTarget !== 'new' && normalizePid(form.pid) && !editTarget?.pid) ? false : (form.neupatient || null),
        rcErstellt:       !!(form.aufgebotArt && form.aufgebotErstellt) || null,
        verlauf:          form.verlauf.length > 0 ? form.verlauf : null,
        zuweisung:        form.zuweisungAktiv && form.zuweisungZiel.trim() ? ({
          typ:        form.zuweisungTyp,
          ziel:       form.zuweisungZiel.trim(),
          grund:      form.zuweisungGrund.trim(),
          datum:      form.zuweisungDatum,
          status:     form.zuweisungStatus,
          erledigtAm:      form.zuweisungErledigtAm,
          berichtErhalten: form.zuweisungBerichtErhalten,
          notiz:           form.zuweisungNotiz.trim(),
          von:        displayLabel,
        } as Zuweisung) : null,
      }
      // switchTab() macht setPage(1) + Filter-Reset + Sortierungs-Reset.
      // Daher rufen wir es nach dem Speichern NUR auf, wenn der Doctor-Tab
      // sich tatsächlich ändert (Neuanlage in anderem Tab, oder Umhängen
      // via assignDoctor). Beim normalen Bearbeiten auf demselben Tab bleibt
      // die Ansicht unverändert — Seite, Filter, Sortierung intakt.
      if (editTarget === 'new') {
        const targetTab = assignDoctor || activeTab
        await createRecallPatient(targetTab, data, displayLabel)
        await reloadTab(targetTab)
        closeEdit()
        if (targetTab !== activeTab) switchTab(targetTab)
      } else if (editTarget) {
        await updateRecallPatient(editTarget.id, { ...data, excelAbgeglichen: true } as any, displayLabel)
        fetch('http://localhost:9731/sync', { method: 'POST' }).catch(() => {})
        if (assignDoctor) {
          await assignRecallPatient(editTarget.id, assignDoctor, displayLabel)
          await Promise.all([reloadTab(editTarget.doctor), reloadTab(assignDoctor)])
          closeEdit()
          // assignDoctor heisst: Patient wurde umgehängt → echter Tab-Wechsel ist gewollt.
          if (assignDoctor !== activeTab) switchTab(assignDoctor)
        } else {
          await reloadTab(editTarget.doctor)
          closeEdit()
          // Reines Bearbeiten ohne Umhängen — auf dem aktiven Tab bleiben.
          // Falls aus irgendwelchen Gründen der Edit-Target-Doctor anders
          // ist als der aktive Tab (Race-Condition mit Tab-Wechsel während
          // Edit-Modal offen), trotzdem zum richtigen Tab springen.
          if (editTarget.doctor !== activeTab) switchTab(editTarget.doctor)
        }
      }
    } catch {
      toast.error('Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }


  /** Inline toggle for aufgebotArt — optimistic update, Firestore write in background.
   *  Wenn ein Aufgebot NEU gesetzt wird (newValue != null), schreiben wir zusätzlich
   *  einen verlauf-Eintrag, damit die Auswertung den Ersteller + Art zuordnen kann.
   *  Beim Entfernen (newValue == null) wird kein Entry erzeugt — der ursprüngliche
   *  bleibt im verlauf stehen. */
  async function handleInlineAufgebotArt(rowId: string, doctor: string, value: string, current: string | null) {
    const newValue = current === value ? null : value
    const today = new Date().toISOString().slice(0, 10)
    const newErstellt = newValue ? today : null

    // verlauf-Entry nur bei Neusetzen, aktions-Namen analog zu aufgebotConfirm()
    const existingPatient = (allData.get(doctor) ?? []).find(r => r.id === rowId)
    const existingVerlauf = existingPatient?.verlauf ?? []
    const inlineEntry: VerlaufEntry | null = newValue ? {
      datum: today,
      aktion: newValue === 'Brief'  ? 'Briefaufgebot'
            : newValue === 'Tel'    ? 'Telefonaufgebot'
            : newValue === 'Praxis' ? 'Praxisaufgebot'
            :                          'Reminder',
      ergebnis: 'Inline erfasst',
      von: displayLabel,
    } : null
    const newVerlauf = inlineEntry ? [...existingVerlauf, inlineEntry] : existingVerlauf

    setAllData(prev => {
      const next = new Map(prev)
      const updated = (next.get(doctor) ?? []).map(r =>
        r.id === rowId
          ? { ...r, aufgebotArt: newValue, aufgebotErstellt: newErstellt, verlauf: newVerlauf }
          : r
      )
      next.set(doctor, updated)
      return next
    })
    try {
      const payload: any = { aufgebotArt: newValue, aufgebotErstellt: newErstellt }
      if (inlineEntry) payload.verlauf = newVerlauf
      await updateRecallPatient(rowId, payload, displayLabel)
      await reloadTab(doctor)
    } catch {
      await reloadTab(doctor)
    }
  }

  /** Append a verlauf entry inline — optimistic update, Firestore write in background */
  async function handleInlineVerlauf(row: RecallPatient, aktion: string, ergebnis: string) {
    const today = new Date().toISOString().slice(0, 10)
    const entry: VerlaufEntry = { datum: today, aktion, ergebnis, von: displayLabel }
    const newVerlauf = [...(row.verlauf ?? []), entry]
    setAllData(prev => {
      const next = new Map(prev)
      const updated = (next.get(row.doctor) ?? []).map(r => r.id === row.id ? { ...r, verlauf: newVerlauf } : r)
      next.set(row.doctor, updated)
      return next
    })
    try {
      await updateRecallPatient(row.id, { verlauf: newVerlauf }, displayLabel)
      await reloadTab(row.doctor)
    } catch {
      await reloadTab(row.doctor)
    }
  }

  /** Mark patient as no-show — storniert + verlauf entry, optimistic update */
  async function handleInlineNoShow(row: RecallPatient) {
    const today = new Date().toISOString().slice(0, 10)
    const entry: VerlaufEntry = { datum: today, aktion: 'no Show', ergebnis: 'nicht erschienen', von: displayLabel }
    const newVerlauf = [...(row.verlauf ?? []), entry]
    setAllData(prev => {
      const next = new Map(prev)
      const updated = (next.get(row.doctor) ?? []).map(r =>
        r.id === row.id ? { ...r, storniert: 'ja', grundStornierung: 'no Show', verlauf: newVerlauf } : r
      )
      next.set(row.doctor, updated)
      return next
    })
    try {
      await updateRecallPatient(row.id, { storniert: 'ja', grundStornierung: 'no Show', verlauf: newVerlauf }, displayLabel)
      await reloadTab(row.doctor)
    } catch {
      await reloadTab(row.doctor)
    }
  }

  /** Toggle Excel-Abgleich flag — optimistic update, Firestore write in background */
  async function handleInlineExcelAbgeglichen(row: RecallPatient) {
    const newVal = !(row as any).excelAbgeglichen
    setAllData(prev => {
      const next = new Map(prev)
      const updated = (next.get(row.doctor) ?? []).map(r =>
        r.id === row.id ? { ...r, excelAbgeglichen: newVal } : r
      )
      next.set(row.doctor, updated)
      return next
    })
    try {
      await updateRecallPatient(row.id, { excelAbgeglichen: newVal || null } as any, displayLabel)
      await reloadTab(row.doctor)
    } catch {
      await reloadTab(row.doctor)
    }
  }

  async function handleDelete() {
    if (editTarget === 'new' || !editTarget) return
    const label = editTarget.vorname || 'diesen Eintrag'
    if (!window.confirm(`${label} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return
    setSaving(true)
    try {
      await deleteRecallPatient(editTarget.id)
      await reloadTab(editTarget.doctor)
      closeEdit()
    } catch {
      toast.error('Löschen fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }

  // ── Status screens ───────────────────────────────────────────────────────────
  if (status === 'checking' || status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        {syncMsg && <p className="text-xs text-amber-600 font-medium">{syncMsg}</p>}
      </div>
    )
  }

  if (status === 'empty') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center p-8">
        <p className="text-gray-500 text-sm">Noch keine Recall-Daten in der Datenbank.</p>
        <button
          onClick={handleImport}
          disabled={importing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {importing ? 'Importiere…' : 'Daten aus JSON importieren'}
        </button>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center p-8">
        <p className="text-red-500 font-semibold text-sm">Fehler beim Laden der Recall-Daten.</p>
        <p className="text-gray-400 text-xs">Bitte Seite neu laden (F5) oder den Administrator kontaktieren.</p>
        <button
          onClick={() => loadAll()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors"
        >
          Erneut versuchen
        </button>
      </div>
    )
  }

  // ── Main view ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      {/* Back + Tab bar */}
      <div className="px-6 pt-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <BackButton />
        </div>
        <nav className="flex gap-1 flex-wrap">
          {allTabs.map(tab => {
            const count    = allData.get(tab)?.length ?? 0
            const isActive = activeTab === tab
            const isZuBearb = tab === ZU_BEARB
            return (
              <button
                key={tab}
                onClick={() => switchTab(tab)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 ${
                  isZuBearb
                    ? isActive
                      ? 'border-amber-500 text-amber-700 bg-amber-50'
                      : 'border-transparent text-amber-600 hover:text-amber-700 hover:bg-amber-50'
                    : isActive
                      ? 'border-primary-600 text-primary-700 bg-primary-50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {tab}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  isZuBearb
                    ? isActive ? 'bg-amber-100 text-amber-700' : 'bg-amber-100 text-amber-600'
                    : isActive ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'
                }`}>{count}</span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* Status-Meldung (sync / import) */}
      {syncMsg && (
        <div className="shrink-0 px-4 sm:px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          {importingZuBearb && <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin shrink-0" />}
          <p className="text-xs text-amber-800 font-medium">{syncMsg}</p>
        </div>
      )}

      {/* Toolbar */}
      <div className="shrink-0 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between px-4 sm:px-6 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3 w-full sm:w-auto">

          {/* Global search */}
          <div ref={searchRef} className="flex-1 sm:w-96 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setSearchOpen(true); captureRect() }}
              onFocus={() => { if (search.trim().length >= 2) { setSearchOpen(true); captureRect() } }}
              placeholder="Alle Ärzte durchsuchen…"
              className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); setSearchOpen(false) }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* New patient */}
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" /> Neu
          </button>

          {/* Zuweisungen */}
          <button
            onClick={() => navigate('/zuweisungen')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 hover:text-gray-900 transition-colors shrink-0"
          >
            <ArrowRightLeft className="w-4 h-4" /> Zuweisungen
          </button>

          {/* Kimenda Excel import – only on "Zu bearbeiten" tab */}
          {activeTab === ZU_BEARB && (
            <>
              <input
                ref={kimendaInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleKimendaFile(f) }}
              />
              <button
                onClick={() => kimendaInputRef.current?.click()}
                disabled={importingZuBearb}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-amber-300 text-amber-700 bg-amber-50 rounded-xl hover:bg-amber-100 disabled:opacity-50 transition-colors shrink-0"
                title="Patientenliste (.xlsx) importieren"
              >
                {importingZuBearb ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span className="hidden sm:inline">{importingZuBearb ? 'Importiert…' : 'Patientenliste Upload'}</span>
              </button>
            </>
          )}

          {/* Aufgebot-Wochenplan */}
          <button
            onClick={() => { setWochenplanOpen(true); setWochenplanWeekOffset(0) }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-primary-200 text-primary-700 bg-primary-50 rounded-xl hover:bg-primary-100 transition-colors shrink-0"
            title="Wöchentlicher Aufgebot-Plan"
          >
            <CalendarDays className="w-4 h-4" />
            <span className="hidden sm:inline">Aufgebot-Plan</span>
          </button>

          {/* Auswertung */}
          <button
            onClick={() => setAuswertungOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors shrink-0"
            title="Auswertung"
          >
            <BarChart2 className="w-4 h-4" />
            <span className="hidden sm:inline">Auswertung</span>
          </button>
        </div>

        {/* Tab stats */}
        <div className="flex items-center gap-3 text-xs text-gray-500 shrink-0">
          <span className="font-medium text-gray-700">
            {search.trim().length >= 2
              ? `${rows.length} Treffer`
              : `${rows.length} Einträge`}
          </span>
          {(filterTermin || filterNeupatient || filterStatus || filterAufgebotArt || filterNochZuErledigen || filterReminderFaellig || filterReminderGeplant) && (
            <button
              onClick={() => { setFilterTermin(null); setFilterNeupatient(false); setFilterStatus(null); setFilterAufgebotArt(null); setFilterNochZuErledigen(false); setFilterReminderFaellig(false); setFilterReminderGeplant(false); setPage(1) }}
              className="flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200 font-medium hover:bg-gray-200 transition-colors"
            >
              <X className="w-3 h-3" /> Filter zurücksetzen
            </button>
          )}
        </div>
      </div>



      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-4 sm:px-6 py-2 bg-white border-b border-gray-100 overflow-x-auto">

        {/* Termin-chips: nur die 3 wichtigsten immer sichtbar */}
        {([
          { key: 'overdue'    as FilterTermin, label: 'Überfällig',  count: tabStats.overdue,    cls: 'bg-red-100 text-red-700 border-red-300' },
          { key: 'inPlanung'  as FilterTermin, label: 'Im Recall',   count: tabStats.inPlanung,  cls: 'bg-amber-100 text-amber-700 border-amber-300' },
          { key: 'ohneTermin' as FilterTermin, label: 'Ohne Termin', count: tabStats.ohneTermin, cls: 'bg-gray-200 text-gray-700 border-gray-300' },
        ]).map(chip => {
          const isActive = filterTermin === chip.key
          return (
            <button key={chip.key}
              onClick={() => { setFilterTermin(isActive ? null : chip.key); setFilterNeupatient(false); setFilterStatus(null); setPage(1) }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border ${isActive ? chip.cls : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
            >
              {chip.label}
              {chip.count > 0 && <span className="opacity-70 tabular-nums">({chip.count})</span>}
              {isActive && <X className="w-3 h-3 ml-0.5" />}
            </button>
          )
        })}

        {/* Reminder fällig chip */}
        {(tabStats.reminderFaellig > 0 || filterReminderFaellig) && (
          <button
            onClick={() => { setFilterReminderFaellig(v => !v); setFilterTermin(null); setFilterNeupatient(false); setFilterStatus(null); setPage(1) }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border ${filterReminderFaellig ? 'bg-purple-100 text-purple-700 border-purple-300' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
          >
            <Bell className="w-3 h-3" />
            Reminder fällig
            {tabStats.reminderFaellig > 0 && <span className="opacity-70 tabular-nums">({tabStats.reminderFaellig})</span>}
            {filterReminderFaellig && <X className="w-3 h-3 ml-0.5" />}
          </button>
        )}

        {/* Reminder geplant chip */}
        {(tabStats.reminderGeplant > 0 || filterReminderGeplant) && (
          <button
            onClick={() => { setFilterReminderGeplant(v => !v); setFilterTermin(null); setFilterNeupatient(false); setFilterStatus(null); setPage(1) }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border ${filterReminderGeplant ? 'bg-purple-50 text-purple-600 border-purple-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
          >
            <Bell className="w-3 h-3" />
            Reminder geplant
            {tabStats.reminderGeplant > 0 && <span className="opacity-70 tabular-nums">({tabStats.reminderGeplant})</span>}
            {filterReminderGeplant && <X className="w-3 h-3 ml-0.5" />}
          </button>
        )}

        {/* Zeitraum-Dropdown: Heute / 7 Tage / 30 Tage */}
        <select
          value={(['heute','week','month'] as FilterTermin[]).includes(filterTermin as FilterTermin) ? filterTermin! : ''}
          onChange={e => { setFilterTermin((e.target.value as FilterTermin) || null); setFilterNeupatient(false); setFilterStatus(null); setPage(1) }}
          className={`text-xs border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-300 cursor-pointer ${
            (['heute','week','month'] as FilterTermin[]).includes(filterTermin as FilterTermin)
              ? 'border-blue-300 bg-blue-50 text-blue-700 font-semibold'
              : 'border-gray-200 bg-white text-gray-500'
          }`}
        >
          <option value="">Zeitraum…</option>
          <option value="heute">Heute ({tabStats.heute})</option>
          <option value="week">7 Tage ({tabStats.week})</option>
          <option value="month">30 Tage ({tabStats.month})</option>
        </select>

        <div className="h-4 w-px bg-gray-200 shrink-0" />

        {/* Status-Dropdown: Neupatienten / Noch zu erledigen / Storniert / Inaktiv */}
        {(() => {
          const val = filterNeupatient ? 'neu' : filterNochZuErledigen ? 'nze' : filterStatus ?? ''
          return (
            <select
              value={val}
              onChange={e => {
                const v = e.target.value
                setFilterNeupatient(v === 'neu')
                setFilterNochZuErledigen(v === 'nze')
                setFilterStatus(v === 'storniert' ? 'storniert' : v === 'inaktiv' ? 'inaktiv' : null)
                setFilterTermin(null)
                setPage(1)
              }}
              className={`text-xs border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-300 cursor-pointer ${
                val ? 'border-primary-300 bg-primary-50 text-primary-700 font-semibold' : 'border-gray-200 bg-white text-gray-500'
              }`}
            >
              <option value="">Status…</option>
              <option value="neu">Neupatienten ({tabStats.neupatient})</option>
              <option value="nze">⏳ Noch zu erledigen ({tabStats.nochZuErledigen})</option>
              <option value="storniert">Storniert ({tabStats.storniert})</option>
              <option value="inaktiv">Inaktiv / ✝ ({tabStats.inaktiv})</option>
            </select>
          )
        })()}

        {/* Aufgebot-Dropdown */}
        <select
          value={filterAufgebotArt ?? ''}
          onChange={e => { setFilterAufgebotArt(e.target.value || null); setFilterTermin(null); setFilterNeupatient(false); setFilterStatus(null); setPage(1) }}
          className={`text-xs border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-300 cursor-pointer ${
            filterAufgebotArt ? 'border-primary-300 bg-primary-50 text-primary-700 font-semibold' : 'border-gray-200 bg-white text-gray-500'
          }`}
        >
          <option value="">Aufgebot…</option>
          <option value="Brief">Brief</option>
          <option value="Reminder">Reminder</option>
          <option value="Tel">Tel.</option>
          <option value="Praxis">Praxis</option>
          <option value="kein">Kein RC</option>
        </select>

      </div>

      {/* ── Mobile card view ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto md:hidden divide-y divide-gray-100">
        {pageRows.length === 0 ? (
          <p className="px-4 py-10 text-center text-gray-400 text-sm">Keine Einträge gefunden.</p>
        ) : pageRows.map(row => {
          const storniert  = isStorniert(row)
          const patStatus  = s(row.patientenStatus)
          const isInaktiv  = patStatus === 'inaktiv' || patStatus === 'verstorben'
          return (
            <div
              key={row.id}
              onClick={() => openEdit(row)}
              className={`flex flex-col gap-1 px-4 py-3 cursor-pointer transition-colors ${
                storniert ? 'bg-red-50 hover:bg-red-100' :
                isInaktiv ? 'opacity-60 hover:opacity-80 hover:bg-gray-50' :
                'hover:bg-primary-50'
              }`}
            >
              {/* Name + Status + badges */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0">
                  {patStatus === 'verstorben'    && <span className="text-gray-500 text-sm font-bold leading-none">✝</span>}
                  {patStatus === 'inaktiv'       && <MinusCircle className="w-4 h-4 text-gray-400" />}
                  {patStatus === 'aktiv'         && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                  {patStatus === 'Reminder'      && <Bell className="w-4 h-4 text-blue-500" />}
                  {patStatus === 'kein Aufgebot' && <BellOff className="w-4 h-4 text-gray-400" />}
                </span>
                <span className={`font-semibold truncate ${isInaktiv ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                  {row.vorname}
                </span>
                {search.trim().length >= 2 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 shrink-0">{row.doctor}</span>
                )}
                {row.neupatient === true && isWithin7Days(row.erstellt) && (
                  <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">Neu</span>
                )}
                {row.verlauf?.some(v => v.ergebnis === 'noch zu erledigen') && (
                  <span title="Kontakt noch zu erledigen" className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">⏳</span>
                )}
                {row.zuweisung && (row.zuweisung.status === 'pendent' || (row.zuweisung.status as string) === 'ausstehend') && (
                  <span title={`Zuweisung pendent → ${row.zuweisung.ziel}`} className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-300">↪ {row.zuweisung.typ === 'intern' ? 'Int.' : 'Ext.'}</span>
                )}
                {storniert && (
                  <span className="ml-auto shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">storniert</span>
                )}
              </div>
              {/* PID + Geb. Datum */}
              <div className="flex items-center gap-3 text-xs text-gray-400 pl-6">
                {row.pid && <span className="font-mono">#{normalizePid(row.pid)}</span>}
                {row.gebDatum && row.gebDatum !== 'kein Termin' && <span>{formatDate(row.gebDatum)}</span>}
              </div>
              {/* Nächste Konst. + RC + Aufgebots Art */}
              <div className="flex items-center gap-3 text-xs pl-6 flex-wrap">
                {row.naechsteKons && row.naechsteKons !== 'kein Termin' && (() => {
                  const d = new Date(row.naechsteKons + 'T00:00:00Z')
                  return <span className="text-gray-600">Nächste: {String(d.getUTCDate()).padStart(2,'0')}.{String(d.getUTCMonth()+1).padStart(2,'0')}.{d.getUTCFullYear()}</span>
                })()}
                {(row.aufgebotErstellt || row.aufgebotFuer) && (() => {
                  const rcErstellt = !!(row.aufgebotArt && row.aufgebotErstellt)
                  if (row.aufgebotErstellt) {
                    const de = new Date(row.aufgebotErstellt + 'T00:00:00Z')
                    if (!isNaN(de.getTime())) {
                      const label = `${String(de.getUTCDate()).padStart(2,'0')}.${String(de.getUTCMonth()+1).padStart(2,'0')}.${de.getUTCFullYear()}`
                      return <span className="font-medium text-green-600">RC: {label} ✓</span>
                    }
                  }
                  if (!row.aufgebotFuer) return null
                  const d = new Date(row.aufgebotFuer + 'T00:00:00Z')
                  if (isNaN(d.getTime())) return null
                  const label = `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`
                  const overdue = !rcErstellt && d <= (() => { const x = new Date(); x.setUTCMonth(x.getUTCMonth()-1); return x })()
                  return <span className={`font-medium ${overdue ? 'text-red-500' : 'text-gray-500'}`}>RC: {label}{overdue ? ' !' : ''}</span>
                })()}
                {row.aufgebotArt && (() => {
                  const opt = AUFGEBOT_OPTIONS.find(o => o.value === row.aufgebotArt)
                  if (!opt) return null
                  const { Icon, label } = opt
                  return (
                    <span className="flex items-center gap-0.5 text-primary-600">
                      <Icon className="w-3.5 h-3.5" />{label}
                      {row.aufgebotErstellt && <span className="text-gray-400 ml-1 tabular-nums">{formatDate(row.aufgebotErstellt)}</span>}
                    </span>
                  )
                })()}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Desktop table ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto hidden md:block">
        <table className="w-full min-w-max text-sm border-collapse">
          <thead className="sticky top-0 z-20">
            <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <th className="px-3 py-3 w-10 sticky left-0 z-30 bg-gray-50" />
              <th onClick={e => handleSort('pid', e.shiftKey)} className="text-left px-3 py-3 whitespace-nowrap hidden md:table-cell sticky left-10 z-30 bg-gray-50 min-w-[80px] cursor-pointer hover:bg-gray-100 select-none">PID{sortIcon('pid')}</th>
              <th onClick={e => handleSort('vorname', e.shiftKey)} className="text-left px-3 py-3 whitespace-nowrap sticky left-10 md:left-[120px] z-30 bg-gray-50 min-w-[120px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] cursor-pointer hover:bg-gray-100 select-none">Vorname{sortIcon('vorname')}</th>
              <th onClick={e => handleSort('gebDatum', e.shiftKey)} className="text-left px-3 py-3 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none">Geb. Datum{sortIcon('gebDatum')}</th>
              <th onClick={e => handleSort('letzteKons', e.shiftKey)} className="text-left px-3 py-3 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none">Letzte Konst.{sortIcon('letzteKons')}</th>
              <th onClick={e => handleSort('naechsteKons', e.shiftKey)} className="text-left px-3 py-3 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none">Nächste Konst.{sortIcon('naechsteKons')}</th>
              <th onClick={e => handleSort('aufgebotFuer', e.shiftKey)} className="text-left px-3 py-3 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none">RC erstellen ab{sortIcon('aufgebotFuer')}</th>
              <th onClick={e => handleSort('aufgebotArt', e.shiftKey)} className="text-left px-3 py-3 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none">Aufgebotsart{sortIcon('aufgebotArt')}</th>
              <th onClick={e => handleSort('storniert', e.shiftKey)} className="text-left px-3 py-3 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none">Storniert{sortIcon('storniert')}</th>
              <th className="px-2 py-3 w-[120px] text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Schnellaktionen</th>
              <th onClick={e => handleSort('aktualisiert', e.shiftKey)} className="text-left px-3 py-3 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none">Aktualisiert{sortIcon('aktualisiert')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-gray-400">
                  Keine Einträge gefunden.
                </td>
              </tr>
            ) : (
              pageRows.map(row => {
                const storniert  = isStorniert(row)
                const keinTermin = isKeinTermin(row.naechsteKons)
                const futureNext = isFutureDate(row.naechsteKons)
                const patStatus  = s(row.patientenStatus)
                const isInaktiv  = patStatus === 'inaktiv' || patStatus === 'verstorben'
                return (
                  <tr
                    key={row.id}
                    onClick={() => openEdit(row)}
                    className={`transition-colors group cursor-pointer ${
                      storniert ? 'bg-red-50 hover:bg-red-100' :
                      isInaktiv ? 'opacity-50 hover:opacity-70 hover:bg-gray-100' :
                      'hover:bg-primary-50'
                    }`}
                  >
                    <td className={`px-2 py-2.5 sticky left-0 z-10 ${storniert ? 'bg-red-50' : 'bg-white'}`}>
                      {patStatus === 'verstorben'    && <span title="Verstorben" className="text-gray-500 text-sm font-bold leading-none">✝</span>}
                      {patStatus === 'inaktiv'       && <span title="Inaktiv"><MinusCircle className="w-4 h-4 text-gray-400" /></span>}
                      {patStatus === 'aktiv'         && <span title="Aktiv"><CheckCircle2 className="w-4 h-4 text-green-600" /></span>}
                      {patStatus === 'Reminder'      && <span title="Reminder"><Bell className="w-4 h-4 text-blue-500" /></span>}
                      {patStatus === 'kein Aufgebot' && <span title="kein Aufgebot - meldet sich b. Bedarf"><BellOff className="w-4 h-4 text-gray-400" /></span>}
                    </td>
                    <td className={`px-3 py-2.5 text-gray-400 text-xs tabular-nums whitespace-nowrap hidden md:table-cell sticky left-10 z-10 min-w-[80px] ${storniert ? 'bg-red-50' : 'bg-white'}`}>
                      {row.pid ? (
                        <span className="flex items-center gap-1">
                          <span>{`#${normalizePid(row.pid)}`}</span>
                          <button onClick={e => { e.stopPropagation(); copyToClipboard(`#${normalizePid(row.pid)}`, `pid-${row.id}`) }} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-primary-500" title="Kopieren">
                            {copiedCell === `pid-${row.id}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </span>
                      ) : '—'}
                    </td>
                    <td className={`px-3 py-2.5 whitespace-nowrap sticky left-10 md:left-[120px] z-10 min-w-[120px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] ${storniert ? 'bg-red-50' : 'bg-white'}`}>
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5">
                          <span className={isInaktiv ? 'text-gray-400 line-through' : 'text-gray-700'}>{row.vorname || '—'}</span>
                          {row.neupatient === true && isWithin7Days(row.erstellt) && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 shrink-0">Neu</span>
                          )}
                          {row.verlauf?.some(v => v.ergebnis === 'noch zu erledigen') && (
                            <span title={pendingVorgehenLabel(row)} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 shrink-0">⏳ {pendingVorgehenLabel(row)}</span>
                          )}
                          {(() => {
                            const overdue2 = getOverdueReminderInfo(row)
                            const dueDate  = getReminderDueDate(row)
                            const upcoming = getUpcomingReminderDate(row)
                            if (overdue2) return <span title="2. Reminder fällig – 6 Monate ohne Rückmeldung" className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-300 shrink-0">🔔 2. Reminder</span>
                            if (dueDate)  return <span title={`Reminder fällig seit ${formatDate(dueDate)}`} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-300 shrink-0">🔔 Reminder {formatDate(dueDate)}</span>
                            if (upcoming) return <span title={`Reminder geplant am ${formatDate(upcoming)}`} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-200 shrink-0">🔔 {formatDate(upcoming)}</span>
                            return null
                          })()}
                        </span>
                        {search.trim().length >= 2 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 self-start leading-tight">{row.doctor}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap tabular-nums">
                      {row.gebDatum && row.gebDatum !== 'kein Termin' ? (
                        <span className="flex items-center gap-1">
                          <span>{formatDate(row.gebDatum)}</span>
                          <button onClick={e => { e.stopPropagation(); copyToClipboard(formatDate(row.gebDatum), `geb-${row.id}`) }} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-primary-500" title="Kopieren">
                            {copiedCell === `geb-${row.id}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </span>
                      ) : formatDate(row.gebDatum)}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap tabular-nums">{formatDate(row.letzteKons)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-500 text-xs">
                      {(() => {
                        const v = row.naechsteKons
                        if (!v || v === 'kein Termin') return '—'
                        const d = new Date(v + 'T00:00:00Z')
                        return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`
                      })()}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-500 text-xs">
                      {(() => {
                        const rcErstellt = !!(row.aufgebotArt && row.aufgebotErstellt)
                        // Prefer aufgebotErstellt (actual creation date) when available
                        if (row.aufgebotErstellt) {
                          const de = new Date(row.aufgebotErstellt + 'T00:00:00Z')
                          if (!isNaN(de.getTime())) {
                            const label = `${String(de.getUTCDate()).padStart(2,'0')}.${String(de.getUTCMonth()+1).padStart(2,'0')}.${de.getUTCFullYear()}`
                            return (
                              <span className="flex flex-col gap-0.5">
                                <span>{label}</span>
                                <span className="text-[10px] font-semibold text-green-600">erstellt</span>
                              </span>
                            )
                          }
                        }
                        // Fall back to aufgebotFuer (target date)
                        if (!row.aufgebotFuer) return '—'
                        const d = new Date(row.aufgebotFuer + 'T00:00:00Z')
                        if (isNaN(d.getTime())) return '—'
                        const label = `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`
                        const oneMonthAgo = new Date(); oneMonthAgo.setUTCMonth(oneMonthAgo.getUTCMonth() - 1)
                        const overdue = !rcErstellt && d <= oneMonthAgo
                        return (
                          <span className="flex flex-col gap-0.5">
                            <span>{label}</span>
                            {overdue && <span className="text-[10px] font-semibold text-red-500">überfällig</span>}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-0.5">
                          {AUFGEBOT_OPTIONS.map(({ value, Icon, label }) => {
                            const isActive = row.aufgebotArt === value
                            return (
                              <button
                                key={value}
                                title={label}
                                onClick={e => { e.stopPropagation(); handleInlineAufgebotArt(row.id, row.doctor, value, row.aufgebotArt) }}
                                className={`p-1 rounded transition-all ${
                                  isActive
                                    ? 'text-primary-600 bg-primary-50 border border-primary-200'
                                    : 'text-gray-300 border border-transparent opacity-0 group-hover:opacity-100 hover:text-gray-600 hover:bg-gray-100'
                                }`}
                              >
                                <Icon className="w-3.5 h-3.5" />
                              </button>
                            )
                          })}
                        </div>
                        {row.aufgebotArt && row.aufgebotErstellt && (
                          <span className="text-[10px] text-gray-400 tabular-nums pl-0.5">
                            {formatDate(row.aufgebotErstellt)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {storniert ? (
                        <span
                          title={row.grundStornierung ? `Grund: ${row.grundStornierung}` : undefined}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 ${row.grundStornierung ? 'cursor-help' : ''}`}
                        >
                          ja
                          {row.grundStornierung && <Info className="w-3 h-3 shrink-0" />}
                        </span>
                      ) : row.storniert === 'nein' ? (
                        <span className="text-gray-400 text-xs">nein</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        {/* Excel-Abgleich Indikator – automatisch gesetzt beim Speichern */}
                        {(row as any).excelAbgeglichen && (
                          <span title="Mit Excel abgeglichen" className="p-1 text-green-600 shrink-0">
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                          </span>
                        )}
                        {/* Schnellaktionen – nur bei Hover */}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            title="Tel: Erreicht"
                            onClick={() => handleInlineVerlauf(row, 'Telefonanruf', 'Erreicht')}
                            className="p-1 rounded text-gray-300 hover:text-green-600 hover:bg-green-50 transition-colors"
                          ><PhoneCall className="w-3.5 h-3.5" /></button>
                          <button
                            title="Tel: Nicht erreicht"
                            onClick={() => handleInlineVerlauf(row, 'Telefonanruf', 'Nicht erreicht')}
                            className="p-1 rounded text-gray-300 hover:text-orange-500 hover:bg-orange-50 transition-colors"
                          ><PhoneMissed className="w-3.5 h-3.5" /></button>
                          <button
                            title="Reminder in 1 Monat planen"
                            onClick={() => { const d = new Date(); d.setMonth(d.getMonth() + 1); handleInlineVerlauf(row, 'Reminder', `Geplant: ${d.toISOString().slice(0, 10)}`) }}
                            className="p-1 rounded text-gray-300 hover:text-purple-600 hover:bg-purple-50 transition-colors"
                          ><Clock className="w-3.5 h-3.5" /></button>
                          <button
                            title="No Show – stornieren"
                            onClick={() => handleInlineNoShow(row)}
                            className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                          ><UserX className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                      {row.aktualisiert || row.erstellt || '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>{/* end desktop table */}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-t border-gray-200 bg-white">
          <p className="text-xs text-gray-500">
            Seite {page} von {totalPages} · {rows.length} Einträge
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p: number
              if (totalPages <= 7)             p = i + 1
              else if (page <= 4)              p = i + 1
              else if (page >= totalPages - 3) p = totalPages - 6 + i
              else                             p = page - 3 + i
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                    p === page
                      ? 'bg-primary-600 text-white'
                      : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </button>
              )
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Search popup removed — results are now shown directly in the table */}

      {/* ── Aufgebot-Dialog ────────────────────────────────────────────────────── */}
      {aufgebotTarget && (() => {
        const p = aufgebotTarget.patient
        const af = aufgebotForm
        const setAf = (patch: Partial<AufgebotForm>) => setAufgebotForm(f => ({ ...f, ...patch }))
        const canSave = !!af.art && (
          af.art === 'Tel'
            ? !!af.notiz.trim()
            : !!af.adressBlock.trim() && !!af.versand && !!af.anrede && !!af.terminDatum && !!af.terminZeit
        )
        const livePreviewHtml = af.art === 'Brief' ? buildBriefHtml(p, af) : null

        const ART_BUTTONS: { art: AufgebotArt; Icon: React.ComponentType<{className?:string}>; label: string; sub: string; color: string }[] = [
          { art: 'Brief', Icon: Mail,  label: 'Brief / Reminder', sub: 'Mit Datum = Brief · ohne = Reminder', color: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' },
          { art: 'Tel',   Icon: Phone, label: 'Telefon',          sub: 'Anruf mit Grundvermerk',              color: 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100' },
        ]

        return (
          <>
            <div className="fixed inset-0 bg-black/60 z-[60]" onClick={() => setAufgebotTarget(null)} />
            <div className="fixed inset-4 z-[61] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden max-w-6xl mx-auto">

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
                <div>
                  <h2 className="font-bold text-gray-900">Patient aufbieten</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{p.vorname} {p.pid && `· #${normalizePid(p.pid)}`} · {p.doctor}</p>
                </div>
                <button onClick={() => setAufgebotTarget(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Two-column body */}
              <div className="flex-1 flex overflow-hidden">

              {/* Left: form */}
              <div className="w-[420px] shrink-0 overflow-y-auto px-6 py-5 space-y-5 border-r border-gray-200">

                {/* Step 1: Art wählen */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Aufgebots-Art</p>
                  <div className="grid grid-cols-2 gap-2">
                    {ART_BUTTONS.map(({ art, Icon, label, sub, color }) => (
                      <button
                        key={art}
                        onClick={() => setAf({ art: af.art === art ? null : art, versand: '', notiz: '', pupille: false })}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-colors ${
                          af.art === art ? color + ' border-current' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="text-xs font-semibold leading-tight">{label}</span>
                        <span className="text-[10px] opacity-70 leading-tight">{sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Nächste Konst. – nur für Tel */}
                {af.art === 'Tel' && (
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
                      Nächste Konst. <span className="font-normal normal-case text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="date"
                      value={af.terminFixiert}
                      onChange={e => setAf({ terminFixiert: e.target.value })}
                      className="input text-sm"
                    />
                  </div>
                )}

                {/* Brief-specific fields */}
                {af.art === 'Brief' && (
                  <>
                    {/* Pupillenerweiterung */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Untersuchungsart</p>
                      <div className="flex gap-2">
                        {([false, true] as const).map(val => (
                          <button key={String(val)} onClick={() => setAf({ pupille: val })}
                            className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                              af.pupille === val ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}>
                            {val ? 'Mit Pupillenerweiterung' : 'Ohne Pupillenerweiterung'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Voruntersuchungen */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                        Voruntersuchungen <span className="font-normal normal-case text-gray-400">(keine Auswahl = Allgemeine Kontrolle)</span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {VORUNTERSUCHUNGEN.map(v => {
                          const active = af.voruntersuchungen.includes(v)
                          return (
                            <button key={v}
                              onClick={() => {
                                const newVUs = active
                                  ? af.voruntersuchungen.filter(x => x !== v)
                                  : [...af.voruntersuchungen, v]
                                setAf({
                                  voruntersuchungen: newVUs,
                                  ...(v === 'Zykloplegie' && !active ? { pupille: true } : {}),
                                })
                              }}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                              }`}>
                              {v}
                            </button>
                          )
                        })}
                        {/* Sonstige toggle */}
                        <button
                          onClick={() => setAf({ voruntersuchungen: af.voruntersuchungen.includes('Sonstige')
                            ? af.voruntersuchungen.filter(x => x !== 'Sonstige')
                            : [...af.voruntersuchungen, 'Sonstige'],
                            voruntersuchungenSonstige: af.voruntersuchungen.includes('Sonstige') ? '' : af.voruntersuchungenSonstige })}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                            af.voruntersuchungen.includes('Sonstige') ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                          }`}>Sonstige</button>
                      </div>
                      {af.voruntersuchungen.includes('Sonstige') && (
                        <input type="text" value={af.voruntersuchungenSonstige}
                          onChange={e => setAf({ voruntersuchungenSonstige: e.target.value })}
                          placeholder="Freitext für sonstige Untersuchung"
                          className="input text-sm mt-1.5 w-full" />
                      )}
                    </div>

                    {/* Termindatum & Uhrzeit */}
                    <div>
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
                        Termindatum &amp; Uhrzeit <span className="text-red-500">*</span>
                      </label>
                      <div className="flex gap-2 items-center">
                        <input type="date" value={af.terminDatum}
                          onChange={e => setAf({ terminDatum: e.target.value })}
                          className="input text-sm flex-1" />
                        <select value={af.terminZeit}
                          onChange={e => setAf({ terminZeit: e.target.value })}
                          className="input text-sm w-28">
                          <option value="">Uhrzeit</option>
                          {Array.from({ length: 37 }, (_, i) => {
                            const totalMin = 8 * 60 + i * 15
                            const h = String(Math.floor(totalMin / 60)).padStart(2, '0')
                            const m = String(totalMin % 60).padStart(2, '0')
                            return <option key={i} value={`${h}:${m}`}>{h}:{m}</option>
                          })}
                        </select>
                        {(af.terminDatum || af.terminZeit) && (
                          <button
                            onClick={() => setAf({ terminDatum: '', terminZeit: '' })}
                            title="Datum und Uhrzeit löschen"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Anrede */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Anrede <span className="text-red-500">*</span></p>
                      <div className="flex gap-2">
                        {(['Frau', 'Herr', 'Familie'] as const).map(a => (
                          <button key={a} onClick={() => setAf({ anrede: a })}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                              af.anrede === a ? 'border-gray-400 bg-gray-100 text-gray-800' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                            }`}>{a}</button>
                        ))}
                      </div>
                    </div>

                    {/* Postadresse */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                        Adresse <span className="text-amber-600 font-normal normal-case">(nicht gespeichert · hineinziehen oder einfügen)</span>
                      </p>
                      <textarea
                        rows={4}
                        value={af.adressBlock}
                        onChange={e => setAf({ adressBlock: e.target.value })}
                        onPaste={e => { e.preventDefault(); setAf({ adressBlock: normalizeLirisAddress(e.clipboardData.getData('text')) }) }}
                        onDrop={e => { e.preventDefault(); setAf({ adressBlock: normalizeLirisAddress(e.dataTransfer.getData('text')) }) }}
                        onDragOver={e => e.preventDefault()}
                        placeholder={"Muster Hans\nBahnhofstrasse 12\n5034 Suhr"}
                        className="input text-sm resize-none font-mono"
                      />
                    </div>

                  </>
                )}

                {/* Telefon: Grundvermerk */}
                {af.art === 'Tel' && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Grundvermerk *</p>
                    <textarea
                      rows={4} value={af.notiz} autoFocus
                      onChange={e => setAf({ notiz: e.target.value })}
                      placeholder="z.B. Patient erreicht, Termin vereinbart für… / Keine Antwort, Nachricht hinterlassen"
                      className="input text-sm resize-none"
                    />
                  </div>
                )}

              </div>{/* end left form panel */}

              {/* Right: versand buttons + live preview */}
              <div className="flex-1 bg-gray-100 overflow-auto flex flex-col">
                {af.art === 'Brief' && (
                  <div className="shrink-0 flex gap-2 px-4 pt-3 pb-2 bg-gray-50 border-b border-gray-200">
                    <button
                      onClick={() => { setAf({ versand: 'Post' }); generateBriefPDF(p, af) }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                        af.versand === 'Post' ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      }`}>
                      <Printer className="w-4 h-4" /> Per Post (PDF)
                    </button>
                    <button
                      onClick={() => { setAf({ versand: 'Email' }); openEmailInOutlook(p, af) }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                        emailCopied ? 'border-green-400 bg-green-50 text-green-700' :
                        af.versand === 'Email' ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      }`}>
                      <Mail className="w-4 h-4" />
                      {emailCopied ? '✓ E-Mail wird geöffnet' : 'Per E-Mail'}
                    </button>
                  </div>
                )}
                {livePreviewHtml ? (
                  <iframe
                    srcDoc={livePreviewHtml}
                    className="flex-1 w-full border-none"
                    style={{ minHeight: '600px' }}
                    title="Vorschau"
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                    {af.art === 'Brief' ? 'Formular ausfüllen für Vorschau' : 'Vorschau nur für Brief verfügbar'}
                  </div>
                )}
              </div>

              </div>{/* end two-column */}

              {/* Footer */}
              {aufgebotConfirmPending ? (
                <div className="shrink-0 px-6 py-4 border-t border-gray-200 bg-amber-50">
                  <p className="text-sm font-medium text-amber-800 mb-3">
                    {af.versand === 'Email'
                      ? '📧 Wurde die E-Mail an den Patienten versendet?'
                      : '🖨️ Wurde der Brief gedruckt und im LIRIS abgelegt?'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAufgebotConfirmPending(false)}
                      className="flex-1 btn btn-secondary text-sm">
                      Zurück
                    </button>
                    <button
                      onClick={handleAufgebotSave}
                      disabled={aufgebotSaving}
                      className="flex-1 btn btn-primary text-sm disabled:opacity-40">
                      {aufgebotSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Ja, aufgeboten markieren
                    </button>
                  </div>
                </div>
              ) : (
                <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
                  <button onClick={() => { setAufgebotTarget(null); setAufgebotConfirmPending(false) }} className="btn btn-secondary text-sm">
                    Abbrechen
                  </button>
                  <button
                    onClick={() => {
                      if (af.versand === 'Email' || af.versand === 'Post') {
                        setAufgebotConfirmPending(true)
                      } else {
                        handleAufgebotSave()
                      }
                    }}
                    disabled={!canSave || aufgebotSaving}
                    className="btn btn-primary text-sm disabled:opacity-40"
                  >
                    {aufgebotSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Aufgeboten markieren
                  </button>
                </div>
              )}
            </div>
          </>
        )
      })()}

      {/* ── Brief-Vorschau modal ──────────────────────────────────────────────── */}
      {briefPreview && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/60">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 shadow-sm">
            <span className="font-semibold text-gray-800 text-sm">Brief-Vorschau</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => briefIframeRef.current?.contentWindow?.print()}
                className="btn btn-primary text-sm"
              >
                <Printer className="w-4 h-4" /> Drucken / Speichern
              </button>
              <button
                onClick={() => setBriefPreview(null)}
                className="btn btn-secondary text-sm"
              >
                <X className="w-4 h-4" /> Schliessen
              </button>
            </div>
          </div>
          {/* iframe */}
          <div className="flex-1 overflow-auto bg-gray-200 p-4 flex justify-center">
            <iframe
              ref={briefIframeRef}
              srcDoc={briefPreview}
              className="w-full max-w-[900px] bg-white shadow-xl rounded"
              style={{ height: '100%', minHeight: '1100px', border: 'none' }}
              title="Brief-Vorschau"
            />
          </div>
        </div>
      )}

      {/* ── Aufgebot-Wochenplan modal ──────────────────────────────────────────── */}
      {wochenplanOpen && (() => {
        const ART_META: Record<string, { label: string; Icon: React.ComponentType<{className?: string}>; color: string; bg: string; border: string }> = {
          Brief:    { label: 'Briefaufgebot', Icon: Mail,      color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
          Reminder: { label: 'Reminder',      Icon: Bell,      color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
          Tel:      { label: 'Telefon',       Icon: Phone,     color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200' },
          Praxis:   { label: 'Praxis',        Icon: Building2, color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
          kein:     { label: 'Kein Aufgebot', Icon: BellOff,   color: 'text-gray-500',   bg: 'bg-gray-50',   border: 'border-gray-200' },
        }
        const ART_ORDER = ['Brief', 'Reminder', 'Tel', 'Praxis', 'kein']

        function WPRow({ entry }: { entry: WPEntry }) {
          const p = entry.patient
          return (
            <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-800 text-sm">{p.vorname || '—'}</span>
                  {p.pid && <span className="text-xs text-gray-400 font-mono">#{normalizePid(p.pid)}</span>}
                  {p.gebDatum && <span className="text-xs text-gray-400">{formatDate(p.gebDatum)}</span>}
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700">{p.doctor}</span>
                  {p.naechsteKons && p.naechsteKons !== 'kein Termin' && (
                    <span className="text-xs text-gray-500">→ {(() => { const d = new Date(p.naechsteKons + 'T00:00:00Z'); return `${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}` })()}</span>
                  )}
                </div>
                {p.aufgebotFuer && (
                  <div className="text-xs text-gray-400 mt-0.5">RC ab: {formatDate(p.aufgebotFuer)}</div>
                )}
              </div>
              <button
                onClick={() => openEdit(p)}
                className="p-1.5 rounded-lg text-gray-400 border border-gray-200 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                title="Patienten bearbeiten"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => openAufgebotDialog(entry)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
              >
                <CalendarDays className="w-3.5 h-3.5" />
                Aufbieten
              </button>
            </div>
          )
        }

        return (
          <>
            <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setWochenplanOpen(false)} />
            <div className="fixed inset-4 sm:inset-8 z-[51] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden max-w-3xl mx-auto">

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
                <div className="flex items-center gap-3">
                  <CalendarDays className="w-5 h-5 text-primary-600" />
                  <h2 className="font-bold text-gray-900 text-lg">Aufgebot-Plan</h2>
                </div>
                <button onClick={() => setWochenplanOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Week navigation */}
              <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-b border-gray-200 shrink-0">
                <button onClick={() => setWochenplanWeekOffset(o => o - 1)} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-white transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-center">
                  <div className="text-sm font-semibold text-gray-800">
                    {wochenplanWeekOffset === 0 ? 'Diese Woche' : wochenplanWeekOffset === 1 ? 'Nächste Woche' : wochenplanWeekOffset === -1 ? 'Letzte Woche' : `KW ${wochenplanWeekOffset > 0 ? '+' : ''}${wochenplanWeekOffset}`}
                  </div>
                  <div className="text-xs text-gray-400">{wochenplanData.weekLabel}</div>
                </div>
                <button onClick={() => setWochenplanWeekOffset(o => o + 1)} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-white transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">

                {/* Überfällig section – only on current week */}
                {wochenplanWeekOffset === 0 && wochenplanData.overdueCount > 0 && (
                  <div className="border-b border-red-100">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50">
                      <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                      <span className="text-sm font-semibold text-red-700">Überfällig</span>
                      <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{wochenplanData.overdueCount}</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {wochenplanData.overdue.map(e => <WPRow key={e.patient.id} entry={e} />)}
                    </div>
                  </div>
                )}

                {/* This week grouped by Aufgebotart */}
                {wochenplanData.total === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-2">
                    <ListChecks className="w-10 h-10 text-gray-200" />
                    <p className="text-gray-400 text-sm">Keine Aufgebote für diese Woche.</p>
                    {wochenplanWeekOffset !== 0 && (
                      <button onClick={() => setWochenplanWeekOffset(0)} className="text-xs text-primary-600 hover:underline mt-1">Zurück zu dieser Woche</button>
                    )}
                  </div>
                ) : (
                  ART_ORDER.filter(art => (wochenplanData.grouped[art] ?? []).length > 0).map(art => {
                    const meta = ART_META[art] ?? ART_META['kein']
                    const entries = wochenplanData.grouped[art]
                    const { Icon } = meta
                    return (
                      <div key={art} className="border-b border-gray-100 last:border-0">
                        <div className={`flex items-center gap-2 px-4 py-2.5 ${meta.bg} border-b ${meta.border}`}>
                          <Icon className={`w-4 h-4 ${meta.color} shrink-0`} />
                          <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
                          <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color} border ${meta.border}`}>{entries.length}</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {entries.map(e => <WPRow key={e.patient.id} entry={e} />)}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Footer */}
              <div className="shrink-0 flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
                <span>{wochenplanData.total} Aufgebot{wochenplanData.total !== 1 ? 'e' : ''} diese Woche</span>
                {wochenplanWeekOffset !== 0 && (
                  <button onClick={() => setWochenplanWeekOffset(0)} className="text-primary-600 hover:underline font-medium">Aktuelle Woche</button>
                )}
              </div>
            </div>
          </>
        )
      })()}

      {/* ── Auswertung modal ─────────────────────────────────────────────────── */}
      {auswertungOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setAuswertungOpen(false)} />
          <div className="fixed inset-4 sm:inset-8 z-[51] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-3">
                <BarChart2 className="w-5 h-5 text-primary-600" />
                <h2 className="font-bold text-gray-900 text-lg">Auswertung</h2>
                <span className="text-xs text-gray-400">{auswertungStats.total} Patienten total</span>
              </div>
              <button onClick={() => setAuswertungOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* ── Aktivität ── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary-500" /> Aktivität
                  </h3>
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                    {(['today','week','month','all'] as ActPeriod[]).map((p, i) => (
                      <button key={p} onClick={() => setActPeriod(p)}
                        className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${actPeriod === p ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                        {p === 'today' ? 'Heute' : p === 'week' ? '7 Tage' : p === 'month' ? '30 Tage' : 'Alle'}
                      </button>
                    ))}
                  </div>
                </div>
                {auswertungStats.actRows.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">Keine Aktivität im gewählten Zeitraum.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        <tr>
                          <th className="text-left  px-4 py-2.5">Datum</th>
                          <th className="text-left  px-4 py-2.5">Benutzer</th>
                          <th className="text-right px-4 py-2.5">Neu erfasst</th>
                          <th className="text-right px-4 py-2.5">Bearbeitet</th>
                          <th className="text-left  px-4 py-2.5">Aufgebote</th>
                          <th className="text-right px-4 py-2.5">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {auswertungStats.actRows.map((r, i) => {
                          const aufgebotTotal = r.aufgebote.Brief + r.aufgebote.Tel + r.aufgebote.Praxis + r.aufgebote.Reminder
                          const badges: Array<{ key: string; count: number; label: string; cls: string }> = [
                            { key: 'B', count: r.aufgebote.Brief,    label: 'Brief',    cls: 'bg-blue-50    text-blue-700    border-blue-200'    },
                            { key: 'T', count: r.aufgebote.Tel,      label: 'Telefon',  cls: 'bg-amber-50   text-amber-700   border-amber-200'   },
                            { key: 'P', count: r.aufgebote.Praxis,   label: 'Praxis',   cls: 'bg-violet-50  text-violet-700  border-violet-200'  },
                            { key: 'R', count: r.aufgebote.Reminder, label: 'Reminder', cls: 'bg-indigo-50  text-indigo-700  border-indigo-200'  },
                          ].filter(b => b.count > 0)
                          return (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="px-4 py-2.5 tabular-nums text-gray-500 text-xs">{r.dateStr}</td>
                              <td className="px-4 py-2.5 font-medium text-gray-800">{r.user.split(' ')[0]}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">
                                {r.created > 0 ? <span className="inline-block px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-semibold text-xs">+{r.created}</span> : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums">
                                {r.updated > 0 ? <span className="text-gray-700 font-medium">{r.updated}</span> : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                {aufgebotTotal === 0 ? (
                                  <span className="text-gray-300">—</span>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {badges.map(b => (
                                      <span
                                        key={b.key}
                                        title={`${b.count} × ${b.label}`}
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular-nums ${b.cls}`}
                                      >
                                        <span className="opacity-70">{b.key}</span>{b.count}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-900">{r.created + r.updated}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Neupatienten ── */}
              <div>
                <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-100 text-green-700 text-[10px] font-black">N</span>
                  Neupatienten
                  <span className="text-xs font-normal text-gray-400 ml-1">(Badge aktiv 7 Tage nach Erfassung)</span>
                </h3>
                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: 'Diese Woche',  value: auswertungStats.neupatienten.week,  color: 'bg-green-50 text-green-700 border-green-100' },
                    { label: 'Dieser Monat', value: auswertungStats.neupatienten.month, color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
                    { label: 'Dieses Jahr',  value: auswertungStats.neupatienten.year,  color: 'bg-teal-50 text-teal-700 border-teal-100' },
                    { label: 'Gesamt',       value: auswertungStats.neupatienten.total, color: 'bg-gray-50 text-gray-700 border-gray-200' },
                  ].map(({ label, value, color }) => (
                    <button
                      key={label}
                      onClick={() => { setFilterNeupatient(true); setFilterTermin(null); setFilterStatus(null); setAuswertungOpen(false); setPage(1) }}
                      className={`flex flex-col px-4 py-3 rounded-xl border text-left transition-opacity hover:opacity-80 active:scale-95 ${color}`}
                    >
                      <span className="text-2xl font-bold tabular-nums">{value}</span>
                      <span className="text-xs mt-0.5 opacity-75">{label}</span>
                    </button>
                  ))}
                </div>
                {/* History table by entry date */}
                {auswertungStats.neupatientRows.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-3">Noch keine Neupatienten erfasst.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        <tr>
                          <th className="text-left px-4 py-2.5">Erfassungsdatum</th>
                          <th className="text-left px-4 py-2.5">Erfasst von</th>
                          <th className="text-right px-4 py-2.5">Anzahl</th>
                          <th className="text-left px-4 py-2.5">Patienten</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {auswertungStats.neupatientRows.map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 tabular-nums text-gray-500 text-xs">{r.dateStr}</td>
                            <td className="px-4 py-2.5 font-medium text-gray-800">{r.user.split(' ')[0]}</td>
                            <td className="px-4 py-2.5 text-right">
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold">{r.count}</span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-gray-500">{r.names.join(', ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* ── Kommende Termine & Recall-Status ── */}
                <div>
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-3">
                    <CalendarClock className="w-4 h-4 text-primary-500" /> Termine & Recall-Status
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { ft: 'heute'      as FilterTermin, label: 'Heute',            value: auswertungStats.upcoming.today,      color: 'bg-blue-50 text-blue-700 border-blue-100' },
                      { ft: 'week'       as FilterTermin, label: 'Nächste 7 Tage',   value: auswertungStats.upcoming.week,       color: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
                      { ft: 'month'      as FilterTermin, label: 'Nächste 30 Tage',  value: auswertungStats.upcoming.month,      color: 'bg-violet-50 text-violet-700 border-violet-100' },
                      { ft: 'overdue'    as FilterTermin, label: 'Überfällig',        value: auswertungStats.upcoming.overdue,    color: 'bg-red-50 text-red-700 border-red-100' },
                      { ft: 'inPlanung'  as FilterTermin, label: 'Im Recall',         value: auswertungStats.upcoming.inPlanung, color: 'bg-amber-50 text-amber-700 border-amber-100' },
                      { ft: 'ohneTermin' as FilterTermin, label: 'Ohne Termin',       value: auswertungStats.upcoming.ohneTermin,color: 'bg-gray-50 text-gray-600 border-gray-200' },
                    ]).map(({ ft, label, value, color }) => (
                      <button
                        key={label}
                        onClick={() => { setFilterTermin(ft); setFilterNeupatient(false); setFilterStatus(null); setAuswertungOpen(false); setPage(1) }}
                        className={`flex flex-col px-4 py-3 rounded-xl border text-left transition-opacity hover:opacity-80 active:scale-95 cursor-pointer ${color}`}
                      >
                        <span className="text-2xl font-bold tabular-nums">{value}</span>
                        <span className="text-xs mt-0.5 opacity-75">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Aufgebot Art ── */}
                <div>
                  <h3 className="font-semibold text-gray-800 mb-3">Aufgebot Art</h3>
                  <div className="space-y-3">
                    {[
                      { label: 'Brief',         Icon: Mail,      value: auswertungStats.aufgebot.Brief,  color: 'bg-blue-500' },
                      { label: 'Telefon',        Icon: Phone,     value: auswertungStats.aufgebot.Tel,    color: 'bg-green-500' },
                      { label: 'Praxis',         Icon: Building2, value: auswertungStats.aufgebot.Praxis, color: 'bg-violet-500' },
                      { label: 'Kein Aufgebot',  Icon: null,      value: auswertungStats.aufgebot.kein,   color: 'bg-gray-300' },
                    ].map(({ label, Icon, value, color }) => (
                      <div key={label} className="flex items-center gap-3">
                        <div className="w-28 shrink-0 flex items-center gap-1.5 text-sm text-gray-600">
                          {Icon && <Icon className="w-3.5 h-3.5 text-gray-400" />}
                          {label}
                        </div>
                        <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                          <div className={`h-full rounded-full ${color} transition-all`}
                            style={{ width: `${(value / auswertungStats.aufgebotMax) * 100}%` }} />
                        </div>
                        <span className="w-10 text-right text-sm font-semibold text-gray-700 tabular-nums">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Per-Arzt Übersicht ── */}
              <div>
                <h3 className="font-semibold text-gray-800 mb-3">Übersicht pro Arzt</h3>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-2.5">Arzt</th>
                        <th className="text-right px-4 py-2.5">Gesamt</th>
                        <th className="text-right px-4 py-2.5">Neupatienten</th>
                        <th className="text-right px-4 py-2.5">Mit Termin</th>
                        <th className="text-right px-4 py-2.5">Im Recall</th>
                        <th className="text-right px-4 py-2.5">Ohne Eintrag</th>
                        <th className="text-right px-4 py-2.5">Inaktiv/✝</th>
                        <th className="text-right px-4 py-2.5">Storniert</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {auswertungStats.docStats.map(d => (
                        <tr key={d.name} className={`hover:bg-gray-50 ${d.name === ZU_BEARB ? 'bg-amber-50/40' : ''}`}>
                          <td className="px-4 py-2.5 font-medium text-gray-800">{d.name}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{d.total}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-green-700 font-medium">
                            {d.neupatient > 0
                              ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100 text-xs font-semibold">{d.neupatient}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-green-700 font-medium">{d.mitTermin || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{d.inPlanung || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">{d.offen || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">{d.inaktiv || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-red-500">{d.storniert || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-700">
                      <tr>
                        <td className="px-4 py-2.5">Total</td>
                        {(['total','neupatient','mitTermin','inPlanung','offen','inaktiv','storniert'] as const).map(k => (
                          <td key={k} className="px-4 py-2.5 text-right tabular-nums">
                            {auswertungStats.docStats.reduce((sum, d) => sum + d[k], 0) || '—'}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

            </div>
          </div>
        </>
      )}

      {/* ── Edit / New modal ──────────────────────────────────────────────────── */}
      {editTarget !== null && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/50 z-[55]" />

          {/* Modal – draggable */}
          <div
            ref={modalRef}
            style={modalPos
              ? { position: 'fixed', left: modalPos.x, top: modalPos.y, zIndex: 56, width: 'min(32rem, calc(100vw - 2rem))' }
              : { position: 'fixed', left: '50%',       top: '50%',      zIndex: 56, width: 'min(32rem, calc(100vw - 2rem))', transform: 'translate(-50%,-50%)' }
            }
            className="bg-white rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
          >

            <div
              onMouseDown={onModalDragStart}
              className={`flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
            >
              <h2 className="font-bold text-gray-900 pointer-events-none">
                {editTarget === 'new' ? 'Neuer Patient' : 'Patient bearbeiten'}
              </h2>
              {editTarget !== 'new' && (
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-primary-100 text-primary-700 mr-auto ml-3 pointer-events-none">
                  {editTarget.doctor}
                </span>
              )}
              <button onClick={closeEdit}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">

              {/* ── Quick-paste parser — nur bei Neuerfassung ── */}
              {editTarget === 'new' && <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-xs font-semibold text-gray-500">Schnelleingabe — kopieren oder direkt hineinziehen</span>
                  <div className="relative group">
                    <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
                    <div className="absolute left-0 top-5 z-50 hidden group-hover:block w-72 bg-gray-900 text-white text-xs rounded-xl px-3 py-2.5 shadow-2xl pointer-events-none">
                      <p className="font-semibold text-gray-100 mb-1">Aus Liris kopieren:</p>
                      <p className="text-gray-400 leading-relaxed mb-2">Im Patientenfenster die Kopfzeile markieren und kopieren&nbsp;<span className="font-mono bg-gray-800 px-1 py-0.5 rounded text-[10px]">Ctrl+C</span></p>
                      <div className="font-mono text-[10px] bg-gray-800 rounded-lg px-2.5 py-2 text-gray-300 leading-relaxed">
                        Herr <span className="text-white font-bold">test Muster</span> , Biberist{' '}
                        <span className="text-blue-300">#00414</span>
                      </div>
                      <div className="mt-2 flex gap-3 text-[10px] text-gray-500">
                        <span><span className="text-white">■</span> Name/Vorname</span>
                        <span><span className="text-blue-300">■</span> PID</span>
                      </div>
                    </div>
                  </div>
                </div>
                <textarea
                  value={quickInput}
                  onChange={e => handleQuickInput(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none placeholder:text-gray-300"
                  placeholder={'Herr test Muster , Biberist  #00414'}
                />
                {(() => {
                  if (!quickInput.trim()) return null
                  const p = parsePastedPatient(quickInput)
                  const found = [p.vorname && 'Vorname', p.gebDatum && 'Geb.', p.pid && 'PID'].filter(Boolean)
                  return found.length > 0
                    ? <p className="mt-1 text-[11px] text-green-700 font-medium">✓ {found.join(', ')} erkannt</p>
                    : <p className="mt-1 text-[11px] text-gray-400">Keine Felder erkannt</p>
                })()}
              </div>}

              {/* ── Bestehender Patient / Neupatient ── */}
              {
              <div className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                form.neupatient
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200'
              }`}>
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!form.neupatient}
                    onChange={e => setField('neupatient', !e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-300"
                  />
                  <span className="text-sm font-medium text-gray-700">Bestehender Patient</span>
                </label>
                {form.neupatient && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
                    Neupatient
                  </span>
                )}
              </div>}

              <div>
                <label className={labelCls}>Patienten-ID (PID){reqStar}</label>
                <div className={`flex items-stretch border rounded-lg overflow-hidden bg-white focus-within:ring-2 ${formErrors.pid ? 'border-red-400 focus-within:ring-red-300' : 'border-gray-200 focus-within:ring-primary-300'}`}>
                  <span className="px-2.5 flex items-center text-sm font-medium text-gray-400 bg-gray-50 border-r border-gray-200 select-none">#</span>
                  <input
                    type="text"
                    value={form.pid}
                    onChange={e => {
                      const raw = e.target.value.replace(/#/g, '')
                      setField('pid', raw)
                      checkPid(raw)
                    }}
                    className="flex-1 px-3 py-2 text-sm focus:outline-none bg-transparent"
                    placeholder="ohne #, z.B. 123456"
                  />
                  {form.pid && (
                    <button type="button" onClick={() => copyToClipboard(`#${normalizePid(form.pid)}`, 'modal-pid')}
                      className="px-2.5 flex items-center text-gray-400 hover:text-primary-500 border-l border-gray-200 bg-gray-50 transition-colors" title="Kopieren">
                      {copiedCell === 'modal-pid' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
                {pidDup && (
                  <div className="mt-1.5 flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                      <span>
                        PID bereits vorhanden:{' '}
                        <strong>{pidDup.vorname || '—'}</strong>
                        {pidDup.gebDatum ? ` (*${formatDate(pidDup.gebDatum)})` : ''}
                        {' — '}{pidDup.doctor}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { switchTab(pidDup.doctor); openEdit(pidDup) }}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 transition-colors whitespace-nowrap"
                    >
                      <Pencil className="w-3 h-3" /> Öffnen
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Vorname{reqStar}</label>
                <input type="text" value={form.vorname}
                  onChange={e => setField('vorname', e.target.value)}
                  className={formErrors.vorname ? inputClsErr : inputCls} placeholder="Vorname" />
              </div>

              <div>
                <label className={labelCls}>Geb. Datum{reqStar}</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input type="date" value={form.gebDatum}
                      onChange={e => setField('gebDatum', e.target.value)}
                      className={`w-full pr-6 ${formErrors.gebDatum ? inputClsErr : inputCls}`} />
                    <ClearBtn show={!!form.gebDatum} onClear={() => setField('gebDatum', '')} />
                  </div>
                  {form.gebDatum && (
                    <button type="button" onClick={() => copyToClipboard(formatDate(form.gebDatum), 'modal-geb')}
                      className="shrink-0 p-2 border border-gray-200 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-gray-50 transition-colors" title="Kopieren">
                      {copiedCell === 'modal-geb' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>

              {/* Inkonsistenz-Warnung: «Nächste Konst.» und «RC zu erstellen ab» dürfen nie beide gleichzeitig gesetzt sein */}
              {!!form.naechsteKons && !!form.aufgebotFuer && (
                <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex flex-col sm:flex-row sm:items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                  <span className="flex-1">
                    <strong>Inkonsistenz:</strong> «Nächste Konst.» <em>und</em> «RC zu erstellen ab» sind gesetzt. Bitte eines davon entfernen.
                  </span>
                  <div className="flex gap-1.5 shrink-0">
                    <button type="button"
                      onClick={() => setField('aufgebotFuer', '')}
                      className="px-2.5 py-1 rounded-md bg-white border border-red-300 text-red-700 hover:bg-red-100 font-medium transition-colors">
                      Termin behalten
                    </button>
                    <button type="button"
                      onClick={() => { setField('naechsteKons', ''); setField('keinTermin', false) }}
                      className="px-2.5 py-1 rounded-md bg-white border border-red-300 text-red-700 hover:bg-red-100 font-medium transition-colors">
                      Recall behalten
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                {/* Letzte Konst. */}
                <div>
                  <label className={labelCls}>Letzte Konst.</label>
                  <div className="relative">
                    <input type="date" value={form.letzteKons}
                      onChange={e => {
                        const newDate = e.target.value
                        setField('letzteKons', newDate)
                        setField('storniert', '')
                        setField('grundStornierung', '')
                        if (form.konsInterval && newDate) {
                          const computed = computeNextKons(newDate, form.konsInterval)
                          if (computed) {
                            // Invariante: entweder Nächste Konst. ODER «RC zu erstellen ab»,
                            // nie beides. Hier wird aufgebotFuer berechnet → naechsteKons leeren.
                            setField('naechsteKons', '')
                            setField('keinTermin', false)
                            const lk2 = new Date(newDate + 'T00:00:00Z')
                            lk2.setUTCMonth(lk2.getUTCMonth() + 2)
                            if (computed <= lk2.toISOString().slice(0, 10)) {
                              setField('aufgebotFuer', new Date().toISOString().slice(0, 10))
                            } else {
                              const d = new Date(computed + 'T00:00:00Z')
                              d.setUTCMonth(d.getUTCMonth() - 2)
                              setField('aufgebotFuer', d.toISOString().slice(0, 10))
                            }
                          }
                        }
                      }}
                      className={`${inputCls} pr-6`} />
                    <ClearBtn show={!!form.letzteKons} onClear={() => setField('letzteKons', '')} />
                  </div>
                </div>

                {/* Intervall */}
                <div>
                  <label className={labelCls}>Intervall</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={form.konsInterval}
                      onChange={e => {
                        const val = e.target.value
                        setField('konsInterval', val)
                        if (form.letzteKons) {
                          const computed = computeNextKons(form.letzteKons, val)
                          if (computed) {
                            // Invariante: entweder Nächste Konst. ODER «RC zu erstellen ab»,
                            // nie beides. Hier wird aufgebotFuer berechnet → naechsteKons leeren.
                            setField('naechsteKons', '')
                            setField('keinTermin', false)
                            const lk2 = new Date(form.letzteKons + 'T00:00:00Z')
                            lk2.setUTCMonth(lk2.getUTCMonth() + 2)
                            if (computed <= lk2.toISOString().slice(0, 10)) {
                              setField('aufgebotFuer', new Date().toISOString().slice(0, 10))
                            } else {
                              const d = new Date(computed + 'T00:00:00Z')
                              d.setUTCMonth(d.getUTCMonth() - 2)
                              setField('aufgebotFuer', d.toISOString().slice(0, 10))
                            }
                          }
                        }
                      }}
                      placeholder="1j · 6m · 30t"
                      className={`${inputCls} pr-6 placeholder:text-gray-300`}
                    />
                    <ClearBtn show={!!form.konsInterval} onClear={() => setField('konsInterval', '')} />
                  </div>
                  {(() => {
                    const computed = computeNextKons(form.letzteKons, form.konsInterval)
                    if (computed) return <p className="mt-1 text-[11px] text-primary-600 font-medium">→ {formatDate(computed)}</p>
                    if (form.konsInterval.trim() && !parseKonsInterval(form.konsInterval))
                      return <p className="mt-1 text-[11px] text-red-400">ungültig</p>
                    return <p className="mt-1 text-[11px] text-gray-400">z.B. 1j, 6m, 2w, 30t</p>
                  })()}
                </div>

                {/* Nächste Konst. */}
                <div>
                  <label className={labelCls}>
                    Nächste Konst.
                    {form.storniert === 'Terminverschiebung' && (
                      <span className="ml-2 text-amber-600 font-normal">← vereinbarten Termin hier eintragen</span>
                    )}
                  </label>
                  <div className="relative">
                    <input ref={naechsteKonsRef} type="date" value={form.naechsteKons}
                      className={`pr-6 ${form.storniert === 'Terminverschiebung' ? `${inputCls} ring-2 ring-amber-400` : inputCls}`}
                      onChange={e => {
                        const val = e.target.value
                        setField('naechsteKons', val)
                        if (val) {
                          // Mit gesetztem Termin braucht es keinen Recall mehr → «RC zu erstellen ab» leeren
                          setField('aufgebotFuer', '')
                          // Aktiv geplante Reminder («Geplant: <Zukunftsdatum>») entfernen,
                          // historische Reminder-Einträge bleiben als Verlauf erhalten.
                          const today = new Date().toISOString().slice(0, 10)
                          const isActivePlannedReminder = (v: { aktion?: string; ergebnis?: string }) => {
                            if (v.aktion !== 'Reminder') return false
                            const m = v.ergebnis?.match(/^Geplant:\s*(\d{4}-\d{2}-\d{2})/)
                            return !!m && m[1] > today
                          }
                          if (form.verlauf.some(isActivePlannedReminder)) {
                            const cancelEntry = {
                              datum: today,
                              aktion: 'Reminder',
                              ergebnis: `Abgesagt – Termin am ${formatDate(val)} vereinbart`,
                              von: displayLabel,
                            }
                            setField('verlauf', [
                              ...form.verlauf.filter(v => !isActivePlannedReminder(v)),
                              cancelEntry,
                            ])
                          }
                        }
                      }} />
                    <ClearBtn show={!!form.naechsteKons} onClear={() => {
                      setField('naechsteKons', '')
                      setField('keinTermin', false)
                    }} />
                  </div>
                  {form.naechsteKons && (
                    <div className="flex justify-end mt-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const newDate = form.naechsteKons.slice(0, 10)
                          setField('letzteKons', newDate)
                          setField('storniert', '')
                          setField('grundStornierung', '')
                          setField('naechsteKons', '') // manuell neu eingeben
                          if (form.konsInterval) {
                            const computed = computeNextKons(newDate, form.konsInterval)
                            if (computed) {
                              const d = new Date(computed + 'T00:00:00Z')
                              d.setUTCMonth(d.getUTCMonth() - 2)
                              setField('aufgebotFuer', d.toISOString().slice(0, 10))
                            }
                          }
                        }}
                        className="text-[11px] font-medium text-primary-600 hover:text-primary-800 hover:underline"
                      >
                        als letzte Konst. ↑
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Zuweisung ─────────────────────────────────────────────────── */}
              <div className="pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-gray-600">
                    Zuweisung
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !form.zuweisungAktiv
                      setField('zuweisungAktiv', next)
                      if (next && form.letzteKons) {
                        setField('zuweisungDatum', form.letzteKons)
                      }
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${form.zuweisungAktiv ? 'bg-violet-500' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${form.zuweisungAktiv ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {form.zuweisungAktiv && (
                  <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
                    {/* Typ */}
                    <div className="flex gap-2">
                      {(['intern', 'extern'] as const).map(t => (
                        <button key={t} type="button"
                          onClick={() => setField('zuweisungTyp', t)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors capitalize ${
                            form.zuweisungTyp === t
                              ? 'border-violet-500 bg-violet-100 text-violet-700'
                              : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                          }`}
                        >{t === 'intern' ? 'Intern (Praxis)' : 'Extern (andere Praxis)'}</button>
                      ))}
                    </div>

                    {/* Ziel */}
                    <div>
                      <label className={labelCls}>
                        {form.zuweisungTyp === 'intern' ? 'Arzt / Abteilung' : 'Praxis / Klinik'}
                        <span className="text-red-500 ml-0.5">*</span>
                      </label>
                      {form.zuweisungTyp === 'intern' ? (
                        <div className="space-y-1.5">
                          <select
                            value={doctors.includes(form.zuweisungZiel) ? form.zuweisungZiel : (form.zuweisungZiel ? '__custom__' : '')}
                            onChange={e => {
                              if (e.target.value === '__custom__') setField('zuweisungZiel', '')
                              else setField('zuweisungZiel', e.target.value)
                            }}
                            className={inputCls}>
                            <option value="">— Arzt wählen —</option>
                            {doctors.map(d => <option key={d} value={d}>{d}</option>)}
                            <option value="__custom__">Sonstige…</option>
                          </select>
                          {!doctors.includes(form.zuweisungZiel) && (
                            <input type="text" value={form.zuweisungZiel}
                              onChange={e => setField('zuweisungZiel', e.target.value)}
                              placeholder="Bezeichnung eingeben…"
                              className={inputCls} autoFocus />
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {/* saved praxen + add-new */}
                          <select
                            value={zuweisungPraxen.includes(form.zuweisungZiel) ? form.zuweisungZiel : (form.zuweisungZiel ? '__custom__' : '')}
                            onChange={e => {
                              if (e.target.value === '__new__') {
                                setAddingPraxis(true)
                                setNewPraxisText('')
                                setField('zuweisungZiel', '')
                              } else if (e.target.value === '__custom__') {
                                setField('zuweisungZiel', '')
                              } else {
                                setAddingPraxis(false)
                                setField('zuweisungZiel', e.target.value)
                              }
                            }}
                            className={inputCls}>
                            <option value="">— Praxis wählen —</option>
                            {zuweisungPraxen.map(p => <option key={p} value={p}>{p}</option>)}
                            <option value="__new__">+ Neue Praxis hinzufügen…</option>
                          </select>
                          {/* inline add-new praxis */}
                          {addingPraxis && (
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={newPraxisText}
                                onChange={e => setNewPraxisText(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    addPraxis(newPraxisText).then(() => {
                                      setField('zuweisungZiel', newPraxisText.trim())
                                      setAddingPraxis(false)
                                    })
                                  }
                                  if (e.key === 'Escape') setAddingPraxis(false)
                                }}
                                placeholder="Name der Praxis / Klinik…"
                                className={`${inputCls} flex-1`}
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => addPraxis(newPraxisText).then(() => {
                                  setField('zuweisungZiel', newPraxisText.trim())
                                  setAddingPraxis(false)
                                })}
                                disabled={!newPraxisText.trim()}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
                              >Speichern</button>
                              <button type="button" onClick={() => setAddingPraxis(false)}
                                className="px-2 py-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                          {/* free-text for values not in list */}
                          {!addingPraxis && !zuweisungPraxen.includes(form.zuweisungZiel) && form.zuweisungZiel && (
                            <input type="text" value={form.zuweisungZiel}
                              onChange={e => setField('zuweisungZiel', e.target.value)}
                              placeholder="Praxisname…"
                              className={inputCls} />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Grund – chip-Auswahl + Freitext */}
                    <div>
                      <label className={labelCls}>Grund</label>
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {zuweisungGruende.map(g => (
                          <button key={g} type="button"
                            onClick={() => setField('zuweisungGrund', form.zuweisungGrund === g ? '' : g)}
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                              form.zuweisungGrund === g
                                ? 'bg-violet-600 text-white border-violet-600'
                                : 'bg-white text-gray-600 border-gray-300 hover:border-violet-400 hover:text-violet-700'
                            }`}
                          >{g}</button>
                        ))}
                        {/* add-new Grund */}
                        {!addingGrund ? (
                          <button type="button" onClick={() => { setAddingGrund(true); setNewGrundText('') }}
                            className="px-2.5 py-1 rounded-full text-xs font-semibold border border-dashed border-gray-300 text-gray-400 hover:border-violet-400 hover:text-violet-600 transition-colors">
                            + Neu
                          </button>
                        ) : (
                          <div className="flex gap-1 w-full mt-0.5">
                            <input
                              type="text"
                              value={newGrundText}
                              onChange={e => setNewGrundText(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  addGrund(newGrundText).then(() => {
                                    setField('zuweisungGrund', newGrundText.trim())
                                    setAddingGrund(false)
                                  })
                                }
                                if (e.key === 'Escape') setAddingGrund(false)
                              }}
                              placeholder="Neuer Grund…"
                              className={`${inputCls} flex-1 text-xs py-1`}
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => addGrund(newGrundText).then(() => {
                                setField('zuweisungGrund', newGrundText.trim())
                                setAddingGrund(false)
                              })}
                              disabled={!newGrundText.trim()}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
                            >+</button>
                            <button type="button" onClick={() => setAddingGrund(false)}
                              className="px-2 py-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      {/* free-text for custom value not in chip list */}
                      {!zuweisungGruende.includes(form.zuweisungGrund) && (
                        <input type="text" value={form.zuweisungGrund}
                          onChange={e => setField('zuweisungGrund', e.target.value)}
                          placeholder="Grund (freitext)…"
                          className={inputCls} />
                      )}
                    </div>

                    {/* Zugewiesen am + Status */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>Zugewiesen am</label>
                        <div className="relative">
                          <input type="date" value={form.zuweisungDatum}
                            onChange={e => setField('zuweisungDatum', e.target.value)}
                            className={`${inputCls} pr-6`} />
                          <ClearBtn show={!!form.zuweisungDatum} onClear={() => setField('zuweisungDatum', '')} />
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>Status</label>
                        <div className="flex gap-1.5">
                          {([
                            ['pendent',  'Pendent',  'Patient wird aufgeboten'],
                            ['erledigt', 'Erledigt', 'Patient war in der Praxis'],
                          ] as const).map(([v, l, hint]) => (
                            <button key={v} type="button"
                              title={hint}
                              onClick={() => {
                                setField('zuweisungStatus', v)
                                if (v === 'erledigt' && !form.zuweisungErledigtAm) {
                                  setField('zuweisungErledigtAm', new Date().toISOString().slice(0, 10))
                                }
                              }}
                              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors ${
                                form.zuweisungStatus === v
                                  ? v === 'pendent'
                                    ? 'border-amber-400 bg-amber-50 text-amber-700'
                                    : 'border-green-400 bg-green-50 text-green-700'
                                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                              }`}
                            >{l}</button>
                          ))}
                        </div>
                        {form.zuweisungStatus === 'pendent' && (
                          <p className="mt-1 text-[10px] text-gray-400">Patient wird aufgeboten</p>
                        )}
                        {form.zuweisungStatus === 'erledigt' && (
                          <div className="mt-1.5 space-y-1.5">
                            <div className="relative">
                              <input type="date" value={form.zuweisungErledigtAm}
                                onChange={e => setField('zuweisungErledigtAm', e.target.value)}
                                className={`${inputCls} pr-6 text-[11px] py-1`} />
                              <ClearBtn show={!!form.zuweisungErledigtAm} onClear={() => setField('zuweisungErledigtAm', '')} />
                            </div>
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={form.zuweisungBerichtErhalten}
                                onChange={e => setField('zuweisungBerichtErhalten', e.target.checked)}
                                className="w-3.5 h-3.5 rounded accent-violet-600"
                              />
                              <span className="text-[11px] font-semibold text-gray-600">Bericht erhalten</span>
                            </label>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Notiz */}
                    <div>
                      <label className={labelCls}>Notiz</label>
                      <textarea rows={2} value={form.zuweisungNotiz}
                        onChange={e => setField('zuweisungNotiz', e.target.value)}
                        placeholder="Weitere Bemerkungen…"
                        className={`${inputCls} resize-none`} />
                    </div>
                  </div>
                )}
              </div>

              {/* Aufgebot + Aufgebot für */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Aufgebot</label>
                  <div className="flex gap-2">
                    {AUFGEBOT_OPTIONS.map(({ value, Icon, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          const next = form.aufgebotArt === value ? '' : value
                          setField('aufgebotArt', next)
                          if (next) {
                            setField('aufgebotErstellt', new Date().toISOString().slice(0, 10))
                          } else {
                            setField('aufgebotErstellt', '')
                            setField('naechsteKons', '')
                            setField('keinTermin', false)
                          }
                        }}
                        className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                          form.aufgebotArt === value
                            ? 'border-primary-500 bg-primary-50 text-primary-700'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className={labelCls}>RC zu erstellen ab</label>
                    <div className="relative">
                      <input type="date" value={form.aufgebotFuer}
                        onChange={e => setField('aufgebotFuer', e.target.value)}
                        className={`${inputCls} pr-6`} />
                      <ClearBtn show={!!form.aufgebotFuer} onClear={() => setField('aufgebotFuer', '')} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>{
                      form.aufgebotArt === 'Brief'    ? 'Briefaufgebot erstellt am' :
                      form.aufgebotArt === 'Reminder' ? 'Reminder erstellt am' :
                      form.aufgebotArt === 'Tel'      ? 'Telefonaufgebot erstellt am' :
                      form.aufgebotArt === 'Praxis'   ? 'Vereinbarungsdatum' :
                      'Aufgebot erstellt am'
                    }</label>
                    <div className="relative">
                      <input type="date" value={form.aufgebotErstellt}
                        onChange={e => setField('aufgebotErstellt', e.target.value)}
                        className={`${inputCls} pr-6`} />
                      <ClearBtn show={!!form.aufgebotErstellt} onClear={() => setField('aufgebotErstellt', '')} />
                    </div>
                    {form.aufgebotArt === 'Praxis' && (
                      <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
                        <span>⚠️</span> Das Terminsdatum bitte oben unter <strong>«Nächste Konst.»</strong> eintragen.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Storniert</label>
                  <select value={form.storniert}
                    onChange={e => {
                      const v = e.target.value
                      setField('storniert', v)
                      if (v === 'Terminverschiebung') {
                        setField('grundStornierung', '')
                        setTimeout(() => naechsteKonsRef.current?.focus(), 50)
                      }
                    }}
                    className={inputCls}>
                    <option value="">—</option>
                    <option value="ja">ja</option>
                    <option value="nein">nein</option>
                    <option value="Terminverschiebung">Terminverschiebung</option>
                  </select>
                </div>
                {form.storniert === 'Terminverschiebung' ? (
                  <div className="flex items-end pb-0.5">
                    <p className="text-xs text-amber-600 font-medium leading-snug">
                      ↑ Bitte vereinbarten Termin unter <strong>«Nächste Konst.»</strong> oben eintragen.
                    </p>
                  </div>
                ) : (
                <div>
                  <label className={labelCls}>Grund f. Stornierung</label>
                  {(() => {
                    const isCustom = form.grundStornierung !== '' && !STORNO_GRUENDE.includes(form.grundStornierung)
                    const selVal = isCustom ? 'Sonstiges' : form.grundStornierung
                    return (
                      <>
                        <select value={selVal}
                          onChange={e => {
                            const v = e.target.value
                            if (v === 'Sonstiges') setField('grundStornierung', ' ')
                            else setField('grundStornierung', v)
                            if (v === 'kein Bedarf') setField('patientenStatus', 'kein Aufgebot')
                            if (v === 'Wegzug' || v === 'Arztwechsel') setField('patientenStatus', 'inaktiv')
                            if (v === 'Verstorben') setField('patientenStatus', 'verstorben')
                            if (v === 'Verstorben' || v === 'Arztwechsel' || v === 'Wegzug') {
                              setField('verlauf', form.verlauf.map(ve =>
                                ve.ergebnis === 'noch zu erledigen' ? { ...ve, ergebnis: 'abgebrochen' } : ve
                              ))
                            }
                          }}
                          className={inputCls}>
                          <option value="">—</option>
                          {STORNO_GRUENDE.map(g => <option key={g} value={g}>{g}</option>)}
                          <option value="Sonstiges">Sonstiges…</option>
                        </select>
                        {selVal === 'Sonstiges' && (
                          <input type="text" value={form.grundStornierung.trimStart()}
                            onChange={e => setField('grundStornierung', e.target.value)}
                            className={`${inputCls} mt-2`}
                            placeholder="Weiterer Grund…" autoFocus />
                        )}
                      </>
                    )
                  })()}
                </div>
                )}
              </div>

              {/* ── Weiteres Vorgehen & Verlauf ────────────────────────────────── */}
              {editTarget !== 'new' && (form.grundStornierung !== '' || form.verlauf.length > 0) && (
                <div className="pt-3 border-t border-amber-200 bg-amber-50 -mx-6 px-6 pb-4">
                  <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <ListChecks className="w-3.5 h-3.5" /> Weiteres Vorgehen
                  </p>

                  {/* Contact method toggles – only when a Stornierungsgrund is set (not when Verstorben or Arztwechsel) */}
                  {form.grundStornierung !== '' && form.grundStornierung !== 'Verstorben' && form.grundStornierung !== 'Arztwechsel' && (
                    <>
                      <button type="button"
                        onClick={async () => {
                          if (!editTarget || (editTarget as unknown as string) === 'new') return
                          const entry: any = { datum: new Date().toISOString().slice(0, 10), aktion: 'Telefonanruf', ergebnis: 'noch zu erledigen', von: displayLabel }
                          const newVerlauf = [...form.verlauf, entry]
                          setField('verlauf', newVerlauf)
                          setAllData(prev => {
                            const next = new Map(prev)
                            const updated = (next.get(editTarget.doctor) ?? []).map(r =>
                              r.id === editTarget.id ? { ...r, verlauf: newVerlauf } : r
                            )
                            next.set(editTarget.doctor, updated)
                            return next
                          })
                          try { await updateRecallPatient(editTarget.id, { verlauf: newVerlauf }, displayLabel) } catch { /* ignore */ }
                        }}
                        className="w-full flex items-center justify-center gap-1.5 py-2 mb-3 rounded-xl text-sm font-semibold border-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                      >
                        <PhoneCall className="w-4 h-4" /> Patient anrufen
                      </button>

                      <div className="flex gap-2 mb-3">
                        <button type="button"
                          onClick={() => { const op = !vorgehenTelOpen; if (op) setVorgehenTelDatum(new Date().toISOString().slice(0, 10)); setVorgehenTelOpen(op); setVorgehenEmailOpen(false); setVorgehenReminderOpen(false) }}
                          className={`flex items-center justify-center gap-1.5 flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                            vorgehenTelOpen ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <Phone className="w-4 h-4" /> Telefon
                        </button>
                        <button type="button"
                          onClick={() => { const op = !vorgehenEmailOpen; if (op) setVorgehenEmailDatum(new Date().toISOString().slice(0, 10)); setVorgehenEmailOpen(op); setVorgehenTelOpen(false); setVorgehenReminderOpen(false) }}
                          className={`flex items-center justify-center gap-1.5 flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                            vorgehenEmailOpen ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <Mail className="w-4 h-4" /> E-Mail
                        </button>
                        <button type="button"
                          onClick={() => { setVorgehenReminderOpen(o => !o); setVorgehenTelOpen(false); setVorgehenEmailOpen(false) }}
                          className={`flex items-center justify-center gap-1.5 flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                            vorgehenReminderOpen ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <Bell className="w-4 h-4" /> Reminder
                        </button>
                      </div>

                      {/* Telefon panel */}
                      {vorgehenTelOpen && (
                        <div className="mb-3 bg-white rounded-xl border border-green-200 p-3 space-y-2">
                          <label className="text-xs font-semibold text-gray-600 block">Datum des Anrufs</label>
                          <input type="date" value={vorgehenTelDatum}
                            onChange={e => setVorgehenTelDatum(e.target.value)}
                            className={inputCls} />
                          {vorgehenTelDatum && <p className="text-xs text-gray-400 -mt-1">{formatDate(vorgehenTelDatum)}</p>}
                          <textarea
                            rows={2}
                            placeholder="Grund / Bemerkung (optional)"
                            value={vorgehenTelGrund}
                            onChange={e => setVorgehenTelGrund(e.target.value)}
                            className={`${inputCls} resize-none`}
                          />
                          {vorgehenTelDatum ? (
                            <div className="grid grid-cols-3 gap-1.5">
                              {([
                                { v: 'Erreicht',              cls: 'border-green-300 bg-green-50 text-green-700' },
                                { v: 'Nicht erreicht',        cls: 'border-orange-300 bg-orange-50 text-orange-700' },
                                { v: 'Nr. nicht mehr gültig', cls: 'border-red-300 bg-red-50 text-red-700' },
                              ] as const).map(({ v, cls }) => (
                                <button key={v} type="button"
                                  onClick={() => {
                                    const entry: any = { datum: vorgehenTelDatum, aktion: 'Telefonanruf', ergebnis: v, von: displayLabel }
                                    if (vorgehenTelGrund.trim()) entry.grund = vorgehenTelGrund.trim()
                                    setField('verlauf', [...form.verlauf, entry])
                                    setVorgehenTelDatum('')
                                    setVorgehenTelGrund('')
                                  }}
                                  className={`py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors hover:opacity-80 ${cls}`}
                                >{v}</button>
                              ))}
                            </div>
                          ) : (
                            <button type="button"
                              onClick={() => {
                                const entry: any = { datum: new Date().toISOString().slice(0, 10), aktion: 'Telefonanruf', ergebnis: 'noch zu erledigen', von: displayLabel }
                                if (vorgehenTelGrund.trim()) entry.grund = vorgehenTelGrund.trim()
                                setField('verlauf', [...form.verlauf, entry])
                                setVorgehenTelGrund('')
                                setVorgehenTelOpen(false)
                              }}
                              className="w-full py-1.5 rounded-lg text-xs font-semibold border-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                            >Als «noch zu erledigen» eintragen</button>
                          )}
                        </div>
                      )}

                      {/* E-Mail panel */}
                      {vorgehenEmailOpen && (
                        <div className="mb-3 bg-white rounded-xl border border-blue-200 p-3 space-y-2">
                          <label className="text-xs font-semibold text-gray-600 block">Datum E-Mail</label>
                          <input type="date" value={vorgehenEmailDatum}
                            onChange={e => setVorgehenEmailDatum(e.target.value)}
                            className={inputCls} />
                          {vorgehenEmailDatum && <p className="text-xs text-gray-400 -mt-1">{formatDate(vorgehenEmailDatum)}</p>}
                          <textarea
                            rows={2}
                            placeholder="Grund / Bemerkung (optional)"
                            value={vorgehenEmailGrund}
                            onChange={e => setVorgehenEmailGrund(e.target.value)}
                            className={`${inputCls} resize-none`}
                          />
                          {vorgehenEmailDatum ? (
                            <div className="grid grid-cols-3 gap-1.5">
                              {([
                                { v: 'Geantwortet',     cls: 'border-green-300 bg-green-50 text-green-700' },
                                { v: 'Keine Antwort',   cls: 'border-orange-300 bg-orange-50 text-orange-700' },
                                { v: 'E-Mail ungültig', cls: 'border-red-300 bg-red-50 text-red-700' },
                              ] as const).map(({ v, cls }) => (
                                <button key={v} type="button"
                                  onClick={() => {
                                    const entry: any = { datum: vorgehenEmailDatum, aktion: 'E-Mail', ergebnis: v, von: displayLabel }
                                    if (vorgehenEmailGrund.trim()) entry.grund = vorgehenEmailGrund.trim()
                                    setField('verlauf', [...form.verlauf, entry])
                                    setVorgehenEmailDatum('')
                                    setVorgehenEmailGrund('')
                                  }}
                                  className={`py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors hover:opacity-80 ${cls}`}
                                >{v}</button>
                              ))}
                            </div>
                          ) : (
                            <button type="button"
                              onClick={() => {
                                const entry: any = { datum: new Date().toISOString().slice(0, 10), aktion: 'E-Mail', ergebnis: 'noch zu erledigen', von: displayLabel }
                                if (vorgehenEmailGrund.trim()) entry.grund = vorgehenEmailGrund.trim()
                                setField('verlauf', [...form.verlauf, entry])
                                setVorgehenEmailGrund('')
                                setVorgehenEmailOpen(false)
                              }}
                              className="w-full py-1.5 rounded-lg text-xs font-semibold border-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                            >Als «noch zu erledigen» eintragen</button>
                          )}
                        </div>
                      )}

                      {/* Reminder panel */}
                      {vorgehenReminderOpen && (
                        <div className="mb-3 bg-white rounded-xl border border-purple-200 p-3 space-y-2">
                          <label className="text-xs font-semibold text-gray-600 block">Reminder senden am</label>
                          {/* Quick-select timeframes */}
                          <div className="grid grid-cols-4 gap-1.5">
                            {([
                              { label: '1 Woche',   days: 7   },
                              { label: '2 Wochen',  days: 14  },
                              { label: '1 Monat',   months: 1 },
                              { label: '3 Monate',  months: 3 },
                            ] as { label: string; days?: number; months?: number }[]).map(({ label, days, months }) => (
                              <button key={label} type="button"
                                onClick={() => {
                                  const d = new Date()
                                  if (days)   d.setDate(d.getDate() + days)
                                  if (months) d.setMonth(d.getMonth() + months)
                                  setVorgehenReminderDatum(d.toISOString().slice(0, 10))
                                }}
                                className="py-1.5 rounded-lg text-xs font-semibold border-2 border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
                              >{label}</button>
                            ))}
                          </div>
                          {/* Custom interval input */}
                          <input
                            type="text"
                            placeholder="Eigenes Intervall: 6m, 1j, 18m, 2j …"
                            className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg bg-purple-50 placeholder-purple-300 text-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-300"
                            onChange={e => {
                              const val = e.target.value.trim().toLowerCase()
                              const m = val.match(/^(\d+)(w|m|j)$/)
                              if (!m) return
                              const n = parseInt(m[1])
                              const unit = m[2]
                              const d = new Date()
                              if (unit === 'w') d.setDate(d.getDate() + n * 7)
                              if (unit === 'm') d.setMonth(d.getMonth() + n)
                              if (unit === 'j') d.setFullYear(d.getFullYear() + n)
                              setVorgehenReminderDatum(d.toISOString().slice(0, 10))
                            }}
                          />
                          <input type="date" value={vorgehenReminderDatum}
                            onChange={e => setVorgehenReminderDatum(e.target.value)}
                            className={inputCls} />
                          {vorgehenReminderDatum && <p className="text-xs text-gray-400 -mt-1">{formatDate(vorgehenReminderDatum)}</p>}
                          <textarea
                            rows={2}
                            placeholder="Grund / Bemerkung (optional)"
                            value={vorgehenReminderGrund}
                            onChange={e => setVorgehenReminderGrund(e.target.value)}
                            className={`${inputCls} resize-none`}
                          />
                          <button type="button"
                            disabled={!vorgehenReminderDatum}
                            onClick={() => {
                              const entry: any = {
                                datum: new Date().toISOString().slice(0, 10),
                                aktion: 'Reminder',
                                ergebnis: `Geplant: ${vorgehenReminderDatum}`,
                                von: displayLabel,
                              }
                              if (vorgehenReminderGrund.trim()) entry.grund = vorgehenReminderGrund.trim()
                              setField('verlauf', [...form.verlauf, entry])
                              setField('aufgebotFuer', vorgehenReminderDatum)
                              setField('aufgebotErstellt', '')
                              setField('storniert', '')
                              setField('grundStornierung', '')
                              setVorgehenReminderDatum('')
                              setVorgehenReminderGrund('')
                              setVorgehenReminderOpen(false)
                            }}
                            className="w-full py-1.5 rounded-lg text-xs font-semibold border-2 border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >Reminder eintragen</button>
                        </div>
                      )}
                    </>
                  )}

                  {/* Verlauf timeline – newest first */}
                  {form.verlauf.length > 0 && (
                    <div className="space-y-1.5 mb-3 max-h-44 overflow-y-auto">
                      {[...form.verlauf].reverse().map((v, revIdx) => {
                        const origIdx = form.verlauf.length - 1 - revIdx
                        const isReminder = v.aktion === 'Reminder'
                        const isTel = v.aktion === 'Telefonanruf'
                        return (
                        <div key={revIdx} className="rounded-lg bg-white border border-gray-200 px-3 py-2 text-xs flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div>
                              <span className="font-semibold text-gray-700">{v.aktion}</span>
                              {v.ergebnis && (
                                <span className={`ml-1.5 font-medium ${
                                  ['Nicht erreicht','Nr. nicht mehr gültig','Keine Antwort','E-Mail ungültig'].includes(v.ergebnis)
                                    ? 'text-red-600'
                                    : (v.ergebnis === 'Erreicht' || v.ergebnis === 'Geantwortet')
                                    ? 'text-green-600'
                                    : v.ergebnis === 'noch zu erledigen'
                                    ? 'text-amber-600'
                                    : v.ergebnis === 'abgebrochen'
                                    ? 'text-gray-400 line-through'
                                    : v.aktion === 'Reminder'
                                    ? 'text-purple-600'
                                    : 'text-gray-500'
                                }`}>· {formatErgebnis(v.ergebnis)}</span>
                              )}
                              <span className="text-gray-400 ml-1.5 tabular-nums">{formatDate(v.datum)}</span>
                            </div>
                            {v.grund && (
                              <p className="mt-0.5 text-gray-500 italic">{formatErgebnis(v.grund)}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-gray-300 text-[10px] leading-relaxed">{v.von}</span>
                            {(isReminder || isTel) && (
                              <button type="button"
                                onClick={() => setField('verlauf', form.verlauf.filter((_, idx) => idx !== origIdx))}
                                className="p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                title={isReminder ? 'Reminder löschen' : 'Telefonanruf löschen'}>
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Inaktivieren – erscheint bei negativem Verlauf */}
                  {form.verlauf.some(v =>
                    ['Nicht erreicht','Nr. nicht mehr gültig','Keine Antwort','E-Mail ungültig'].includes(v.ergebnis)
                  ) && (
                    <button type="button"
                      onClick={() => setField('patientenStatus', 'inaktiv')}
                      className={`w-full py-2 rounded-lg text-xs font-bold border-2 transition-colors ${
                        form.patientenStatus === 'inaktiv'
                          ? 'border-gray-400 bg-gray-200 text-gray-700'
                          : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                      }`}
                    >
                      {form.patientenStatus === 'inaktiv' ? '✓ Als inaktiv markiert' : 'Patient inaktivieren'}
                    </button>
                  )}
                </div>
              )}

              {/* Status */}
              <div>
                <label className={labelCls}>Status</label>
                <select value={form.patientenStatus}
                  onChange={e => {
                    const v = e.target.value
                    setField('patientenStatus', v)
                    if (v !== 'aktiv') {
                      setField('naechsteKons', '')
                      setField('keinTermin', false)
                    }
                  }}
                  className={inputCls}>
                  <option value="">—</option>
                  <option value="aktiv">Aktiv</option>
                  <option value="inaktiv">Inaktiv</option>
                  <option value="verstorben">Verstorben</option>
                  <option value="Reminder">Reminder</option>
                  <option value="kein Aufgebot">kein Aufgebot - meldet sich b. Bedarf</option>
                </select>
              </div>

              {/* Assign doctor – for new patients and existing */}
              {(
                <div className="pt-3 border-t border-gray-100">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    {editTarget === 'new' ? 'Arzt zuweisen' : editTarget.doctor === ZU_BEARB ? 'Arzt zuweisen' : 'Behandelnden Arzt wechseln'}
                    {editTarget !== 'new' && assignDoctor && <span className="ml-1.5 text-primary-500 font-normal">(wird beim Speichern übernommen)</span>}
                  </label>
                  <select
                    value={assignDoctor}
                    onChange={e => setAssignDoctor(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
                  >
                    <option value="">{editTarget === 'new' ? '— kein Arzt —' : '— kein Wechsel —'}</option>
                    {doctors.filter(d => editTarget === 'new' || d !== editTarget.doctor).map(d =>
                      <option key={d} value={d}>{d}</option>
                    )}
                  </select>
                </div>
              )}

              {editTarget !== 'new' && (
                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                  <div>
                    <p className={labelCls}>Erfasst</p>
                    <p className="text-xs text-gray-500">{editTarget.erstellt || '—'}</p>
                  </div>
                  <div>
                    <p className={labelCls}>Aktualisiert</p>
                    <p className="text-xs text-gray-500">{editTarget.aktualisiert || '—'}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 shrink-0">
              {editTarget !== 'new' ? (
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="px-3 py-2 text-sm font-medium text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Löschen
                </button>
              ) : <span />}
              <div className="flex items-center gap-3">
                <button onClick={closeEdit}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                  Abbrechen
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Speichern
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
