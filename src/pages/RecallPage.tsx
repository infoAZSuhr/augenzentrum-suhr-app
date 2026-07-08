import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useBrowser } from '../contexts/BrowserContext'
import { usePostausgang } from '../contexts/PostausgangContext'
import * as XLSX from 'xlsx'
import { LOGO_AZS_BASE64 } from '../lib/logoBase64'
import { doctorPhoto } from '../lib/doctorPhotos'
import { Search, ChevronLeft, ChevronRight, AlertTriangle, X, Pencil, Plus, Loader2, UserRound, Mail, Phone, Building2, Info, BarChart2, CalendarClock, TrendingUp, CheckCircle2, MinusCircle, Bell, BellOff, Copy, Check, Download, CalendarDays, ListChecks, Printer, PhoneMissed, PhoneCall, UserX, Clock, FileSpreadsheet, ArrowRightLeft, Trash2, ExternalLink, ArrowUp, ArrowDown, ChevronsUpDown, ChevronDown, ArrowLeft, Sparkles } from 'lucide-react'
import { generateBriefText } from '../lib/ai'
import {
  RecallPatient,
  Zuweisung,
  patientZuweisungen,
  newZuweisung,
  ZuweisungConfig,
  VerlaufEntry,
  zuBearbStableId,
  getRecallPatients,
  getInactiveRecallPatients,
  updateRecallPatient,
  touchRecallPatient,
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
import { loadPlanungDoctorNames, loadPlanung, type PlanungData } from '../lib/firestorePlanung'
import {
  s, formatDate, ageFromGeb, isKeinTermin, parseDroppedDate, normalizeLirisAddress,
  isFutureDate, toInputDate, toInputDatetime, parseStamp, formatErgebnis,
  pendingVorgehenLabel, normalizePid, titleCaseName, isWithin7Days, computeNextKons,
  parseKonsInterval,
} from '../lib/recallUtils'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/ToastContext'
import { collection, getDocs } from 'firebase/firestore'
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { db, storage } from '../lib/firebase'
import { ref as storageRef, uploadBytes } from 'firebase/storage'

const DOCTORS_DEFAULT = ['Artemiev', 'Menke', 'Malinina', 'Tschopp', 'Trachsler', 'Kirr', 'Papazoglou']
const ZU_BEARB   = 'Zu bearbeiten'
const OFFEN_TAB  = 'offen'                       // interner Doctor-Wert in der DB
const OFFEN_LABEL = 'Inaktive / Archiv'           // sichtbares Label im UI — Sammelansicht: Patienten inaktiver Ärzte + alle inaktiven/verstorbenen Patienten
const AUFGEBOT_TAB = '📅 RECALL'
const PAGE_SIZE  = 50

const STORNO_GRUENDE = ['Terminverschiebung', 'WV bei Bedarf', 'Wegzug', 'Verstorben', 'Arztwechsel', 'no Show', 'Brief ungeöffnet retourniert', 'nicht erreichbar', 'Krankheit', 'Behandlung im Spital', 'im Altersheim', 'Arzt lehnt Behandlung ab', 'Finanzielle Gründe / KK', 'Unzufrieden', 'Zweitmeinung - einmalige Konst.', 'Notfall - einmalige Konst.']

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
  'Pachymetrie':          '+5 Min.',
  'Hornhaut-Topographie': '+5 Min.',
  'Tränenfilm-Analyse':   '+5 Min.',
  'Funduskopie':          '+5 Min.',
  'Tonometrie':           '+5 Min.',
}

/** Minuten-Mapping fuer die Brief-Zeit-Berechnung (Zykloplegie separat). */
const VU_MIN: Record<string, number> = {
  'Perimetrie':           15,
  'Biometrie':            15,
  'Pachymetrie':           5,
  'Hornhaut-Topographie':  5,
  'Tränenfilm-Analyse':    5,
  'Funduskopie':           5,
  'Tonometrie':            5,
}
const SONSTIGE_MIN = 5

type FilterTermin = 'heute' | 'week' | 'month' | 'overdue' | 'inPlanung' | 'ohneTermin' | 'nachfass' | 'ohneRC'
type FilterStatus = 'storniert' | 'inaktiv' | 'reminder' | 'keinAufgebot' | 'wartetBericht' | 'nieBeimArzt'
const TERMIN_FILTER_LABELS: Record<FilterTermin, string> = {
  heute:      'Heute',
  week:       'Nächste 7 Tage',
  month:      'Nächste 30 Tage',
  overdue:    'Überfällig',
  inPlanung:  'Geplante Recalls',
  ohneTermin: 'Ohne Termin',
  nachfass:   'Nachfassen',
  ohneRC:     'Ohne RC',
}


/** Deutliche Kennzeichnung fuer Minderjaehrige (unter 18) — rosa Badge mit Alter. */
function MinorBadge({ gebDatum }: { gebDatum: string | null | undefined }) {
  const age = ageFromGeb(gebDatum)
  if (age === null || age < 0 || age >= 18) return null
  return (
    <span
      title={`Minderjährig — Briefe/E-Mails gehen an die Eltern (gesetzliche Vertreter). Alter: ${age} Jahre`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-pink-100 text-pink-700 border border-pink-300 text-[10px] font-bold shrink-0"
    >
      👶 {age} J.
    </span>
  )
}

function isStorniert(row: RecallPatient): boolean   { return s(row.storniert).toLowerCase() === 'ja' }

/** Aktiver Patient, der dem Arzt zugeteilt ist, aber noch NIE bei ihm war.
 *  Erkannt ueber (eines genuegt):
 *   - keine Konsultation vorhanden (zugeteilter Neupatient),
 *   - Zuteilung (arztSeit) NACH der letzten Konsultation (Umhaengung ohne
 *     Besuch seither; arztSeit wird bei jeder Umhaengung gestempelt),
 *   - letzte Konsultation war laut Liris bei einem ANDEREN Arzt
 *     (letzterKonsArzt, z.B. frueher Dr. Nessmann, jetzt Dr. Artemiev
 *     zugeteilt — wird beim Oeffnen der Akte automatisch erfasst). */
function isNieBeimArzt(p: RecallPatient): boolean {
  if (isStorniert(p) || p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben') return false
  const lk = toInputDate(p.letzteKons)
  if (!lk) return true
  if (!!p.arztSeit && p.arztSeit > lk) return true
  return !!p.letzterKonsArzt && p.letzterKonsArzt !== p.doctor
}

/**
 * Patient gilt als "im Recall" (geplante Recall-Erstellung), wenn:
 *   - naechsteKons === 'kein Termin' (alter Marker), ODER
 *   - aufgebotFuer ist gesetzt UND aufgebotErstellt ist NICHT gesetzt
 *     (Recall ist geplant aber noch nicht erstellt — angezeigt mit "RC")
 * Active-Filter (nicht storniert/inaktiv) wird vom Caller erwartet.
 */
function isInPlanung(p: RecallPatient): boolean {
  if (p.naechsteKons === 'kein Termin') return true
  if (p.aufgebotFuer && !p.aufgebotErstellt) return true
  return false
}

/** True wenn der Patient an einen externen oder internen Arzt/Klinik
 *  weiterverwiesen wurde und der Bericht (Abschluss / weiteres Vorgehen)
 *  noch aussteht — also wir auf die Empfehlung warten und das eigene
 *  Recall-Vorgehen erst danach bestimmt wird. */
function isAwaitingZuweisungsBericht(p: RecallPatient): boolean {
  // Aktiv = mindestens eine Zuweisung noch offen (pendent) oder erledigt ohne Bericht.
  return patientZuweisungen(p).some(z => z.status === 'pendent' || (z.status === 'erledigt' && !z.berichtErhalten))
}

/** True wenn ein Patient WIRKLICH offen ist (=> braucht Recall-Planung):
 *  kein nächster Termin, kein RC-Datum (aufgebotFuer), kein "kein-Termin"-Flag,
 *  Patient hat NICHT aktiv "kein Aufgebot" gewünscht, und wir warten NICHT
 *  noch auf den Abschlussbericht einer Zuweisung.
 *
 *  Patienten mit Status 'kein Aufgebot' wollen weder Reminder noch Aufgebote
 *  bekommen — die melden sich bei Bedarf selbst.
 *
 *  Patienten mit ausstehender Zuweisung sind auch nicht offen — das weitere
 *  Vorgehen kann ja erst nach Erhalt des Berichts bestimmt werden. */
function isOhneRC(p: RecallPatient): boolean {
  if (p.patientenStatus === 'kein Aufgebot') return false
  if (p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben') return false
  return !p.aufgebotErstellt
}

function isOhneTermin(p: RecallPatient): boolean {
  if (p.patientenStatus === 'kein Aufgebot') return false  // bewusste Entscheidung
  if (p.naechsteKons) return false                          // hat Termin (oder "kein Termin"-Flag)
  if (p.aufgebotFuer) return false                          // hat RC-Datum geplant
  if (isAwaitingZuweisungsBericht(p)) return false          // wartet auf Bericht
  return true
}

/** True if the patient already has a real next-consult date booked (not «kein Termin», not empty). */
function hasScheduledNextKons(p: { naechsteKons?: string | null }): boolean {
  const nk = p.naechsteKons
  return !!nk && nk !== 'kein Termin'
}

function isOverdue(p: { letzteKons?: string | null; naechsteKons?: string | null; aufgebotFuer?: string | null; patientenStatus?: string | null; aufgebotErstellt?: string | null; aufgebotArt?: string | null }): boolean {
  // Selbstmelder ("kein Aufgebot"): wollen bewusst keine Aufgebote und melden
  // sich bei Bedarf selbst -> nie überfällig.
  if (p.patientenStatus === 'kein Aufgebot') return false
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  // NUR Reminder: ein gesendeter Reminder hat KEINEN fixen Termin (anders als
  // Brief/Tel/Praxis, die den Termin in «Nächste Konst.» setzen). Er unterdrückt
  // «überfällig» nur für 6 Monate: NACH dem letzten Konsil erstellt (sonst alter
  // Zyklus) UND höchstens 6 Monate alt. Reagiert der Patient innert 6 Monaten
  // nicht, erscheint er danach wieder als überfällig.
  const sixMo = new Date(now); sixMo.setMonth(now.getMonth() - 6)
  const sixMoIso = sixMo.toISOString().slice(0, 10)
  if (p.aufgebotArt === 'Reminder' && p.aufgebotErstellt && p.aufgebotErstellt >= (p.letzteKons || '') && p.aufgebotErstellt >= sixMoIso) return false
  if (p.naechsteKons && p.naechsteKons !== 'kein Termin' && p.naechsteKons >= today) return false
  if (!p.letzteKons || p.letzteKons >= today) return false
  if (p.naechsteKons && p.naechsteKons !== 'kein Termin') return true
  if (!p.aufgebotFuer) return true
  return false
}

/** Nachfass fällig: Es wurde ein Aufgebot/Reminder erstellt (aktueller Zyklus,
 *  also nach dem letzten Konsil), seit mind. `weeks` Wochen, aber es wurde noch
 *  KEIN (zukünftiger) Termin gebucht. -> Patient hat nicht reagiert. */
function isNachfassFaellig(
  p: { letzteKons?: string | null; naechsteKons?: string | null; patientenStatus?: string | null; aufgebotErstellt?: string | null; aufgebotArt?: string | null },
  weeks = 8,
): boolean {
  if (p.patientenStatus === 'kein Aufgebot' || p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben') return false
  if (!p.aufgebotArt || !p.aufgebotErstellt) return false
  const today = new Date().toISOString().slice(0, 10)
  if (p.naechsteKons && p.naechsteKons !== 'kein Termin' && p.naechsteKons >= today) return false  // Termin gebucht → erledigt
  if (p.aufgebotErstellt < (p.letzteKons || '')) return false                                       // Aufgebot aus altem Zyklus
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - weeks * 7)
  return p.aufgebotErstellt <= cutoff.toISOString().slice(0, 10)
}

/** Vorgeschlagene nächste Eskalationsstufe: nach Brief/Reminder/Praxis → Telefon, nach Telefon → Brief. */
function nachfassNext(art?: string | null): 'Tel' | 'Brief' {
  return art === 'Tel' ? 'Brief' : 'Tel'
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
  zuweisungExtra: Zuweisung[]   // weitere Zuweisungen (neben der primären)
  zuweisungNoetig: boolean      // Merker: Zuweisung steht noch aus (Erinnerung fuer ZW-Management)
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
    // Primäre Zuweisung = erste der Liste (Legacy-Einzel wird mit-migriert).
    ...(() => {
      const z0 = p ? patientZuweisungen(p)[0] : undefined
      return {
        zuweisungAktiv:     !!z0,
        zuweisungTyp:       z0?.typ       ?? 'extern',
        zuweisungZiel:      z0?.ziel       ?? '',
        zuweisungGrund:     z0?.grund      ?? '',
        zuweisungDatum:     z0?.datum      || toInputDate(p?.letzteKons) || new Date().toISOString().slice(0, 10),
        zuweisungStatus:    ((z0?.status as string) === 'ausstehend' ? 'pendent' : z0?.status) ?? 'pendent',
        zuweisungErledigtAm: z0?.erledigtAm    ?? '',
        zuweisungBerichtErhalten: z0?.berichtErhalten ?? false,
        zuweisungNotiz:     z0?.notiz            ?? '',
        zuweisungExtra:     p ? patientZuweisungen(p).slice(1) : [],
      }
    })(),
    zuweisungNoetig:  p?.zuweisungNoetig === true,
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
  const { user: currentUser, profile, isAdmin, isGeschaeftsleitung, isArzt } = useAuth()
  // Electron-Erkennung — Liris-Integration (Webview + Auto-PID) funktioniert
  // NUR in der Desktop-App. Im Browser blockiert CORS, daher Buttons
  // ausblenden statt einen toten Link anzubieten.
  const isElectron = typeof window !== 'undefined' && /Electron/i.test(navigator.userAgent)
  /** Wer darf die Patientenliste hochladen und Imports rückgängig machen?
   *  Nur Admin + Geschäftsleitung — destruktive bzw. weitreichende Aktionen. */
  const canManageImports = isAdmin || isGeschaeftsleitung
  const toast = useToast()
  const navigate     = useNavigate()
  const location     = useLocation()
  const { openWithPid, open: openBrowser, lirisExtract, setLirisExtract, recallPidRequest, clearRecallPidRequest, recallNewRequest, clearRecallNewRequest, requestRecallNew, setStaleRecallPids, setKnownRecallPids, staleReferenceDate, reloadLiris, requestTerminAnlegen, setLirisSuppressed, lirisPanelWidth } = useBrowser()
  const postausgang = usePostausgang()
  const username     = profile?.username || profile?.displayName || 'System'
  const displayLabel = profile?.displayName || profile?.username || 'System'

  const [doctors, setDoctors] = useState<string[]>(DOCTORS_DEFAULT)
  const allTabs = useMemo(() => [...doctors, OFFEN_TAB, ZU_BEARB, AUFGEBOT_TAB], [doctors])

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

const lirisExtractRef  = useRef(lirisExtract)
  useEffect(() => { lirisExtractRef.current = lirisExtract }, [lirisExtract])

  // Search
  const [search, setSearch]         = useState('')

  // Edit modal
  const [editTarget, setEditTarget] = useState<EditTarget>(null)
  const [form, setForm] = useState<EditForm>(initForm())
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTargetOverride, setDeleteTargetOverride] = useState<{ id: string; label: string; doctor: string } | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteErr, setDeleteErr] = useState('')
  const [deleting, setDeleting] = useState(false)
  // Doppelte PIDs — Cleanup-Confirmation + Loading
  const [showDupCleanupConfirm, setShowDupCleanupConfirm] = useState(false)
  const [dupCleanupRunning,     setDupCleanupRunning]     = useState(false)
  // Letzte Einlesung rückgängig
  const [showUndoImportConfirm, setShowUndoImportConfirm] = useState(false)
  const [undoImportRunning,     setUndoImportRunning]     = useState(false)
  // Liris-Mismatch-Dialog (Patient nicht / falsch in Liris)
  const [lirisMismatch, setLirisMismatch] = useState<{ patientId: string; doctor: string; vorname: string; pid: string; reason: string } | null>(null)
  // Bestätigung wenn Liris-letzteKons älter als bestehende
  const [lirisOlderKons, setLirisOlderKons] = useState<{ lirisDate: string; formDate: string } | null>(null)
  // Namensauswahl bei mehreren Vornamen aus Liris
  const [lirisNameChoice, setLirisNameChoice] = useState<{ options: string[] } | null>(null)
  // Arzt-nicht-in-Liste-Dialog (aus Liris extrahierter Arzt-Name).
  // Auto-Close-useEffect ist weiter unten platziert (nach der Deklaration
  // von assignDoctor), siehe Suche nach "unknownDoctor && assignDoctor".
  const [unknownDoctor, setUnknownDoctor] = useState<{ extractedName: string } | null>(null)
  const [assignDoctor, setAssignDoctor] = useState('')
  // Auto-schliessen des Unknown-Doctor-Popups sobald assignDoctor gesetzt wird.
  useEffect(() => {
    if (unknownDoctor && assignDoctor) setUnknownDoctor(null)
  }, [assignDoctor, unknownDoctor])
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({})
  const [quickInput, setQuickInput] = useState('')
  const [pidDup, setPidDup] = useState<RecallPatient | null>(null)
  const naechsteKonsRef = useRef<HTMLInputElement>(null)
  const lastLirisAutor = useRef<string | null>(null)
  const lastLirisExtract = useRef<{ intervalWeeks?: number | null; bpText?: string | null; naechsterTerminRaw?: string | null } | null>(null)
  const pendingReload = useRef(false)
  // Stub-Refs falls noch alte Aufrufe von setModalBuffer rumliegen — die Live-
  // Subscription wurde komplett entfernt, daher No-Op.
  function setModalBuffer(_active: boolean) { /* no-op */ }
  const [copiedCell, setCopiedCell] = useState<string | null>(null)
  const [filterNeupatient, setFilterNeupatient] = useState(false)
  const [filterTermin, setFilterTermin] = useState<FilterTermin | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus | null>(null)
  const [filterGrund, setFilterGrund] = useState<string | null>(null)   // Storno-Grund
  // true solange der Arzt-Abgleich (Batch-Scan) laeuft — unterdrueckt u.a.
  // das Auto-Oeffnen des Patient-bearbeiten-Modals bei Akte-Navigation.
  const arztScanRunningRef = useRef(false)
  const [filterAufgebotArt, setFilterAufgebotArt] = useState<string | null>(null)
  const [filterNochZuErledigen, setFilterNochZuErledigen] = useState(false)
  const [filterReminderFaellig, setFilterReminderFaellig] = useState(false)
  const [filterReminderGeplant, setFilterReminderGeplant] = useState(false)
  // Filter über eine verlauf-Aktion (Telefonanruf / E-Mail) — für die anklickbaren
  // Badges in der Aktivitäts-Tabelle, die nicht über patientenseitiges aufgebotArt
  // abgedeckt sind.
  const [filterVerlaufAktion, setFilterVerlaufAktion] = useState<string | null>(null)
  const [filterInaktivArzt, setFilterInaktivArzt] = useState<string | null>(null)

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
  const [wochenplanSort, setWochenplanSort] = useState<'arzt' | 'name' | 'datumAsc' | 'datumDesc'>('arzt')
  const [wochenplanFilterArzt, setWochenplanFilterArzt] = useState<string>('')
  // Klick auf Arzt-Badge im Wochenplan: Einsatztage des Arztes anzeigen.
  const [arztTageFor, setArztTageFor] = useState<string | null>(null)
  const [planungData, setPlanungData] = useState<PlanungData | null>(null)
  const openArztTage = (doctor: string) => {
    setArztTageFor(doctor)
    if (!planungData) loadPlanung(new Date().getFullYear()).then(setPlanungData).catch(() => {})
  }

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
    // Telefon-Ergebnis nach Anruf — definiert auch das weitere Vorgehen
    telResult: 'erreicht' | 'nichtErreicht' | 'nichtGueltig' | ''
    // Folge-Vorgehen bei "nicht erreicht": was nun?
    telFollowup: 'erneutAnrufen' | 'briefVersenden' | 'reminderSetzen' | ''
    telFollowupDatum: string          // YYYY-MM-DD — Datum für erneuten Anruf / Reminder
    nachnameOverride: string          // vom User gewählter Nachname für die Anrede (bei mehrdeutigem Namen)
    briefVariante: '' | 'neuerArzt' | 'terminVerpasst' | 'terminVerschoben' | 'terminBestaetigung' | 'freierBrief'   // Brief-Textvariante ('' = Standard); terminBestaetigung/freierBrief = Allgemeine Briefe (kein Aufgebot)
    freiBetreff: string               // Freier Brief: Betreffzeile
    freiText: string                  // Freier Brief: Fliesstext (Absaetze durch Leerzeile)
    frueherArzt: string               // früherer Arzt (für Variante 'neuerArzt')
    verschiebungDurch: 'praxis' | 'patient'   // Terminverschiebung: wer hat verschoben? (bestimmt den Brieftext)
    vertreterModus: boolean           // Erwachsener Patient mit gesetzlichem Vertreter — Brief geht an den Vertreter, nicht direkt an den Patienten (analog Minderjährige)
    vertreterTyp: 'vertreter' | 'kontaktperson'   // Art des Dritt-Empfaengers: gesetzl. Vertreter/Vormund vs. Kontaktperson (bestimmt die Formulierung)
  }
  const emptyAufgebotForm = (): AufgebotForm => ({
    art: null, pupille: false, anrede: '', adressBlock: '',
    terminDatum: '', terminZeit: '',
    arztName: '', notiz: '', versand: '', terminFixiert: '',
    voruntersuchungen: [], voruntersuchungenSonstige: '', fachtitel: '',
    telResult: '', telFollowup: '', telFollowupDatum: '',
    nachnameOverride: '', briefVariante: '', frueherArzt: '',
    freiBetreff: '', freiText: '',
    verschiebungDurch: 'patient',
    vertreterModus: false,
    vertreterTyp: 'vertreter',
  })
  const [aufgebotTarget, setAufgebotTarget] = useState<WPEntry | null>(null)
  const [aufgebotForm, setAufgebotForm] = useState<AufgebotForm>(emptyAufgebotForm())
  const [aufgebotPdfCreated, setAufgebotPdfCreated] = useState(false)
  // KI-Formulierung im Freien Brief (Gemini via Firebase AI Logic, gratis, ohne Patientendaten)
  const [kiAnliegen, setKiAnliegen] = useState('')
  const [kiLoading, setKiLoading] = useState(false)
  // Inline-Formular «weitere Zuweisung» im Patient-bearbeiten-Dialog
  const [zwAddOpen, setZwAddOpen] = useState(false)
  const [zwAddDraft, setZwAddDraft] = useState<{ typ: 'intern' | 'extern'; ziel: string; grund: string; datum: string }>({ typ: 'extern', ziel: '', grund: '', datum: new Date().toISOString().slice(0, 10) })

  useEffect(() => () => setLirisSuppressed(false), [setLirisSuppressed])
  // «weitere Zuweisung»-Inline-Form zurücksetzen, wenn ein anderer Patient geöffnet wird
  useEffect(() => { setZwAddOpen(false); setZwAddDraft({ typ: 'extern', ziel: '', grund: '', datum: new Date().toISOString().slice(0, 10) }) }, [editTarget])
  const [emailCopied,       setEmailCopied]       = useState(false)
  const [previewCollapsed]  = useState(true)   // Dialog bleibt schmal (Vorschau ist Popup)
  // Benutzerdefinierte Voruntersuchungen (zusaetzlich zu VORUNTERSUCHUNGEN),
  // lokal gespeichert damit haeufige eigene Eintraege als Buttons bleiben.
  const [customVUs, setCustomVUs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('recall-custom-vu') || '[]') } catch { return [] }
  })
  const persistCustomVUs = (next: string[]) => {
    setCustomVUs(next)
    try { localStorage.setItem('recall-custom-vu', JSON.stringify(next)) } catch { /* ignore */ }
  }
  const addCustomVU = () => {
    const name = window.prompt('Neue Voruntersuchung hinzufügen:')?.trim()
    if (!name) return
    if ((VORUNTERSUCHUNGEN as readonly string[]).includes(name) || customVUs.includes(name)) {
      toast.info('Diese Voruntersuchung existiert bereits.'); return
    }
    persistCustomVUs([...customVUs, name])
  }
  // Logo als Base64-DataURL — wird einmalig beim Mount geladen. Inline
  // im Brief noetig damit Electron-printToPDF (loadet temp .html via
  // file://) das Bild auch ohne Internet darstellen kann.
  const [logoDataUrl, setLogoDataUrl] = useState<string>('')
  useEffect(() => {
    let aborted = false
    fetch('/logo-azs.png')
      .then(r => r.ok ? r.blob() : Promise.reject(r.status))
      .then(b => new Promise<string>((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result))
        fr.onerror = () => rej(fr.error)
        fr.readAsDataURL(b)
      }))
      .then(url => { if (!aborted) setLogoDataUrl(url) })
      .catch(err => console.warn('[Brief] Logo konnte nicht geladen werden', err))
    return () => { aborted = true }
  }, [])

  // Tab aus URL-Parameter (z.B. ?tab=aufgebot)
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const tab = params.get('tab')
    if (tab === 'aufgebot') {
      // switchTab statt setActiveTab: oeffnet auch den Wochenplan und setzt
      // Filter/Seite zurueck (setActiveTab allein liess den Plan geschlossen).
      switchTab(AUFGEBOT_TAB)
      // URL bereinigen
      navigate('/recall', { replace: true })
    } else if (tab === 'zubearbeiten') {
      switchTab(ZU_BEARB)
      navigate('/recall', { replace: true })
    }
  }, [location.search, navigate]) // eslint-disable-line react-hooks/exhaustive-deps

  const [aufgebotSaving,        setAufgebotSaving]        = useState(false)
  const [briefPreview, setBriefPreview] = useState<string | null>(null)
  const [doctorFachtitelMap, setDoctorFachtitelMap] = useState<Record<string, string>>({})
  const [doctorFotoMap, setDoctorFotoMap] = useState<Record<string, string>>({})
  const briefIframeRef = useRef<HTMLIFrameElement>(null)
  function copyToClipboard(val: string, key: string) {
    navigator.clipboard.writeText(val).then(() => {
      setCopiedCell(key)
      setTimeout(() => setCopiedCell(null), 1500)
    }).catch(() => {})
  }

  // ── Table sort (multi-column: Shift+Click adds secondary key) ───────────────
  type SortCol = 'pid'|'vorname'|'gebDatum'|'letzteKons'|'naechsteKons'|'aufgebotFuer'|'aufgebotArt'|'storniert'|'patientenStatus'|'aktualisiert'|'doctor'
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
    if (idx < 0) {
      // Unsortierte Spalte: dezenter Doppel-Pfeil als Hint, dass sortierbar.
      return <ChevronsUpDown className="ml-1 inline-block w-3 h-3 opacity-25 group-hover:opacity-60 transition-opacity align-middle" />
    }
    const isAsc = sortKeys[idx].dir === 'asc'
    return (
      <span className="ml-1 inline-flex items-center gap-0.5 align-middle">
        {isAsc
          ? <ArrowUp   className="w-3.5 h-3.5 text-primary-600" />
          : <ArrowDown className="w-3.5 h-3.5 text-primary-600" />}
        {sortKeys.length > 1 && (
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-primary-600 text-white text-[9px] font-bold tabular-nums">
            {idx + 1}
          </span>
        )}
      </span>
    )
  }
  /** Tailwind-Klassen für sortierbare Header — active=primary getöntes Bg, sonst nur Hover. */
  function thSortCls(col: SortCol, baseCls: string): string {
    const isActive = sortKeys.some(k => k.col === col)
    return `${baseCls} ${isActive ? 'bg-primary-50 text-primary-800' : 'hover:bg-gray-100'} cursor-pointer select-none group transition-colors`
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
      case 'doctor':         return p.doctor === OFFEN_TAB ? 'zzz' : s(p.doctor)
    }
  }

  // Draggable modal — Position wird in localStorage gespeichert
  const MODAL_POS_KEY = 'recall-modal-pos'
  const modalRef    = useRef<HTMLDivElement>(null)
  const [modalPos, setModalPos]     = useState<{ x: number; y: number } | null>(() => {
    try { const s = localStorage.getItem(MODAL_POS_KEY); return s ? JSON.parse(s) : null } catch { return null }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragOrigin  = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null)

  const saveModalPos = (pos: { x: number; y: number }) => {
    setModalPos(pos)
    try { localStorage.setItem(MODAL_POS_KEY, JSON.stringify(pos)) } catch { /* ignore */ }
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragOrigin.current) return
      const dx = e.clientX - dragOrigin.current.mouseX
      const dy = e.clientY - dragOrigin.current.mouseY
      const w  = modalRef.current?.offsetWidth  ?? 512
      const h  = modalRef.current?.offsetHeight ?? 300
      saveModalPos({
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
      const fotoMap: Record<string, string> = {}
      for (const d of snap.docs) {
        const data = d.data()
        // Key by last word of displayName → matches recall keys ("Artemiev", "Menke" …)
        const lastName = String(data.displayName ?? '').trim().split(/\s+/).pop()
        if (data.fachtitel) {
          if (lastName) map[lastName] = data.fachtitel
          if (data.username) map[data.username] = data.fachtitel
        }
        // Arztfoto-URL (wie Material-Bild in der Lagerverwaltung)
        if (data.fotoUrl) {
          if (lastName) fotoMap[lastName] = data.fotoUrl
          if (data.username) fotoMap[data.username] = data.fotoUrl
        }
      }
      setDoctorFachtitelMap(map)
      setDoctorFotoMap(fotoMap)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    getZuweisungConfig().then(cfg => {
      setZuweisungPraxen(cfg.praxen)
      setZuweisungGruende(cfg.gruende)
    }).catch(() => {})
  }, [])

  // Liris-Panel beim Recall-Start vorab oeffnen (nur Electron) — so ist die
  // Webview schon geladen + eingeloggt bevor der User den ersten Patient
  // anklickt. Erster Klick auf "-> Liris" ist dann sofort interaktiv statt
  // 2-3 Sek auf den Initial-Page-Load zu warten.
  useEffect(() => {
    if (isElectron) openBrowser()
  }, [isElectron]) // eslint-disable-line react-hooks/exhaustive-deps

  // Liris-Kalender → Recall: User hat im eingebetteten Liris einen Patienten
  // angeklickt. PID kommt via recallPidRequest. Passenden Recall-Patienten
  // suchen und Edit-Popup oeffnen (ohne PID erneut an Liris zu senden — der
  // Patient ist dort bereits offen).
  useEffect(() => {
    if (!recallPidRequest) return
    // Waehrend des Arzt-Abgleichs (Batch-Scan) KEIN Auto-Open — der Scan
    // blaettert selbst durch die Akten.
    if (arztScanRunningRef.current) { clearRecallPidRequest(); return }
    // Auto-Requests (Akte-Navigation) brauchen ein laengeres Fenster: Sie
    // warten auf den Liris-Extract (letzteKons etc.), der einige Sekunden
    // braucht. Bewusste Klicks oeffnen sofort (5s Fenster wie bisher).
    const maxAge = recallPidRequest.auto ? 15000 : 5000
    if (Date.now() - recallPidRequest.at > maxAge) { clearRecallPidRequest(); return }
    // Solange das Aufbieten-Modal offen ist, kein Auto-Open des Patient-
    // bearbeiten-Modals — der User hat bewusst Brief/Reminder gewaehlt und
    // bekommt die Liris-Daten via lirisExtract direkt ins Aufbieten-Formular.
    if (aufgebotTarget) { clearRecallPidRequest(); return }
    const wantPid = normalizePid(recallPidRequest.pid)
    if (!wantPid) { clearRecallPidRequest(); return }
    // Nicht erneut oeffnen wenn dieser Patient schon im Edit-Popup ist
    if (editTarget && editTarget !== 'new' && normalizePid(editTarget.pid) === wantPid) {
      clearRecallPidRequest()
      return
    }
    let found: RecallPatient | null = null
    for (const list of allData.values()) {
      const hit = list.find(p => normalizePid(p.pid) === wantPid)
      if (hit) { found = hit; break }
    }
    if (found && recallPidRequest.auto) {
      // Automatisch (blosse Akte-Navigation): NUR oeffnen wenn es in der Akte
      // etwas Neues gibt — neue Konsultation (Liris-Datum neuer als gespeichert)
      // oder †-Markierung, die im Recall noch fehlt. Sonst kein Popup.
      const lx = (lirisExtract && normalizePid(lirisExtract.pid) === wantPid && Date.now() - lirisExtract.at < 20000) ? lirisExtract : null
      if (!lx) return   // Extract noch nicht da -> warten (Effect re-runt bei lirisExtract-Update; maxAge raeumt auf)
      const neueKons = !!(lx.letzteKons && String(lx.letzteKons) > String(found.letzteKons ?? ''))
      const verstorbenNeu = !!lx.verstorben && found.patientenStatus !== 'verstorben'
      // Neuer/geaenderter Termin in Liris, der lokal noch nicht erfasst ist —
      // das Auto-Fill im Modal wuerde ihn uebernehmen -> Modal lohnt sich.
      const terminNeu = !!lx.naechsterTerminDatum
        && toInputDate(found.naechsteKons) !== lx.naechsterTerminDatum
      if (!neueKons && !verstorbenNeu && !terminNeu) {
        console.log('[Recall] Auto-Open unterdrueckt — keine Aenderung in der Akte (PID', wantPid + ')')
        clearRecallPidRequest()
        return
      }
    }
    clearRecallPidRequest()
    if (found) {
      openEdit(found, false)   // false = nicht zurueck an Liris senden
    } else {
      // Patient existiert nicht im Recall — Neu-Erfassung mit Liris-Daten
      // anstossen (PID + ggf. Name/Geb/letzteKons/Intervall aus lirisExtract).
      // recallNewRequest-Effect uebernimmt das eigentliche Modal-Oeffnen.
      const lx = (lirisExtract && normalizePid(lirisExtract.pid) === wantPid) ? lirisExtract : null
      requestRecallNew({
        pid:          wantPid,
        name:         lx?.vorname     || '',
        geb:          lx?.gebDatum    || '',
        letzteKons:   lx?.letzteKons  || '',
        intervalWeeks: lx?.intervalWeeks ?? null,
        autor:        lx?.autor       || '',
      })
    }
  }, [recallPidRequest, allData, lirisExtract]) // eslint-disable-line react-hooks/exhaustive-deps

  // Neu-Erfassung aus Liris: PID nicht im Recall vorhanden -> Edit-Modal
  // im NEU-Modus mit PID + Name + Geb.datum + Untersuchungsdatum + Intervall
  // vorausgefuellt oeffnen (letzteKons/intervalWeeks aus lirisExtract).
  useEffect(() => {
    if (!recallNewRequest) return
    if (Date.now() - recallNewRequest.at > 5000) { clearRecallNewRequest(); return }
    const { pid, name, geb, letzteKons: reqLK, intervalWeeks: reqIW, autor: reqAutor } = recallNewRequest
    clearRecallNewRequest()
    // Daten kommen direkt aus dem Request (wurden beim Aufruf aus lirisExtract
    // übernommen) → kein erneuter Timeout-Check auf lirisExtract nötig.
    let intervalStr = ''
    if (reqIW) {
      const w = reqIW
      if      (w % 52 === 0 && w / 52 <= 120) intervalStr = `${w / 52}j`
      else if (w % 4  === 0 && w / 4  <= 120) intervalStr = `${w / 4}m`
      else if (w <= 120)                      intervalStr = `${w}w`
    }
    // Arzt aus Liris-Autor extrahieren
    let autoDoc = ''
    if (reqAutor) {
      const cleaned = reqAutor.replace(/^(?:Dr|Prof|med)\.?\s+/i, '').trim()
      const words = cleaned.split(/\s+/)
      for (let n = 1; n <= words.length; n++) {
        const cand = words.slice(-n).join(' ').toLowerCase()
        const match = doctors.find(d => d.toLowerCase() === cand || d.toLowerCase().includes(cand))
        if (match) { autoDoc = match; break }
      }
    }
    // 'RC zu erstellen ab' aus letzteKons + Intervall berechnen
    let autoAufgebotFuer = ''
    if (reqLK && intervalStr) {
      const computed = computeNextKons(reqLK, intervalStr)
      if (computed) {
        const lk2 = new Date(reqLK + 'T00:00:00Z')
        lk2.setUTCMonth(lk2.getUTCMonth() + 2)
        if (computed <= lk2.toISOString().slice(0, 10)) {
          autoAufgebotFuer = new Date().toISOString().slice(0, 10)
        } else {
          const d = new Date(computed + 'T00:00:00Z')
          d.setUTCMonth(d.getUTCMonth() - 2)
          autoAufgebotFuer = d.toISOString().slice(0, 10)
        }
      }
    }
    // name = "Nachname Vorname(n)" → erstes Wort abtrennen; name enthält schon
    // den Vornamen aus lirisExtract (übergeben via requestRecallNew).
    const nameParts = (name || '').trim().split(/\s+/).filter(Boolean)
    const calendarVorname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : (nameParts[0] || '')
    const resolvedVorname = name || calendarVorname
    const vornameParts = resolvedVorname.trim().split(/\s+/).filter(Boolean)
    setModalBuffer(true)
    setEditTarget('new')
    setForm(_ => ({
      ...initForm(),
      pid: pid || '',
      vorname: resolvedVorname,
      gebDatum: geb || '',
      letzteKons: reqLK || '',
      konsInterval: intervalStr,
      aufgebotFuer: autoAufgebotFuer,
      neupatient: true,
    }))
    setAssignDoctor(autoDoc)
    if (vornameParts.length > 1) {
      setLirisNameChoice({ options: [resolvedVorname, ...vornameParts] })
    }
    setFormErrors({})
    setQuickInput('')
    setPidDup(null)
    resetVorgehen()
    if (pid) checkPid(pid)
  }, [recallNewRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-Fill: wenn der Liris-Webview Patient-Infos extrahiert hat und ein
  // Edit-Modal offen ist, das passt (gleiche PID) UND das jeweilige Feld
  // leer ist → automatisch befuellen. Sicherheits-Checks:
  //   - Nur bei bestehenden Patienten (nicht 'new')
  //   - Nur wenn extract.at neuer ist als 5 Sek (verhindert stale Daten)
  //   - Nach Anwendung wird lirisExtract genullt damit's nicht doppelt feuert
  useEffect(() => {
    if (!lirisExtract) return
    if (!editTarget || editTarget === 'new') return
    if (Date.now() - lirisExtract.at > 5000) return
    const currentPid = normalizePid(form.pid)
    const extractPid = normalizePid(lirisExtract.pid)
    if (!currentPid || !extractPid || currentPid !== extractPid) return

    // Verifikation: Patient muss in Liris vorhanden sein UND mit unseren
    // bekannten Daten uebereinstimmen. Vergleichs-Strategie:
    //   - PID muss im Liris-Text vorkommen (pidMatchesLiris)
    //   - Vorname muss im Liris-Header vorkommen
    //   - Geburtsdatum muss matchen WENN beide gesetzt sind (sonst nicht
    //     ausschlaggebend, nur informativ)
    const localVorname  = (form.vorname || '').toLowerCase().trim()
    const lirisVorname  = (lirisExtract.vorname || '').toLowerCase()
    const lirisNachname = (lirisExtract.nachname || '').toLowerCase()
    const lirisFullName = [lirisNachname, lirisVorname].filter(Boolean).join(' ')
    const vornameMatches = !localVorname || !lirisVorname || lirisVorname.includes(localVorname) || localVorname.split(/\s+/).every(w => lirisVorname.includes(w) || lirisNachname.includes(w) || lirisFullName.includes(w))

    const localGeb = form.gebDatum || ''
    const lirisGeb = lirisExtract.gebDatum || ''
    const gebMatches = !localGeb || !lirisGeb || localGeb === lirisGeb

    const patientNotFound =
      lirisExtract.notFound ||
      !lirisExtract.pidMatchesLiris ||
      !vornameMatches ||
      !gebMatches

    if (patientNotFound) {
      // Praezise Meldung: warum es nicht passt
      let reason = 'Patient nicht in Liris vorhanden'
      if (lirisExtract.notFound)             reason = 'Patient nicht in Liris vorhanden'
      else if (!lirisExtract.pidMatchesLiris) reason = `PID #${currentPid} nicht in Liris gefunden`
      else if (!vornameMatches)               reason = `Name passt nicht: lokal „${form.vorname}" vs. Liris „${[lirisExtract.nachname, lirisExtract.vorname].filter(Boolean).join(' ')}"`
      else if (!gebMatches)                   reason = `Geburtsdatum passt nicht: lokal ${formatDate(localGeb)} vs. Liris ${formatDate(lirisGeb)}`
      // Popup statt Toast — Mismatch sollte nicht uebersehen werden.
      setLirisMismatch({
        patientId: editTarget.id,
        doctor:    editTarget.doctor,
        vorname:   form.vorname || '—',
        pid:       currentPid,
        reason,
      })
      setLirisExtract(null)
      return
    }

    let filled = false
    // Vorname auto-fill bei Neupatient (neupatient===true) wenn lokal leer.
    // Liris liefert «Vorname» und «Nachname» getrennt — kombinieren zu «Nachname Vorname».
    const isNeupatient = !!(editTarget as RecallPatient).neupatient
    if (isNeupatient && !form.vorname.trim() && (lirisExtract.vorname || lirisExtract.nachname)) {
      const combined = [lirisExtract.nachname, lirisExtract.vorname].filter(Boolean).join(' ')
      if (combined) { setField('vorname', combined); filled = true }
    }
    // Geburtsdatum auto-fill nur wenn LOKAL leer (sonst bleibt bestehender
    // Wert erhalten — er wurde oben schon gegen Liris validiert).
    if (!form.gebDatum && lirisExtract.gebDatum) {
      setField('gebDatum', lirisExtract.gebDatum)
      filled = true
    }
    // Letzte Konst. auto-fill — wenn Liris ein Datum liefert:
    //   - neuer als bestehend → alles zurücksetzen und neu ausfüllen
    //   - gleich → nur Intervall/RC neu ausfüllen wenn leer
    //   - älter → User fragen
    if (lirisExtract.letzteKons) {
      if (lirisExtract.letzteKons < form.letzteKons) {
        setLirisOlderKons({ lirisDate: lirisExtract.letzteKons, formDate: form.letzteKons })
      } else {
        const isNewer = !form.letzteKons || lirisExtract.letzteKons > form.letzteKons
        if (isNewer) {
          // Neues Datum → alles zurücksetzen (ausser Status). Auch das alte
          // «Aufgebot erstellt am» gehört zum ABGESCHLOSSENEN Zyklus und
          // muss weg — sonst wirkt der Patient weiterhin als aufgeboten.
          setField('letzteKons', lirisExtract.letzteKons)
          setField('storniert', '')
          setField('grundStornierung', '')
          setField('aufgebotArt', '')
          setField('aufgebotErstellt', '')
          setField('aufgebotFuer', '')
          setField('naechsteKons', '')
          setField('keinTermin', false)
          setField('konsInterval', '')
          // «Weiteres Vorgehen»/Verlauf gehoert zum alten Zyklus → bereinigen
          // (historische Statistik bleibt: recall_activity_log ist immutable).
          setField('verlauf', [])
          filled = true
        }
        // Intervall aus Liris übernehmen — NUR bei echter Änderung (neuer
        // Zyklus) oder als reines Ergänzen, wenn lokal noch kein Intervall
        // erfasst ist. Bei unveränderter Akte darf das Auto-Ausfüllen keine
        // manuell gesetzten Werte (Storno, nächste Konst., RC-ab) anfassen.
        const baseLk = lirisExtract.letzteKons
        if (lirisExtract.intervalWeeks && (isNewer || !form.konsInterval.trim())) {
          const w = lirisExtract.intervalWeeks
          let label: string | null = null
          if (w % 52 === 0 && w / 52 <= 120)      label = `${w / 52}j`
          else if (w % 4  === 0 && w / 4  <= 120) label = `${w / 4}m`
          else if (w <= 120)                      label = `${w}w`
          if (label) {
            setField('konsInterval', label)
            if (isNewer) {
              setField('storniert', '')
              setField('grundStornierung', '')
            }
            const computed = computeNextKons(baseLk, label)
            // RC-ab nur berechnen wenn neuer Zyklus ODER beide Zielfelder
            // noch leer sind (Ergänzung statt Überschreiben).
            if (computed && (isNewer || (!form.naechsteKons && !form.aufgebotFuer))) {
              if (isNewer) {
                setField('naechsteKons', '')
                setField('keinTermin', false)
              }
              const lk2 = new Date(baseLk + 'T00:00:00Z')
              lk2.setUTCMonth(lk2.getUTCMonth() + 2)
              if (computed <= lk2.toISOString().slice(0, 10)) {
                setField('aufgebotFuer', new Date().toISOString().slice(0, 10))
              } else {
                const d = new Date(computed + 'T00:00:00Z')
                d.setUTCMonth(d.getUTCMonth() - 2)
                setField('aufgebotFuer', d.toISOString().slice(0, 10))
              }
            }
            filled = true
          }
        }
        // Liris zeigt bereits einen ZUKUENFTIGEN Termin (Timeline) → der
        // Patient wurde direkt in der Praxis aufgeboten: Praxis waehlen,
        // Vereinbarungsdatum = letzte Kons., naechste Konst. = Liris-Termin.
        // Nur beim neuen Zyklus (oder wenn noch nichts erfasst ist) — sonst
        // wuerden manuell gesetzte Werte ueberschrieben.
        if (lirisExtract.naechsterTerminDatum
            && (isNewer || (!form.aufgebotArt && !form.naechsteKons))) {
          setField('aufgebotArt', 'Praxis')
          setField('aufgebotErstellt', baseLk)
          setField('naechsteKons', lirisExtract.naechsterTerminDatum)
          setField('keinTermin', false)
          setField('aufgebotFuer', '')
          filled = true
        } else if (lirisExtract.naechsterTerminDatum && !form.naechsteKons) {
          // Aufgebot ist bereits erfasst (z.B. Brief verschickt) und in Liris
          // ist inzwischen ein Termin erschienen → NUR die naechste Konst.
          // uebernehmen; Art/Datum des bestehenden Aufgebots bleiben.
          setField('naechsteKons', lirisExtract.naechsterTerminDatum)
          setField('keinTermin', false)
          setField('aufgebotFuer', '')
          filled = true
        }
      }
    } else if (lirisExtract.naechsterTerminDatum && !form.naechsteKons) {
      // Neupatient: noch KEINE Konsultation in Liris, aber bereits ein
      // gebuchter Termin → naechste Konst. direkt uebernehmen. Ohne
      // bestehendes Aufgebot zusaetzlich Praxis + Vereinbarungsdatum=heute.
      if (!form.aufgebotArt) {
        setField('aufgebotArt', 'Praxis')
        setField('aufgebotErstellt', new Date().toISOString().slice(0, 10))
      }
      setField('naechsteKons', lirisExtract.naechsterTerminDatum)
      setField('keinTermin', false)
      setField('aufgebotFuer', '')
      filled = true
    }
    // Arzt-zuweisen auto-fill nur wenn Patient in "Zu bearbeiten" und leer
    if (!assignDoctor && lirisExtract.autor && editTarget.doctor === ZU_BEARB) {
      // Aus "Dr. Max Mustermann" → versuche Nachname extrahieren und gegen doctors-Liste matchen.
      const cleaned = lirisExtract.autor.replace(/^(?:Dr|Prof|med)\.?\s+/i, '').trim()
      const words = cleaned.split(/\s+/)
      // Probier alle Suffix-Kombinationen (letztes Wort, 2 letzte, ...)
      let match: string | undefined
      for (let n = 1; n <= words.length; n++) {
        const cand = words.slice(-n).join(' ').toLowerCase()
        match = doctors.find(d => d.toLowerCase() === cand || d.toLowerCase().includes(cand))
        if (match) break
      }
      if (match) {
        setAssignDoctor(match)
        filled = true
      }
    }
    if (filled) toast.success('Patient-Infos aus Liris übernommen')
    // Verstorben-Check: NACH Intervall/aufgebotFuer-Fill prüfen
    if (lirisExtract.verstorben) {
      const alreadySet = form.patientenStatus === 'verstorben'
        && form.storniert?.toLowerCase() === 'ja'
        && form.grundStornierung === 'Verstorben'
      if (!alreadySet) {
        setField('storniert', 'ja')
        setField('patientenStatus', 'verstorben')
        setField('grundStornierung', 'Verstorben')
        setField('aufgebotFuer', '')
        toast.success('Patient als verstorben markiert († in Liris erkannt)')
      }
      const currentDoctor = (editTarget as RecallPatient).doctor
      const hatKeinenArzt = !assignDoctor && (!currentDoctor || currentDoctor === OFFEN_TAB)
      if (lirisExtract.autor && hatKeinenArzt) {
        const cleaned = lirisExtract.autor.replace(/^(?:Dr|Prof|med)\.?\s+/i, '').trim()
        const words = cleaned.split(/\s+/)
        let arztAktiv = false
        for (let n = 1; n <= words.length; n++) {
          const cand = words.slice(-n).join(' ').toLowerCase()
          if (doctors.find(d => d.toLowerCase() === cand || d.toLowerCase().includes(cand))) { arztAktiv = true; break }
        }
        if (!arztAktiv) {
          setAssignDoctor(lirisExtract.autor!)
        }
      }
    }
    // Inaktiver Patient: ebenfalls inaktiven Arzt aus Liris übernehmen
    if (!lirisExtract.verstorben && form.patientenStatus === 'inaktiv' && lirisExtract.autor) {
      const cleaned = lirisExtract.autor.replace(/^(?:Dr|Prof|med)\.?\s+/i, '').trim()
      const words = cleaned.split(/\s+/)
      let arztAktiv = false
      for (let n = 1; n <= words.length; n++) {
        const cand = words.slice(-n).join(' ').toLowerCase()
        if (doctors.find(d => d.toLowerCase() === cand || d.toLowerCase().includes(cand))) { arztAktiv = true; break }
      }
      if (!arztAktiv) {
        setAssignDoctor(lirisExtract.autor!)
      }
    }
    // Autor + Intervall-Daten merken für spätere manuelle Datumsänderung
    if (lirisExtract.autor) lastLirisAutor.current = lirisExtract.autor
    // Arzt der LETZTEN Konsultation am Patienten persistieren (aus dem
    // Liris-Autor, gegen die Tab-Namen inkl. inaktiver Aerzte gematcht).
    // Grundlage fuer den Filter «Noch nie beim Arzt»: letzte Konsultation
    // war bei einem ANDEREN Arzt als dem aktuell zugeteilten.
    if (lirisExtract.autor) {
      // (editTarget ist hier immer ein bestehender Patient — der Effect
      //  bricht fuer 'new' ganz oben ab.)
      const cleanedA = lirisExtract.autor.replace(/^(?:Dr|Prof|med)\.?\s+/i, '').trim().toLowerCase()
      // Kandidaten: aktive Aerzte + alle Arzt-Tabs (inkl. inaktive wie Nessmann)
      const alleAerzte = new Set<string>(doctors)
      for (const tab of allData.keys()) {
        if (tab !== OFFEN_TAB && tab !== AUFGEBOT_TAB && tab !== ZU_BEARB) alleAerzte.add(tab)
      }
      const matched = Array.from(alleAerzte).find(d => d && cleanedA.includes(d.toLowerCase()))
      if (matched && matched !== (editTarget as RecallPatient).letzterKonsArzt) {
        updateRecallPatient(editTarget.id, { letzterKonsArzt: matched } as Partial<RecallPatient>, displayLabel)
          .catch(() => { /* nicht kritisch */ })
      }
    }
    lastLirisExtract.current = { intervalWeeks: lirisExtract.intervalWeeks, bpText: lirisExtract.bpText, naechsterTerminRaw: lirisExtract.naechsterTerminRaw }
    // Extract konsumiert -> nicht erneut anwenden
    setLirisExtract(null)
  }, [lirisExtract, editTarget, form.gebDatum, form.letzteKons, form.konsInterval, form.pid, assignDoctor, doctors]) // eslint-disable-line react-hooks/exhaustive-deps

  // Verstorben-Auto-Fill fuer neue Patienten (editTarget === 'new'):
  // Der Haupt-Effect oben bricht bei 'new' ab, deshalb separater Check.
  useEffect(() => {
    if (!lirisExtract?.verstorben) return
    if (editTarget !== 'new') return
    if (Date.now() - lirisExtract.at > 5000) return
    const alreadySet = form.patientenStatus === 'verstorben'
      && form.storniert?.toLowerCase() === 'ja'
      && form.grundStornierung === 'Verstorben'
    if (alreadySet) return
    setField('storniert', 'ja')
    setField('patientenStatus', 'verstorben')
    setField('grundStornierung', 'Verstorben')
    setField('aufgebotFuer', '')
    toast.success('Patient als verstorben markiert († in Liris erkannt)')
  }, [lirisExtract, editTarget]) // eslint-disable-line react-hooks/exhaustive-deps

  // Snapshot-Buffer/Live-Subscription entfernt — siehe init() unten.


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
      await loadAll([...docList, OFFEN_TAB, ZU_BEARB])
      // Live-Subscription entfernt — sorgte fuer Re-Renders waehrend des
      // Tippens und blockierte Tastatureingaben. Aktualisierung jetzt nur
      // nach eigenen Aktionen (reloadTab) oder manuell via "Erneut versuchen".
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

      // Inaktive/verstorbene Patienten nachladen — diese können einem Arzt
      // zugewiesen sein, der nicht in der aktiven Ärzte-Liste ist.
      try {
        const inaktive = await getInactiveRecallPatients()
        const byDoctor = new Map<string, RecallPatient[]>()
        const loadedIds = new Set<string>()
        for (const [, list] of map) for (const p of list) loadedIds.add(p.id)
        for (const p of inaktive) {
          if (loadedIds.has(p.id)) continue
          if (!byDoctor.has(p.doctor)) byDoctor.set(p.doctor, [])
          byDoctor.get(p.doctor)!.push(p)
        }
        for (const [doc, list] of byDoctor) {
          const existing = map.get(doc) ?? []
          map.set(doc, [...existing, ...list])
        }
      } catch { /* inaktive nicht geladen — kein Blocker */ }

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

  // ── Arzt-Abgleich: Batch-Scan aller aktiven Patienten ohne erfassten
  //    letzten Konsultations-Arzt. Blaettert die Liris-Akten automatisch
  //    durch (openWithPid), liest den Autor der letzten Konsultation und
  //    persistiert ihn (letzterKonsArzt) — Grundlage fuer den Filter
  //    «Noch nie beim Arzt» und dessen Auswertung. Nur Desktop-App.
  const [arztScan, setArztScan] = useState<{ running: boolean; done: number; total: number; current: string; found: number; umgeteilt: number } | null>(null)
  const arztScanAbort = useRef(false)
  const arztScanWaiter = useRef<{ pid: string; resolve: (autor: string | null) => void } | null>(null)

  // Extract-Konsument fuer den Scan (laeuft ohne offenes Edit-Modal).
  useEffect(() => {
    const w = arztScanWaiter.current
    if (!w || !lirisExtract) return
    if (!lirisExtract.notFound && normalizePid(lirisExtract.pid) !== w.pid) return
    arztScanWaiter.current = null
    w.resolve(lirisExtract.notFound ? null : (lirisExtract.autor || null))
    setLirisExtract(null)
  }, [lirisExtract]) // eslint-disable-line react-hooks/exhaustive-deps

  async function startArztScan() {
    const targets: RecallPatient[] = []
    // ALLE Arzt-Tabs scannen — auch inaktive (z.B. Nessmann): dort haengen
    // Patienten, die ggf. laengst von einem aktiven Arzt betreut werden.
    for (const [tab, list] of allData) {
      if (tab === OFFEN_TAB || tab === AUFGEBOT_TAB || tab === ZU_BEARB) continue
      for (const p of list) {
        if (!p.pid || p.letzterKonsArzt) continue
        if (isStorniert(p) || p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben') continue
        if (!toInputDate(p.letzteKons)) continue   // ohne Konsultation greift der Filter ohnehin
        targets.push(p)
      }
    }
    if (targets.length === 0) { toast.info('Alle aktiven Patienten haben bereits einen erfassten Konsultations-Arzt.'); return }
    const min = Math.max(1, Math.round(targets.length * 8 / 60))
    if (!window.confirm(
      `Arzt-Abgleich für ${targets.length} Patienten starten?\n\n` +
      `Liris blättert dafür automatisch durch die Akten (ca. ${min} Min.). ` +
      `Während des Abgleichs bitte nicht in Liris arbeiten. Der Lauf kann jederzeit gestoppt werden.\n\n` +
      `Zuteilung: Hängt ein Patient bei einem NICHT mehr aktiven Arzt und war ` +
      `zuletzt bei einem aktiven Arzt in Konsultation, wird er diesem automatisch ` +
      `zugeteilt. Zuteilungen an aktive Ärzte werden NIE verändert.`
    )) return
    arztScanAbort.current = false
    arztScanRunningRef.current = true
    openBrowser()
    const alleAerzte = new Set<string>(doctors)
    for (const tab of allData.keys()) {
      if (tab !== OFFEN_TAB && tab !== AUFGEBOT_TAB && tab !== ZU_BEARB) alleAerzte.add(tab)
    }
    let found = 0
    let umgeteilt = 0
    setArztScan({ running: true, done: 0, total: targets.length, current: '', found: 0, umgeteilt: 0 })
    for (let i = 0; i < targets.length; i++) {
      if (arztScanAbort.current) break
      const p = targets[i]
      const pid = normalizePid(p.pid)
      setArztScan(s => (s ? { ...s, done: i, current: `${p.vorname || ''} #${pid}` } : s))
      const autor = await new Promise<string | null>(resolve => {
        arztScanWaiter.current = { pid, resolve }
        openWithPid(pid)
        // Timeout: Akte laedt nicht / Extract kommt nicht -> Patient ueberspringen
        window.setTimeout(() => {
          if (arztScanWaiter.current?.pid === pid) { arztScanWaiter.current = null; resolve(null) }
        }, 15000)
      })
      if (autor) {
        const cleanedA = autor.replace(/^(?:Dr|Prof|med)\.?\s+/i, '').trim().toLowerCase()
        const matched = Array.from(alleAerzte).find(d => d && cleanedA.includes(d.toLowerCase()))
        if (matched) {
          found++
          try {
            await updateRecallPatient(p.id, { letzterKonsArzt: matched } as Partial<RecallPatient>, displayLabel)
            // Korrekt zuteilen — NUR wenn der bisher zugeteilte Arzt nicht
            // mehr aktiv ist UND die letzte Konsultation bei einem aktiven
            // Arzt war. Bewusste Zuteilungen an aktive Ärzte bleiben stehen.
            const zugeteilterAktiv = doctors.includes(p.doctor)
            const konsArztAktiv    = doctors.includes(matched)
            if (!zugeteilterAktiv && konsArztAktiv && matched !== p.doctor) {
              await assignRecallPatient(p.id, matched, displayLabel)
              umgeteilt++
            }
          } catch { /* weiter */ }
        }
      }
      setArztScan(s => (s ? { ...s, done: i + 1, found, umgeteilt } : s))
    }
    arztScanRunningRef.current = false
    setArztScan(s => (s ? { ...s, running: false, current: '' } : s))
    toast.success(`Arzt-Abgleich beendet: ${found} erfasst, ${umgeteilt} korrekt zugeteilt.`)
    await reloadAllTabs()
  }

  async function reloadAllTabs() {
    if (editTarget) { pendingReload.current = true; return }
    await loadAll()
  }

/** Aus einer Duplikat-Gruppe den Eintrag bestimmen der HEUTE erfasst wurde.
   *  Schutz für historische Duplikate (z.B. aus alten Excel-Imports) — die
   *  bleiben unberührt und müssen manuell entschieden werden. Wenn mehrere
   *  Einträge heute erfasst wurden, wird der zuletzt-erstellte gewählt
   *  (sollte aber nicht passieren bei sauberen Daten). */
  function pickTodaysDuplicate(entries: RecallPatient[]): RecallPatient | null {
    const today = new Date().toISOString().slice(0, 10)
    let best: RecallPatient | null = null
    let bestKey = ''
    for (const e of entries) {
      const ps = parseStamp(e.erstellt)
      if (!ps || ps.isoDate !== today) continue
      // Mehrere heute → den letzten/spätesten nehmen (dateStr-Vergleich
      // hat Sekunden-Genauigkeit über das ursprüngliche Format).
      const key = String(e.erstellt ?? '')
      if (key > bestKey) { bestKey = key; best = e }
    }
    return best
  }

  /** Bulk-Löschung: pro Duplikat-Gruppe den neuesten Eintrag entfernen.
   *  Doctor-Tabs werden danach neu geladen damit die UI aktuell ist. */
  async function handleDeleteNewestDuplicates(groups: Array<{ pid: string; entries: RecallPatient[] }>) {
    if (groups.length === 0) return
    setDupCleanupRunning(true)
    try {
      const affectedDoctors = new Set<string>()
      let deletedCount = 0
      for (const g of groups) {
        const victim = pickTodaysDuplicate(g.entries)
        if (!victim) continue
        await deleteRecallPatient(victim.id)
        affectedDoctors.add(victim.doctor)
        deletedCount++
      }
      await Promise.all([...affectedDoctors].map(d => reloadTab(d)))
      toast.success(`${deletedCount} heute hochgeladene Duplikat-PID${deletedCount === 1 ? '' : 's'} entfernt`)
      setShowDupCleanupConfirm(false)
    } catch (e) {
      toast.error(`Fehler beim Löschen: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setDupCleanupRunning(false)
    }
  }

  /** Letzte Excel-Einlesung rückgängig machen — löscht alle Patienten mit
   *  dem genau gleichen importedAt-Stamp wie die jüngste Import-Session.
   *  Erzeugt einen Toast mit Anzahl entfernter Einträge. */
  async function handleUndoLastImport() {
    if (!lastImport) return
    setUndoImportRunning(true)
    try {
      // Sequenzielle Deletes — Firestore-SDK macht intern Batching, aber
      // wir wollen pro Patient sehen ob's klappt (im Fehlerfall klar wo).
      for (const id of lastImport.ids) {
        await deleteRecallPatient(id)
      }
      await Promise.all(lastImport.doctors.map(d => reloadTab(d)))
      toast.success(`${lastImport.count} Patienten der letzten Einlesung (${lastImport.dateStr} von ${lastImport.user}) entfernt`)
      setShowUndoImportConfirm(false)
    } catch (e) {
      toast.error(`Fehler beim Rückgängig-Machen: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUndoImportRunning(false)
    }
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

      // 2a. FRESH-FETCH aller Tabs vor dem Dedup — garantiert dass keine
      //     veralteten lokalen Daten zu falschen "neue Patienten"-Imports
      //     führen. Wenn einzelne Tabs fehlschlagen: Abbruch mit Fehler,
      //     besser nichts importieren als gegen löchrige Liste vergleichen.
      setSyncMsg('Recall-Liste wird frisch geladen für Dedup-Check…')
      const allTabs = [ZU_BEARB, ...doctors]
      const settled = await Promise.allSettled(
        allTabs.map(d => getRecallPatients(d).then(r => [d, r] as const))
      )
      const failedTabs = settled
        .map((r, i) => r.status === 'rejected' ? allTabs[i] : null)
        .filter(Boolean) as string[]
      if (failedTabs.length > 0) {
        throw new Error(`Konnte ${failedTabs.length} Tab(s) nicht laden: ${failedTabs.join(', ')} — Import abgebrochen, bitte erneut versuchen`)
      }
      const freshData = new Map<string, RecallPatient[]>()
      for (const r of settled) {
        if (r.status === 'fulfilled') freshData.set(r.value[0], r.value[1])
      }
      // Lokalen State gleich aktualisieren — falls inzwischen jemand was geändert hat
      setAllData(freshData)

      // 2b. Build dedup-Set über ALLE Recall-Einträge (inkl. Zu bearbeiten).
      //    Signatur = pid | vornameLower | gebDatumISO. Eine Übereinstimmung
      //    in ALLEN drei Feldern gilt als Duplikat und wird übersprungen.
      //    Wenn ein Feld fehlt, wird darauf reduziert verglichen (pid only,
      //    bzw. vorname+gebDatum) — verhindert dass Datenlücken Duplikate
      //    durchschlüpfen lassen.
      // Normalisierung — Vorname kompakt+lowercased, PID nur Ziffern,
      // Geburtsdatum auf ISO YYYY-MM-DD egal ob ursprünglich DD.MM.YYYY,
      // YYYY-MM-DD[Trest] oder mit Whitespace.
      const normName = (s: string | null | undefined) =>
        (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ')
      const normPid = (s: string | null | undefined) => {
        const t = (s ?? '').toString().trim()
        if (!t) return ''
        const digits = t.replace(/\D+/g, '')
        return digits || t.toLowerCase()
      }
      const normGeb = (s: string | null | undefined): string => {
        const t = (s ?? '').toString().trim()
        if (!t) return ''
        // ISO yyyy-MM-dd…
        const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
        // DD.MM.YYYY oder D.M.YYYY
        const ch = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
        if (ch) return `${ch[3]}-${ch[2].padStart(2,'0')}-${ch[1].padStart(2,'0')}`
        // Excel-Serial
        if (/^\d+$/.test(t)) {
          const n = Number(t)
          if (n > 1 && n < 100_000) {
            const ms = Math.round((n - 25569) * 86400_000)
            const d  = new Date(ms)
            if (!isNaN(d.getTime())) {
              const yy = d.getUTCFullYear()
              const mm = String(d.getUTCMonth()+1).padStart(2,'0')
              const dd = String(d.getUTCDate()).padStart(2,'0')
              return `${yy}-${mm}-${dd}`
            }
          }
        }
        return t.toLowerCase()
      }
      const sigPid    = (pid: string | null, vn: string | null, gd: string | null) => {
        const p = normPid(pid); if (!p) return null
        return `p:${p}|v:${normName(vn)}|g:${normGeb(gd)}`
      }
      const sigPidOnly = (pid: string | null) => {
        const p = normPid(pid); return p ? `P:${p}` : null
      }
      const sigNoPid  = (vn: string | null, gd: string | null) => {
        const v = normName(vn), g = normGeb(gd)
        return v && g ? `v:${v}|g:${g}` : null
      }

      const existingSigs = new Set<string>()
      for (const pts of freshData.values()) {
        for (const p of pts) {
          const sP = sigPidOnly(p.pid);                     if (sP) existingSigs.add(sP)
          const s1 = sigPid(p.pid, p.vorname, p.gebDatum);  if (s1) existingSigs.add(s1)
          const s2 = sigNoPid(p.vorname, p.gebDatum);       if (s2) existingSigs.add(s2)
        }
      }

      // 3. Map Excel rows → RecallPatient shape, skip wenn Signatur bereits existiert
      let skippedCount = 0
      const toImport: Omit<RecallPatient, 'id' | 'doctor'>[] = []
      for (const r of rows) {
        const pid     = r['#'] ? String(r['#']).trim() : null
        const vorname = r['Vorname'] ? String(r['Vorname']).trim() : null

        let gebDatum: string | null = null
        const raw = r['Geburtsdatum']
        if (raw instanceof Date) {
          gebDatum = raw.toISOString().slice(0, 10)
        } else if (typeof raw === 'string' && raw.match(/\d{4}-\d{2}-\d{2}/)) {
          gebDatum = raw.slice(0, 10)
        }

        const sP = sigPidOnly(pid)
        const s1 = sigPid(pid, vorname, gebDatum)
        const s2 = sigNoPid(vorname, gebDatum)
        // Match-Strategie: PID alleine ist eindeutig → match.
        // Sonst Vorname+Geburtsdatum als Fallback.
        if ((sP && existingSigs.has(sP)) ||
            (s1 && existingSigs.has(s1)) ||
            (s2 && existingSigs.has(s2))) {
          skippedCount++
          continue
        }
        // Sofort registrieren — verhindert dass dieselbe Person doppelt
        // in der Excel-Liste beide Mal importiert wird.
        if (sP) existingSigs.add(sP)
        if (s1) existingSigs.add(s1)
        if (s2) existingSigs.add(s2)

        const verstorben = r['Verstorben'] === true || r['Verstorben'] === 'True'
        const inaktiv    = r['Inaktiv']    === true || r['Inaktiv']    === 'True'

        toImport.push({
          pid,
          vorname,
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

      console.log('[Recall-Import] Dedup-Stats:', {
        excelRows: rows.length,
        existingPatients: [...freshData.values()].reduce((n, arr) => n + arr.length, 0),
        existingSigCount: existingSigs.size,
        skipped: skippedCount,
        newToImport: toImport.length,
      })

      if (toImport.length === 0) {
        setSyncMsg(`Keine neuen Patienten — alle ${rows.length} sind bereits in der Recall-Liste vorhanden`)
        return
      }

      // 4. Write to Firestore with progress feedback
      setSyncMsg(`${toImport.length} neue Patienten werden geschrieben (${skippedCount} Duplikate übersprungen)…`)
      await importUnmatched(toImport, username)

      // 5. Verify by reading back from Firestore (source: server)
      setSyncMsg('Überprüfe Datenbank…')
      const fresh = await getRecallPatients(ZU_BEARB)

      if (fresh.length > 0) {
        // Firestore confirmed — use server data as source of truth
        setAllData(prev => new Map(prev).set(ZU_BEARB, fresh))
        setSyncMsg(`✓ ${toImport.length} neue Patienten gespeichert, ${skippedCount} Duplikate übersprungen`)
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
  // Popup mit der Patientenliste der «Sonstige»-Spalte (Auswertung pro Arzt)
  const [listePopup, setListePopup] = useState<{ titel: string; subtitel: string; list: { pid: string; name: string; grund: string; patient: RecallPatient }[] } | null>(null)
  // Ausgeschiedene / inaktive Ärzte in der «Übersicht pro Arzt» — standardmässig zugeklappt
  const [showInactiveDocs, setShowInactiveDocs] = useState(false)
  type ActPeriod = 'today' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'year' | 'lastYear' | 'all'
  const [actPeriod, setActPeriod] = useState<ActPeriod>('week')
  const [neuPeriod, setNeuPeriod] = useState<ActPeriod>('all')
  const [inaktivPeriod, setInaktivPeriod] = useState<ActPeriod>('all')
  // Zentrale Definition der Period-Buttons (Reihenfolge + Labels) — beide
  // Filter-Bars (Aktivität + Neupatienten) rendern aus dieser Liste.
  const PERIODS: Array<{ key: ActPeriod; label: string }> = [
    { key: 'today',     label: 'Heute' },
    { key: 'week',      label: 'Diese Woche' },
    { key: 'lastWeek',  label: 'Letzte Woche' },
    { key: 'month',     label: 'Dieser Monat' },
    { key: 'lastMonth', label: 'Letzter Monat' },
    { key: 'year',      label: 'Dieses Jahr' },
    { key: 'lastYear',  label: 'Letztes Jahr' },
    { key: 'all',       label: 'Alle' },
  ]

  const auswertungStats = useMemo(() => {
    const all: RecallPatient[] = []
    for (const pts of allData.values()) all.push(...pts)

    // ── Activity log ────────────────────────────────────────────────────────
    const now = new Date()

    // Periodengrenzen — konsistent mit den Neupatienten-Cards weiter unten
    // (Kalenderwoche Mo–Fr / Kalendermonat). Werden hier deklariert, damit
    // sowohl inPeriod() als auch der Neupatienten-Block sie nutzen können.
    const yearStartG  = new Date(now.getFullYear(), 0, 1)
    const monthStartG = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEndG   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    const dowG = now.getDay()                                       // 0=So, 1=Mo, ..., 6=Sa
    const offsetMoG = dowG === 0 ? -6 : 1 - dowG
    const weekStartG = new Date(now); weekStartG.setDate(now.getDate() + offsetMoG); weekStartG.setHours(0, 0, 0, 0)
    const weekEndG   = new Date(weekStartG); weekEndG.setDate(weekStartG.getDate() + 4); weekEndG.setHours(23, 59, 59, 999)
    // Letzte Woche: Mo–Fr der Vorwoche (weekStartG − 7 / weekEndG − 7, aber neu instanziieren)
    const lastWeekStartG = new Date(weekStartG); lastWeekStartG.setDate(weekStartG.getDate() - 7)
    const lastWeekEndG   = new Date(weekEndG);   lastWeekEndG.setDate(weekEndG.getDate() - 7)
    // Letzter Monat: vorheriger Kalendermonat
    const lastMonthStartG = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEndG   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
    // Dieses Jahr: 1.1. — 31.12. des aktuellen Jahres
    const yearEndG        = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
    // Letztes Jahr: 1.1. — 31.12. des Vorjahres
    const lastYearStartG  = new Date(now.getFullYear() - 1, 0, 1)
    const lastYearEndG    = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999)

    function matchPeriod(d: Date, period: ActPeriod): boolean {
      if (period === 'today')     return d.toDateString() === now.toDateString()
      if (period === 'week')      return d >= weekStartG      && d <= weekEndG
      if (period === 'lastWeek')  return d >= lastWeekStartG  && d <= lastWeekEndG
      if (period === 'month')     return d >= monthStartG     && d <= monthEndG
      if (period === 'lastMonth') return d >= lastMonthStartG && d <= lastMonthEndG
      if (period === 'year')      return d >= yearStartG      && d <= yearEndG
      if (period === 'lastYear')  return d >= lastYearStartG  && d <= lastYearEndG
      return true   // 'all'
    }
    function inPeriod(iso: string): boolean {
      return matchPeriod(new Date(iso), actPeriod)
    }
    // Aufgebot-Aufschlüsselung aus verlauf: aktion → Art-Bucket.
    // System-generierte Reminder (von === 'System') zählen NICHT — die kommen
    // aus Auto-Logik, nicht aus User-Aktion.
    type AufgebotBucket = 'Brief' | 'Tel' | 'Praxis' | 'Reminder' | 'TelCall' | 'Email'
    const VERLAUF_TO_ART: Record<string, AufgebotBucket> = {
      Briefaufgebot:    'Brief',
      Telefonaufgebot:  'Tel',
      Praxisaufgebot:   'Praxis',
      Reminder:         'Reminder',
      Telefonanruf:     'TelCall',
      'E-Mail':         'Email',
    }
    function emptyAufgebote() {
      return { Brief: 0, Tel: 0, Praxis: 0, Reminder: 0, TelCall: 0, Email: 0 }
    }

    type UA = { updated: number; created: number; displayName: string; aufgebote: ReturnType<typeof emptyAufgebote> }
    const actMap: Record<string, Record<string, UA>> = {}
    function ensureCell(isoDate: string, userKey: string, displayName: string): UA {
      if (!actMap[isoDate]) actMap[isoDate] = {}
      if (!actMap[isoDate][userKey]) actMap[isoDate][userKey] = { updated: 0, created: 0, displayName, aufgebote: emptyAufgebote() }
      return actMap[isoDate][userKey]
    }
    function tally(isoDate: string, user: string, field: 'created' | 'updated') {
      if (!inPeriod(isoDate)) return
      ensureCell(isoDate, user.trim().toLowerCase(), user.trim())[field]++
    }
    for (const p of all) {
      const ce = parseStamp(p.erstellt)
      if (ce) tally(ce.isoDate, ce.user, 'created')

      // "Bearbeitet" = Anzahl distinct Patienten, die ein User an einem Tag
      // berührt hat. Quellen:
      //   1. verlauf-Entries (append-only, behalten jeden User-Eintrag,
      //      auch wenn später jemand anderes editiert — kein last-write-wins)
      //   2. aktualisiert-Stamp (Fallback für Edits ohne verlauf-Entry,
      //      z.B. simple Inline-Toggles wie naechsteKons-Setzen)
      // Set<`${date}|${userKey}`> verhindert Doppel-Counts wenn dieselbe
      // Person mehrere verlauf-Entries am selben Tag auf demselben Patient
      // hatte (z.B. Aufgebot erstellen + zusätzliche Notiz).
      // Map<`${date}\x00${userKey}`, displayName> — \x00 als Separator vermeidet
      // Kollision mit irgendwelchen Zeichen in Usernamen.
      const touches = new Map<string, string>()
      for (const v of (p.verlauf ?? [])) {
        if (!v?.datum || !v?.von || v.von === 'System') continue
        const name = v.von.trim()
        touches.set(`${v.datum}\x00${name.toLowerCase()}`, name)
      }
      const cu = parseStamp(p.aktualisiert)
      if (cu) touches.set(`${cu.isoDate}\x00${cu.user.trim().toLowerCase()}`, cu.user.trim())

      for (const [k, displayName] of touches) {
        const sep = k.indexOf('\x00')
        const isoDate = k.slice(0, sep)
        const userKey = k.slice(sep + 1)
        // Same-day-Creator nicht doppelt zählen (erscheint schon in 'created')
        if (ce && ce.isoDate === isoDate && ce.user.trim().toLowerCase() === userKey) continue
        if (!inPeriod(isoDate)) continue
        ensureCell(isoDate, userKey, displayName).updated++
      }
      // (Aufgebot-Tally läuft im nächsten Block unverändert weiter)

      // Aufgebote aus verlauf-Entries des Patienten.
      //
      // 'Reminder' ist mehrdeutig — es gibt im Code drei Producer-Typen:
      //   1. Echtes Reminder-Aufgebot (aufgebotConfirm-Modal + Inline-Toggle):
      //      ergebnis = 'Erstellt' | 'Via {versand}' | 'Inline erfasst'
      //   2. Geplante Erinnerung (handleInlineVerlauf + 'Reminder geplant'-Btn):
      //      ergebnis = 'Geplant: <ISO-Datum>'
      //   3. Stornierung einer geplanten Erinnerung (Edit-Modal terminFixiert):
      //      ergebnis startswith 'Abgesagt'
      //   4. System-Auto-Reminder (autoSecondReminder):
      //      von === 'System'
      // Nur (1) ist ein echtes Aufgebot — die anderen müssen wir herausfiltern.
      for (const v of (p.verlauf ?? [])) {
        if (!v?.aktion || !v?.datum || !v?.von) continue
        const bucket = VERLAUF_TO_ART[v.aktion]
        if (!bucket) continue
        if (bucket === 'Reminder') {
          if (v.von === 'System') continue
          const erg = (v.ergebnis ?? '').trim()
          if (erg.startsWith('Geplant:')) continue
          if (erg.startsWith('Abgesagt')) continue
          if (erg.startsWith('Automatisch')) continue
        }
        if (!inPeriod(v.datum)) continue
        const userName = v.von.trim()
        const userKey = userName.toLowerCase()
        ensureCell(v.datum, userKey, userName).aufgebote[bucket]++
      }

      // FALLBACK für Aufgebote ohne Verlauf-Entry:
      // - Alte Inline-Toggle-Klicks (vor der Auto-Verlauf-Logik)
      // - Edit-Modal-Saves (vor der Auto-Verlauf-Logik)
      // - User-Browser mit gecachtem alten Code, der noch nicht refresht hat
      // Wir leiten den Ersteller aus dem aktualisiert-Stamp ab — heuristisch
      // (kann falschen User zuweisen wenn der Patient nach der Aufgebot-Erstellung
      // nochmal editiert wurde), aber besser als gar nichts. Skip wenn für
      // dasselbe (date, user, bucket) bereits ein Verlauf-Entry existiert.
      if (p.aufgebotErstellt && p.aufgebotArt) {
        const fallbackBucket: AufgebotBucket | null =
          p.aufgebotArt === 'Brief'    ? 'Brief'    :
          p.aufgebotArt === 'Tel'      ? 'Tel'      :
          p.aufgebotArt === 'Praxis'   ? 'Praxis'   :
          p.aufgebotArt === 'Reminder' ? 'Reminder' : null
        const cu = parseStamp(p.aktualisiert)
        // Nur wenn aufgebotErstellt mit aktualisiert-Datum übereinstimmt (= dieser
        // Edit war vermutlich die Aufgebot-Erstellung), sonst hat danach jemand
        // anderes editiert und wir würden ihm das Aufgebot fälschlich zuschreiben.
        if (fallbackBucket && cu && cu.isoDate === p.aufgebotErstellt && inPeriod(p.aufgebotErstellt)) {
          const fbUserName = cu.user.trim()
          const fbUserKey  = fbUserName.toLowerCase()
          const alreadyInVerlauf = (p.verlauf ?? []).some(v => {
            if (!v?.aktion || !v?.datum || !v?.von) return false
            if (VERLAUF_TO_ART[v.aktion] !== fallbackBucket) return false
            if (v.datum !== p.aufgebotErstellt) return false
            if (v.von.trim().toLowerCase() !== fbUserKey) return false
            // gleiche Reminder-Blacklist wie oben (sonst zählt geplanter Reminder mit)
            if (fallbackBucket === 'Reminder') {
              const erg = (v.ergebnis ?? '').trim()
              if (v.von === 'System') return false
              if (erg.startsWith('Geplant:') || erg.startsWith('Abgesagt') || erg.startsWith('Automatisch')) return false
            }
            return true
          })
          if (!alreadyInVerlauf) {
            ensureCell(p.aufgebotErstellt, fbUserKey, fbUserName).aufgebote[fallbackBucket]++
          }
        }
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

    // Totals der Aufgebote über alle actRows (= bereits period-gefiltert via
    // inPeriod). Wird in der UI als Summary-Cards über der Aktivitäts-Tabelle
    // angezeigt — analog zu Neupatienten/Inaktive-Cards.
    const actAufgebotTotals = actRows.reduce(
      (acc, r) => {
        acc.Brief    += r.aufgebote.Brief
        acc.Tel      += r.aufgebote.Tel
        acc.Praxis   += r.aufgebote.Praxis
        acc.Reminder += r.aufgebote.Reminder
        acc.TelCall  += r.aufgebote.TelCall
        acc.Email    += r.aufgebote.Email
        return acc
      },
      { Brief: 0, Tel: 0, Praxis: 0, Reminder: 0, TelCall: 0, Email: 0 }
    )

    // Gruppierte Variante: pro User die Summen über den gewählten Zeitraum.
    // Wird in der UI bei jeder Filterung außer 'all' statt der per-Tag-Liste
    // angezeigt — kompakter und besser für "wer hat im Monat wie viel gemacht".
    const actGroupedMap = new Map<string, { user: string; created: number; updated: number; aufgebote: ReturnType<typeof emptyAufgebote>; days: number }>()
    const actDaysSeen = new Map<string, Set<string>>()
    for (const r of actRows) {
      const k = r.user.trim().toLowerCase()
      if (!actGroupedMap.has(k)) { actGroupedMap.set(k, { user: r.user, created: 0, updated: 0, aufgebote: emptyAufgebote(), days: 0 }); actDaysSeen.set(k, new Set()) }
      const e = actGroupedMap.get(k)!
      e.created += r.created
      e.updated += r.updated
      for (const b of ['Brief','Tel','Praxis','Reminder','TelCall','Email'] as const) e.aufgebote[b] += r.aufgebote[b]
      actDaysSeen.get(k)!.add(r.iso)
    }
    for (const [k, days] of actDaysSeen) actGroupedMap.get(k)!.days = days.size
    const actRowsGrouped = [...actGroupedMap.values()]
      .sort((a, b) => (b.created + b.updated) - (a.created + a.updated))   // aktivste oben

    // ── Neupatienten ────────────────────────────────────────────────────────
    // Periodengrenzen entsprechen den Card-Labels — Kalenderwoche Mo–Fr
    // (Praxis arbeitet Mo–Fr) / Kalendermonat / Kalenderjahr. Die Grenzen
    // sind oben als *G-Vars deklariert (geteilt mit inPeriod() für Activity).
    const neuAll = all.filter(p => p.neupatient === true)
    function neupDate(p: RecallPatient): Date | null {
      const ps = parseStamp(p.erstellt); return ps ? new Date(ps.isoDate) : null
    }
    const neupatienten = {
      week:      neuAll.filter(p => { const d = neupDate(p); return d && d >= weekStartG      && d <= weekEndG      }).length,
      lastWeek:  neuAll.filter(p => { const d = neupDate(p); return d && d >= lastWeekStartG  && d <= lastWeekEndG  }).length,
      month:     neuAll.filter(p => { const d = neupDate(p); return d && d >= monthStartG     && d <= monthEndG     }).length,
      lastMonth: neuAll.filter(p => { const d = neupDate(p); return d && d >= lastMonthStartG && d <= lastMonthEndG }).length,
      year:      neuAll.filter(p => { const d = neupDate(p); return d && d >= yearStartG      && d <= yearEndG      }).length,
      lastYear:  neuAll.filter(p => { const d = neupDate(p); return d && d >= lastYearStartG  && d <= lastYearEndG  }).length,
      total:     neuAll.length,
      // Kumulativer Stand am Jahres-Ende: alle Neupatienten, die VOR dem
      // Beginn des aktuellen Jahres erfasst wurden — "wie viele hatten wir
      // bis Ende letztes Jahr insgesamt".
      totalEndLastYear: neuAll.filter(p => { const d = neupDate(p); return d && d < yearStartG }).length,
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
    const neupatientRowsAll = Object.entries(neuHistMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .flatMap(([iso, users]) =>
        Object.entries(users).map(([, { count, names, displayName }]) => ({
          dateStr: iso.split('-').reverse().join('.'), isoDate: iso, user: displayName, count, names,
        }))
      )

    // Period-Filter analog zu inPeriod() (Activity). Nutzt dieselben *G-Vars
    // via gemeinsamen matchPeriod()-Helper — identische Semantik garantiert.
    const neupatientRows = neupatientRowsAll.filter(r => matchPeriod(new Date(r.isoDate), neuPeriod))

    // Gruppierte Variante nach User über den gewählten Zeitraum (siehe actRowsGrouped).
    const neuGroupedMap = new Map<string, { user: string; count: number; names: string[]; days: Set<string> }>()
    for (const r of neupatientRows) {
      const k = r.user.trim().toLowerCase()
      if (!neuGroupedMap.has(k)) neuGroupedMap.set(k, { user: r.user, count: 0, names: [], days: new Set() })
      const e = neuGroupedMap.get(k)!
      e.count += r.count
      e.names.push(...r.names)
      e.days.add(r.isoDate)
    }
    const neupatientRowsGrouped = [...neuGroupedMap.values()]
      .map(e => ({ user: e.user, count: e.count, names: e.names, days: e.days.size }))
      .sort((a, b) => b.count - a.count)

    // ── Per-doctor stats ────────────────────────────────────────────────────
    // Jeder Patient wird GENAU EINER Kategorie zugeordnet (Priorität von oben),
    // damit die Spalten exakt die Gesamtzahl ergeben. «Neupatient» ist eine
    // Querschnitts-Markierung (kann in jeder Kategorie sein) → separat als «davon neu».
    const classifyPatient = (p: RecallPatient): 'mitTermin' | 'imRecall' | 'ohneRecall' | 'keinAufgebot' | 'wartetBericht' | 'sonstige' | 'inaktiv' | 'storniert' => {
      if (p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben') return 'inaktiv'
      if (isStorniert(p)) return 'storniert'
      if (p.naechsteKons && p.naechsteKons !== 'kein Termin' && isFutureDate(p.naechsteKons)) return 'mitTermin'
      if (isInPlanung(p)) return 'imRecall'
      if (p.patientenStatus === 'kein Aufgebot') return 'keinAufgebot'
      if (isAwaitingZuweisungsBericht(p)) return 'wartetBericht'
      if (isOhneTermin(p)) return 'ohneRecall'
      return 'sonstige'
    }
    const buildDocStatFromPts = (label: string, pts: RecallPatient[]) => {
      const c = { mitTermin: 0, imRecall: 0, ohneRecall: 0, keinAufgebot: 0, wartetBericht: 0, sonstige: 0, inaktiv: 0, storniert: 0 }
      const sonstigeList: { pid: string; name: string; grund: string; patient: RecallPatient }[] = []
      for (const p of pts) {
        const cat = classifyPatient(p)
        c[cat]++
        if (cat === 'sonstige') {
          // Grund-Heuristik: warum fällt der Patient in keine Kategorie?
          let grund = 'unklar'
          if (p.naechsteKons && p.naechsteKons !== 'kein Termin' && !isFutureDate(p.naechsteKons)) grund = 'Termin in Vergangenheit'
          else if (p.aufgebotArt && p.aufgebotArt !== '') grund = 'Aufgebot ohne neuen Termin'
          else if (!p.naechsteKons || p.naechsteKons === 'kein Termin') grund = 'kein nächster Termin gesetzt'
          sonstigeList.push({
            pid: normalizePid(p.pid ?? ''),
            name: titleCaseName((p.vorname ?? '').trim()) || '(ohne Name)',
            grund,
            patient: p,
          })
        }
      }
      sonstigeList.sort((a, b) => a.name.localeCompare(b.name, 'de'))
      return {
        name:       label,
        total:      pts.length,
        ...c,
        sonstigeList,
        neupatient: pts.filter(p => p.neupatient === true).length,
      }
    }
    const buildDocStat = (doc: string, label?: string) => buildDocStatFromPts(label ?? doc, allData.get(doc) ?? [])
    const docStats = [...doctors, ZU_BEARB].map(doc => buildDocStat(doc)).filter(d => d.total > 0)
    // Ausgeschiedene / inaktive Ärzte (Sammel-Bucket «offen») — pro ehemaligem Arzt
    // gruppiert (p.doctor trägt den ursprünglichen Arzt; «offen» = Ohne Zuordnung).
    const offenPts = allData.get(OFFEN_TAB) ?? []
    const offenByDoc = new Map<string, RecallPatient[]>()
    for (const p of offenPts) {
      const key = p.doctor && p.doctor !== OFFEN_TAB ? p.doctor : '__none__'
      const arr = offenByDoc.get(key); if (arr) arr.push(p); else offenByDoc.set(key, [p])
    }
    const inactiveDocStats = [...offenByDoc.entries()]
      .map(([key, pts]) => buildDocStatFromPts(key === '__none__' ? 'Ohne Zuordnung' : doctorFullName(key), pts))
      .filter(d => d.total > 0)
      .sort((a, b) => (a.name === 'Ohne Zuordnung' ? 1 : b.name === 'Ohne Zuordnung' ? -1 : b.total - a.total))
    const inactiveDocTotal = inactiveDocStats.reduce((s, d) => s + d.total, 0)

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
      overdue:   activeAll.filter(isOverdue).length,
      inPlanung: activeAll.filter(isInPlanung).length,
      ohneTermin:activeAll.filter(isOhneTermin).length,
      ohneRC:    activeAll.filter(isOhneRC).length,
      nachfass:  activeAll.filter(p => isNachfassFaellig(p)).length,
      // Status-basierte Unter-Kategorien (warum "ohne Termin"):
      statusReminder:     activeAll.filter(p => p.patientenStatus === 'Reminder').length,
      statusKeinAufgebot: activeAll.filter(p => p.patientenStatus === 'kein Aufgebot').length,
      wartetBericht:      activeAll.filter(isAwaitingZuweisungsBericht).length,
    }

    // ── Inaktive / verstorbene Patienten ────────────────────────────────────
    // Zeigt "wer hat wen deaktiviert" mit feinem Grund-basiertem Status.
    // Erfasst auch Alt-Daten, bei denen nur grundStornierung gesetzt ist
    // ohne automatischen patientenStatus-Sync. "Deaktiviert von" basiert
    // auf aktualisiert-Stamp (Limitation — siehe Hinweis in UI).
    type InaktivKind = 'verstorben' | 'arztwechsel' | 'wegzug' | 'inaktiv'
    function classifyInaktiv(p: RecallPatient): InaktivKind | null {
      const g = (p.grundStornierung ?? '').trim().toLowerCase()
      if (p.patientenStatus === 'verstorben' || g === 'verstorben') return 'verstorben'
      if (g === 'arztwechsel') return 'arztwechsel'
      if (g === 'wegzug')      return 'wegzug'
      if (p.patientenStatus === 'inaktiv') return 'inaktiv'
      return null
    }
    const inaktiveRowsAll = all
      .map(p => ({ p, kind: classifyInaktiv(p) }))
      .filter((x): x is { p: RecallPatient; kind: InaktivKind } => x.kind !== null)
      .map(({ p, kind }) => {
        const ps = parseStamp(p.aktualisiert)
        return {
          id:        p.id,
          pid:       p.pid,
          vorname:   p.vorname ?? '',
          doctor:    p.doctor,
          // Ist der zugeordnete Arzt noch aktiv? (für Arztwechsel-Unterscheidung)
          doctorActive: !!p.doctor && doctors.includes(p.doctor),
          kind,                                                              // präziser als nur 'inaktiv'/'verstorben'
          grund:     (p.grundStornierung ?? '').trim(),
          by:        ps?.user.trim() ?? '',
          isoDate:   ps?.isoDate ?? '',
          dateStr:   ps?.isoDate ? ps.isoDate.split('-').reverse().join('.') : '',
        }
      })
      .sort((a, b) => b.isoDate.localeCompare(a.isoDate))
    // Period-Filter analog zu Activity/Neupatienten. Rows ohne isoDate
    // (kein aktualisiert-Stamp) werden in Vergangenheits-Filtern ausgeblendet,
    // bleiben aber bei 'Alle' sichtbar.
    const inaktiveRows = inaktivPeriod === 'all'
      ? inaktiveRowsAll
      : inaktiveRowsAll.filter(r => r.isoDate && matchPeriod(new Date(r.isoDate), inaktivPeriod))

    // Counts pro Grund-Kategorie für die Summary-Cards (filterbasiert).
    const inaktivCounts = {
      verstorben:  inaktiveRows.filter(r => r.kind === 'verstorben').length,
      arztwechsel: inaktiveRows.filter(r => r.kind === 'arztwechsel').length,
      wegzug:      inaktiveRows.filter(r => r.kind === 'wegzug').length,
      inaktiv:     inaktiveRows.filter(r => r.kind === 'inaktiv').length,
    }

    // ── Doppelte PIDs ───────────────────────────────────────────────────────
    // Gruppiert alle Patienten nach normalisierter PID; gibt nur Gruppen
    // zurück die mehr als einen Eintrag haben. Pro Gruppe sortiert nach
    // doctor + vorname (deterministisch). Leere/missing PIDs werden ignoriert.
    const duplicatesByPid = new Map<string, RecallPatient[]>()
    for (const p of all) {
      const k = normalizePid(p.pid)
      if (!k) continue
      const list = duplicatesByPid.get(k) ?? []
      list.push(p)
      duplicatesByPid.set(k, list)
    }
    const duplicatePidGroups: Array<{ pid: string; entries: RecallPatient[] }> = []
    for (const [pid, entries] of duplicatesByPid) {
      if (entries.length > 1) {
        entries.sort((a, b) => (a.doctor + a.vorname).localeCompare(b.doctor + b.vorname, 'de'))
        duplicatePidGroups.push({ pid, entries })
      }
    }
    duplicatePidGroups.sort((a, b) => b.entries.length - a.entries.length || a.pid.localeCompare(b.pid))

    // ── (GL/Arzt/Admin) 1) Recall-Effektivität: Conversion aufgeboten → Termin ──
    // Von den aufgebotenen Patienten (aufgebotErstellt + aufgebotArt gesetzt):
    // wie viele haben einen echten nächsten Termin? Gesamt + pro Kanal.
    const hasRealTermin = (p: RecallPatient) => !!p.naechsteKons && p.naechsteKons !== 'kein Termin'
    const recall = {
      gesamt: { auf: 0, termin: 0 },
      Brief:  { auf: 0, termin: 0 },
      Tel:    { auf: 0, termin: 0 },
      Praxis: { auf: 0, termin: 0 },
    } as Record<'gesamt' | 'Brief' | 'Tel' | 'Praxis', { auf: number; termin: number }>
    for (const p of activeAll) {
      if (!p.aufgebotErstellt || !p.aufgebotArt) continue
      recall.gesamt.auf++
      if (hasRealTermin(p)) recall.gesamt.termin++
      const ch = (p.aufgebotArt === 'Brief' || p.aufgebotArt === 'Tel' || p.aufgebotArt === 'Praxis') ? p.aufgebotArt : null
      if (ch) { recall[ch].auf++; if (hasRealTermin(p)) recall[ch].termin++ }
    }

    // ── (GL/Arzt/Admin) 2) RC-Last: offene Recalls nach Fälligkeit ──────────────
    // Patienten mit «RC zu erstellen ab», aber noch kein Aufgebot erstellt.
    const todayIsoG = now.toISOString().slice(0, 10)
    const addWeeksIso = (weeks: number) => { const d = new Date(now); d.setDate(now.getDate() + weeks * 7); return d.toISOString().slice(0, 10) }
    const w4 = addWeeksIso(4), w8 = addWeeksIso(8), w12 = addWeeksIso(12)
    const rcLast = { ueberfaellig: 0, w0_4: 0, w4_8: 0, w8_12: 0, spaeter: 0 }
    for (const p of activeAll) {
      if (!p.aufgebotFuer || p.aufgebotErstellt) continue
      const d = s(p.aufgebotFuer).slice(0, 10)
      if (!d) continue
      if      (d <  todayIsoG) rcLast.ueberfaellig++
      else if (d <= w4)        rcLast.w0_4++
      else if (d <= w8)        rcLast.w4_8++
      else if (d <= w12)       rcLast.w8_12++
      else                     rcLast.spaeter++
    }

    // ── (GL/Arzt/Admin) 3) Altersverteilung (aus Geburtsjahr) ───────────────────
    const ageBuckets = { '0-17': 0, '18-39': 0, '40-59': 0, '60-74': 0, '75+': 0, unbekannt: 0 } as Record<string, number>
    for (const p of activeAll) {
      const by = parseInt(s(p.gebDatum).slice(0, 4), 10)
      if (!by || by < 1900 || by > now.getFullYear()) { ageBuckets.unbekannt++; continue }
      const age = now.getFullYear() - by
      if      (age < 18) ageBuckets['0-17']++
      else if (age < 40) ageBuckets['18-39']++
      else if (age < 60) ageBuckets['40-59']++
      else if (age < 75) ageBuckets['60-74']++
      else               ageBuckets['75+']++
    }

    // ── Sicherheitsnetz: Risikogruppen, in denen Patienten durchrutschen ──────
    // Jede Liste ist anklickbar (Popup → Patient bearbeiten).
    const wochenAgoIso = (n: number) => { const d = new Date(now); d.setDate(now.getDate() - n * 7); return d.toISOString().slice(0, 10) }
    const w8ago = wochenAgoIso(8), w26ago = wochenAgoIso(26)
    const toRisk = (p: RecallPatient, grund: string) => ({
      pid: normalizePid(p.pid ?? ''),
      name: titleCaseName((p.vorname ?? '').trim()) || '(ohne Name)',
      doctor: p.doctor,
      grund,
      patient: p,
    })
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'de')

    // 1) Zuweisung überfällig: Abschlussbericht seit > 8 Wochen ausstehend.
    //    Pro offener, überfälliger Zuweisung ein Eintrag (Patient kann mehrfach).
    const riskZuweisung = activeAll
      .flatMap(p => patientZuweisungen(p)
        .filter(z => (z.status === 'pendent' || (z.status === 'erledigt' && !z.berichtErhalten)) && (z.datum || '') !== '' && (z.datum || '') <= w8ago)
        .map(z => {
          const wochen = Math.floor((now.getTime() - new Date(z.datum + 'T00:00:00Z').getTime()) / (7 * 864e5))
          return toRisk(p, `${z.ziel || 'Zuweisung'}: Bericht ausstehend seit ${wochen} Wochen`)
        }))
      .sort(byName)

    // 3) Reminder ohne Reaktion: Reminder im aktuellen Zyklus, kein Termin
    //    gebucht, 8–26 Wochen her (schliesst das 6-Monats-Blindfenster).
    const riskReminder = activeAll
      .filter(p => p.aufgebotArt === 'Reminder' && p.aufgebotErstellt
        && !hasRealTermin(p)
        && p.aufgebotErstellt >= (p.letzteKons || '')
        && p.aufgebotErstellt <= w8ago && p.aufgebotErstellt >= w26ago)
      .map(p => toRisk(p, `Reminder vom ${formatDate(p.aufgebotErstellt)} – keine Reaktion`))
      .sort(byName)

    // 4) Adresse veraltet / Brief retour — über ALLE (auch stornierte, da
    //    «Brief ungeöffnet retourniert» den Patienten storniert), ohne Verstorbene.
    const riskAdresse = all
      .filter(p => p.patientenStatus !== 'verstorben'
        && (p.nachfassAdresse === 'veraltet' || (p.grundStornierung || '').toLowerCase().includes('retourniert')))
      .map(p => toRisk(p, p.nachfassAdresse === 'veraltet' ? 'Adresse veraltet' : 'Brief retour'))
      .sort(byName)

    // 5) Kürzlich deaktiviert (Fehlklick-Audit): in den letzten 30 Tagen auf
    //    inaktiv / kein Aufgebot / storniert gesetzt — zur Kontrolle.
    const day30 = new Date(now); day30.setDate(now.getDate() - 30)
    const day30Iso = day30.toISOString().slice(0, 10)
    const riskDeaktiviert = all
      .filter(p => {
        const deaktiviert = p.patientenStatus === 'inaktiv' || p.patientenStatus === 'kein Aufgebot' || isStorniert(p)
        if (!deaktiviert || p.patientenStatus === 'verstorben') return false
        const ps = parseStamp(p.aktualisiert)
        return !!ps?.isoDate && ps.isoDate >= day30Iso
      })
      .map(p => {
        const ps = parseStamp(p.aktualisiert)
        const grund = p.patientenStatus === 'kein Aufgebot' ? 'kein Aufgebot'
          : p.patientenStatus === 'inaktiv' ? 'inaktiv'
          : (p.grundStornierung || 'storniert')
        return toRisk(p, `${grund}${ps ? ` · ${ps.dateStr}${ps.user ? ' · ' + ps.user.split(' ')[0] : ''}` : ''}`)
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))

    // 6) Ausgeschiedene Ärzte: aktive Patienten im «offen»-Bucket, die einen
    //    Recall bräuchten (überfällig oder ohne Recall) — haben keinen
    //    aktiven Verantwortlichen → müssen neu zugewiesen werden.
    const riskAusgeschieden = (allData.get(OFFEN_TAB) ?? [])
      .filter(p => p.patientenStatus !== 'inaktiv' && p.patientenStatus !== 'verstorben' && !isStorniert(p)
        && (isOverdue(p) || isOhneTermin(p)))
      .map(p => toRisk(p, `${p.doctor && p.doctor !== OFFEN_TAB ? p.doctor + ' · ' : ''}${isOverdue(p) ? 'überfällig' : 'ohne Recall'}`))
      .sort(byName)

    return { actRows, actRowsGrouped, actAufgebotTotals, docStats, inactiveDocStats, inactiveDocTotal, aufgebot, aufgebotMax, upcoming, neupatienten, neupatientRows, neupatientRowsGrouped, inaktiveRows, inaktivCounts, duplicatePidGroups, total: all.length, recall, rcLast, ageBuckets, riskZuweisung, riskReminder, riskAdresse, riskDeaktiviert, riskAusgeschieden }
  }, [allData, actPeriod, neuPeriod, inaktivPeriod, doctors]) // eslint-disable-line react-hooks/exhaustive-deps

  // Letzte Excel-Einlesung — gruppiert Patienten nach importedAt-Stamp,
  // findet den jüngsten (= chronologisch letzte Import-Session) + alle
  // Doc-IDs die zu dieser Session gehören. Eine Import-Session ist eindeutig
  // durch ihren Sekunden-/Minuten-genauen Timestamp identifizierbar
  // (siehe recallTimestamp() in firestoreRecall.ts).
  const lastImport = useMemo(() => {
    const sessions = new Map<string, { isoKey: string; ids: string[]; doctors: Set<string>; sample: RecallPatient }>()
    for (const pts of allData.values()) {
      for (const p of pts) {
        const stamp = (p as any).importedAt as string | undefined
        if (!stamp) continue
        const parsed = parseStamp(stamp)
        if (!parsed) continue
        const isoKey = `${parsed.isoDate} ${stamp}` // primarer sort-key + fallback auf raw-string
        if (!sessions.has(stamp)) sessions.set(stamp, { isoKey, ids: [], doctors: new Set(), sample: p })
        const s = sessions.get(stamp)!
        s.ids.push(p.id)
        s.doctors.add(p.doctor)
      }
    }
    if (sessions.size === 0) return null
    // Sortieren nach isoKey desc — jüngste Session zuerst
    const arr = [...sessions.entries()].sort((a, b) => b[1].isoKey.localeCompare(a[1].isoKey))
    const [stamp, info] = arr[0]
    return {
      stamp,
      isoDate: parseStamp(stamp)?.isoDate ?? '',
      dateStr: parseStamp(stamp)?.dateStr ?? '',
      user:    parseStamp(stamp)?.user ?? '',
      count:   info.ids.length,
      ids:     info.ids,
      doctors: [...info.doctors],
    }
  }, [allData])

  // Suche per Escape leeren
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSearch('')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── Tab helpers ──────────────────────────────────────────────────────────────
  function switchTab(doctor: string) {
    setActiveTab(doctor); setPage(1); setFilterTermin(null); setFilterNeupatient(false); setFilterStatus(null); setFilterAufgebotArt(null); setFilterNochZuErledigen(false); setFilterReminderFaellig(false); setFilterVerlaufAktion(null); setFilterInaktivArzt(null)
    // Aufgebot-Plan Tab: oeffnet das eingebettete Aufgebot-Panel; sonst zu
    setWochenplanOpen(doctor === AUFGEBOT_TAB)
    if (doctor === AUFGEBOT_TAB) setWochenplanWeekOffset(0)
  }

  const inaktiveAerzte = useMemo(() => {
    if (activeTab !== OFFEN_TAB) return [] as { nachname: string; doctors: string[] }[]
    const allDocs = new Set<string>()
    for (const [tab, list] of allData) {
      if (tab === OFFEN_TAB || tab === AUFGEBOT_TAB) continue
      if (doctors.includes(tab)) continue
      for (const p of list) {
        if (p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben') allDocs.add(p.doctor)
      }
    }
    const offenList = allData.get(OFFEN_TAB) ?? []
    for (const p of offenList) {
      if (p.doctor !== OFFEN_TAB && !doctors.includes(p.doctor)) allDocs.add(p.doctor)
    }
    const byNachname = new Map<string, string[]>()
    for (const d of allDocs) {
      const cleaned = d.replace(/^(?:Dr|Prof|med)\.?\s+/gi, '').trim()
      const words = cleaned.split(/\s+/)
      const nachname = words[words.length - 1] || d
      if (!byNachname.has(nachname)) byNachname.set(nachname, [])
      byNachname.get(nachname)!.push(d)
    }
    const result = [...byNachname.entries()]
      .map(([nachname, docs]) => ({ nachname, doctors: docs }))
      .sort((a, b) => a.nachname.localeCompare(b.nachname, 'de'))
    const hasOffen = offenList.some(p => p.doctor === OFFEN_TAB)
    if (hasOffen) result.push({ nachname: 'Ohne Zuordnung', doctors: [OFFEN_TAB] })
    return result
  }, [allData, activeTab, doctors])

  const rows = useMemo(() => {
    // When searching (≥2 chars), show cross-doctor results in the table
    if (search.trim().length >= 2) return searchResults

    let base = allData.get(activeTab) ?? []
    // 'Keinem Arzt zugewiesen': zusaetzlich alle Verstorbenen aus allen
    // anderen Buckets hier einblenden (verschoben zur Sammelansicht).
    if (activeTab === OFFEN_TAB) {
      const seen = new Set(base.map(p => p.id))
      const extra: RecallPatient[] = []
      for (const [tab, list] of allData) {
        if (tab === OFFEN_TAB || tab === AUFGEBOT_TAB) continue
        for (const p of list) {
          if ((p.patientenStatus === 'verstorben' || p.patientenStatus === 'inaktiv') && !seen.has(p.id)) { seen.add(p.id); extra.push(p) }
        }
      }
      base = [...base, ...extra]
    }
    if (filterNeupatient) base = base.filter(p => p.neupatient === true)
    if (filterStatus === 'storniert') {
      base = base.filter(isStorniert)
    } else if (filterStatus === 'inaktiv') {
      base = base.filter(p => p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben')
    } else if (filterStatus === 'reminder') {
      base = base.filter(p => p.patientenStatus === 'Reminder')
    } else if (filterStatus === 'keinAufgebot') {
      base = base.filter(p => p.patientenStatus === 'kein Aufgebot')
    } else if (filterStatus === 'wartetBericht') {
      base = base.filter(isAwaitingZuweisungsBericht)
    } else if (filterStatus === 'nieBeimArzt') {
      base = base.filter(isNieBeimArzt)
    } else if (activeTab === ZU_BEARB) {
      // 'Zu bearbeiten': inaktive sichtbar lassen, nur Verstorbene ausblenden.
      base = base.filter(p => p.patientenStatus !== 'verstorben')
    } else if (activeTab === OFFEN_TAB) {
      // Inaktive Ärzte: alle zeigen (inaktive + verstorbene)
    } else {
      // Standard: inaktive/verstorbene ausblenden
      base = base.filter(p => p.patientenStatus !== 'inaktiv' && p.patientenStatus !== 'verstorben')
    }
    if (filterAufgebotArt === 'kein') base = base.filter(p => !p.aufgebotArt)
    else if (filterAufgebotArt) base = base.filter(p => p.aufgebotArt === filterAufgebotArt)
    // Grund-Filter (Storno-Grund) — kombinierbar mit dem Status-Filter.
    if (filterGrund) base = base.filter(p => (p.grundStornierung || '').trim() === filterGrund)
    if (filterNochZuErledigen) base = base.filter(p => p.verlauf?.some(v => v.ergebnis === 'noch zu erledigen'))
    if (filterVerlaufAktion) base = base.filter(p => p.verlauf?.some(v => v.aktion === filterVerlaufAktion && v.von !== 'System'))
    if (filterReminderFaellig) base = base.filter(p => getReminderDueDate(p) !== null)
    if (filterReminderGeplant) base = base.filter(p => getUpcomingReminderDate(p) !== null)
    if (filterInaktivArzt) {
      const match = inaktiveAerzte.find(a => a.nachname === filterInaktivArzt)
      if (match) base = base.filter(p => match.doctors.includes(p.doctor))
    }
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
          case 'overdue':    return isOverdue(p)
          case 'inPlanung':  return isInPlanung(p)
          case 'ohneTermin': return isOhneTermin(p)
          case 'ohneRC':     return isOhneRC(p)
          case 'nachfass':   return isNachfassFaellig(p)
        }
      })
    }
    const sorted = [...base].sort((a, b) => {
      // Arzt-Gruppierung: Standardmässig aufsteigend, ausser der User hat
      // per Klick auf "Arzt" explizit eine eigene Sortierung gewählt (dann
      // greift stattdessen deren Richtung weiter unten in der sortKeys-Schleife).
      if (activeTab === OFFEN_TAB && !sortKeys.some(k => k.col === 'doctor')) {
        const da = a.doctor === OFFEN_TAB ? 'zzz' : a.doctor
        const db = b.doctor === OFFEN_TAB ? 'zzz' : b.doctor
        const dc = da.localeCompare(db, 'de')
        if (dc !== 0) return dc
      }
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
    return sorted
  }, [allData, activeTab, sortKeys, filterNeupatient, filterTermin, filterStatus, filterGrund, filterAufgebotArt, filterNochZuErledigen, filterReminderFaellig, filterReminderGeplant, filterVerlaufAktion, filterInaktivArzt, inaktiveAerzte, search, searchResults]) // eslint-disable-line react-hooks/exhaustive-deps

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
      overdue:    active.filter(isOverdue).length,
      inPlanung:  active.filter(isInPlanung).length,
      ohneTermin: active.filter(isOhneTermin).length,
      ohneRC:     active.filter(isOhneRC).length,
      nachfass:   active.filter(p => isNachfassFaellig(p)).length,
      neupatient:        base.filter(p => p.neupatient === true).length,
      storniert:         base.filter(isStorniert).length,
      inaktiv:           base.filter(p => p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben').length,
      nochZuErledigen:   base.filter(p => p.verlauf?.some(v => v.ergebnis === 'noch zu erledigen')).length,
      nieBeimArzt:       base.filter(isNieBeimArzt).length,
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

    const anrufenSet = new Set<string>()
    // Rückkehr-Überwachung: externe Zuweisung abgeschlossen (Abschlussbericht),
    // aber der Patient war seither nicht mehr bei uns und hat auch keinen
    // kuenftigen Termin/kein Aufgebot — nach 3 Monaten pruefen ob er zurueckkommt.
    const rueckkehr: WPEntry[] = []
    const dreiMonateHer = (() => {
      const d = new Date(); d.setMonth(d.getMonth() - 3)
      return d.toISOString().slice(0, 10)
    })()
    for (const patients of allData.values()) {
      for (const p of patients) {
        if (isStorniert(p) || p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben') continue
        // Patienten mit offenen Telefonanrufen ("noch zu erledigen")
        if (p.verlauf?.some(v => v.aktion === 'Telefonanruf' && v.ergebnis === 'noch zu erledigen')) {
          thisWeek.push({ patient: p })
          anrufenSet.add(p.id)
        }
        // Rückkehr-Überwachung (nur wenn kein anderes Aufgebot/kein Anruf offen)
        if (!p.aufgebotFuer && !anrufenSet.has(p.id) && p.patientenStatus !== 'kein Aufgebot') {
          const zws = patientZuweisungen(p).filter(z => z.typ === 'extern')
          const abgeschlossen = zws.filter(z => z.status === 'erledigt' && z.erledigtAm)
          const nochPendent = zws.some(z => (z.status || 'pendent') === 'pendent')
          if (abgeschlossen.length > 0 && !nochPendent) {
            const letzterAbschluss = abgeschlossen.map(z => z.erledigtAm).sort().pop()!
            if (letzterAbschluss <= dreiMonateHer) {
              const nk = p.naechsteKons && p.naechsteKons !== 'kein Termin' ? String(p.naechsteKons) : ''
              const zurueck = (p.letzteKons && String(p.letzteKons) > letzterAbschluss) || (nk && nk > letzterAbschluss)
              const aufgebotenSeither = p.aufgebotErstellt && String(p.aufgebotErstellt) > letzterAbschluss
              if (!zurueck && !aufgebotenSeither) rueckkehr.push({ patient: p })
            }
          }
        }
        if (!p.aufgebotFuer || p.aufgebotErstellt) continue
        if (anrufenSet.has(p.id)) continue
        const d = new Date(p.aufgebotFuer + 'T00:00:00')
        if (d >= start && d <= end) thisWeek.push({ patient: p })
        else if (d < start && wochenplanWeekOffset === 0) overdue.push({ patient: p })
      }
    }
    const filterArzt = (entries: WPEntry[]) => wochenplanFilterArzt ? entries.filter(e => e.patient.doctor === wochenplanFilterArzt) : entries
    const thisWeekF = filterArzt(thisWeek)
    const overdueF  = filterArzt(overdue)
    const sortFn = (a: WPEntry, b: WPEntry) => {
      // Kontrolldatum = «RC ab» (aufgebotFuer). Eintraege ohne Datum ans Ende.
      if (wochenplanSort === 'datumAsc' || wochenplanSort === 'datumDesc') {
        const da = s(a.patient.aufgebotFuer)
        const db = s(b.patient.aufgebotFuer)
        if (da !== db) {
          if (!da) return 1
          if (!db) return -1
          const cmp = da.localeCompare(db)
          return wochenplanSort === 'datumAsc' ? cmp : -cmp
        }
      } else if (wochenplanSort === 'arzt') {
        const dc = s(a.patient.doctor).localeCompare(s(b.patient.doctor), 'de')
        if (dc !== 0) return dc
      }
      return s(a.patient.vorname).localeCompare(s(b.patient.vorname), 'de')
    }
    type Groups = Record<string, WPEntry[]>
    function groupByArt(entries: WPEntry[]): Groups {
      const g: Groups = {}
      for (const e of entries) {
        const art = anrufenSet.has(e.patient.id) ? 'Anrufen' : (e.patient.aufgebotArt ?? 'kein')
        if (!g[art]) g[art] = []
        g[art].push(e)
      }
      for (const k of Object.keys(g)) g[k].sort(sortFn)
      return g
    }
    const rueckkehrF = filterArzt(rueckkehr)
    return {
      grouped: groupByArt(thisWeekF),
      overdue: overdueF.sort(sortFn),
      rueckkehr: rueckkehrF.sort(sortFn),
      total: thisWeekF.length,
      overdueCount: overdueF.length,
      weekLabel: fmtWeekLabel(start, end),
    }
  }, [allData, wochenplanWeekOffset, wochenplanSort, wochenplanFilterArzt]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Termin-anlegen-Flow (Liris) ───────────────────────────────────────────
  // Klick auf 'Termin' im Aufgebot-Plan: NUR das Liris-Panel oeffnen und im
  // Terminkalender die PID ins Patient-Feld tippen + den Vorschlag anklicken.
  // KEINE Akte, KEINE Auslesung, KEIN Bearbeiten-Modal. Termin + Grund setzt
  // der User manuell; die Termin-Infos zeigt Liris selbst (gelbe Box).
  function startTerminFlow(p: RecallPatient) {
    const pid = normalizePid(p.pid)
    if (!pid) { toast.warning('Patient hat keine PID.'); return }
    openBrowser()                 // nur Panel oeffnen (keine Akte)
    requestTerminAnlegen(pid, '') // Terminkalender: Patient per PID auswaehlen
    toast.info('Termin anlegen wird in Liris vorbereitet…')
  }

  function openAufgebotDialog(entry: WPEntry, presetArt?: AufgebotArt) {
    // Self-Service-Patienten ("kein Aufgebot") wollen bewusst nicht aufgeboten
    // werden -> warnen, aber Fortfahren erlauben. Ein bewusst gewählter Reminder
    // ist für sie OK (sie melden sich selbst) -> dann keine Warnung.
    if (entry.patient.patientenStatus === 'kein Aufgebot' && presetArt !== 'Reminder') {
      if (!window.confirm('Patient wünscht kein Aufgebot.\n\nTrotzdem aufbieten?')) return
    }
    setAufgebotTarget(entry)
    const doctor = entry.patient.doctor
    setAufgebotForm({
      ...emptyAufgebotForm(),
      art:       presetArt ?? null,
      arztName:  doctorFullName(doctor),
      fachtitel: doctorFachtitelMap[doctor] ?? '',
    })
    setAufgebotPdfCreated(false)
    // Bei vorgewählter Art (Brief/Reminder) gleich die Liris-Akte öffnen,
    // damit Anrede/Adresse via lirisExtract ins Formular gefüllt werden.
    if ((presetArt === 'Brief' || presetArt === 'Reminder')) {
      const pid = normalizePid(entry.patient.pid)
      if (pid) openWithPid(pid)
    }
  }

  // Liris-Extract -> Aufbieten-Formular auto-fuellen, sofern das Modal
  // gerade offen ist und die PID matched. Leere Felder werden befuellt;
  // bestehende User-Eingaben werden NICHT ueberschrieben.
  useEffect(() => {
    if (!lirisExtract || !aufgebotTarget) return
    if (Date.now() - lirisExtract.at > 8000) return
    if (normalizePid(lirisExtract.pid) !== normalizePid(aufgebotTarget.patient.pid)) return
    setAufgebotForm(f => {
      const patch: Partial<typeof f> = {}
      if (!f.anrede && lirisExtract.anrede) patch.anrede = lirisExtract.anrede as any
      if (!f.nachnameOverride && lirisExtract.nachname) patch.nachnameOverride = lirisExtract.nachname.trim()
      // Früherer Arzt = Autor der letzten Untersuchung (für Variante «Neuen Arzt
      // vorschlagen»). Nur vorbefüllen, MPA kann korrigieren.
      if (!f.frueherArzt && lirisExtract.autor) patch.frueherArzt = lirisExtract.autor.trim()
      // Minderjährig (< 18): Anrede auf «Familie» + Adresse des zusätzlichen Kontakts (Eltern).
      let isMinor = false
      {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(aufgebotTarget.patient.gebDatum || ''))
        if (m) {
          const t = new Date()
          let a = t.getFullYear() - parseInt(m[1], 10)
          const mo = t.getMonth() + 1, d = t.getDate()
          if (mo < parseInt(m[2], 10) || (mo === parseInt(m[2], 10) && d < parseInt(m[3], 10))) a--
          if (a >= 0 && a < 18) { patch.anrede = 'Familie'; isMinor = true }
        }
      }
      // Erwachsene mit gesetzlichem Vertreter (Beistandschaft o.ä.): Liris hat
      // im Kontaktangaben-Block trotzdem einen "Gesetzlicher Vertreter"-Eintrag
      // (zusKontaktName/-Adresse) — dasselbe Datenfeld wie bei Minderjährigen,
      // nur ohne Altersgrenze. Analog zu Minderjährigen wird der Brief an den
      // Vertreter adressiert.
      const hasVertreterData = !isMinor && !!lirisExtract.zusKontaktName && !!lirisExtract.zusKontaktAdresse
      if (!f.adressBlock.trim()) {
        // Minderjährige ODER Erwachsene mit Vertreter: Adresse und Name des
        // zusätzlichen Kontakts (Eltern bzw. gesetzlicher Vertreter) verwenden.
        if ((isMinor || hasVertreterData) && lirisExtract.zusKontaktName && lirisExtract.zusKontaktAdresse) {
          patch.adressBlock = lirisExtract.zusKontaktName + '\n' + lirisExtract.zusKontaktAdresse
          // Vertreter-Modus nur zusammen mit der Erst-Befuellung aktivieren —
          // NICHT bei jedem Extraktions-Retry, sonst laesst er sich waehrend
          // der Nachlade-Phase nicht manuell abschalten.
          if (hasVertreterData && !f.vertreterModus) {
            patch.vertreterModus = true
            patch.vertreterTyp = lirisExtract.zusKontaktTyp === 'kontaktperson' ? 'kontaktperson' : 'vertreter'
          }
          // nachnameOverride bleibt beim Patienten-Nachnamen (aus Liris-Header)
        } else if (lirisExtract.postAdresse) {
          // Name-Zeile in LIRIS-Reihenfolge "Nachname Vorname" — so wie beim
          // manuellen Einfügen. Alle Parser (Begrüßung, Adress-Anzeige, E-Mail)
          // erwarten diese Reihenfolge: das letzte Wort ist der Vorname.
          // Dadurch nutzt die Anrede den Nachnamen, und die gedruckte Adresse
          // wird korrekt zu "Vorname Nachname" umsortiert.
          const vorname = (lirisExtract.vorname || aufgebotTarget.patient.vorname || '').trim()
          const nachname = (lirisExtract.nachname || '').trim()
          const name = [nachname, vorname].filter(Boolean).join(' ')
          patch.adressBlock = (name ? name + '\n' : '') + lirisExtract.postAdresse
        }
      }
      const kws = lirisExtract.bpKeywords ?? []
      if (kws.includes('Myd') && !f.pupille) patch.pupille = true
      if (kws.includes('OCT') && !/OCT/i.test(f.voruntersuchungenSonstige)) {
        patch.voruntersuchungenSonstige = (f.voruntersuchungenSonstige ? f.voruntersuchungenSonstige + ', ' : '') + 'OCT'
        // 'Sonstige'-Checkbox setzen damit OCT in der Brief-Liste UND in
        // der Zeit-Berechnung erscheint.
        if (!f.voruntersuchungen.includes('Sonstige')) {
          patch.voruntersuchungen = [...(patch.voruntersuchungen ?? f.voruntersuchungen), 'Sonstige']
        }
      }
      // BP-Keywords auf vordefinierte Voruntersuchungen mappen — Haken
      // setzen wenn das Item noch nicht gewaehlt ist.
      const KW_TO_VU: Record<string, string> = {
        GF:           'Perimetrie',
        Biometrie:    'Biometrie',
        Pachymetrie:  'Pachymetrie',
        Topographie:  'Hornhaut-Topographie',
        Traenenfilm:  'Tränenfilm-Analyse',
        Funduskopie:  'Funduskopie',
        Tonometrie:   'Tonometrie',
        Zykloplegie:  'Zykloplegie',
      }
      const addVu: string[] = []
      for (const kw of kws) {
        const vu = KW_TO_VU[kw]
        if (vu && !f.voruntersuchungen.includes(vu) && !addVu.includes(vu)) addVu.push(vu)
      }
      if (addVu.length) patch.voruntersuchungen = [...f.voruntersuchungen, ...addVu]
      // Zukuenftiger Termin: Datum + Uhrzeit aus Liris uebernehmen.
      if (!f.terminDatum && lirisExtract.naechsterTerminDatum) {
        patch.terminDatum = lirisExtract.naechsterTerminDatum
      }
      if (!f.terminZeit && lirisExtract.naechsterTerminZeit) {
        patch.terminZeit = lirisExtract.naechsterTerminZeit
      }
      return Object.keys(patch).length ? { ...f, ...patch } : f
    })
  }, [lirisExtract, aufgebotTarget]) // eslint-disable-line react-hooks/exhaustive-deps

  function buildBriefHtml(patient: RecallPatient, form: AufgebotForm): string {
    const GERMAN_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
    const GERMAN_DAYS   = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag']
    const FEMALE_DOCTORS = new Set(['Malinina','Papazoglou'])

    // Address block: Liris format = "Nachname[1..n Worte] Vorname / Strasse / PLZ Ort".
    // Beispiele:
    //   "MUELLER Frank"          -> Nachname: MUELLER,        Vorname: Frank
    //   "PASQUALE TEST Michael"  -> Nachname: PASQUALE TEST,  Vorname: Michael
    //   "VON DER LIETH Hans"     -> Nachname: VON DER LIETH,  Vorname: Hans
    // Heuristik: das LETZTE Wort ist der Vorname, alles davor der
    // Nachname. Wird fuer die Salutation verwendet ("Sehr geehrte Frau
    // PASQUALE TEST").
    const adressLines = form.adressBlock.trim().split('\n').map(l => l.trim()).filter(Boolean)
    const nameLine    = adressLines[0] || ''
    const nameWords   = nameLine.split(/\s+/).filter(Boolean)
    // Erwachsener mit gesetzlichem Vertreter: adressBlock enthält den NAMEN
    // DES VERTRETERS (nicht des Patienten) — die Anrede muss daher IMMER aus
    // der adressBlock-Namenszeile kommen, nicht aus nachnameOverride (das
    // bewusst der Patienten-Nachname bleibt, siehe unten kindHinweis).
    const nachname    = form.vertreterModus
      ? titleCaseName(nameWords.length > 1 ? nameWords.slice(0, -1).join(' ') : (nameWords[0] || nameLine))
      : titleCaseName(form.nachnameOverride.trim() || (nameWords.length > 1 ? nameWords.slice(0, -1).join(' ') : (nameWords[0] || nameLine)))

    const anredeAnrede = form.anrede === 'Herr' ? 'geehrter Herr' : form.anrede === 'Familie' ? 'geehrte Familie' : form.anrede === 'Frau' ? 'geehrte Frau' : 'geehrte Damen und Herren'

    // Minderjährig (< 18): Aufgebots-/Reminderbriefe IMMER an die Familie
    // richten und den Namen des Kindes im Brief nennen.
    const childAge = (() => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(patient.gebDatum || ''))
      if (!m) return null
      const t = new Date()
      let a = t.getFullYear() - parseInt(m[1], 10)
      const mo = t.getMonth() + 1, d = t.getDate()
      if (mo < parseInt(m[2], 10) || (mo === parseInt(m[2], 10) && d < parseInt(m[3], 10))) a--
      return a
    })()
    const isMinor = childAge !== null && childAge >= 0 && childAge < 18
    // Erwachsener mit gesetzlichem Vertreter: gleiche Grundlogik wie bei
    // Minderjährigen (Brief an Dritte, Patient wird nur genannt), aber ohne
    // erzwungene "Familie"-Anrede — der Vertreter kann Herr/Frau/Familie sein.
    const effAnredeAnrede = isMinor ? 'geehrte Familie' : anredeAnrede

    // Reorder name: "Nachname Vorname" → "Vorname Nachname" for address window.
    // (nameWords ist oben schon definiert — wiederverwendet)
    const escLine    = (l: string) => l.replace(/&/g,'&amp;').replace(/</g,'&lt;')
    const nameDisplay = titleCaseName(nameWords.length >= 2
      ? `${nameWords[nameWords.length - 1]} ${nameWords.slice(0, -1).join(' ')}`
      : nameLine)
    // Kindname: immer aus Patientendaten, nicht aus adressBlock (der bei Minderjährigen die Eltern enthält)
    const kindNameDisplay = titleCaseName(`${aufgebotTarget!.patient.vorname || ''} ${titleCaseName(form.nachnameOverride)}`.trim())
    const kindHinweis = isMinor
      ? `<p>Dieses Schreiben betrifft Ihr Kind <strong>${escLine(kindNameDisplay)}</strong>.</p>`
      : form.vertreterModus
        ? (form.vertreterTyp === 'kontaktperson'
            ? `<p>Dieses Schreiben betrifft <strong>${escLine(kindNameDisplay)}</strong>. Sie erhalten es als hinterlegte Kontaktperson &#8212; wir bitten Sie, die Information weiterzuleiten.</p>`
            : `<p>Dieses Schreiben betrifft <strong>${escLine(kindNameDisplay)}</strong>, f&#252;r die/den Sie als gesetzliche/r Vertreter/in handeln.</p>`)
        : ''
    // Build structured address: Anrede / Vorname Nachname / Strasse / PLZ Ort
    const adressHtml = [form.anrede, nameDisplay, adressLines[1] ?? '', adressLines[2] ?? '']
      .filter(Boolean)
      .map(escLine)
      .join('<br>')

    // Date
    const today   = new Date()
    const dateStr = `${today.getDate()}. ${GERMAN_MONTHS[today.getMonth()]} ${today.getFullYear()}`

    const isAllgemein = form.briefVariante === 'terminBestaetigung' || form.briefVariante === 'freierBrief'
    const isReminder = form.art === 'Reminder' || (form.art === 'Brief' && !form.terminDatum.trim() && !isAllgemein)
    const arztName   = form.arztName || doctorFullName(patient.doctor)
    const isFemale    = FEMALE_DOCTORS.has(patient.doctor)
    const arztArtikel = isFemale ? 'unserer Augenärztin' : 'unserem Augenarzt'
    // Fachtitel: from form (pre-filled from user profile), fallback to gender-based default
    const fachtitelDisplay = form.fachtitel.trim()
      || (isFemale ? 'Fachärztin für Augenheilkunde' : 'Facharzt für Augenheilkunde')

    // Arztfoto NUR bei der «neuer Arzt vorschlagen»-Variante (Vorstellung des
    // neuen behandelnden Arztes). URL aus dem Arzt-Profil (fotoUrl) bevorzugt,
    // sonst Code-Tabelle. Leer wenn kein Foto hinterlegt ist.
    const docPhoto = form.briefVariante === 'neuerArzt'
      ? doctorPhoto(patient.doctor, doctorFotoMap[patient.doctor])
      : ''
    const docPhotoCard = docPhoto
      ? `<div class="doc-card"><img class="doc-photo" src="${docPhoto}" alt="${arztName}"><div class="doc-cap"><strong>${arztName}</strong><br>${fachtitelDisplay}</div></div>`
      : ''
    // Nur das Foto (ohne Namensunterschrift) — für die Platzierung direkt neben
    // dem Text, der den neuen Arzt bereits namentlich nennt (Reminder).
    const docPhotoImg = docPhoto
      ? `<img class="doc-photo" src="${docPhoto}" alt="${arztName}">`
      : ''

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

    // Total additional time for VU note.
    // Regel:
    //  - Zykloplegie dominiert: 'bis 2 Stunden'
    //  - 15-Min-Items (Perimetrie, Biometrie) werden bei Mehrfachauswahl
    //    kummuliert (z.B. beide -> 30 Min).
    //  - 5-Min-Items (Pachymetrie, Topographie, Traenenfilm, Funduskopie,
    //    Tonometrie) + 'Sonstige' werden NICHT kummuliert: sobald MIND.
    //    eines davon gewaehlt ist, gilt pauschal +15 Min zusaetzlich.
    const hasZykloplegie   = vuItems.includes('Zykloplegie')
    const fifteenMinSum    = form.voruntersuchungen
      .filter(v => v !== 'Zykloplegie' && VU_MIN[v] === 15)
      .reduce((sum, v) => sum + VU_MIN[v], 0)
    // short = jede gewaehlte VU die nicht 15-Min, nicht Zykloplegie und
    // nicht 'Sonstige' ist (inkl. benutzerdefinierter VUs).
    const hasShortVu       = form.voruntersuchungen.some(v => v !== 'Zykloplegie' && v !== 'Sonstige' && VU_MIN[v] !== 15)
    const hasSonstige      = !!(form.voruntersuchungenSonstige && form.voruntersuchungenSonstige.trim())
    const shortMinFlat     = (hasShortVu || hasSonstige) ? 15 : 0
    const totalMin         = fifteenMinSum + shortMinFlat
    const vuZeitHinweis    = hasZykloplegie
      ? 'bis 2 Stunden'
      : totalMin > 0 ? `ca. ${totalMin} Minuten` : null

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

    const title = form.briefVariante === 'terminVerpasst' ? 'Ihr verpasster Termin &#8211; Bitte um kurze R&#252;ckmeldung'
      : form.briefVariante === 'terminBestaetigung' ? 'Terminbest&#228;tigung'
      : form.briefVariante === 'freierBrief' ? escLine(form.freiBetreff.trim() || 'Mitteilung')
      : form.briefVariante === 'terminVerschoben' ? 'Terminverschiebung &#8211; Best&#228;tigung Ihres neuen Termins'
      : isReminder ? 'Erinnerung &#8211; Augenkontrolle'
      : hasTermin ? 'Terminvorschlag f&#252;r die Routine Augenkontrolle'
      : 'Einladung zur Augenkontrolle'

    const salut = `<p class="salut">Sehr ${effAnredeAnrede} ${nachname}</p>`

    const terminBlock = hasTermin ? `
      <div class="termin-box-wrap">
        <div class="termin-row">
          <div class="termin-box">
            <div class="termin-box-label">Vorgeschlagener Termin</div>
            <div class="termin-box-date">${terminZeile}</div>
          </div>
          ${docPhotoCard}
        </div>
      </div>
      <p>Bei Terminänderung bitten wir um R&#252;ckmeldung bis <strong>24 Stunden vorher</strong> per Tel. <strong>+41 62 842 18 46</strong> oder <a href="mailto:info@augenzentrum-suhr.ch">info@augenzentrum-suhr.ch</a>.</p>
    ` : `
      <p>Termin vereinbaren: Tel. <strong>+41 62 842 18 46</strong> oder <a href="mailto:info@augenzentrum-suhr.ch">info@augenzentrum-suhr.ch</a>.</p>
    `

    // ── Einleitungs-Absatz je Brief-Variante ─────────────────────────────────
    const pupTxt = form.pupille ? 'mit Pupillenerweiterung' : 'ohne Pupillenerweiterung'
    const introStandard = `<p>Gem&#228;ss unseren Unterlagen steht eine Augenkontrolle <strong>${pupTxt}</strong> bei ${arztArtikel}${arztName ? ` <strong>${arztName}</strong>` : ''} an.</p>`
    const frueherArztTxt = escLine(form.frueherArzt.trim())
    const introNeuerArzt = `<p>Gem&#228;ss unseren Unterlagen w&#228;re bei Ihnen wieder eine Kontrolle f&#228;llig.${frueherArztTxt ? ` Da ${frueherArztTxt} nicht mehr in unserer Praxis t&#228;tig ist, erlauben wir uns, Ihnen folgenden Termin vorzuschlagen:` : ` Gerne schlagen wir Ihnen folgenden Termin vor:`}</p>`
    const introVerschoben = form.verschiebungDurch === 'praxis'
      ? `<p>Leider m&#252;ssen wir Ihren geplanten Termin <strong>aus organisatorischen Gr&#252;nden verschieben</strong> &#8211; wir bitten um Ihr Verst&#228;ndnis. Ihr neuer Termin bei ${arztArtikel}${arztName ? ` <strong>${arztName}</strong>` : ''}:</p>`
      : `<p>Gerne best&#228;tigen wir Ihnen die <strong>Verschiebung Ihres Termins</strong>. Ihr neuer Termin bei ${arztArtikel}${arztName ? ` <strong>${arztName}</strong>` : ''}:</p>`
    const introBestaetigung = `<p>Gerne best&#228;tigen wir Ihnen Ihren <strong>vereinbarten Termin</strong> bei ${arztArtikel}${arztName ? ` <strong>${arztName}</strong>` : ''}:</p>`
    const introPara = form.briefVariante === 'neuerArzt' ? introNeuerArzt
      : form.briefVariante === 'terminVerschoben' ? introVerschoben
      : form.briefVariante === 'terminBestaetigung' ? introBestaetigung
      : introStandard
    // Reminder-Variante «Neuen Arzt vorschlagen»: zusätzlicher Hinweis-Absatz.
    const reminderArztHinweis = form.briefVariante === 'neuerArzt'
      ? (frueherArztTxt
          ? `<p>Da ${frueherArztTxt} nicht mehr in unserer Praxis t&#228;tig ist, wird Ihre augen&#228;rztliche Betreuung neu von ${arztArtikel}${arztName ? ` <strong>${arztName}</strong>` : ''} &#252;bernommen. Gerne d&#252;rfen Sie sich f&#252;r einen Termin bei uns melden.</p>`
          : `<p>Ihre augen&#228;rztliche Betreuung in unserer Praxis liegt neu in guten H&#228;nden &#8211; gerne d&#252;rfen Sie sich f&#252;r einen Termin bei uns melden.</p>`)
      : ''

    // ── Body: mit Pupillenerweiterung ────────────────────────────────────────
    const bodyMit = `
      ${salut}
      ${kindHinweis}
      ${introPara}
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
      ${kindHinweis}
      ${introPara}
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
      ${kindHinweis}
      <p>${isMinor
        ? 'Die Augengesundheit Ihres Kindes liegt uns am Herzen. Da die letzte augen&#228;rztliche Kontrolle bereits einige Zeit zur&#252;ckliegt, m&#246;chten wir Sie freundlich daran erinnern und Sie herzlich zu einer erneuten Untersuchung einladen.'
        : form.vertreterModus
          ? `Die Augengesundheit von ${escLine(kindNameDisplay)} liegt uns am Herzen. Da die letzte augen&#228;rztliche Kontrolle bereits einige Zeit zur&#252;ckliegt, m&#246;chten wir Sie freundlich daran erinnern und zu einer erneuten Untersuchung einladen.`
          : 'Ihre Augengesundheit liegt uns am Herzen. Da Ihre letzte augen&#228;rztliche Kontrolle bereits einige Zeit zur&#252;ckliegt, m&#246;chten wir Sie freundlich daran erinnern und Sie herzlich zu einer erneuten Untersuchung einladen.'}</p>
      ${docPhotoImg
        ? `<div class="arzt-vorstellung"><div class="av-text">${reminderArztHinweis}</div>${docPhotoImg}</div>`
        : reminderArztHinweis}
      <p>Gerne vereinbaren wir mit Ihnen einen Termin. Sie erreichen uns unter:<br>
      Tel. <strong>+41 62 842 18 46</strong><br>
      Mail <a href="mailto:info@augenzentrum-suhr.ch">info@augenzentrum-suhr.ch</a><br>
      Web <a href="https://www.augenzentrum-suhr.ch">www.augenzentrum-suhr.ch</a></p>
      <p>Sollten Sie inzwischen anderweitig augen&#228;rztlich betreut werden, umgezogen sein oder aktuell keine weiteren Kontrollen ben&#246;tigen, freuen wir uns &#252;ber eine kurze R&#252;ckmeldung &#8211; per E-Mail, Telefon oder Web-Formular. So k&#246;nnen wir Ihre Angaben aktuell halten und unn&#246;tigen administrativen Aufwand vermeiden.</p>
      <p>Falls Sie bereits einen Termin bei uns vereinbart haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.</p>
      <p>Herzlichen Dank f&#252;r Ihr Vertrauen. Wir sind gerne f&#252;r Sie da.</p>
    `

    // ── Body: Termin verpasst ────────────────────────────────────────────────
    const isTerminVerpasst = form.briefVariante === 'terminVerpasst'
    let terminVerpasstDatum = ''
    if (form.terminDatum) {
      const tvd = new Date(form.terminDatum + 'T00:00:00')
      terminVerpasstDatum = `${GERMAN_DAYS[tvd.getDay()]}, ${tvd.getDate()}. ${GERMAN_MONTHS[tvd.getMonth()]} ${tvd.getFullYear()}`
    }
    const bodyTerminVerpasst = `
      ${salut}
      <p>Sie konnten Ihren Termin am <strong>${terminVerpasstDatum || '[Datum]'}</strong> leider nicht wahrnehmen. Bitte melden Sie sich kurz bei uns, damit wir gemeinsam einen neuen Termin vereinbaren k&#246;nnen.</p>
      <p>Aufgrund der aktuell sehr hohen Nachfrage sind unsere Terminpl&#228;tze stark ausgelastet. Gem&#228;ss unseren Praxisrichtlinien m&#252;ssen wir vers&#228;umte Termine mit <strong>CHF 80.00</strong> in Rechnung stellen, wenn keine R&#252;ckmeldung erfolgt. Das machen wir selbstverst&#228;ndlich ungern, da jederzeit Unvorhergesehenes passieren kann &#8211; und weil wir das uns von Ihnen entgegengebrachte Vertrauen sehr sch&#228;tzen.</p>
      <p>Falls Sie inzwischen den Arzt gewechselt haben, weggezogen sind oder keine weiteren Termine ben&#246;tigen, bitten wir ebenfalls um eine kurze R&#252;ckmeldung. So k&#246;nnen wir unn&#246;tigen administrativen Aufwand vermeiden und die Terminplanung f&#252;r andere Patientinnen und Patienten effizient gestalten.</p>
      <p>Sie erreichen uns telefonisch unter <strong>062 842 18 46</strong>, per E-Mail an <a href="mailto:info@augenzentrum-suhr.ch">info@augenzentrum-suhr.ch</a> oder &#252;ber unser Web-Formular auf <a href="https://www.augenzentrum-suhr.ch">www.augenzentrum-suhr.ch</a>.</p>
      <p>Wir freuen uns &#252;ber Ihre R&#252;ckmeldung.</p>
    `

    // Freier Brief: Betreff = Titel, Fliesstext als Absaetze (Leerzeile trennt).
    // Bei Versand an Dritte (Eltern/Vertreter/Kontaktperson) den Patienten
    // EINDEUTIG identifizieren: voller Name + Geburtsdatum im Betrifft-Hinweis.
    const gebSuffix = patient.gebDatum ? `, geb. ${formatDate(patient.gebDatum)}` : ''
    const kindHinweisFrei = isMinor
      ? `<p>Dieses Schreiben betrifft Ihr Kind <strong>${escLine(kindNameDisplay)}${gebSuffix}</strong>.</p>`
      : form.vertreterModus
        ? (form.vertreterTyp === 'kontaktperson'
            ? `<p>Dieses Schreiben betrifft <strong>${escLine(kindNameDisplay)}${gebSuffix}</strong>. Sie erhalten es als hinterlegte Kontaktperson &#8212; wir bitten Sie, die Information weiterzuleiten.</p>`
            : `<p>Dieses Schreiben betrifft <strong>${escLine(kindNameDisplay)}${gebSuffix}</strong>, f&#252;r die/den Sie als gesetzliche/r Vertreter/in handeln.</p>`)
        : ''
    const bodyFrei = `
      ${salut}
      ${kindHinweisFrei}
      ${form.freiText.split(/\n{2,}/).map(abs => `<p>${escLine(abs.trim()).replace(/\n/g, '<br>')}</p>`).join('')}
    `
    const bodyHtml = form.briefVariante === 'freierBrief' ? bodyFrei : isTerminVerpasst ? bodyTerminVerpasst : isReminder ? bodyReminder : form.pupille ? bodyMit : bodyOhne

    const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><title>Brief</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#111;background:#fff}
  .page{position:relative;width:21cm;height:29.7cm;max-height:29.7cm;overflow:hidden;padding:1.2cm 2.2cm 2cm 2.5cm;margin:auto}
  .footer-id{position:absolute;left:2.5cm;right:2.2cm;bottom:.7cm;font-size:7.5pt;color:#888;border-top:1px solid #ddd;padding-top:.15cm;white-space:nowrap}
  .letterhead{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:-0.1cm}
  .lh-left{display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end;max-width:7.5cm}
  .lh-logo{height:1.9cm;width:auto;max-width:7.5cm;object-fit:contain;display:block;margin-bottom:.45cm}
  .lh-name{font-size:14pt;font-weight:bold;margin-bottom:.12cm}
  .lh-title{font-size:11.5pt;font-weight:bold;color:#1a3a6e;margin-bottom:.15cm}
  .lh-praxisname{font-size:12pt;font-weight:bold;color:#1a3a6e;margin-bottom:.1cm;letter-spacing:.02em}
  .lh-addr{font-size:9.5pt;color:#1a3a6e;letter-spacing:.03em;margin-bottom:.18cm;font-weight:600}
  .lh-contact-left{font-size:9pt;line-height:1.5;color:#1a3a6e}
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
  .body a{color:#111;text-decoration:none;font-weight:bold}
  .sig{margin-top:1.8cm;line-height:1.7}
  .sig .gruss{margin-bottom:.4cm}
  .termin-row{display:flex;align-items:center;justify-content:center;gap:.7cm;flex-wrap:wrap}
  .doc-card-wrap{display:flex;justify-content:center;margin:.35cm 0}
  .arzt-vorstellung{display:flex;align-items:center;gap:.55cm;margin:.15cm 0}
  .arzt-vorstellung .av-text{flex:1}
  .arzt-vorstellung .av-text p{margin-bottom:0}
  .arzt-vorstellung .doc-photo{flex-shrink:0}
  .doc-card{display:flex;align-items:center;gap:.35cm}
  .doc-photo{width:2cm;height:2.4cm;object-fit:cover;border-radius:5px;border:1px solid #ccc}
  .doc-cap{font-size:9pt;line-height:1.3;text-align:left;color:#1a3a6e}
  @page{margin:0;size:A4}
  @media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body><div class="page">

  <div class="letterhead">
    <div class="lh-left">
      ${logoDataUrl ? `<img class="lh-logo" src="${logoDataUrl}" alt="Augenzentrum Suhr">` : '<div class="lh-praxisname">Augenzentrum Suhr</div>'}
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

  <div class="footer-id">Pat.-Nr.: ${escLine(normalizePid(patient.pid) || '—')} &middot; Geb.: ${escLine(formatDate(patient.gebDatum))}</div>

</div>
</body></html>`

    return html
  }

  function generateBriefPDF(patient: RecallPatient, form: AufgebotForm, skipPrint = false) {
    const html = buildBriefHtml(patient, form)
    const ea = (window as unknown as { electronApp?: {
      renderBriefPdf?: (html: string) => Promise<{ ok: boolean; buffer?: ArrayBuffer; error?: string }>
      saveBriefPdf?:   (html: string, filename: string) => Promise<{ ok: boolean; path?: string; error?: string }>
    } }).electronApp
    const lastName = (form.adressBlock.trim().split('\n')[0] || patient.vorname || 'Patient').split(/\s+/)[0]
    const today = new Date().toISOString().slice(0, 10)
    const pid = normalizePid(patient.pid)
    const filename = `Brief_${lastName}${pid ? '_' + pid : ''}_${today}.pdf`
    setAufgebotPdfCreated(true)

    // Bevorzugter Pfad: PDF-Buffer direkt aus Main-Prozess holen und in
    // den Postausgang legen — keine Schreib-/Re-Lese-Schleife ueber Disk.
    if (ea?.renderBriefPdf) {
      toast.info('PDF wird vorbereitet…')
      ea.renderBriefPdf(html).then(async res => {
        if (!res.ok || !res.buffer) { toast.error(`PDF-Fehler: ${res.error}`); return }
        const blob = new Blob([res.buffer], { type: 'application/pdf' })
        try {
          await postausgang.add({
            pid:      pid || null,
            vorname:  patient.vorname || lastName,
            arzt:     patient.doctor,
            filename, blob,
            // autoUpload → Postausgang lädt den Brief automatisch ins Liris hoch
            // (gilt für «Per Post» und «Per E-Mail», beide laufen hierüber).
            autoUpload: true,
            // Bei E-Mail-Versand nicht ausdrucken — nur ins Liris hochladen.
            skipPrint,
            // Payload fuer automatisches 'aufgeboten markieren' nach
            // Verarbeitung (Liris-Upload oder Mail an Praxis).
            aufgebot: { patient, form },
          })
          toast.success(
            skipPrint
              ? 'Brief wird im Hintergrund ins Liris hochgeladen…'
              : (window as any).electronApp?.autoImportToLiris
                ? 'In Postausgang abgelegt — wird ins Liris hochgeladen…'
                : 'In Postausgang abgelegt'
          )
        } catch (e) {
          console.error('[Brief] Postausgang-Add fehlgeschlagen', e)
          toast.error('PDF erstellt, aber Postausgang-Ablage fehlgeschlagen')
        }
      }).catch(err => toast.error(`PDF-Fehler: ${String(err)}`))
      return
    }
    // Aelterer Electron-Pfad: saveBriefPdf legt direkt nach Downloads ab.
    if (ea?.saveBriefPdf) {
      toast.info('PDF wird in Downloads abgelegt (App-Update fuer Postausgang noetig)…')
      ea.saveBriefPdf(html, filename).then(res => {
        if (res.ok) toast.success(`PDF gespeichert: ${res.path}`)
        else toast.error(`PDF-Fehler: ${res.error}`)
      }).catch(err => toast.error(`PDF-Fehler: ${String(err)}`))
      return
    }
    if ((window as any).electronApp) {
      toast.info('Direkte PDF-Erstellung erfordert App-Update — Vorschau wird geöffnet.')
    }
    setBriefPreview(html)
  }

  function openEmailInOutlook(patient: RecallPatient, form: AufgebotForm, toEmail?: string) {
    const GERMAN_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
    const GERMAN_DAYS   = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag']

    const isAllgemeinE = form.briefVariante === 'terminBestaetigung' || form.briefVariante === 'freierBrief'
    const isReminder   = form.art === 'Reminder' || (form.art === 'Brief' && !form.terminDatum.trim() && !isAllgemeinE)
    const nameLine     = (form.adressBlock.trim().split('\n')[0] || '').trim()
    const nameWordsE   = nameLine.split(/\s+/).filter(Boolean)
    // Erwachsener mit gesetzlichem Vertreter: adressBlock enthält den Namen
    // des Vertreters, nicht des Patienten — Anrede muss daher von dort kommen.
    const nachname     = form.vertreterModus
      ? titleCaseName(nameWordsE.length > 1 ? nameWordsE.slice(0, -1).join(' ') : (nameWordsE[0] || nameLine))
      : titleCaseName(form.nachnameOverride.trim() || nameWordsE[0] || nameLine)
    const anredeAnrede = form.anrede === 'Herr' ? 'geehrter Herr' : form.anrede === 'Familie' ? 'geehrte Familie' : 'geehrte Frau'
    // Minderjährig (< 18): immer an die Familie, Kind namentlich nennen.
    const eAge = (() => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(patient.gebDatum || ''))
      if (!m) return null
      const t = new Date()
      let a = t.getFullYear() - parseInt(m[1], 10)
      const mo = t.getMonth() + 1, d = t.getDate()
      if (mo < parseInt(m[2], 10) || (mo === parseInt(m[2], 10) && d < parseInt(m[3], 10))) a--
      return a
    })()
    const eMinor   = eAge !== null && eAge >= 0 && eAge < 18
    // childName: Vorname + Nachname des Patienten (nicht aus adressBlock, der bei Minderjährigen die Eltern enthält)
    const childName = titleCaseName(`${patient.vorname || ''} ${titleCaseName(form.nachnameOverride)}`.trim())
    const salut    = `Sehr ${eMinor ? 'geehrte Familie' : anredeAnrede} ${nachname}`
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
      : form.briefVariante === 'terminBestaetigung' ? 'Terminbestätigung – Augenzentrum Suhr'
      : form.briefVariante === 'freierBrief' ? (form.freiBetreff.trim() || 'Mitteilung – Augenzentrum Suhr')
      : form.briefVariante === 'terminVerschoben' ? 'Terminverschiebung – Bestätigung Ihres neuen Termins'
      : terminZeile ? 'Terminvorschlag für die Routine Augenkontrolle' : 'Einladung zur Augenkontrolle'

    // ── Formatierter Plaintext + direkt Outlook öffnen via mailto ────────────
    const kontakt = [
      '📞  +41 62 842 18 46',
      '✉   info@augenzentrum-suhr.ch',
      '🌐  www.augenzentrum-suhr.ch',
    ].join('\n')
    let body: string
    if (isReminder) {
      const arztHinweis = form.briefVariante === 'neuerArzt'
        ? (form.frueherArzt.trim()
            ? `Da ${form.frueherArzt.trim()} nicht mehr in unserer Praxis tätig ist, wird Ihre augenärztliche Betreuung neu von ${arztArtikel}${arztName ? ` ${arztName}` : ''} übernommen. Gerne dürfen Sie sich für einen Termin bei uns melden.\n\nLernen Sie unsere Ärzte kennen:\n    www.augenzentrum-suhr.ch/team`
            : 'Ihre augenärztliche Betreuung in unserer Praxis liegt neu in guten Händen – gerne dürfen Sie sich für einen Termin bei uns melden.\n\nLernen Sie unsere Ärzte kennen:\n    www.augenzentrum-suhr.ch/team')
        : ''
      const terminVerpasstDatumTxt = (() => {
        if (form.briefVariante !== 'terminVerpasst' || !form.terminDatum) return ''
        const td = new Date(form.terminDatum + 'T00:00:00')
        const DAYS = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag']
        const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
        return `${DAYS[td.getDay()]}, ${td.getDate()}. ${MONTHS[td.getMonth()]} ${td.getFullYear()}`
      })()
      body = [
        salut, '',
        ...(eMinor ? [`Dieses Schreiben betrifft Ihr Kind ${childName}.`, ''] : []),
        ...(!eMinor && form.vertreterModus ? [form.vertreterTyp === 'kontaktperson'
          ? `Dieses Schreiben betrifft ${childName}. Sie erhalten es als hinterlegte Kontaktperson — wir bitten Sie, die Information weiterzuleiten.`
          : `Dieses Schreiben betrifft ${childName}, für die/den Sie als gesetzliche/r Vertreter/in handeln.`, ''] : []),
        ...(form.briefVariante === 'terminVerpasst' ? [
          `Ihr Termin am ${terminVerpasstDatumTxt || '[Datum]'} konnte leider nicht wahrgenommen werden.`,
          '',
          'Bitte melden Sie sich kurz bei uns, damit wir gemeinsam einen neuen Termin vereinbaren können.',
          '',
          'Aufgrund der aktuell sehr hohen Nachfrage sind unsere Terminplätze stark ausgelastet. Gemäss unseren Praxisrichtlinien müssen wir versäumte Termine mit CHF 80.00 in Rechnung stellen, wenn keine Rückmeldung erfolgt.',
          '',
          'Falls Sie inzwischen den Arzt gewechselt haben, weggezogen sind oder keine weiteren Termine benötigen, bitten wir ebenfalls um eine kurze Rückmeldung.',
          '',
          kontakt,
        ] : [
          eMinor
            ? 'Die Augengesundheit Ihres Kindes liegt uns am Herzen. Da die letzte augenärztliche Kontrolle bereits einige Zeit zurückliegt, möchten wir Sie freundlich daran erinnern und Sie herzlich zu einer erneuten Untersuchung einladen.'
            : form.vertreterModus
              ? `Die Augengesundheit von ${childName} liegt uns am Herzen. Da die letzte augenärztliche Kontrolle bereits einige Zeit zurückliegt, möchten wir Sie freundlich daran erinnern und zu einer erneuten Untersuchung einladen.`
              : 'Ihre Augengesundheit liegt uns am Herzen. Da Ihre letzte augenärztliche Kontrolle bereits einige Zeit zurückliegt, möchten wir Sie freundlich daran erinnern und Sie herzlich zu einer erneuten Untersuchung einladen.',
          '',
          ...(arztHinweis ? [arztHinweis, ''] : []),
          'Gerne vereinbaren wir mit Ihnen einen Termin:',
          '',
          kontakt,
          '',
          'Sollten Sie inzwischen anderweitig augenärztlich betreut werden, umgezogen sein oder aktuell keine weiteren Kontrollen benötigen, freuen wir uns über eine kurze Rückmeldung – per E-Mail, Telefon oder Web-Formular. So können wir Ihre Angaben aktuell halten und unnötigen administrativen Aufwand vermeiden.',
          '',
          'Falls Sie bereits einen Termin bei uns vereinbart haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.',
          '',
          'Herzlichen Dank für Ihr Vertrauen. Wir sind gerne für Sie da.',
        ]),
      ].join('\n')
    } else {
      const pupText = form.pupille ? 'mit Pupillenerweiterung' : 'ohne Pupillenerweiterung'
      // Termin-Kasten (Box-Drawing) — bewusst SCHMAL gehalten und der Text
      // darunter kompakt formuliert: jedes ─-Zeichen kostet in der mailto-URL
      // 9 kodierte Zeichen; ueber ~2000 verwirft Windows den Aufruf still
      // (Outlook oeffnet nicht). Gesamtlaenge wird unten geloggt/gewarnt.
      const terminBox = terminZeile ? [
        '  ┌─ 📅 IHR TERMIN ' + '─'.repeat(12) + '┐',
        `  │  ${terminZeile}`,
        '  └' + '─'.repeat(30) + '┘',
      ].join('\n') : ''
      const terminSection = terminZeile ? [
        '',
        terminBox,
        '',
        'Terminänderung? Bitte bis spätestens 24 Std. vorher melden:',
        '',
        kontakt,
      ].join('\n') : [
        '',
        'Für einen Termin erreichen Sie uns gerne:',
        '',
        kontakt,
      ].join('\n')
      const vuSection = vuItems.length > 0
        ? `\nGeplante Voruntersuchungen: ${vuItems.join(', ')}`
        : ''
      const sehSection = hasZykloplegie
        ? '\n⚠ Zykloplegie (Pupillenerweiterung) geplant: Sehleistung danach 12–24 Std. beeinträchtigt — kein Fahrzeug lenken, Sonnenbrille mitbringen.'
        : form.pupille
          ? '\n⚠ Pupillenerweiterung geplant: Sehleistung danach ca. 4–6 Std. eingeschränkt — kein Fahrzeug lenken, Sonnenbrille mitbringen.'
          : ''
      const mitbringen = `\nBitte mitbringen: Brille/Kontaktlinsen (vor dem Termin entfernen), Medikamentenliste, Krankenkassenausweis${form.pupille ? ', Sonnenbrille' : ''}.`
      const introLineEmail = form.briefVariante === 'terminBestaetigung'
        ? `Gerne bestätigen wir Ihnen Ihren vereinbarten Termin bei ${arztArtikel}${arztName ? ` ${arztName}` : ''}:`
        : form.briefVariante === 'neuerArzt'
        ? `Gemäss unseren Unterlagen wäre bei Ihnen wieder eine Kontrolle fällig.${form.frueherArzt.trim() ? ` Da ${form.frueherArzt.trim()} nicht mehr in unserer Praxis tätig ist, erlauben wir uns, Ihnen folgenden Termin vorzuschlagen:` : ' Gerne schlagen wir Ihnen folgenden Termin vor:'}\n\nLernen Sie unsere Ärzte kennen:\n    www.augenzentrum-suhr.ch/team`
        : form.briefVariante === 'terminVerschoben'
          ? form.verschiebungDurch === 'praxis'
            ? `Leider müssen wir Ihren geplanten Termin aus organisatorischen Gründen verschieben – wir bitten um Ihr Verständnis. Ihr neuer Termin bei ${arztArtikel}${arztName ? ` ${arztName}` : ''}:`
            : `Gerne bestätigen wir Ihnen die Verschiebung Ihres Termins. Ihr neuer Termin bei ${arztArtikel}${arztName ? ` ${arztName}` : ''}:`
          : `Gemäss unseren Unterlagen steht eine Augenkontrolle ${pupText} bei ${arztArtikel}${arztName ? ` ${arztName}` : ''} an.`
      const hinweisZeilen = [
        ...(eMinor ? [`Dieses Schreiben betrifft Ihr Kind ${childName}.`, ''] : []),
        ...(!eMinor && form.vertreterModus ? [form.vertreterTyp === 'kontaktperson'
          ? `Dieses Schreiben betrifft ${childName}. Sie erhalten es als hinterlegte Kontaktperson — wir bitten Sie, die Information weiterzuleiten.`
          : `Dieses Schreiben betrifft ${childName}, für die/den Sie als gesetzliche/r Vertreter/in handeln.`, ''] : []),
      ]
      // Freier Brief an Dritte: Patient eindeutig benennen (Name + Geburtsdatum).
      const gebSuffixE = patient.gebDatum ? `, geb. ${formatDate(patient.gebDatum)}` : ''
      const hinweisZeilenFrei = [
        ...(eMinor ? [`Dieses Schreiben betrifft Ihr Kind ${childName}${gebSuffixE}.`, ''] : []),
        ...(!eMinor && form.vertreterModus ? [form.vertreterTyp === 'kontaktperson'
          ? `Dieses Schreiben betrifft ${childName}${gebSuffixE}. Sie erhalten es als hinterlegte Kontaktperson — wir bitten Sie, die Information weiterzuleiten.`
          : `Dieses Schreiben betrifft ${childName}${gebSuffixE}, für die/den Sie als gesetzliche/r Vertreter/in handeln.`, ''] : []),
      ]
      body = form.briefVariante === 'freierBrief'
        // Freier Brief: nur Anrede + Freitext (keine Termin-/VU-Sektionen)
        ? [salut, '', ...hinweisZeilenFrei, form.freiText.trim()].join('\n')
        : [
            salut, '',
            ...hinweisZeilen,
            introLineEmail,
            terminSection, vuSection, sehSection, mitbringen,
          ].join('\n')
    }

    // Identifikations-Fussnote: bei E-Mails gibt es keinen Briefkopf mit
    // Adressfenster — ohne PID/Geburtsdatum lässt sich der Patient bei
    // Rückfragen (z.B. gleicher Nachname, mehrere Familienmitglieder) nicht
    // eindeutig zuordnen.
    body += `\n\n---\nPat.-Nr.: ${normalizePid(patient.pid) || '—'} · Geb.: ${formatDate(patient.gebDatum)}`

    // Empfänger: bevorzugt die übergebene Patienten-E-Mail (aus Liris),
    // sonst der Adressblock falls er selbst eine E-Mail ist.
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const adressTrimmedLocal = form.adressBlock.trim()
    const to = (toEmail && emailRe.test(toEmail.trim())) ? toEmail.trim()
             : emailRe.test(adressTrimmedLocal) ? adressTrimmedLocal
             : ''
    const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    // Windows/ShellExecute begrenzt URLs auf ~2000 Zeichen — laengere mailto-
    // Links werden STILL verworfen (Outlook oeffnet nicht). Warnen statt raten.
    console.log('[E-Mail] mailto-Laenge:', mailtoUrl.length)
    if (mailtoUrl.length > 1950) {
      toast.warning('E-Mail-Text ist sehr lang — falls sich Outlook nicht öffnet, bitte Text kürzen (z.B. weniger Voruntersuchungen).')
    }
    // WICHTIG: window.open statt location.href — in der Electron-Desktop-App
    // wird eine location.href-Navigation auf mailto: STILL verschluckt
    // (kein will-navigate-Handler); window.open laeuft ueber den
    // setWindowOpenHandler und landet via shell.openExternal in Outlook.
    // (Gleicher Mechanismus wie bei der Berichtsanfrage im ZW-Management.)
    try { window.open(mailtoUrl) } catch { window.location.href = mailtoUrl }

    setEmailCopied(true)
    setTimeout(() => setEmailCopied(false), 4000)
  }

  // Reine Save-Logik (ohne Modal/PDF): markiert den Recall-Patienten als
  // aufgeboten. Wird sowohl manuell (handleAufgebotSave) als auch
  // automatisch (nach Postausgang-Verarbeitung) aufgerufen.
  async function persistAufgebot(patient: RecallPatient, form: AufgebotForm) {
    const today = new Date().toISOString().slice(0, 10)
    const existingVerlauf: VerlaufEntry[] = patient.verlauf ?? []
    // Allgemeine Briefe (Terminbestaetigung, Freier Brief) sind KEIN
    // Aufgebot: nur ein Verlaufseintrag, keine Aufgebots-Felder anfassen.
    if (form.briefVariante === 'terminBestaetigung' || form.briefVariante === 'freierBrief') {
      const label = form.briefVariante === 'terminBestaetigung'
        ? 'Terminbestätigung'
        : `Brief «${form.freiBetreff.trim() || 'Allgemein'}»`
      await updateRecallPatient(patient.id, {
        verlauf: [...existingVerlauf, {
          datum: today, aktion: 'Notiz',
          ergebnis: `${label} versendet${form.versand ? ` via ${form.versand}` : ''}`,
          von: displayLabel,
        }],
      }, displayLabel)
      await reloadAllTabs()
      return
    }
    const effectiveArt: AufgebotArt =
      form.art === 'Brief' && !form.terminDatum ? 'Reminder' : (form.art as AufgebotArt)
    const telResultLabel =
      form.telResult === 'erreicht'      ? 'Erreicht' :
      form.telResult === 'nichtErreicht' ? 'Nicht erreicht' :
      form.telResult === 'nichtGueltig'  ? 'Nr. nicht mehr gültig' : ''
    const telErgebnis = effectiveArt === 'Tel'
      ? [telResultLabel, form.notiz.trim()].filter(Boolean).join(' — ') || 'Anruf'
      : null
    const logEntry: VerlaufEntry = {
      datum: today,
      aktion: effectiveArt === 'Brief' ? 'Briefaufgebot' :
              effectiveArt === 'Reminder' ? 'Reminder' : 'Telefonaufgebot',
      ergebnis: telErgebnis ?? (form.versand ? `Via ${form.versand}` : 'Erstellt'),
      von: displayLabel,
    }
    const followupEntries: VerlaufEntry[] = []
    let followupAufgebotFuer: string | null = null
    if (effectiveArt === 'Tel' && form.telResult === 'nichtErreicht') {
      const fd = form.telFollowupDatum
      if (form.telFollowup === 'erneutAnrufen' && fd) {
        followupEntries.push({ datum: today, aktion: 'Telefonanruf', ergebnis: `Geplant: ${fd}`, von: displayLabel })
      } else if (form.telFollowup === 'reminderSetzen' && fd) {
        followupEntries.push({ datum: today, aktion: 'Reminder', ergebnis: `Geplant: ${fd}`, von: displayLabel })
        followupAufgebotFuer = fd
      } else if (form.telFollowup === 'briefVersenden') {
        followupEntries.push({ datum: today, aktion: 'Notiz', ergebnis: 'Brief versenden — folgt', von: displayLabel })
      }
    }
    const telDate = form.art === 'Tel' ? form.terminFixiert || null : null
    const briefDate = form.art === 'Brief' ? form.terminDatum || null : null
    await updateRecallPatient(patient.id, {
      aufgebotArt:       effectiveArt,
      aufgebotErstellt:  today,
      aufgebotVersand:   form.versand       || null,
      aufgebotNotiz:     form.notiz          || null,
      terminFixiert:     (form.art === 'Brief' ? form.terminDatum : form.terminFixiert) || null,
      ...(telDate ? { naechsteKons: telDate } : {}),
      ...(briefDate ? { naechsteKons: briefDate } : {}),
      // Aufgebot erstellt → «RC zu erstellen ab» ist obsolet. Wird beim
      // Tel-Followup (reminderSetzen) gleich darunter wieder neu gesetzt.
      aufgebotFuer:      null,
      ...(followupAufgebotFuer ? { aufgebotFuer: followupAufgebotFuer } : {}),
      verlauf:           [...existingVerlauf, logEntry, ...followupEntries],
      excelAbgeglichen:  true,
    } as any, displayLabel)
    await reloadAllTabs()
  }

  // `formOverride`/`pdfAlreadyCreated` werden von den Per-Post/Per-E-Mail-
  // Buttons übergeben: setAf() aktualisiert den State asynchron, ein direkt
  // im selben Klick-Handler folgender Aufruf würde sonst noch den ALTEN
  // (veralteten) aufgebotForm-Stand sehen (React-Closure, kein Re-Render
  // zwischen den beiden Aufrufen).
  async function handleAufgebotSave(formOverride?: AufgebotForm, pdfAlreadyCreated?: boolean) {
    const form = formOverride ?? aufgebotForm
    if (!aufgebotTarget || !form.art) return
    setAufgebotSaving(true)
    // PDF erzeugen und in den Postausgang legen NUR bei Post-Versand.
    // Bei E-Mail-Versand wird kein PDF im Postausgang abgelegt (Brief liegt in Liris via Outlook).
    // NUR wenn nicht schon per «Per Post (PDF)»-Button erzeugt — sonst doppelt im Postausgang.
    const alreadyCreated = pdfAlreadyCreated ?? aufgebotPdfCreated
    const willGeneratePdf = !alreadyCreated && form.versand === 'Post' && (
      (form.art === 'Brief' && form.terminDatum) ||
      form.briefVariante === 'freierBrief' ||
      form.art === 'Reminder'
    )
    if (willGeneratePdf) {
      try { generateBriefPDF(aufgebotTarget.patient, form) } catch (e) { console.warn('[handleAufgebotSave] PDF-Gen fehlgeschlagen', e) }
    }
    // «Als aufgeboten markieren» geschieht IMMER sofort, unabhängig davon ob
    // der Brief bereits gedruckt/ins Liris hochgeladen wurde — das Drucken/
    // Ablegen läuft eigenständig im Postausgang weiter, ohne Rückfrage.
    try {
      await persistAufgebot(aufgebotTarget.patient, form)
      // WICHTIG: Liris NICHT sofort neu laden, wenn ein Brief zum Auto-Upload
      // im Postausgang liegt — der Import braucht die noch geöffnete
      // Patientenakte; ein Reload würde sie schliessen und der Upload
      // schlüge fehl («Patient muss in Liris geöffnet sein»).
      const briefWirdHochgeladen = (alreadyCreated || willGeneratePdf)
        && !!(window as any).electronApp?.autoImportToLiris
      if (!briefWirdHochgeladen) reloadLiris()
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
  function openEdit(patient: RecallPatient, sendToLiris = true) {
    // Live-Snapshot waehrend Edit puffern -> verhindert Input-Reset beim Tippen.
    setModalBuffer(true)
    // Pflichtfelder die fehlen sofort als Fehler markieren — User sieht das
    // gleich beim Oeffnen, nicht erst beim Speichern. Gilt vor allem fuer
    // Importe aus Excel, wo Geburtsdatum und Arzt oft noch fehlen.
    const preErrors: Record<string, boolean> = {}
    if (!patient.gebDatum) preErrors.gebDatum = true
    if (patient.doctor === ZU_BEARB) preErrors.assignDoctor = true
    setEditTarget(patient); setForm(initForm(patient)); setAssignDoctor(''); setFormErrors(preErrors); setQuickInput(''); setPidDup(null); resetVorgehen()
    // PID an Liris senden — NUR in Electron sinnvoll (CORS blockt im Browser).
    // sendToLiris=false wenn der Patient bereits aus dem Liris-Kalender heraus
    // angeklickt wurde (er ist dort schon offen — kein erneutes Suchen noetig).
    if (isElectron && sendToLiris) {
      const pid = normalizePid(patient.pid)
      console.log('[Recall] openEdit -> openWithPid', { pid, patientId: patient.id })
      if (pid) openWithPid(pid)
    }
  }
  function openNew() {
    setModalBuffer(true)
    setEditTarget('new');    setForm(initForm());          setAssignDoctor(''); setFormErrors({}); setQuickInput(''); setPidDup(null); resetVorgehen()
  }
  function closeEdit() {
    if (!aufgebotTarget) setModalBuffer(false)
    setEditTarget(null)
    if (pendingReload.current) { pendingReload.current = false; loadAll() }
  }

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

  // Regel: Liegt «…erstellt am» (aufgebotErstellt) zeitlich NACH «RC zu erstellen
  // ab» (aufgebotFuer), ist das RC-Datum obsolet — das Aufgebot wurde nach dem
  // geplanten RC-Termin bereits erstellt. Dann «RC zu erstellen ab» leeren.
  // (beide sind YYYY-MM-DD aus Date-Inputs → String-Vergleich korrekt)
  useEffect(() => {
    if (editTarget && form.aufgebotErstellt && form.aufgebotFuer && form.aufgebotErstellt > form.aufgebotFuer) {
      setField('aufgebotFuer', '')
    }
  }, [editTarget, form.aufgebotErstellt, form.aufgebotFuer]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Drop-Props für Datumsfelder: hineingezogener Text wird als Datum geparst.
   *  Verwendung: <input type="date" {...dateDrop('gebDatum')} … /> */
  function dateDrop(field: keyof EditForm) {
    return {
      onDragOver: (e: React.DragEvent) => { e.preventDefault() },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const iso = parseDroppedDate(e.dataTransfer.getData('text'))
        if (iso) setField(field, iso as EditForm[typeof field])
      },
    }
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

  /** Vergleicht die user-relevanten Felder im Save-data-Objekt gegen den
   *  Original-Patient. Gibt true zurueck wenn nichts geaendert wurde — dann
   *  kann der Firestore-Write komplett uebersprungen werden. */
  // Set der Felder die im aktuell offenen Edit-Modal vom Original abweichen.
  // Wird genutzt um geaenderte Inputs visuell mit einem Bernstein-Ring
  // hervorzuheben — User sieht so direkt was er angefasst hat.
  const changedFields = useMemo(() => {
    const s = new Set<string>()
    if (!editTarget || editTarget === 'new') return s
    const norm = (v: any) => (v === '' || v === undefined ? null : v)
    const eq = (a: any, b: any) => {
      const na = norm(a), nb = norm(b)
      if (na === nb) return true
      if (na && nb && typeof na === 'object' && typeof nb === 'object') {
        return JSON.stringify(na) === JSON.stringify(nb)
      }
      return false
    }
    const fields: (keyof EditForm)[] = [
      'pid', 'vorname', 'gebDatum', 'letzteKons', 'naechsteKons',
      'storniert', 'grundStornierung',
      'nachfassAdresse', 'nachfassTel', 'nachfassTelDatum',
      'aufgebotFuer', 'aufgebotErstellt', 'aufgebotArt',
      'patientenStatus', 'neupatient', 'keinTermin', 'zuweisungNoetig',
    ]
    for (const f of fields) {
      if (!eq((form as any)[f], (editTarget as any)[f])) s.add(f as string)
    }
    return s
  }, [form, editTarget])

  /** Append-Klasse fuer Eingabefelder die vom Original abweichen. */
  const chCls = (f: string) => changedFields.has(f) ? ' ring-2 ring-amber-300 border-amber-300 bg-amber-50' : ''

  // PIDs der Recall-Patienten die seit dem Referenzdatum (Default: heute)
  // nicht mehr aktualisiert wurden. Wird in den BrowserContext gepusht,
  // damit BrowserPanel sie im Liris-Kalender farblich hervorhebt.
  // staleReferenceDate ist ein ISO-Datum YYYY-MM-DD; der User kann
  // im BrowserPanel-Header zurueckblaettern um z.B. die Liste letzter
  // Woche zu pruefen ("welche Patienten von Montag haben wir bis
  // heute nicht angefasst?").
  useEffect(() => {
    // refMs = 00:00 Uhr lokal am Referenztag. Patient gilt als OK wenn
    // aktualisiert-Datum >= refMs.
    // Patient gilt als OK wenn aktualisiert-Datum AM ODER NACH dem
    // Referenztag liegt. Beispiel: Referenztag 12.02.2026, Patient
    // zuletzt am 11.02 aktualisiert -> markiert. Am 12.02 oder spaeter
    // aktualisiert -> unmarkiert.
    const refDate = new Date(staleReferenceDate + 'T00:00:00')
    const refMs = refDate.getTime()
    if (isNaN(refMs)) return
    const stale: string[] = []
    const known: string[] = []
    for (const list of allData.values()) {
      for (const p of list) {
        const norm = normalizePid(p.pid)
        if (!norm) continue
        known.push(norm)
        // Fuer Neupatienten ohne 'aktualisiert' gilt das Erfassungsdatum
        // ('erstellt') als implizite Aktualisierung — sonst stuenden alle
        // neu angelegten Recall-Eintraege sofort als "stale" da.
        const stamp = p.aktualisiert || p.erstellt
        let okay = false
        if (stamp) {
          // Format: "DD.MM.YYYY HH:MM – username"
          const m = stamp.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/)
          if (m) {
            const ms = new Date(
              parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10),
              m[4] ? parseInt(m[4], 10) : 0, m[5] ? parseInt(m[5], 10) : 0
            ).getTime()
            if (ms >= refMs) okay = true
          }
        }
        if (!okay) stale.push(norm)
      }
    }
    setStaleRecallPids(stale)
    setKnownRecallPids(known)
  }, [allData, staleReferenceDate, setStaleRecallPids, setKnownRecallPids])

  // Hinweis "bereits aktualisiert" ist sichtbar, sobald ein bestehender
  // Patient offen ist UND nichts geaendert wurde UND kein Arzt-Wechsel
  // ausgewaehlt ist. Verschwindet automatisch sobald irgendwas angefasst
  // wird — und erscheint wieder, wenn der User alle Aenderungen rueckgaengig
  // macht.
  const showNoChangesMsg = !!editTarget
    && editTarget !== 'new'
    && changedFields.size === 0
    && !assignDoctor

  function isUserDataUnchanged(data: any, orig: RecallPatient): boolean {
    const norm = (v: any) => (v === '' || v === undefined ? null : v)
    const eq = (a: any, b: any) => {
      const na = norm(a), nb = norm(b)
      if (na === nb) return true
      if (na && nb && typeof na === 'object' && typeof nb === 'object') {
        return JSON.stringify(na) === JSON.stringify(nb)
      }
      return false
    }
    const fields = [
      'pid', 'vorname', 'gebDatum', 'letzteKons', 'naechsteKons',
      'storniert', 'grundStornierung',
      'nachfassAdresse', 'nachfassTel', 'nachfassTelDatum',
      'aufgebotFuer', 'aufgebotErstellt', 'aufgebotArt',
      'patientenStatus', 'neupatient', 'verlauf', 'zuweisung', 'zuweisungen', 'zuweisungNoetig',
    ] as const
    for (const f of fields) {
      if (!eq((data as any)[f], (orig as any)[f])) return false
    }
    return true
  }

  async function handleSave() {
    const errors: Record<string, boolean> = {}
    if (!form.pid.trim())      errors.pid      = true
    if (!form.vorname.trim())  errors.vorname  = true
    if (!form.gebDatum)        errors.gebDatum = true
    // Wenn der Patient noch keinen Arzt hat (Neuanlage ODER in "Zu bearbeiten"),
    // ist die Arzt-Zuweisung beim Speichern Pflicht — sonst landet der Patient
    // niemals in einer Arzt-Liste.
    const noDoctorYet = editTarget === 'new' || (editTarget && editTarget.doctor === ZU_BEARB)
    if (noDoctorYet && !assignDoctor) errors.assignDoctor = true
    if (form.patientenStatus === 'inaktiv' && !form.grundStornierung?.trim()) errors.grundStornierung = true
    // Aktiver Arzt Pflicht wenn Aufgebot oder Intervall+RC-Datum gesetzt.
    // Ausnahme: inaktive/verstorbene Patienten brauchen keinen aktiven Arzt.
    // Bei bestehenden Patienten nur prüfen wenn Aufgebot NEU gesetzt wird.
    const hatAufgebot = !!form.aufgebotArt?.trim()
    const hatIntervallUndRc = !!form.konsInterval?.trim() && !!form.aufgebotFuer?.trim()
    const istInaktiverPatient = form.patientenStatus === 'inaktiv' || form.patientenStatus === 'verstorben'
    const oldP = editTarget !== 'new' && editTarget ? editTarget : null
    const aufgebotUnveraendert = oldP && form.aufgebotArt === (oldP.aufgebotArt ?? '') && form.aufgebotFuer === (oldP.aufgebotFuer ?? '')
    let inaktiverArztName = ''
    if ((hatAufgebot || hatIntervallUndRc) && !istInaktiverPatient && !aufgebotUnveraendert) {
      const effDoctor = assignDoctor || (editTarget !== 'new' ? (editTarget as RecallPatient).doctor : '')
      const istAktiverArzt = doctors.includes(effDoctor)
      if (!istAktiverArzt) {
        errors.assignDoctor = true
        inaktiverArztName = effDoctor && effDoctor !== OFFEN_TAB && effDoctor !== ZU_BEARB ? effDoctor : ''
      }
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      if (errors.pid || errors.vorname || errors.gebDatum) toast.error('Bitte Pflichtfelder ausfüllen (PID, Vorname, Geburtsdatum).')
      if (errors.grundStornierung) toast.error('Bitte einen Grund angeben — bei inaktiven Patienten ist das Pflicht.')
      if (errors.assignDoctor && (hatAufgebot || hatIntervallUndRc)) {
        // Konkret sagen, WELCHER Arzt das Problem ist und WO er gewechselt
        // wird — «bereits gewählt» ist sonst irreführend, wenn der Patient
        // einem inzwischen inaktiven Arzt zugeteilt ist.
        toast.error(inaktiverArztName
          ? `Der zugeteilte Arzt «${inaktiverArztName}» ist nicht mehr aktiv — bitte im Feld «Arzt wechseln» einen aktiven Arzt wählen, bevor ein Aufgebot/Intervall gesetzt wird.`
          : 'Bitte einen aktiven Arzt zuweisen — bei gesetztem Aufgebot oder Intervall ist das Pflicht.')
      }
      else if (errors.assignDoctor) toast.error('Bitte einen Arzt auswählen — der Patient braucht eine Zuweisung.')
      return
    }

    // Doppelte PID hart blockieren — der Hinweis-Banner im Modal warnt
    // schon, aber der User sollte nicht versehentlich speichern können.
    // checkPid setzt pidDup live während des Tippens, daher ist dieser
    // Wert hier verlässlich.
    if (pidDup) {
      setFormErrors({ ...errors, pid: true })
      toast.error(`PID ${normalizePid(form.pid)} ist bereits vergeben — bitte korrigieren oder den bestehenden Eintrag öffnen.`)
      return
    }
    setFormErrors({})

    setSaving(true)
    try {
      const naechsteKons = form.naechsteKons || null

      // Auto-verlauf-Entry wenn der User im Edit-Modal aufgebotArt + aufgebotErstellt
      // setzt/ändert, damit die Auswertung diese Aufgebote auch dem User zuordnen
      // kann. Doppel-Tracking wird vermieden, falls der User heute schon einen
      // matching verlauf-Entry manuell hinzugefügt hat.
      const oldP = (editTarget !== 'new' && editTarget) ? editTarget : null
      const newArt  = form.aufgebotArt || ''
      const newDate = form.aufgebotErstellt || ''
      const oldArt  = oldP?.aufgebotArt      ?? ''
      const oldDate = oldP?.aufgebotErstellt ?? ''
      let finalVerlauf = form.verlauf
      if (newArt && newDate && (newArt !== oldArt || newDate !== oldDate)) {
        const today  = new Date().toISOString().slice(0, 10)
        const aktion = newArt === 'Brief'  ? 'Briefaufgebot'
                     : newArt === 'Tel'    ? 'Telefonaufgebot'
                     : newArt === 'Praxis' ? 'Praxisaufgebot'
                     :                        'Reminder'
        const alreadyPresent = (form.verlauf ?? []).some(v =>
          v?.datum === today && v?.aktion === aktion && v?.von === displayLabel
        )
        if (!alreadyPresent) {
          finalVerlauf = [...form.verlauf, {
            datum:    today,
            aktion,
            ergebnis: 'Im Edit-Modal erfasst',
            von:      displayLabel,
          }]
        }
      }

      // Wenn letzteKons geändert wurde, reset aufgebotErstellt
      // (der alte Aufgeboten-Status ist dann obsolet)
      // Neuer Zyklus nur, wenn die Letzte Konst. SPÄTER als die gespeicherte ist
      // (eine echte neue Konsultation) — nicht bei Korrekturen auf ein älteres Datum.
      const letzteKonsNeuer = oldP && form.letzteKons > (oldP.letzteKons ?? '')
      const aufgebotErstellt = letzteKonsNeuer ? null : (form.aufgebotErstellt || null)
      // Neuer Zyklus → auch «Weiteres Vorgehen»/Verlauf bereinigen: die
      // Eintraege (Telefonanrufe, Aufgebote, Reminder) gehoeren zum alten,
      // abgeschlossenen Recall-Zyklus. Die historische Statistik bleibt
      // davon unberuehrt (recall_activity_log ist immutable).
      if (letzteKonsNeuer) finalVerlauf = []

      // Zuweisungen: Form-Zuweisung als PRIMÄRE (erste) in die Liste schreiben,
      // weitere bestehende Zuweisungen (z.B. via ZW-Management) bewahren.
      const existingZw = oldP ? patientZuweisungen(oldP) : []
      const genZwId = () => { try { const u = (crypto as { randomUUID?: () => string }).randomUUID?.(); if (u) return u } catch { /* */ } return 'zw_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }
      const primaryZw: Zuweisung | null = form.zuweisungAktiv && form.zuweisungZiel.trim() ? {
        id:         existingZw[0]?.id || genZwId(),
        typ:        form.zuweisungTyp,
        ziel:       form.zuweisungZiel.trim(),
        grund:      form.zuweisungGrund.trim(),
        datum:      form.zuweisungDatum,
        status:     form.zuweisungStatus,
        erledigtAm: form.zuweisungErledigtAm,
        berichtErhalten: form.zuweisungBerichtErhalten,
        ...(existingZw[0]?.berichtAngefragt !== undefined ? { berichtAngefragt: existingZw[0].berichtAngefragt } : {}),
        ...(existingZw[0]?.berichtAngefragtAm ? { berichtAngefragtAm: existingZw[0].berichtAngefragtAm } : {}),
        notiz:      form.zuweisungNotiz.trim(),
        von:        existingZw[0]?.von || displayLabel,
      } : null
      const zuweisungenList = primaryZw ? [primaryZw, ...form.zuweisungExtra] : [...form.zuweisungExtra]

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
        aufgebotErstellt: aufgebotErstellt,
        aufgebotArt:      form.aufgebotArt       || null,
        aufgebotVersand:  null,
        aufgebotNotiz:    null,
        terminFixiert:    null,
        patientenStatus:  form.patientenStatus   || null,
        neupatient:       (editTarget !== 'new' && normalizePid(form.pid) && !editTarget?.pid) ? false : (form.neupatient || null),
        rcErstellt:       !!(form.aufgebotArt && form.aufgebotErstellt) || null,
        verlauf:          finalVerlauf.length > 0 ? finalVerlauf : null,
        zuweisung:        null,   // Legacy-Einzelfeld migriert in zuweisungen[]
        zuweisungen:      zuweisungenList.length > 0 ? zuweisungenList : null,
        zuweisungNoetig:  form.zuweisungNoetig || null,
      }
      // Nach dem Speichern bleibt der User IMMER auf der aktuellen Tab/Liste.
      // Auch bei Patient-Umhängung (assignDoctor) oder Neuanlage in einem
      // anderen Tab springt die Ansicht NICHT auf den Ziel-Tab — User möchte
      // auf der gerade bearbeiteten Liste weiterarbeiten.
      // reloadTab() für die betroffenen Tabs läuft trotzdem, damit beim
      // späteren Wechsel die Daten aktuell sind.
      if (editTarget === 'new') {
        const targetTab = assignDoctor || activeTab
        await createRecallPatient(targetTab, data, displayLabel)
        await reloadAllTabs()
        closeEdit()
      } else if (editTarget) {
        // No-Op-Check: wenn keine User-Eingabe geaendert wurde UND keine Arzt-
        // Zuweisung vorliegt, das Doc NICHT ueberschreiben (kein aktualisiert-
        // Update, kein Live-Snapshot-Trigger).
        const noChanges = !assignDoctor && isUserDataUnchanged(data, editTarget)
        if (noChanges) {
          await touchRecallPatient(editTarget.id, displayLabel)
          toast.info('Keine Änderungen — als geprüft markiert.')
          pendingReload.current = true
          closeEdit()
          return
        }
        await updateRecallPatient(editTarget.id, { ...data, excelAbgeglichen: true } as any, displayLabel)
        if (assignDoctor) {
          await assignRecallPatient(editTarget.id, assignDoctor, displayLabel)
        }
        await reloadAllTabs()
        closeEdit()
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
    // Bei Brief-Aufgebot: Modal öffnen statt inline zu setzen
    if (newValue === 'Brief') {
      const row = (allData.get(doctor) ?? []).find(r => r.id === rowId)
      if (row) {
        openAufgebotDialog({ patient: row })
      }
      return
    }

    const today = new Date().toISOString().slice(0, 10)
    // Praxis-Aufgebot: meist beim letzten Konsil direkt vereinbart. Wird der
    // Inline-Toggle nachtraeglich gesetzt, ist das Datum des letzten Konsils
    // das semantisch korrekte aufgebotErstellt — sonst muesste der User das
    // Datum jedes Mal manuell anpassen. Wenn kein letzteKons vorhanden -> today.
    const row = (allData.get(doctor) ?? []).find(r => r.id === rowId)
    const erstelltDatum = newValue === 'Praxis' && row?.letzteKons
      ? row.letzteKons
      : today
    const newErstellt = newValue ? erstelltDatum : null

    // verlauf-Entry nur bei Neusetzen, aktions-Namen analog zu aufgebotConfirm().
    // ergebnis = 'Inline erfasst' wird vom Auswertung-Aggregator als echtes
    // Aufgebot gewertet (für Reminder: Whitelist gegen 'Geplant:'/'Abgesagt').
    const inlineEntry: VerlaufEntry | null = newValue ? {
      datum: erstelltDatum,                       // gleich wie aufgebotErstellt
      aktion: newValue === 'Brief'  ? 'Briefaufgebot'
            : newValue === 'Tel'    ? 'Telefonaufgebot'
            : newValue === 'Praxis' ? 'Praxisaufgebot'
            :                          'Reminder',
      ergebnis: 'Inline erfasst',
      von: displayLabel,
    } : null

    // verlauf-Append + Firestore-Payload werden INSIDE setAllData berechnet,
    // damit bei zwei parallelen Inline-Toggles keine Entries verlorengehen.
    // Wir merken uns die finale Verlauf-Liste über eine Ref-Variable, damit
    // der nachfolgende Firestore-Write dieselbe Liste schreibt wie der UI-State.
    let finalVerlauf: VerlaufEntry[] = []
    setAllData(prev => {
      const next = new Map(prev)
      const updated = (next.get(doctor) ?? []).map(r => {
        if (r.id !== rowId) return r
        const verlauf = inlineEntry ? [...(r.verlauf ?? []), inlineEntry] : (r.verlauf ?? [])
        finalVerlauf = verlauf
        return { ...r, aufgebotArt: newValue, aufgebotErstellt: newErstellt, verlauf }
      })
      next.set(doctor, updated)
      return next
    })
    try {
      const payload: any = { aufgebotArt: newValue, aufgebotErstellt: newErstellt }
      if (inlineEntry) payload.verlauf = finalVerlauf
      await updateRecallPatient(rowId, payload, displayLabel)
      await reloadAllTabs()
    } catch {
      await reloadAllTabs()
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
      await reloadAllTabs()
    } catch {
      await reloadAllTabs()
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
      await reloadAllTabs()
    } catch {
      await reloadAllTabs()
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
      await reloadAllTabs()
    } catch {
      await reloadAllTabs()
    }
  }

  function handleDelete() {
    if (editTarget === 'new' || !editTarget) return
    setDeletePassword('')
    setDeleteErr('')
    setShowDeleteConfirm(true)
  }

  async function confirmDelete() {
    const target = deleteTargetOverride || (editTarget && editTarget !== 'new' ? { id: editTarget.id, label: editTarget.vorname || '—', doctor: editTarget.doctor } : null)
    if (!target) return
    if (!deletePassword.trim()) { setDeleteErr('Passwort eingeben'); return }
    setDeleting(true)
    setDeleteErr('')
    try {
      const cu = currentUser
      if (!cu?.email) throw new Error('Nicht eingeloggt')
      const cred = EmailAuthProvider.credential(cu.email, deletePassword)
      await reauthenticateWithCredential(cu, cred)
      await deleteRecallPatient(target.id)
      setShowDeleteConfirm(false)
      setDeleteTargetOverride(null)
      setLirisMismatch(null)
      await reloadAllTabs()
      closeEdit()
      toast.success('Patient gelöscht.')
    } catch (e: any) {
      if (e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential') {
        setDeleteErr('Falsches Passwort')
      } else {
        setDeleteErr(e?.message || 'Fehler beim Löschen')
      }
    } finally {
      setDeleting(false)
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

      {/* Back + Tab bar — im Aufgebotsplan (RECALL) ausgeblendet, der zeigt
          sich stattdessen wie ZW-Management als eigenständige Ansicht ohne
          Ärzte-Register. Zurück zur Ärzte-Ansicht über den Button im
          Wochenplan-Header. */}
      {activeTab !== AUFGEBOT_TAB && (
      <div className="px-6 pt-4 border-b border-gray-200 bg-white shrink-0">
        <nav className="flex items-end gap-1 flex-wrap">
          {allTabs.map(tab => {
            const rawCount = allData.get(tab)?.length ?? 0
            const isActive = activeTab === tab
            // Aktiver Tab: zeige die nach Filter sichtbare Anzahl (rows.length)
            // damit Badge mit dem tatsaechlich angezeigten Listeninhalt
            // uebereinstimmt. Andere Tabs: Roh-Anzahl (Filter waren ja nicht
            // angewandt).
            const count = isActive ? rows.length : rawCount
            const isZuBearb = tab === ZU_BEARB
            const isAufgebot = tab === AUFGEBOT_TAB
            const isOffen   = tab === OFFEN_TAB
            return (
              <button
                key={tab}
                onClick={() => switchTab(tab)}
                title={isActive && rawCount !== count ? `${count} sichtbar von ${rawCount} insgesamt (inaktive/verstorbene ausgeblendet)` : undefined}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 ${
                  isAufgebot
                    ? isActive
                      ? 'border-indigo-500 text-indigo-700 bg-indigo-50'
                      : 'border-transparent text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50'
                    : isZuBearb
                      ? isActive
                        ? 'border-amber-500 text-amber-700 bg-amber-50'
                        : 'border-transparent text-amber-600 hover:text-amber-700 hover:bg-amber-50'
                      : isOffen
                        ? isActive
                          ? 'border-slate-500 text-slate-700 bg-slate-100'
                          : 'border-transparent text-slate-600 hover:text-slate-700 hover:bg-slate-50'
                        : isActive
                          ? 'border-primary-600 text-primary-700 bg-primary-50'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {isOffen ? OFFEN_LABEL : tab}
                {!isAufgebot && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    isZuBearb
                      ? isActive ? 'bg-amber-100 text-amber-700' : 'bg-amber-100 text-amber-600'
                      : isOffen
                        ? isActive ? 'bg-slate-200 text-slate-700' : 'bg-slate-200 text-slate-600'
                        : isActive ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'
                  }`}>{count}</span>
                )}
              </button>
            )
          })}
          {/* ZW-Management — direkt hinter dem letzten Register (RECALL) */}
          <button
            onClick={() => navigate('/zuweisungen')}
            title="ZW-Management (Zuweisungen verwalten)"
            className="mb-1 ml-1 flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors shrink-0"
          >
            <ArrowRightLeft className="w-4 h-4" /> <span className="hidden sm:inline">ZW-Management</span>
          </button>
        </nav>
      </div>
      )}

      {/* Status-Meldung (sync / import) */}
      {syncMsg && (
        <div className="shrink-0 px-4 sm:px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          {importingZuBearb && <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin shrink-0" />}
          <p className="text-xs text-amber-800 font-medium">{syncMsg}</p>
        </div>
      )}

      {/* Toolbar: Suche + Neu, Zuweisungen, Auswertung … — im RECALL-Register ausgeblendet */}
      {activeTab !== AUFGEBOT_TAB && (
      <div className="shrink-0 flex flex-col sm:flex-row gap-2 sm:gap-3 items-start sm:items-center justify-between px-2 sm:px-6 py-2 sm:py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-1.5 sm:gap-3 w-full sm:w-auto">

          {/* Suche — filtert die Liste arztübergreifend (Name, PID, Geburtsdatum) */}
          <div className="relative flex-1 sm:flex-none sm:w-72 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Suche (Name, PID, Geb.-Datum)…"
              className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                title="Suche leeren"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* New patient */}
          <button
            onClick={openNew}
            title="Neuer Patient"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-sm font-medium bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Neu</span>
          </button>

          {/* Kimenda Excel import – nur auf "Zu bearbeiten" tab UND nur für Admin/GL */}
          {activeTab === ZU_BEARB && canManageImports && (
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
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-sm font-medium border border-amber-300 text-amber-700 bg-amber-50 rounded-xl hover:bg-amber-100 disabled:opacity-50 transition-colors shrink-0"
                title="Patientenliste (.xlsx) importieren"
              >
                {importingZuBearb ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span className="hidden sm:inline">{importingZuBearb ? 'Importiert…' : 'Patientenliste Upload'}</span>
              </button>
              {lastImport && (
                <button
                  onClick={() => setShowUndoImportConfirm(true)}
                  disabled={importingZuBearb}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-sm font-medium border border-red-300 text-red-700 bg-red-50 rounded-xl hover:bg-red-100 disabled:opacity-50 transition-colors shrink-0"
                  title={`Letzte Einlesung rückgängig machen — ${lastImport.count} Patienten vom ${lastImport.dateStr} (${lastImport.user})`}
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Letzte Einlesung rückgängig ({lastImport.count})</span>
                  <span className="sm:hidden text-[10px] font-bold tabular-nums">{lastImport.count}</span>
                </button>
              )}
            </>
          )}

          {/* Aufgebot-Plan -> jetzt ueber den gleichnamigen Tab oben */}

          {/* Auswertung — nur GL / Ärzte / Admin */}
          {(isGeschaeftsleitung || isArzt || isAdmin) && (
            <button
              onClick={() => setAuswertungOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors shrink-0"
              title="Auswertung"
            >
              <BarChart2 className="w-4 h-4" />
              <span className="hidden sm:inline">Auswertung</span>
            </button>
          )}
        </div>

        {/* Tab stats */}
        <div className="flex items-center gap-3 text-xs text-gray-500 shrink-0">
          <span className="font-medium text-gray-700">
            {search.trim().length >= 2
              ? `${rows.length} Treffer`
              : `${rows.length} Einträge`}
          </span>
          {(filterTermin || filterNeupatient || filterStatus || filterGrund || filterAufgebotArt || filterNochZuErledigen || filterReminderFaellig || filterReminderGeplant || filterVerlaufAktion || filterInaktivArzt) && (
            <button
              onClick={() => { setFilterTermin(null); setFilterNeupatient(false); setFilterStatus(null); setFilterGrund(null); setFilterAufgebotArt(null); setFilterNochZuErledigen(false); setFilterReminderFaellig(false); setFilterVerlaufAktion(null); setFilterReminderGeplant(false); setFilterInaktivArzt(null); setPage(1) }}
              className="flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200 font-medium hover:bg-gray-200 transition-colors"
            >
              <X className="w-3 h-3" /> Filter zurücksetzen
            </button>
          )}
        </div>
      </div>
      )}



      {activeTab !== AUFGEBOT_TAB && <>
      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-4 sm:px-6 py-2 bg-white border-b border-gray-100 overflow-x-auto">

        {/* Termin-chips: nur die 3 wichtigsten immer sichtbar */}
        {([
          { key: 'overdue'    as FilterTermin, label: 'Überfällig',  count: tabStats.overdue,    cls: 'bg-red-100 text-red-700 border-red-300' },
          { key: 'nachfass'   as FilterTermin, label: 'Nachfassen',  count: tabStats.nachfass,   cls: 'bg-orange-100 text-orange-700 border-orange-300' },
          { key: 'inPlanung'  as FilterTermin, label: 'Geplante Recalls', count: tabStats.inPlanung, cls: 'bg-amber-100 text-amber-700 border-amber-300' },
          { key: 'ohneTermin' as FilterTermin, label: 'Ohne Termin', count: tabStats.ohneTermin, cls: 'bg-gray-200 text-gray-700 border-gray-300' },
          { key: 'ohneRC'     as FilterTermin, label: 'Ohne RC',     count: tabStats.ohneRC,     cls: 'bg-slate-200 text-slate-700 border-slate-300' },
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
                setFilterStatus(v === 'storniert' ? 'storniert' : v === 'inaktiv' ? 'inaktiv' : v === 'nieBeimArzt' ? 'nieBeimArzt' : null)
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
              <option value="nieBeimArzt">Noch nie beim Arzt ({tabStats.nieBeimArzt})</option>
            </select>
          )
        })()}

        {/* Grund-Dropdown (Storno-Grund) — erscheint erst, wenn ein passender
            Status-Filter (Storniert / Inaktiv) aktiv ist, damit die Leiste
            im Normalzustand schlank bleibt. Nur Gruende anbieten, die im
            AKTUELLEN Tab tatsaechlich vorkommen. */}
        {(filterStatus === 'storniert' || filterStatus === 'inaktiv' || filterGrund) && (() => {
          const gruende = new Set<string>()
          for (const p of allData.get(activeTab) ?? []) {
            const g = (p.grundStornierung || '').trim()
            if (g) gruende.add(g)
          }
          // Aktiver Filter aus einem anderen Tab bleibt sichtbar/abwaehlbar,
          // auch wenn der Grund hier nicht vorkommt.
          if (filterGrund) gruende.add(filterGrund)
          const sorted = Array.from(gruende).sort((a, b) => a.localeCompare(b, 'de'))
          if (sorted.length === 0) return null
          return (
            <select
              value={filterGrund ?? ''}
              onChange={e => { setFilterGrund(e.target.value || null); setPage(1) }}
              className={`text-xs border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-300 cursor-pointer ${
                filterGrund ? 'border-primary-300 bg-primary-50 text-primary-700 font-semibold' : 'border-gray-200 bg-white text-gray-500'
              }`}
            >
              <option value="">Grund…</option>
              {sorted.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          )
        })()}

        {/* Arzt-Abgleich läuft: kompakte Fortschritts-Anzeige (Start-Button
            liegt in der Auswertung — er ist kein Filter). */}
        {isElectron && arztScan?.running && (
          <span className="flex items-center gap-1.5 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 shrink-0">
            <span className="animate-pulse">⟳</span>
            Abgleich {arztScan.done}/{arztScan.total} · {arztScan.found} erkannt · {arztScan.umgeteilt} zugeteilt
            <button type="button" onClick={() => { arztScanAbort.current = true }}
              className="ml-1 font-semibold underline hover:no-underline">Stopp</button>
          </span>
        )}

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

        {activeTab === OFFEN_TAB && (
          <button
            type="button"
            onClick={e => handleSort('doctor', e.shiftKey)}
            title="Nach Arzt sortieren · Shift+Klick: Mehrfach-Sortierung"
            className={`text-xs border rounded-lg px-2 py-1 focus:outline-none flex items-center ${
              sortKeys.some(k => k.col === 'doctor') ? 'border-primary-300 bg-primary-50 text-primary-800 font-semibold' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            Arzt{sortIcon('doctor')}
          </button>
        )}

        {activeTab === OFFEN_TAB && inaktiveAerzte.length > 0 && (
          <select
            value={filterInaktivArzt ?? ''}
            onChange={e => { setFilterInaktivArzt(e.target.value || null); setPage(1) }}
            className={`text-xs border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-300 cursor-pointer ${
              filterInaktivArzt ? 'border-orange-300 bg-orange-50 text-orange-700 font-semibold' : 'border-gray-200 bg-white text-gray-500'
            }`}
          >
            <option value="">Inaktive Ärzte…</option>
            {inaktiveAerzte.map(a => <option key={a.nachname} value={a.nachname}>{a.nachname}</option>)}
          </select>
        )}

      </div>

      {/* ── Leitfaden: Reminder fällig ──────────────────────────────────────── */}
      {filterReminderFaellig && (
        <div className="shrink-0 mx-4 sm:mx-6 my-2 p-3 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-900 space-y-1.5">
          <p className="font-bold text-sm flex items-center gap-1.5"><Bell className="w-4 h-4" /> Vorgehen bei fälligen Remindern</p>
          <ol className="list-decimal list-inside space-y-1 pl-1">
            <li><strong>Patient anrufen.</strong> Termin vereinbaren und im System eintragen.</li>
            <li><strong>Nicht erreichbar?</strong> Neuen Reminder auf <strong>1 Monat</strong> setzen und erneut versuchen.</li>
            <li><strong>Beim 2. Versuch wieder nicht erreichbar?</strong> Patient <strong>inaktivieren</strong>.</li>
            <li><strong>Telefonnummer ungültig?</strong> Patient sofort <strong>inaktivieren</strong>.</li>
          </ol>
          <p className="text-[10px] text-purple-600 italic">Jeden Kontaktversuch im Verlauf dokumentieren.</p>
        </div>
      )}

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
                {row.aufgebotFuer && !row.aufgebotErstellt && (
                  <span title={`Recall geplant für ${formatDate(row.aufgebotFuer)}`} className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">RC</span>
                )}
                {row.verlauf?.some(v => v.ergebnis === 'noch zu erledigen') && (
                  <span title="Kontakt noch zu erledigen" className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">⏳</span>
                )}
                {(() => {
                  const offen = patientZuweisungen(row).filter(z => z.status === 'pendent' || (z.status as string) === 'ausstehend')
                  if (offen.length === 0) return null
                  const z0 = offen[0]
                  return (
                    <span title={offen.map(z => `Zuweisung pendent → ${z.ziel}`).join('\n')} className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-300">↪ {z0.typ === 'intern' ? 'Int.' : 'Ext.'}{offen.length > 1 ? ` ×${offen.length}` : ''}</span>
                  )
                })()}
                {storniert && (
                  <span className="ml-auto shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">storniert</span>
                )}
              </div>
              {/* PID + Geb. Datum */}
              <div className="flex items-center gap-3 text-xs text-gray-400 pl-6">
                {row.pid && <span className="font-mono">#{normalizePid(row.pid)}</span>}
                {row.gebDatum && row.gebDatum !== 'kein Termin' && <span>{formatDate(row.gebDatum)}</span>}
                <MinorBadge gebDatum={row.gebDatum} />
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
                  // Taggenau (einheitlich mit isOverdue + RC-Badge): überfällig
                  // sobald das RC-Datum in der Vergangenheit liegt, kein 1-Monats-Karenz.
                  const today = new Date().toISOString().slice(0, 10)
                  const overdue = !rcErstellt && row.aufgebotFuer < today && row.patientenStatus !== 'kein Aufgebot'
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
              <th onClick={e => handleSort('pid', e.shiftKey)}          title="Klick: sortieren · Shift+Klick: Mehrfach-Sortierung" className={thSortCls('pid',          "text-left px-3 py-3 whitespace-nowrap hidden md:table-cell sticky left-10 z-30 min-w-[80px] " + (sortKeys.some(k => k.col === 'pid') ? '' : 'bg-gray-50'))}>PID{sortIcon('pid')}</th>
              <th onClick={e => handleSort('vorname', e.shiftKey)}      title="Klick: sortieren · Shift+Klick: Mehrfach-Sortierung" className={thSortCls('vorname',      "text-left px-3 py-3 whitespace-nowrap sticky left-10 md:left-[120px] z-30 min-w-[120px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] " + (sortKeys.some(k => k.col === 'vorname') ? '' : 'bg-gray-50'))}>Vorname{sortIcon('vorname')}</th>
              <th onClick={e => handleSort('gebDatum', e.shiftKey)}     title="Klick: sortieren · Shift+Klick: Mehrfach-Sortierung" className={thSortCls('gebDatum',     "text-left px-3 py-3 whitespace-nowrap")}>Geb. Datum{sortIcon('gebDatum')}</th>
              <th onClick={e => handleSort('letzteKons', e.shiftKey)}   title="Klick: sortieren · Shift+Klick: Mehrfach-Sortierung" className={thSortCls('letzteKons',   "text-left px-3 py-3 whitespace-nowrap")}>Letzte Konst.{sortIcon('letzteKons')}</th>
              <th onClick={e => handleSort('naechsteKons', e.shiftKey)} title="Klick: sortieren · Shift+Klick: Mehrfach-Sortierung" className={thSortCls('naechsteKons', "text-left px-3 py-3 whitespace-nowrap")}>Nächste Konst.{sortIcon('naechsteKons')}</th>
              <th onClick={e => handleSort('aufgebotFuer', e.shiftKey)} title="Klick: sortieren · Shift+Klick: Mehrfach-Sortierung" className={thSortCls('aufgebotFuer', "text-left px-3 py-3 whitespace-nowrap")}>RC / Aufgebot{sortIcon('aufgebotFuer')}</th>
              <th onClick={e => handleSort('storniert', e.shiftKey)}    title="Klick: sortieren · Shift+Klick: Mehrfach-Sortierung" className={thSortCls('storniert',    "text-left px-3 py-3 whitespace-nowrap")}>Storniert{sortIcon('storniert')}</th>
              <th className="px-2 py-3 w-[120px] text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Schnellaktionen</th>
              <th onClick={e => handleSort('aktualisiert', e.shiftKey)} title="Klick: sortieren · Shift+Klick: Mehrfach-Sortierung" className={thSortCls('aktualisiert', "text-left px-3 py-3 whitespace-nowrap")}>Aktualisiert{sortIcon('aktualisiert')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-gray-400">
                  Keine Einträge gefunden.
                </td>
              </tr>
            ) : (
              pageRows.map((row, idx) => {
                const storniert  = isStorniert(row)
                const keinTermin = isKeinTermin(row.naechsteKons)
                const futureNext = isFutureDate(row.naechsteKons)
                const patStatus  = s(row.patientenStatus)
                const isInaktiv  = patStatus === 'inaktiv' || patStatus === 'verstorben'
                const showGroupHeader = activeTab === OFFEN_TAB && (idx === 0 || pageRows[idx - 1].doctor !== row.doctor)
                return (<Fragment key={row.id}>
                  {showGroupHeader && (
                    <tr className="bg-slate-100 border-t-2 border-slate-300">
                      <td colSpan={10} className="px-4 py-2 text-sm font-bold text-slate-700">
                        {row.doctor === OFFEN_TAB ? 'Ohne Zuordnung' : row.doctor}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          ({pageRows.filter(r => r.doctor === row.doctor).length})
                        </span>
                      </td>
                    </tr>
                  )}
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
                      <div className="flex items-center gap-1">
                        {patStatus === 'verstorben'    && <span title="Verstorben" className="text-gray-500 text-sm font-bold leading-none">✝</span>}
                        {patStatus === 'inaktiv'       && <span title="Inaktiv"><MinusCircle className="w-4 h-4 text-gray-400" /></span>}
                        {patStatus === 'aktiv'         && <span title="Aktiv"><CheckCircle2 className="w-4 h-4 text-green-600" /></span>}
                        {patStatus === 'Reminder'      && <span title="Reminder"><Bell className="w-4 h-4 text-blue-500" /></span>}
                        {patStatus === 'kein Aufgebot' && <span title="kein Aufgebot - meldet sich b. Bedarf"><BellOff className="w-4 h-4 text-gray-400" /></span>}
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 text-gray-400 text-xs tabular-nums whitespace-nowrap hidden md:table-cell sticky left-10 z-10 min-w-[80px] ${storniert ? 'bg-red-50' : 'bg-white'}`}>
                      {row.pid ? (
                        <span className="flex items-center gap-1">
                          <span>{`#${normalizePid(row.pid)}`}</span>
                          <button onClick={e => { e.stopPropagation(); copyToClipboard(`#${normalizePid(row.pid)}`, `pid-${row.id}`) }} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-primary-500" title="Kopieren">
                            {copiedCell === `pid-${row.id}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                          {/* "→ Liris" — nur in der Electron-Desktop-App. Im Browser
                              koennen wir Liris nicht steuern (CORS) -> Button nicht zeigen. */}
                          {isElectron && (
                            <button
                              onClick={e => { e.stopPropagation(); openWithPid(normalizePid(row.pid) ?? '') }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-primary-600"
                              title="In Liris öffnen"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
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
                          {row.aufgebotFuer && !row.aufgebotErstellt && (
                            <span title={`Recall geplant für ${formatDate(row.aufgebotFuer)}`} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 shrink-0">RC</span>
                          )}
                          {row.verlauf?.some(v => v.ergebnis === 'noch zu erledigen') && (
                            <span title={pendingVorgehenLabel(row)} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 shrink-0">⏳ {pendingVorgehenLabel(row)}</span>
                          )}
                          {(() => {
                            const dueDate  = getReminderDueDate(row)
                            const upcoming = getUpcomingReminderDate(row)
                            if (dueDate)  return <span title={`Reminder fällig seit ${formatDate(dueDate)} — Patient anrufen`} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-300 shrink-0">🔔 Reminder {formatDate(dueDate)}</span>
                            if (upcoming) return <span title={`Reminder geplant am ${formatDate(upcoming)}`} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-200 shrink-0">🔔 {formatDate(upcoming)}</span>
                            return null
                          })()}
                          {isNachfassFaellig(row) && (
                            <span
                              title="Aufgeboten, aber seit über 8 Wochen kein Termin gebucht — bitte nachfassen. Nach dem 1. Brief als nächste Stufe telefonisch nachfassen."
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-300 shrink-0 cursor-help">
                              ↻ Nachfassen → {nachfassNext(row.aufgebotArt) === 'Tel' ? 'Tel.' : 'Brief'}
                            </span>
                          )}
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
                          <MinorBadge gebDatum={row.gebDatum} />
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
                    <td className="px-3 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        {/* RC-Datum */}
                        <div className="text-xs tabular-nums text-gray-500 min-w-[70px]">
                          {(() => {
                            const rcErstellt = !!(row.aufgebotArt && row.aufgebotErstellt)
                            if (row.aufgebotErstellt) {
                              const de = new Date(row.aufgebotErstellt + 'T00:00:00Z')
                              if (!isNaN(de.getTime())) {
                                const label = `${String(de.getUTCDate()).padStart(2,'0')}.${String(de.getUTCMonth()+1).padStart(2,'0')}.${de.getUTCFullYear()}`
                                return <span className="flex flex-col gap-0.5"><span>{label}</span><span className="text-[10px] font-semibold text-green-600">erstellt</span></span>
                              }
                            }
                            if (!row.aufgebotFuer) {
                              if (isOhneTermin(row)) return <span title="Kein nächster Termin und kein RC-Datum gesetzt" className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-300 text-[10px] font-semibold">ohne RC</span>
                              if (isAwaitingZuweisungsBericht(row)) return <span title="Wartet auf Abschluss-Bericht" className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200 text-[10px] font-semibold">⏳ Bericht</span>
                              return <span className="text-gray-300">—</span>
                            }
                            const d = new Date(row.aufgebotFuer + 'T00:00:00Z')
                            if (isNaN(d.getTime())) return <span className="text-gray-300">—</span>
                            const label = `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`
                            const today = new Date().toISOString().slice(0, 10)
                            const hatZukunftsTermin = row.naechsteKons && row.naechsteKons !== 'kein Termin' && row.naechsteKons >= today
                            const lkInPast = row.letzteKons && row.letzteKons < today
                            const aufgebotInZukunft = row.aufgebotFuer && row.aufgebotFuer >= today
                            const isOverdue = !rcErstellt && !hatZukunftsTermin && !!lkInPast && !aufgebotInZukunft && row.patientenStatus !== 'kein Aufgebot'
                            return <span className="flex flex-col gap-0.5"><span>{label}</span>{isOverdue && <span className="text-[10px] font-semibold text-red-500">überfällig</span>}</span>
                          })()}
                        </div>
                        {/* Aufgebotsart-Icons */}
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
                </Fragment>)
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
      </>}

      {/* ── Aufgebot-Dialog ────────────────────────────────────────────────────── */}
      {aufgebotTarget && (() => {
        const p = aufgebotTarget.patient
        const af = aufgebotForm
        const setAf = (patch: Partial<AufgebotForm>) => setAufgebotForm(f => ({ ...f, ...patch }))
        const canSave = !!af.art && (
          af.art === 'Tel'
            ? !!af.notiz.trim()
            : af.art === 'Reminder'
              ? !!af.adressBlock.trim() && !!af.versand && !!af.anrede
              : !!af.adressBlock.trim() && !!af.versand && !!af.anrede && !!af.terminDatum && !!af.terminZeit
        )
        const livePreviewHtml = (af.art === 'Brief' || af.art === 'Reminder') ? buildBriefHtml(p, af) : null

        // Terminverschiebung ist technisch ein Briefaufgebot mit der Variante
        // 'terminVerschoben' — als eigene Karte, damit der Ablauf gleich
        // funktioniert wie Briefaufgebot/Reminder (Adresse, Versand, Vorschau).
        const ART_BUTTONS: { art: AufgebotArt; variante?: 'terminVerschoben'; Icon: React.ComponentType<{className?:string}>; label: string; sub: string; color: string }[] = [
          { art: 'Brief',    Icon: Mail,  label: 'Briefaufgebot', sub: 'Einladung zu festem Termin',        color: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' },
          { art: 'Reminder', Icon: Bell,  label: 'Reminder',      sub: 'ohne Termin · meldet sich selbst',   color: 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100' },
          { art: 'Brief', variante: 'terminVerschoben', Icon: CalendarClock, label: 'Terminverschiebung', sub: 'Bestätigung des neuen Termins', color: 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100' },
        ]

        return (
          <>
            {/* Aufbieten-Modal — verschiebbar wie Patient-Bearbeiten.
                Re-use modalRef/modalPos/isDragging (immer nur eines offen). */}
            {(() => {
            // Bei eingeklappter Vorschau: Modal schmaler darstellen,
            // damit es nicht halbleer wirkt.
            const widthExpanded  = 'min(72rem, calc(100vw - 2rem))'
            const widthCollapsed = 'min(30rem, calc(100vw - 2rem))'
            const w = previewCollapsed ? widthCollapsed : widthExpanded
            return (
            <div
              ref={modalRef}
              style={modalPos
                ? { position: 'fixed', left: modalPos.x, top: modalPos.y, zIndex: 61, width: w, maxHeight: 'calc(100vh - 2rem)' }
                : { position: 'fixed', left: '50%',       top: '50%',      zIndex: 61, width: w, maxHeight: 'calc(100vh - 2rem)', transform: 'translate(-50%,-50%)' }
              }
              className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            >

              {/* Header — Drag-Handle */}
              <div
                onMouseDown={onModalDragStart}
                className={`flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
              >
                <div className="pointer-events-none">
                  <h2 className="font-bold text-gray-900 flex items-center gap-2">Aufbieten & Briefe <MinorBadge gebDatum={p.gebDatum} /></h2>
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

                {/* Step 1: Art wählen — Aufgebote + Allgemeine Briefe.
                    Sondervarianten (eigene Karten) vs. Brief-Basiskarte:
                    die Basiskarte ist aktiv, solange KEINE Sondervariante
                    gewaehlt ist (Normal/neuerArzt/terminVerpasst laufen
                    ueber die Varianten-Buttons darunter). */}
                {(() => {
                  const SONDER = ['terminVerschoben', 'terminBestaetigung', 'freierBrief']
                  const renderCard = ({ art, variante, Icon, label, sub, color, fullWidth }: { art: AufgebotArt; variante?: string; Icon: React.ComponentType<{className?:string}>; label: string; sub: string; color: string; fullWidth?: boolean }) => {
                    const isActive = variante
                      ? af.art === art && af.briefVariante === variante
                      : af.art === art && !(art === 'Brief' && SONDER.includes(af.briefVariante))
                    return (
                      <button
                        key={art + (variante ?? '')}
                        onClick={() => {
                          const next = isActive ? null : art
                          setAf({ art: next, briefVariante: (next && variante ? variante : '') as AufgebotForm['briefVariante'], versand: '', notiz: '', pupille: false })
                          // Bei Brief ODER Reminder (inkl. Sondervarianten) -> Liris-Akte
                          // oeffnen, damit Anrede/Adresse via lirisExtract-Handler ins
                          // Formular gefuellt werden. Tel braucht das nicht.
                          if ((next === 'Brief' || next === 'Reminder') && aufgebotTarget) {
                            const pid = normalizePid(aufgebotTarget.patient.pid)
                            if (pid) openWithPid(pid)
                          }
                        }}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-colors ${fullWidth ? 'col-span-2' : ''} ${
                          isActive ? color + ' border-current' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="text-xs font-semibold leading-tight">{label}</span>
                        <span className="text-[10px] opacity-70 leading-tight">{sub}</span>
                      </button>
                    )
                  }
                  return (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Aufgebot & Reminder</p>
                      <div className="grid grid-cols-2 gap-2">
                        {ART_BUTTONS.map(b => renderCard({ ...b, fullWidth: !!b.variante }))}
                      </div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4">Allgemeine Briefe <span className="font-normal normal-case text-gray-400">(kein Aufgebot)</span></p>
                      <div className="grid grid-cols-2 gap-2">
                        {renderCard({ art: 'Brief', variante: 'terminBestaetigung', Icon: CalendarClock, label: 'Terminbestätigung', sub: 'Bestätigung des vereinbarten Termins', color: 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100' })}
                        {renderCard({ art: 'Brief', variante: 'freierBrief', Icon: Pencil, label: 'Freier Brief', sub: 'Eigener Betreff & Text auf Briefkopf', color: 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100' })}
                        {/* Direkt-Aktion (kein Brief-Flow): vorbereitete E-Mail an das
                            Berichtesekretariat der KSA-Augenklinik oeffnen + Verlauf. */}
                        <button
                          type="button"
                          onClick={() => {
                            const name = titleCaseName(p.vorname) || '[Name]'
                            const geb = p.gebDatum ? formatDate(p.gebDatum) : ''
                            const ident = `${name}${geb ? `, geb. ${geb}` : ''}`
                            const subject = `Berichtsanfrage – ${ident}`
                            const body = [
                              'Sehr geehrtes Team der Augenklinik',
                              '',
                              'Folgende Patientin / folgender Patient war bei Ihnen in Behandlung:',
                              '',
                              `    ${ident}`,
                              '',
                              'Bisher ist bei uns noch kein Bericht eingegangen. Wir bitten Sie freundlich um Zustellung des Berichts.',
                              '',
                              'Freundliche Grüsse',
                              'Augenzentrum Suhr',
                            ].join('\n')
                            const url = `mailto:berichtesekretariat-augenklinik@ksa.ch?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
                            try { window.open(url) } catch { window.location.href = url }
                            const entry: VerlaufEntry = { datum: new Date().toISOString().slice(0, 10), aktion: 'Notiz', ergebnis: 'Berichtsanfrage an KSA-Augenklinik versendet', von: displayLabel }
                            updateRecallPatient(p.id, { verlauf: [...(p.verlauf ?? []), entry] }, displayLabel)
                              .then(() => reloadAllTabs()).catch(() => {})
                            toast.success('E-Mail an das Berichtesekretariat der KSA-Augenklinik wird geöffnet.')
                          }}
                          title="Öffnet eine vorbereitete E-Mail an berichtesekretariat-augenklinik@ksa.ch («Sehr geehrtes Team der Augenklinik») mit Name und Geburtsdatum des Patienten. Wird im Verlauf protokolliert."
                          className="col-span-2 flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-colors border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
                        >
                          <Mail className="w-5 h-5" />
                          <span className="text-xs font-semibold leading-tight">Bericht anfordern (KSA Augenklinik)</span>
                          <span className="text-[10px] opacity-70 leading-tight">E-Mail an das Berichtesekretariat · öffnet sofort Outlook</span>
                        </button>
                      </div>
                    </div>
                  )
                })()}

                {/* Freier Brief: Betreff + Text (mit Vorlagen) */}
                {af.briefVariante === 'freierBrief' && (
                  <div className="space-y-2">
                    {/* Vorlagen: fuellen Betreff+Text vor, bleiben frei editierbar.
                        [Platzhalter] in eckigen Klammern vor dem Versand ersetzen. */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Vorlagen</p>
                      <div className="flex flex-wrap gap-1">
                        {([
                          { label: 'Anwesenheitsbestätigung',
                            betreff: 'Anwesenheitsbestätigung',
                            text: `Hiermit bestätigen wir, dass ${titleCaseName(p.vorname) || '[Name]'} am [Datum] um [Uhrzeit] Uhr zur augenärztlichen Behandlung in unserer Praxis war.\n\nDieses Schreiben dient zur Vorlage beim Arbeitgeber bzw. bei der Schule.` },
                          { label: 'Rezept-Begleitbrief',
                            betreff: 'Ihr Rezept',
                            text: `Gerne senden wir Ihnen das gewünschte Rezept — es liegt diesem Schreiben bei.\n\nBei Fragen erreichen Sie uns unter 062 842 18 46 oder info@augenzentrum-suhr.ch.` },
                          { label: 'Unterlagen anfordern',
                            betreff: 'Fehlende Unterlagen',
                            text: `Für die weitere Bearbeitung benötigen wir noch folgende Unterlagen von Ihnen:\n\n- [Unterlage 1]\n- [Unterlage 2]\n\nBitte senden Sie uns diese per Post oder E-Mail an info@augenzentrum-suhr.ch. Herzlichen Dank.` },
                          { label: 'Nicht erreicht',
                            betreff: 'Wir konnten Sie nicht erreichen',
                            text: `Wir haben mehrfach versucht, Sie telefonisch zu erreichen — leider ohne Erfolg.\n\nBitte melden Sie sich bei uns unter 062 842 18 46 oder info@augenzentrum-suhr.ch, damit wir das weitere Vorgehen mit Ihnen besprechen können.` },
                        ]).map(v => (
                          <button key={v.label} type="button"
                            onClick={() => setAf({ freiBetreff: v.betreff, freiText: v.text })}
                            className="px-2 py-0.5 text-[11px] font-medium border border-slate-300 bg-white text-slate-700 rounded-full hover:bg-slate-100 transition-colors"
                          >{v.label}</button>
                        ))}
                      </div>
                    </div>
                    {/* KI-Formulierung: Anliegen in Stichworten → Gemini formuliert Betreff+Text.
                        Es werden keine Patientendaten mitgeschickt (nur der Anliegen-Text). */}
                    <div className="p-2.5 rounded-lg border border-violet-200 bg-violet-50/60 space-y-1.5">
                      <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" /> KI-Formulierung
                      </p>
                      <div className="flex gap-1.5">
                        <input type="text" value={kiAnliegen}
                          onChange={e => setKiAnliegen(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
                          placeholder="Anliegen in Stichworten, z.B. «Patient soll neue Brille abholen, freundlich erinnern»"
                          className="input text-sm flex-1" />
                        <button type="button" disabled={kiLoading || !kiAnliegen.trim()}
                          onClick={async () => {
                            setKiLoading(true)
                            try {
                              const empfaenger = af.vertreterModus
                                ? 'die gesetzliche Vertretung bzw. Kontaktperson eines Patienten'
                                : 'der Patient / die Patientin selbst'
                              const entwurf = await generateBriefText(kiAnliegen, empfaenger)
                              // [Name]/[Geburtsdatum] lokal mit echten Patientendaten füllen —
                              // die Daten verlassen die App nicht, nur die KI kennt sie nicht.
                              const patientName = titleCaseName((p.vorname ?? '').trim())
                              const fillPlatzhalter = (t: string) => t
                                .replace(/\[(Name|Patientenname|Patient(?:in)?)\]/gi, patientName || '[Name]')
                                .replace(/\[Geburtsdatum\]/gi, p.gebDatum ? formatDate(p.gebDatum) : '[Geburtsdatum]')
                              setAf({
                                freiBetreff: fillPlatzhalter(entwurf.betreff) || af.freiBetreff,
                                freiText: fillPlatzhalter(entwurf.text),
                              })
                            } catch (err) {
                              console.error('KI-Formulierung fehlgeschlagen', err)
                              toast.error('KI-Formulierung fehlgeschlagen — bitte erneut versuchen oder Text manuell schreiben.')
                            } finally {
                              setKiLoading(false)
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1 shrink-0"
                        >{kiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Formulieren</button>
                      </div>
                      <p className="text-[10px] text-violet-500">Ohne Patientendaten zur KI — Name/Geburtsdatum werden lokal eingesetzt, übrige [Platzhalter] bitte vor dem Versand ersetzen.</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Betreff *</p>
                      <input type="text" value={af.freiBetreff}
                        onChange={e => setAf({ freiBetreff: e.target.value })}
                        placeholder="z.B. Bestätigung Ihrer Behandlung"
                        className="input text-sm w-full" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Text *</p>
                      <textarea rows={7} value={af.freiText}
                        onChange={e => setAf({ freiText: e.target.value })}
                        placeholder={'Brieftext… Absätze durch Leerzeile trennen.\nAnrede und Grussformel werden automatisch ergänzt.'}
                        className="input text-sm w-full resize-none" />
                    </div>
                  </div>
                )}

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

                {/* Brief- & Reminder-Felder (Adresse/Versand gemeinsam) */}
                {(af.art === 'Brief' || af.art === 'Reminder') && (
                  <>
                    {/* Variante — gilt für Briefaufgebot UND Reminder.
                        Terminverschiebung hat eine eigene Art-Karte oben und
                        blendet die Varianten-Auswahl aus. */}
                    {!['terminVerschoben', 'terminBestaetigung', 'freierBrief'].includes(af.briefVariante) && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Variante</p>
                      <div className="flex gap-2">
                        {([
                          ['', 'Normal', 'Übliche Einladung / Erinnerung zur Kontrolle'],
                          ['neuerArzt', 'Neuen Arzt vorschlagen', 'Bestehender Patient: neuen Arzt vorschlagen/erwähnen (früherer Arzt nicht mehr in der Praxis)'],
                          ['terminVerpasst', 'Termin verpasst', 'Patient hat Termin nicht wahrgenommen – Bitte um Rückmeldung / CHF 80 Ausfallgebühr'],
                        ] as const).map(([v, label, hint]) => (
                          <button key={v || 'std'} type="button" title={hint}
                            onClick={() => setAf({ briefVariante: v })}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                              af.briefVariante === v ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                            }`}>{label}</button>
                        ))}
                      </div>
                      {af.briefVariante === 'neuerArzt' && (
                        <div className="mt-2">
                          <input type="text" value={af.frueherArzt}
                            onChange={e => setAf({ frueherArzt: e.target.value })}
                            placeholder="Früherer Arzt, z.B. Frau Dr. Nessmann"
                            className="input text-sm w-full" />
                          <p className="mt-1 text-[10px] text-gray-400">Wird im Brief/Reminder genannt: «Da [Name] nicht mehr in unserer Praxis tätig ist …»</p>
                        </div>
                      )}
                    </div>
                    )}

                    {/* Terminverschiebung: wer hat verschoben? Bestimmt den
                        Brieftext (Bestätigung vs. Entschuldigung). */}
                    {af.briefVariante === 'terminVerschoben' && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Verschoben durch</p>
                        <div className="flex gap-2">
                          {([
                            ['patient', 'Patient', 'Patient hat den Termin verschoben – Brief bestätigt den neuen Termin'],
                            ['praxis', 'Praxis (uns)', 'Wir mussten den Termin verschieben – Brief entschuldigt sich und nennt den neuen Termin'],
                          ] as const).map(([v, label, hint]) => (
                            <button key={v} type="button" title={hint}
                              onClick={() => setAf({ verschiebungDurch: v })}
                              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                af.verschiebungDurch === v ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                              }`}>{label}</button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Verpasstes Datum bei «Termin verpasst»-Variante */}
                    {af.briefVariante === 'terminVerpasst' && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Verpasster Termin (Datum)</p>
                        <input type="date" value={af.terminDatum}
                          onChange={e => setAf({ terminDatum: e.target.value })}
                          className="input text-sm w-full" />
                      </div>
                    )}

                    {/* Termin-spezifische Felder NUR für Briefaufgebot — Reminder hat keinen festen Termin */}
                    {af.art === 'Brief' && af.briefVariante !== 'terminVerpasst' && af.briefVariante !== 'freierBrief' && (<>
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
                        {/* Benutzerdefinierte Voruntersuchungen */}
                        {customVUs.map(v => {
                          const active = af.voruntersuchungen.includes(v)
                          return (
                            <span key={v} className={`inline-flex items-center rounded-lg text-xs font-medium border transition-colors ${
                              active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'
                            }`}>
                              <button
                                onClick={() => setAf({ voruntersuchungen: active
                                  ? af.voruntersuchungen.filter(x => x !== v)
                                  : [...af.voruntersuchungen, v] })}
                                className="pl-2.5 pr-1 py-1.5 hover:bg-gray-50 rounded-l-lg">
                                {v}
                              </button>
                              <button
                                onClick={() => { persistCustomVUs(customVUs.filter(x => x !== v)); setAf({ voruntersuchungen: af.voruntersuchungen.filter(x => x !== v) }) }}
                                title="Aus Liste entfernen"
                                className="px-1.5 py-1.5 text-gray-400 hover:text-red-500 rounded-r-lg">×</button>
                            </span>
                          )
                        })}
                        {/* Eigene Voruntersuchung hinzufuegen */}
                        <button
                          onClick={addCustomVU}
                          title="Eigene Voruntersuchung hinzufügen (bleibt gespeichert)"
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                          + Hinzufügen
                        </button>
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
                    </>)}

                    {/* Gesetzlicher Vertreter (Erwachsene): analog Minderjährige — Brief
                        geht an den Vertreter, nicht direkt an den Patienten. Wird von Liris
                        automatisch erkannt (Kontaktangaben → «Gesetzlicher Vertreter»),
                        kann hier aber auch manuell umgeschaltet werden. */}
                    <button type="button"
                      onClick={() => setAf({ vertreterModus: !af.vertreterModus })}
                      className={`w-full py-2 rounded-lg text-xs font-bold border-2 transition-colors flex items-center justify-center gap-1.5 ${
                        af.vertreterModus
                          ? 'border-violet-400 bg-violet-50 text-violet-700'
                          : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                      }`}>
                      {af.vertreterModus
                        ? (af.vertreterTyp === 'kontaktperson' ? '✓ Adressiert an Kontaktperson' : '✓ Adressiert an gesetzlichen Vertreter')
                        : 'Brief an Drittperson (Vertreter/Kontaktperson)'}
                    </button>
                    {/* Art des Dritt-Empfaengers — bestimmt die Formulierung im
                        Brief/E-Mail («als gesetzliche/r Vertreter/in» vs.
                        «als hinterlegte Kontaktperson»). Aus Liris vorbelegt. */}
                    {af.vertreterModus && (
                      <div className="flex gap-2 mt-1.5">
                        {([
                          ['vertreter', 'Vormund / gesetzl. Vertreter', 'Brief: «…für die/den Sie als gesetzliche/r Vertreter/in handeln»'],
                          ['kontaktperson', 'Kontaktperson', 'Brief: «Sie erhalten es als hinterlegte Kontaktperson — bitte weiterleiten»'],
                        ] as const).map(([v, label, hint]) => (
                          <button key={v} type="button" title={hint}
                            onClick={() => setAf({ vertreterTyp: v })}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                              af.vertreterTyp === v ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                            }`}>{label}</button>
                        ))}
                      </div>
                    )}
                    {/* Empfaenger explizit definieren — der Brief geht NIE an den
                        Patienten selbst. Das Feld ist die erste Zeile des
                        Adressblocks (Anrede/Begruessung leiten sich daraus ab);
                        aus Liris («Zusätzlicher Kontakt») vorbefuellt, falls
                        vorhanden — sonst hier eintragen. */}
                    {af.vertreterModus && (
                      <div className="mt-1.5">
                        <p className="text-xs font-semibold text-violet-700 mb-1">
                          Empfänger ({af.vertreterTyp === 'kontaktperson' ? 'Kontaktperson' : 'Vertreter/in'}) *
                        </p>
                        <input type="text"
                          value={af.adressBlock.split('\n')[0] || ''}
                          onChange={e => {
                            const lines = af.adressBlock.split('\n')
                            lines[0] = e.target.value
                            setAf({ adressBlock: lines.join('\n') })
                          }}
                          placeholder="Nachname Vorname der Dritt-Person"
                          className="input text-sm w-full" />
                        <p className="mt-0.5 text-[10px] text-gray-400">
                          Anrede + Briefbegrüssung beziehen sich auf diese Person; deren Adresse unten im Adressfeld ergänzen.
                        </p>
                      </div>
                    )}

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

                    {/* Nachname mehrdeutig (Name mit 3+ Wörtern) → MPA wählt den
                        Nachnamen für die Anrede. Erscheint nur im Zweifel. */}
                    {(() => {
                      const nameLine = (af.adressBlock.trim().split('\n')[0] || '').trim()
                      const words = nameLine.split(/\s+/).filter(Boolean)
                      if (words.length < 3) return null
                      const options: string[] = []
                      for (let n = 1; n < words.length; n++) options.push(titleCaseName(words.slice(0, n).join(' ')))
                      const current = af.nachnameOverride.trim()
                        ? titleCaseName(af.nachnameOverride.trim())
                        : titleCaseName(words.slice(0, -1).join(' '))
                      return (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                          <p className="text-xs font-semibold text-amber-800 mb-1.5">⚠️ Name mehrdeutig — welcher Teil ist der Nachname? (für die Anrede)</p>
                          <div className="flex flex-wrap gap-1.5">
                            {options.map(opt => (
                              <button key={opt} type="button"
                                onClick={() => setAf({ nachnameOverride: opt })}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                  current === opt ? 'border-amber-500 bg-amber-100 text-amber-800' : 'border-amber-200 bg-white text-gray-600 hover:bg-amber-50'
                                }`}>{opt}</button>
                            ))}
                          </div>
                          <p className="mt-1.5 text-[10px] text-amber-600">Anrede: «Sehr geehrte/r … {current}»</p>
                        </div>
                      )
                    })()}

                    {/* Postadresse + Versand-Buttons direkt darunter */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Adresse <span className="text-amber-600 font-normal normal-case">(nicht gespeichert · hineinziehen oder einfügen)</span>
                        </p>
                        {isElectron && !af.adressBlock.trim() && (
                          <button type="button"
                            onClick={() => { const pid = normalizePid(p.pid); if (pid) { toast.info('Liris wird erneut ausgelesen…'); openWithPid(pid) } }}
                            className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 hover:underline shrink-0"
                          >
                            ⟳ Erneut aus Liris auslesen
                          </button>
                        )}
                      </div>
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
                      {/* Versand-Buttons: 'Per E-Mail' nur aktiv wenn Patient eine E-Mail hat. */}
                      {(() => {
                        const patientEmail = (lirisExtract && normalizePid(lirisExtract.pid) === normalizePid(aufgebotTarget!.patient.pid) ? lirisExtract.email : '') || ''
                        const hasEmail = !!patientEmail
                        const emailVerdaechtig = (!hasEmail && lirisExtract && normalizePid(lirisExtract.pid) === normalizePid(aufgebotTarget!.patient.pid) ? lirisExtract.emailVerdaechtig : '') || ''
                        // Briefaufgebot & Terminverschiebung nennen einen konkreten
                        // Termin im Brief — ohne Datum UND Zeit darf nicht versendet
                        // werden (der Brief enthielte einen leeren Termin). Reminder
                        // und «Termin verpasst» haben keinen festen Termin.
                        const terminFehlt = af.art === 'Brief' && af.briefVariante !== 'terminVerpasst' && af.briefVariante !== 'freierBrief' && (!af.terminDatum || !af.terminZeit)
                        const freiFehlt = af.briefVariante === 'freierBrief' && (!af.freiBetreff.trim() || !af.freiText.trim())
                        const terminHinweis = freiFehlt ? 'Bitte zuerst Betreff und Text erfassen' : 'Bitte zuerst Termin-Datum und -Zeit erfassen'
                        const sendGesperrt = terminFehlt || freiFehlt
                        return (
                          <>
                          {emailVerdaechtig && (
                            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                              ⚠️ In Liris ist eine <strong>fehlerhafte E-Mail-Adresse</strong> hinterlegt:
                              {' '}<span className="font-mono">{emailVerdaechtig}</span> — vermutlich ein Tippfehler
                              (z.&nbsp;B. Bindestrich statt Punkt). Bitte in der Liris-Akte korrigieren,
                              danach ist «Per E-Mail» verfügbar.
                            </div>
                          )}
                          <div className="mt-2 flex gap-2">
                            <button
                              disabled={sendGesperrt}
                              onClick={() => {
                                console.log('[Brief] Per Post PDF Button geklickt — art:', af.art, 'terminDatum:', af.terminDatum)
                                const nextForm = { ...af, versand: 'Post' as const }
                                setAf({ versand: 'Post' })
                                generateBriefPDF(p, nextForm)
                                // Direkt als aufgeboten markieren — kein Zwischenschritt/Rückfrage
                                // mehr, ob gedruckt/im Liris abgelegt ist. Das Drucken/Ablegen
                                // läuft eigenständig im Postausgang weiter.
                                handleAufgebotSave(nextForm, true)
                              }}
                              title={sendGesperrt ? terminHinweis : undefined}
                              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                                sendGesperrt ? 'border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed' :
                                af.versand === 'Post' ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                              }`}>
                              <Printer className="w-4 h-4" /> Per Post (PDF)
                            </button>
                            <button
                              disabled={!hasEmail || sendGesperrt}
                              onClick={() => {
                                const nextForm = { ...af, versand: 'Email' as const }
                                setAf({ versand: 'Email' })
                                openEmailInOutlook(p, nextForm, patientEmail)
                                // Bei E-Mail-Versand wird NICHT gedruckt und nichts im
                                // Postausgang angezeigt — der Brief wird aber (nur Desktop-App)
                                // als unsichtbarer Hintergrund-Job ins Liris hochgeladen
                                // (skipPrint: true). Im Browser gibt es keinen Liris-Upload,
                                // dort entfaellt die Ablage komplett.
                                if ((window as any).electronApp?.autoImportToLiris) {
                                  generateBriefPDF(p, nextForm, true)
                                }
                                // Direkt als aufgeboten markieren — kein Zwischenschritt/Rückfrage
                                // mehr, ob die E-Mail versendet wurde.
                                handleAufgebotSave(nextForm, true)
                              }}
                              title={sendGesperrt ? terminHinweis : hasEmail ? `An ${patientEmail}` : 'Keine E-Mail in Liris hinterlegt'}
                              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                                (!hasEmail || sendGesperrt) ? 'border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed' :
                                emailCopied ? 'border-green-400 bg-green-50 text-green-700' :
                                af.versand === 'Email' ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                              }`}>
                              <Mail className="w-4 h-4" />
                              {!hasEmail ? 'Keine E-Mail' : emailCopied ? '✓ E-Mail wird geöffnet' : 'Per E-Mail'}
                            </button>
                          </div>
                          </>
                        )
                      })()}
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

                {/* Telefon: Ergebnis-Quick-Buttons + Folge-Vorgehen.
                    Klick auf "Nicht erreicht" oeffnet Folge-Aktionen, damit
                    sofort klar wird wie weiter (erneuter Anruf, Brief, Reminder). */}
                {af.art === 'Tel' && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ergebnis</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        { key: 'erreicht'     as const, label: 'Erreicht',              cls: 'border-green-300 bg-green-50 text-green-700' },
                        { key: 'nichtErreicht'as const, label: 'Nicht erreicht',        cls: 'border-orange-300 bg-orange-50 text-orange-700' },
                        { key: 'nichtGueltig' as const, label: 'Nr. nicht mehr gültig', cls: 'border-red-300 bg-red-50 text-red-700' },
                      ]).map(b => {
                        const active = af.telResult === b.key
                        return (
                          <button key={b.key} type="button"
                            onClick={() => setAf({
                              telResult: active ? '' : b.key,
                              // Folge-Aktionen nur bei "nicht erreicht" relevant — sonst zuruecksetzen
                              telFollowup: (active || b.key !== 'nichtErreicht') ? '' : af.telFollowup,
                              telFollowupDatum: (active || b.key !== 'nichtErreicht') ? '' : af.telFollowupDatum,
                            })}
                            className={`py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors hover:opacity-80 ${
                              active ? b.cls : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                            }`}
                          >{b.label}</button>
                        )
                      })}
                    </div>

                    {/* Folge-Vorgehen-Auswahl — nur bei "Nicht erreicht" */}
                    {af.telResult === 'nichtErreicht' && (
                      <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-xl space-y-2">
                        <p className="text-xs font-semibold text-orange-700">Weiteres Vorgehen</p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {([
                            { key: 'erneutAnrufen'  as const, label: 'Erneut anrufen' },
                            { key: 'briefVersenden' as const, label: 'Brief versenden' },
                            { key: 'reminderSetzen' as const, label: 'Reminder setzen' },
                          ]).map(b => {
                            const active = af.telFollowup === b.key
                            // Default-Datum: für Anruf in 3 Tagen, für Reminder in 14 Tagen
                            const defaultDate = () => {
                              const d = new Date()
                              d.setDate(d.getDate() + (b.key === 'erneutAnrufen' ? 3 : 14))
                              return d.toISOString().slice(0, 10)
                            }
                            return (
                              <button key={b.key} type="button"
                                onClick={() => setAf({
                                  telFollowup: active ? '' : b.key,
                                  telFollowupDatum: active ? '' : (af.telFollowupDatum || defaultDate()),
                                })}
                                className={`py-1.5 rounded-lg text-[11px] font-semibold border-2 transition-colors hover:opacity-80 ${
                                  active
                                    ? 'border-orange-400 bg-white text-orange-700'
                                    : 'border-orange-200 bg-white text-orange-600 hover:bg-orange-100'
                                }`}
                              >{b.label}</button>
                            )
                          })}
                        </div>

                        {/* Datum-Picker für Anruf / Reminder */}
                        {(af.telFollowup === 'erneutAnrufen' || af.telFollowup === 'reminderSetzen') && (
                          <div className="flex items-center gap-2">
                            <label className="text-[11px] text-orange-700 font-semibold whitespace-nowrap">
                              {af.telFollowup === 'erneutAnrufen' ? 'Anruf am' : 'Reminder am'}
                            </label>
                            <input type="date"
                              value={af.telFollowupDatum}
                              onChange={e => setAf({ telFollowupDatum: e.target.value })}
                              className="input text-xs flex-1"
                            />
                          </div>
                        )}
                        {af.telFollowup === 'briefVersenden' && (
                          <p className="text-[11px] text-orange-700 leading-relaxed">
                            Nach dem Speichern auf <strong>«Brief / Reminder»</strong> umschalten und Brief erstellen.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

              </div>{/* end left form panel */}

              </div>{/* end two-column */}

              {/* Footer — bei Brief/Reminder erledigen die Per-Post/Per-E-Mail-
                  Buttons das Markieren bereits direkt (kein separater Schritt
                  mehr nötig). Dieser Button bleibt für Tel/Praxis (kein Versand). */}
              <div className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
                {livePreviewHtml && (
                  <button
                    onClick={() => setBriefPreview(livePreviewHtml)}
                    title="Briefvorschau in grossem Popup öffnen (mit Drucken/Speichern)"
                    className="btn btn-secondary text-sm mr-auto"
                  >
                    <Search className="w-4 h-4" /> Vorschau
                  </button>
                )}
                <button onClick={() => setAufgebotTarget(null)} className="btn btn-secondary text-sm">
                  Abbrechen
                </button>
                {!(af.art === 'Brief' || af.art === 'Reminder') && (
                  <button
                    onClick={() => handleAufgebotSave()}
                    disabled={!canSave || aufgebotSaving}
                    className="btn btn-primary text-sm disabled:opacity-40"
                  >
                    {aufgebotSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Als aufgeboten markieren
                  </button>
                )}
              </div>
            </div>
            )
            })()}
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
          Anrufen:  { label: 'Anrufen',        Icon: PhoneCall, color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200' },
          kein:     { label: 'Kein Aufgebot', Icon: BellOff,   color: 'text-gray-500',   bg: 'bg-gray-50',   border: 'border-gray-200' },
        }
        const ART_ORDER = ['Anrufen', 'Brief', 'Reminder', 'Tel', 'Praxis', 'kein']

        function WPRow({ entry }: { entry: WPEntry }) {
          const p = entry.patient
          return (
            <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors group">
              {/* Klickbarer Patient-Bereich: oeffnet 'Patient bearbeiten'. */}
              <button
                type="button"
                onClick={() => openEdit(p)}
                title="Patienten bearbeiten"
                className="flex-1 min-w-0 text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-300 rounded-md -mx-1 px-1 py-0.5 hover:bg-primary-50/40"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-800 text-sm">{p.vorname || '—'}</span>
                  {p.pid && <span className="text-xs text-gray-400 font-mono">#{normalizePid(p.pid)}</span>}
                  {p.gebDatum && <span className="text-xs text-gray-400">{formatDate(p.gebDatum)}</span>}
                  <MinorBadge gebDatum={p.gebDatum} />
                  <span
                    onClick={e => { e.stopPropagation(); e.preventDefault(); openArztTage(p.doctor) }}
                    title={`Einsatztage von ${p.doctor} anzeigen`}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 hover:bg-primary-200 cursor-pointer transition-colors">{p.doctor}</span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  {p.aufgebotFuer && (
                    <span className="text-xs text-green-700 font-semibold cursor-help"
                          title="RC ab = «Recall zu erstellen ab». Ab diesem Datum soll das Aufgebot erstellt werden — berechnet aus letztem Konsil + Kontrollintervall (minus Vorlauf).">
                      RC ab: {formatDate(p.aufgebotFuer)}
                    </span>
                  )}
                  {p.aufgebotFuer && (() => {
                    const d = new Date(p.aufgebotFuer + 'T00:00:00Z')
                    if (isNaN(d.getTime())) return null
                    d.setUTCMonth(d.getUTCMonth() + 2)
                    const iso = d.toISOString().slice(0, 10)
                    return (
                      <span className="text-xs text-violet-700 font-semibold cursor-help"
                            title="Ungefähres KO-Datum (Konsultationstermin) = RC-Datum + 2 Monate. Richtwert zum Setzen des Termins.">
                        KO ca.: {formatDate(iso)}
                      </span>
                    )
                  })()}
                  {p.naechsteKons && p.naechsteKons !== 'kein Termin' && (
                    <span className="text-xs text-blue-700 font-semibold cursor-help"
                          title="Nächste KO = bereits vereinbarter nächster Termin (Nächste Konsultation).">
                      Nächste KO: {formatDate(p.naechsteKons)}
                    </span>
                  )}
                  {patientZuweisungen(p).some(z => (z.status || 'pendent') === 'pendent') && (
                    <span className="text-xs text-orange-700 font-semibold cursor-help flex items-center gap-1"
                          title="Es liegt eine offene (pendente) Zuweisung vor — siehe ZW-Management.">
                      <ExternalLink className="w-3 h-3" />
                      Offene Zuweisung
                    </span>
                  )}
                </div>
              </button>
              {/* Termin-anlegen steuert das Liris-Webview — nur in der Desktop-App möglich. */}
              {isElectron && (
                <button
                  onClick={() => startTerminFlow(p)}
                  title="Termin anlegen"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors shrink-0"
                >
                  <CalendarClock className="w-3.5 h-3.5" />
                  Termin
                </button>
              )}
              {p.patientenStatus === 'kein Aufgebot' ? (
                <button
                  onClick={() => openAufgebotDialog(entry, 'Reminder')}
                  title="Reminder erstellen (Patient meldet sich selbst)"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-colors shrink-0"
                >
                  <Bell className="w-3.5 h-3.5" />
                  Reminder
                </button>
              ) : (
                <button
                  onClick={() => openAufgebotDialog(entry)}
                  title="Aufbieten oder Brief erstellen"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors shrink-0"
                >
                  <CalendarDays className="w-3.5 h-3.5" />
                  Aufbieten
                </button>
              )}
            </div>
          )
        }

        return (
          <>
            {/* Inline-Panel im Hauptbereich der Recall-Seite. Liris-Panel
                bleibt rechts daneben sichtbar (vom AppShell gerendert).
                Kein Modal-Overlay mehr — User-Workflow: parallel zu Liris
                aufbieten. */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden mx-4 my-4">

              {/* Header — Ärzte-Register ist hier ausgeblendet (eigenständige
                  Ansicht wie ZW-Management); Rückkehr über diesen Button. */}
              <div className="flex items-center px-6 py-4 border-b border-gray-200 shrink-0">
                <button
                  onClick={() => switchTab(DOCTORS_DEFAULT[0])}
                  title="Zur Ärzte-Ansicht wechseln"
                  className="mr-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-3">
                  <CalendarDays className="w-5 h-5 text-primary-600" />
                  <h2 className="font-bold text-gray-900 text-lg">RECALL</h2>
                </div>
                <div className="ml-auto flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 mr-1">Arzt:</span>
                    <select
                      value={wochenplanFilterArzt}
                      onChange={e => setWochenplanFilterArzt(e.target.value)}
                      className={`text-xs border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-300 cursor-pointer ${
                        wochenplanFilterArzt ? 'border-primary-300 bg-primary-50 text-primary-800 font-semibold' : 'border-gray-200 bg-white text-gray-500'
                      }`}
                    >
                      <option value="">Alle Ärzte</option>
                      {doctors.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 mr-1">Sortieren:</span>
                    {(['arzt', 'name'] as const).map(mode => (
                      <button key={mode} type="button"
                        onClick={() => setWochenplanSort(mode)}
                        className={`px-2.5 py-1 rounded-full font-semibold border transition-colors ${
                          wochenplanSort === mode
                            ? 'bg-primary-100 text-primary-700 border-primary-300'
                            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                        }`}
                      >{mode === 'arzt' ? 'Arzt' : 'Name'}</button>
                    ))}
                    <button type="button"
                      onClick={() => setWochenplanSort(s => s === 'datumAsc' ? 'datumDesc' : 'datumAsc')}
                      title="Nach Kontrolldatum (RC ab) sortieren — Klick wechselt auf-/absteigend"
                      className={`px-2.5 py-1 rounded-full font-semibold border transition-colors flex items-center gap-0.5 ${
                        wochenplanSort === 'datumAsc' || wochenplanSort === 'datumDesc'
                          ? 'bg-primary-100 text-primary-700 border-primary-300'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      Datum
                      {wochenplanSort === 'datumAsc' && <ArrowUp className="w-3 h-3" />}
                      {wochenplanSort === 'datumDesc' && <ArrowDown className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
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

                {/* Rückkehr-Überwachung: externe Behandlung abgeschlossen
                    (Abschlussbericht vor >3 Monaten), aber Patient hat seither
                    weder einen Termin bei uns gehabt noch einen kuenftigen —
                    pruefen ob er zurueckkommt / aufbieten. */}
                {wochenplanWeekOffset === 0 && wochenplanData.rueckkehr.length > 0 && (
                  <div className="border-b border-orange-100">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-orange-50"
                      title="Externe Zuweisung ist seit über 3 Monaten abgeschlossen, aber der Patient war seither nicht mehr bei uns und hat keinen künftigen Termin.">
                      <ExternalLink className="w-4 h-4 text-orange-500 shrink-0" />
                      <span className="text-sm font-semibold text-orange-700">Rückkehr prüfen (nach externer Behandlung)</span>
                      <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">{wochenplanData.rueckkehr.length}</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {wochenplanData.rueckkehr.map(e => <WPRow key={e.patient.id} entry={e} />)}
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

            {/* Einsatztage-Popup: Klick auf Arzt-Badge zeigt die kommenden
                Einsatztage des Arztes aus der Einsatzplanung. */}
            {arztTageFor && (() => {
              const WORKING: Record<string, string> = { GT: 'Ganztag', VM: 'Vormittag', NM: 'Nachmittag', OP: 'OP KSA', W: 'Weiterbildung', NFD: 'Notfalldienst' }
              const CODE_CLS: Record<string, string> = {
                GT: 'bg-green-100 text-green-700', VM: 'bg-blue-100 text-blue-700', NM: 'bg-indigo-100 text-indigo-700',
                OP: 'bg-purple-100 text-purple-700', W: 'bg-amber-100 text-amber-700', NFD: 'bg-red-100 text-red-700',
              }
              const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
              // Person in der Planung finden: Nachname des Recall-Arztes muss im
              // Planungs-Namen vorkommen (Planung kann Vor+Nachname enthalten).
              const person = planungData?.sections.flatMap(sec => sec.persons)
                .find(pn => pn.toLowerCase() === arztTageFor.toLowerCase()
                  || pn.toLowerCase().split(/\s+/).includes(arztTageFor.toLowerCase()))
              const tage: { date: string; code: string }[] = []
              if (planungData && person) {
                const now = new Date()
                for (let i = 0; i < 90 && tage.length < 15; i++) {
                  const d = new Date(now); d.setDate(now.getDate() + i)
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                  const code = planungData.schedule[person]?.[key]
                  if (code && WORKING[code]) tage.push({ date: key, code })
                }
              }
              return (
                <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" onClick={() => setArztTageFor(null)}>
                  <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                    <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3.5 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                        <CalendarDays className="w-4 h-4 text-primary-600" />
                        Einsatztage — {arztTageFor}
                      </h3>
                      <button onClick={() => setArztTageFor(null)} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {!planungData ? (
                        <p className="px-5 py-4 text-sm text-gray-400 italic">Einsatzplanung wird geladen…</p>
                      ) : !person ? (
                        <p className="px-5 py-4 text-sm text-gray-400 italic">«{arztTageFor}» wurde in der Einsatzplanung nicht gefunden.</p>
                      ) : tage.length === 0 ? (
                        <p className="px-5 py-4 text-sm text-gray-400 italic">Keine Einsatztage in den nächsten 90 Tagen eingetragen.</p>
                      ) : (
                        tage.map(({ date, code }) => {
                          const d = new Date(date + 'T12:00:00')
                          return (
                            <div key={date} className="px-5 py-2 flex items-center justify-between">
                              <span className="text-sm text-gray-800">
                                <span className="text-xs font-semibold text-gray-500 mr-2">{WD[d.getDay()]}</span>
                                {formatDate(date)}
                              </span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CODE_CLS[code] ?? 'bg-gray-100 text-gray-600'}`}>
                                {WORKING[code] ?? code}
                              </span>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>
              )
            })()}
          </>
        )
      })()}

      {/* ── Auswertung modal (nur GL / Ärzte / Admin) ────────────────────────── */}
      {auswertungOpen && (isGeschaeftsleitung || isArzt || isAdmin) && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setAuswertungOpen(false)} />
          <div className="fixed inset-2 sm:inset-8 z-[51] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-4 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <BarChart2 className="w-5 h-5 text-primary-600 shrink-0" />
                <h2 className="font-bold text-gray-900 text-base sm:text-lg">Auswertung</h2>
                <span className="text-xs text-gray-400 truncate">{auswertungStats.total} <span className="hidden sm:inline">Patienten total</span></span>
              </div>
              <button onClick={() => setAuswertungOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-5 sm:space-y-6">

              {/* ── Aktivität ── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary-500" /> Aktivität
                  </h3>
                  {/* Mobile: native Dropdown — spart Platz bei 8 Optionen */}
                  <select
                    value={actPeriod}
                    onChange={e => setActPeriod(e.target.value as ActPeriod)}
                    className="sm:hidden text-xs font-medium px-2 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
                  >
                    {PERIODS.map(({ key, label }) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  {/* Desktop: Pill-Reihe für direkten Zugriff */}
                  <div className="hidden sm:flex flex-wrap rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                    {PERIODS.map(({ key, label }, i) => (
                      <button key={key} onClick={() => setActPeriod(key)}
                        className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${actPeriod === key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Hinweis: Summary-Cards wurden entfernt (Stand 2026-06).
                    Die Aufgebot-Totals pro Art lassen sich aus den Badges in der
                    Tabelle ablesen — klick filtert die Hauptliste. */}
                {(() => {
                  // Wenn ein Period-Filter aktiv ist (alles außer 'Alle'),
                  // zeige aggregierte Zahlen pro User statt einer Zeile pro
                  // Tag×User. Erste Spalte wird zum Tage-Counter (z.B. "8 Tage")
                  // statt einem konkreten Datum.
                  const actGrouped = actPeriod !== 'all'
                  const actBodyRows = actGrouped
                    ? auswertungStats.actRowsGrouped.map((r, i) => ({ key: `g${i}`, leftCol: `${r.days} ${r.days === 1 ? 'Tag' : 'Tage'}`, user: r.user, created: r.created, updated: r.updated, aufgebote: r.aufgebote }))
                    : auswertungStats.actRows.map(       (r, i) => ({ key: `d${i}`, leftCol: r.dateStr,                                  user: r.user, created: r.created, updated: r.updated, aufgebote: r.aufgebote }))
                  if (actBodyRows.length === 0) return <p className="text-sm text-gray-400 py-4 text-center">Keine Aktivität im gewählten Zeitraum.</p>
                  return (
                  // Inline-scrollbar: max-h begrenzt die sichtbare Höhe, lange Listen
                  // scrollen innerhalb des Containers statt das Modal aufzublähen.
                  // sticky thead hält die Spaltenköpfe beim Scrollen am oberen Rand.
                  <div className="overflow-auto rounded-xl border border-gray-200 max-h-80">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 z-10 shadow-[inset_0_-1px_0_0_rgb(229_231_235)]">
                        <tr>
                          <th className="text-left  px-4 py-2.5">{actGrouped ? 'Tage' : 'Datum'}</th>
                          <th className="text-left  px-4 py-2.5">Benutzer</th>
                          <th className="text-right px-4 py-2.5" title="Patienten, die der User an diesem Tag NEU erfasst hat (Quelle: erstellt-Stamp)">Neu erfasst</th>
                          <th className="text-right px-4 py-2.5" title="Distinct Patienten, die der User an diesem Tag bearbeitet hat (Verlauf-Eintrag oder aktualisiert-Stamp). Patienten, die er am gleichen Tag selbst erstellt hat, zaehlen nur unter 'Neu erfasst'.">Bearbeitet</th>
                          <th className="text-left  px-4 py-2.5" title="Anzahl Aufgebot-Aktionen (Brief, Tel-Aufgebot, Praxis, Reminder, Telefonanruf, E-Mail) — Klick filtert die Liste">Aufgebote</th>
                          <th className="text-right px-4 py-2.5" title="Summe: Neu erfasst + Bearbeitet + alle Aufgebot-Aktionen — Gesamt-Arbeitsleistung an diesem Tag">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {actBodyRows.map(r => {
                          const aufgebotTotal = r.aufgebote.Brief + r.aufgebote.Tel + r.aufgebote.Praxis + r.aufgebote.Reminder + r.aufgebote.TelCall + r.aufgebote.Email
                          type Badge = { key: string; count: number; label: string; cls: string; filter: { type: 'aufgebotArt' | 'verlaufAktion'; value: string } }
                          const badges: Badge[] = ([
                            { key: 'B', count: r.aufgebote.Brief,    label: 'Brief',        cls: 'bg-blue-50    text-blue-700    border-blue-200',    filter: { type: 'aufgebotArt'   as const, value: 'Brief'        } },
                            { key: 'T', count: r.aufgebote.Tel,      label: 'Tel-Aufgebot', cls: 'bg-amber-50   text-amber-700   border-amber-200',   filter: { type: 'aufgebotArt'   as const, value: 'Tel'          } },
                            { key: 'P', count: r.aufgebote.Praxis,   label: 'Praxis',       cls: 'bg-violet-50  text-violet-700  border-violet-200',  filter: { type: 'aufgebotArt'   as const, value: 'Praxis'       } },
                            { key: 'R', count: r.aufgebote.Reminder, label: 'Reminder',     cls: 'bg-indigo-50  text-indigo-700  border-indigo-200',  filter: { type: 'aufgebotArt'   as const, value: 'Reminder'     } },
                            { key: '☎', count: r.aufgebote.TelCall,  label: 'Telefonanruf', cls: 'bg-teal-50    text-teal-700    border-teal-200',   filter: { type: 'verlaufAktion' as const, value: 'Telefonanruf' } },
                            { key: '✉', count: r.aufgebote.Email,    label: 'E-Mail',       cls: 'bg-pink-50    text-pink-700    border-pink-200',   filter: { type: 'verlaufAktion' as const, value: 'E-Mail'       } },
                          ]).filter(b => b.count > 0)
                          return (
                            <tr key={r.key} className="hover:bg-gray-50">
                              <td className="px-4 py-2.5 tabular-nums text-gray-500 text-xs">{r.leftCol}</td>
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
                                      <button
                                        key={b.key}
                                        title={`${b.count} × ${b.label} — Liste filtern`}
                                        onClick={() => {
                                          // Filter setzen + Modal schließen + zu betroffenem User-Tab springen
                                          // wenn die Activity-Row einem konkreten Arzt zugeordnet ist (Zu-bearb bleibt).
                                          if (b.filter.type === 'aufgebotArt') {
                                            setFilterAufgebotArt(b.filter.value)
                                            setFilterVerlaufAktion(null)
                                          } else {
                                            setFilterVerlaufAktion(b.filter.value)
                                            setFilterAufgebotArt(null)
                                          }
                                          setFilterTermin(null)
                                          setFilterNeupatient(false)
                                          setFilterStatus(null)
                                          setAuswertungOpen(false)
                                          setPage(1)
                                        }}
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular-nums hover:opacity-80 active:scale-95 transition cursor-pointer ${b.cls}`}
                                      >
                                        <span className="opacity-70">{b.key}</span>{b.count}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-900">{r.created + r.updated + aufgebotTotal}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  )
                })()}
              </div>

              {/* ── Neupatienten ── */}
              <div>
                <div className="flex items-center justify-between mb-3 gap-2">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-100 text-green-700 text-[10px] font-black">N</span>
                    Neupatienten
                    <span className="text-xs font-normal text-gray-400 ml-1 hidden sm:inline">(Badge aktiv 7 Tage nach Erfassung)</span>
                  </h3>
                  {/* Period-Filter analog zur Aktivitäts-Section. Filtert die History-
                      Tabelle drunter rückwirkend; Summary-Cards bleiben unabhängig. */}
                  <select
                    value={neuPeriod}
                    onChange={e => setNeuPeriod(e.target.value as ActPeriod)}
                    className="sm:hidden text-xs font-medium px-2 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
                  >
                    {PERIODS.map(({ key, label }) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  <div className="hidden sm:flex flex-wrap rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                    {PERIODS.map(({ key, label }, i) => (
                      <button key={key} onClick={() => setNeuPeriod(key)}
                        className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${neuPeriod === key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Summary cards — passen sich an den Period-Filter an:
                    bei Vergangenheits-Filter (Letzte Woche / Letzter Monat /
                    Letztes Jahr) zeigen sie die Vergangenheits-Pendants statt
                    Gegenwart, Gesamt-Card wird zum kumulativen Stand am Ende
                    des Vorjahres ("wo standen wir letztes Jahr Silvester"). */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {(() => {
                    const isPast = neuPeriod === 'lastWeek' || neuPeriod === 'lastMonth' || neuPeriod === 'lastYear'
                    const n = auswertungStats.neupatienten
                    const cards = isPast
                      ? [
                          { label: 'Letzte Woche',          value: n.lastWeek,         color: 'bg-green-50    text-green-700    border-green-100'    },
                          { label: 'Letzter Monat',         value: n.lastMonth,        color: 'bg-emerald-50  text-emerald-700  border-emerald-100'  },
                          { label: 'Letztes Jahr',          value: n.lastYear,         color: 'bg-teal-50     text-teal-700     border-teal-100'     },
                          { label: 'Bis Ende letztes Jahr', value: n.totalEndLastYear, color: 'bg-gray-50     text-gray-700     border-gray-200'     },
                        ]
                      : [
                          { label: 'Diese Woche',           value: n.week,             color: 'bg-green-50    text-green-700    border-green-100'    },
                          { label: 'Dieser Monat',          value: n.month,            color: 'bg-emerald-50  text-emerald-700  border-emerald-100'  },
                          { label: 'Dieses Jahr',           value: n.year,             color: 'bg-teal-50     text-teal-700     border-teal-100'     },
                          { label: 'Gesamt',                value: n.total,            color: 'bg-gray-50     text-gray-700     border-gray-200'     },
                        ]
                    return cards.map(({ label, value, color }) => (
                      <button
                        key={label}
                        onClick={() => { setFilterNeupatient(true); setFilterTermin(null); setFilterStatus(null); setAuswertungOpen(false); setPage(1) }}
                        className={`flex flex-col px-4 py-3 rounded-xl border text-left transition-opacity hover:opacity-80 active:scale-95 ${color}`}
                      >
                        <span className="text-2xl font-bold tabular-nums">{value}</span>
                        <span className="text-xs mt-0.5 opacity-75">{label}</span>
                      </button>
                    ))
                  })()}
                </div>
                {/* History table by entry date */}
                {auswertungStats.neupatientRows.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-3">
                    {neuPeriod === 'all'       ? 'Noch keine Neupatienten erfasst.'
                   : neuPeriod === 'today'     ? 'Heute keine Neupatienten erfasst.'
                   : neuPeriod === 'week'      ? 'Diese Woche keine Neupatienten erfasst.'
                   : neuPeriod === 'lastWeek'  ? 'Letzte Woche keine Neupatienten erfasst.'
                   : neuPeriod === 'month'     ? 'Diesen Monat keine Neupatienten erfasst.'
                   : neuPeriod === 'lastMonth' ? 'Letzten Monat keine Neupatienten erfasst.'
                   : neuPeriod === 'year'      ? 'Dieses Jahr keine Neupatienten erfasst.'
                                               : 'Letztes Jahr keine Neupatienten erfasst.'}
                  </p>
                ) : (() => {
                  // Bei aktivem Period-Filter: pro User aggregiert (Datums-Spalte
                  // wird zum Tage-Counter). Bei 'Alle': eine Zeile pro Tag×User.
                  const neuGrouped = neuPeriod !== 'all'
                  const neuBodyRows = neuGrouped
                    ? auswertungStats.neupatientRowsGrouped.map((r, i) => ({ key: `g${i}`, leftCol: `${r.days} ${r.days === 1 ? 'Tag' : 'Tage'}`, user: r.user, count: r.count, names: r.names }))
                    : auswertungStats.neupatientRows.map(       (r, i) => ({ key: `d${i}`, leftCol: r.dateStr,                                  user: r.user, count: r.count, names: r.names }))
                  return (
                  // Inline-scrollbar (siehe Aktivitäts-Tabelle oben).
                  <div className="overflow-auto rounded-xl border border-gray-200 max-h-80">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 z-10 shadow-[inset_0_-1px_0_0_rgb(229_231_235)]">
                        <tr>
                          <th className="text-left px-4 py-2.5">{neuGrouped ? 'Tage' : 'Erfassungsdatum'}</th>
                          <th className="text-left px-4 py-2.5">Erfasst von</th>
                          <th className="text-right px-4 py-2.5">Anzahl</th>
                          <th className="text-left px-4 py-2.5">Patienten</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {neuBodyRows.map(r => (
                          <tr key={r.key} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 tabular-nums text-gray-500 text-xs">{r.leftCol}</td>
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
                  )
                })()}
              </div>

              {/* ── Kommende Termine & Recall-Status (volle Breite, "Aufgebot Art" entfernt) ── */}
              <div>
                <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-3">
                  <CalendarClock className="w-4 h-4 text-primary-500" /> Termine & Recall-Status
                </h3>

                {/* Termin-bezogen */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                  {([
                    { ft: 'heute'   as FilterTermin, label: 'Heute',           value: auswertungStats.upcoming.today,   color: 'bg-blue-50 text-blue-700 border-blue-100' },
                    { ft: 'week'    as FilterTermin, label: 'Nächste 7 Tage',  value: auswertungStats.upcoming.week,    color: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
                    { ft: 'month'   as FilterTermin, label: 'Nächste 30 Tage', value: auswertungStats.upcoming.month,   color: 'bg-violet-50 text-violet-700 border-violet-100' },
                    { ft: 'overdue' as FilterTermin, label: 'Überfällig',      value: auswertungStats.upcoming.overdue, color: 'bg-red-50 text-red-700 border-red-100' },
                  ]).map(({ ft, label, value, color }) => (
                    <button key={label}
                      onClick={() => { setFilterTermin(ft); setFilterNeupatient(false); setFilterStatus(null); setAuswertungOpen(false); setPage(1) }}
                      className={`flex flex-col px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border text-left transition-opacity hover:opacity-80 active:scale-95 cursor-pointer ${color}`}
                    >
                      <span className="text-xl sm:text-2xl font-bold tabular-nums">{value}</span>
                      <span className="text-[11px] sm:text-xs mt-0.5 opacity-75">{label}</span>
                    </button>
                  ))}
                </div>

                {/* Recall-Status — "Ohne Termin" aufgeschlüsselt nach Grund (patientenStatus) */}
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mt-3 mb-1.5">Ohne konkreten Termin — nach Status</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {([
                    { kind: 'termin' as const, key: 'inPlanung'    as FilterTermin, label: 'Geplante Recalls', sub: 'RC-Datum oder im Recall',           value: auswertungStats.upcoming.inPlanung,         color: 'bg-amber-50 text-amber-700 border-amber-100' },
                    { kind: 'termin' as const, key: 'nachfass'     as FilterTermin, label: 'Nachfassen',       sub: 'aufgeboten, >8 Wo. ohne Termin',    value: auswertungStats.upcoming.nachfass,          color: 'bg-orange-50 text-orange-700 border-orange-100' },
                    { kind: 'termin' as const, key: 'ohneTermin'   as FilterTermin, label: 'Wirklich offen',   sub: 'kein Termin, kein RC',              value: auswertungStats.upcoming.ohneTermin,        color: 'bg-gray-50 text-gray-700 border-gray-200' },
                    { kind: 'status' as const, key: 'wartetBericht'as FilterStatus, label: 'Wartet auf Bericht', sub: 'Zuweisung ausstehend',            value: auswertungStats.upcoming.wartetBericht,     color: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
                    { kind: 'status' as const, key: 'reminder'     as FilterStatus, label: 'Status: Reminder', sub: 'meldet sich noch',                  value: auswertungStats.upcoming.statusReminder,    color: 'bg-purple-50 text-purple-700 border-purple-100' },
                    { kind: 'status' as const, key: 'keinAufgebot' as FilterStatus, label: 'Kein Aufgebot',    sub: 'Patientenwunsch',                   value: auswertungStats.upcoming.statusKeinAufgebot,color: 'bg-slate-50 text-slate-600 border-slate-200' },
                  ]).map(c => (
                    <button key={c.label}
                      onClick={() => {
                        if (c.kind === 'termin') { setFilterTermin(c.key); setFilterStatus(null) }
                        else                      { setFilterStatus(c.key); setFilterTermin(null) }
                        setFilterNeupatient(false); setAuswertungOpen(false); setPage(1)
                      }}
                      title={c.sub}
                      className={`flex flex-col px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border text-left transition-opacity hover:opacity-80 active:scale-95 cursor-pointer ${c.color}`}
                    >
                      <span className="text-xl sm:text-2xl font-bold tabular-nums">{c.value}</span>
                      <span className="text-[11px] sm:text-xs mt-0.5 opacity-90 font-medium">{c.label}</span>
                      <span className="text-[10px] opacity-60 hidden sm:block">{c.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Praxis-Kennzahlen (nur GL / Ärzte / Admin) ── */}
              {(isGeschaeftsleitung || isArzt || isAdmin) && (
                <div className="space-y-5 p-4 rounded-2xl border border-indigo-100 bg-indigo-50/30">
                  <div className="flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-indigo-600" />
                    <h3 className="font-semibold text-gray-800">Praxis-Kennzahlen</h3>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">GL · Ärzte · Admin</span>
                    <span className="cursor-help" title="Momentaufnahme — Stand HEUTE, gerechnet über alle aktiven Patienten (ohne inaktiv / verstorben / storniert). Es ist KEIN Datums-Zeitraum, sondern der aktuelle Bestand. Für jede Zahl gibt es eine eigene Erklärung beim Darüberfahren.">
                      <Info className="w-3.5 h-3.5 text-gray-400" />
                    </span>
                  </div>
                  <p className="-mt-3 text-[11px] text-gray-500">Momentaufnahme · Stand heute · alle aktiven Patienten (kein Zeitraum). Erklärungen per Maus über die Überschriften und Zahlen.</p>

                  {/* 1) Wiedereinbestellung: Aufgebot → Termin (Conversion) */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2 inline-flex items-center gap-1 cursor-help"
                        title="Von den Patienten mit bereits ERSTELLTEM Aufgebot: welcher Anteil hat aktuell einen nächsten Termin gesetzt? Gesamt und pro Aufgebotsweg (Brief / Telefon / Praxis). Misst, ob/wie gut das Aufbieten zu Terminen führt. Momentaufnahme aller aktiven Patienten — kein Zeitraum.">
                      Wiedereinbestellung — Aufgebot → Termin <Info className="w-3 h-3 text-gray-400" />
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                      {([
                        ['Gesamt',  auswertungStats.recall.gesamt],
                        ['Brief',   auswertungStats.recall.Brief],
                        ['Telefon', auswertungStats.recall.Tel],
                        ['Praxis',  auswertungStats.recall.Praxis],
                      ] as const).map(([label, r]) => {
                        const pct = r.auf ? Math.round(r.termin / r.auf * 100) : 0
                        const tip = label === 'Gesamt'
                          ? `Conversion gesamt: ${r.termin} von ${r.auf} aufgebotenen Patienten haben aktuell einen nächsten Termin (${r.auf ? pct : 0}%). Momentaufnahme, kein Zeitraum.`
                          : `${label}: ${r.termin} von ${r.auf} per ${label === 'Telefon' ? 'Telefon' : label}-Aufgebot aufgebotenen Patienten haben aktuell einen Termin (${r.auf ? pct : 0}%).`
                        return (
                          <div key={label} title={tip} className="flex flex-col px-3 py-2.5 rounded-xl border border-indigo-100 bg-white cursor-help">
                            <span className="text-xl font-bold tabular-nums text-indigo-700">{r.auf ? `${pct}%` : '—'}</span>
                            <span className="text-[11px] font-medium text-gray-600">{label}</span>
                            <span className="text-[10px] text-gray-400">{r.termin}/{r.auf} mit Termin</span>
                          </div>
                        )
                      })}
                    </div>
                    <p className="mt-1 text-[10px] text-gray-400">Anteil der aufgebotenen Patienten (Aufgebot erstellt) mit gesetztem nächstem Termin. Momentaufnahme aller aktiven Patienten.</p>
                  </div>

                  {/* 2) RC-Last: offene Recalls nach Fälligkeit */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2 inline-flex items-center gap-1 cursor-help"
                        title="Arbeitsvorschau: Patienten, bei denen ein «RC zu erstellen ab»-Datum gesetzt ist, aber noch KEIN Aufgebot erstellt wurde. Gruppiert danach, wann das RC-Datum fällig wird (gerechnet ab heute). Zeigt, wie viel Recall-Arbeit ansteht.">
                      RC-Last — offene Recalls nach Fälligkeit <Info className="w-3 h-3 text-gray-400" />
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
                      {([
                        ['Überfällig', auswertungStats.rcLast.ueberfaellig, 'bg-red-50 text-red-700 border-red-100',       'RC-Datum liegt bereits in der Vergangenheit — überfällig, sollte zeitnah bearbeitet werden.'],
                        ['0–4 Wo.',    auswertungStats.rcLast.w0_4,         'bg-amber-50 text-amber-700 border-amber-100',  'RC-Datum wird in den nächsten 0–4 Wochen fällig.'],
                        ['4–8 Wo.',    auswertungStats.rcLast.w4_8,         'bg-yellow-50 text-yellow-700 border-yellow-100','RC-Datum wird in 4–8 Wochen fällig.'],
                        ['8–12 Wo.',   auswertungStats.rcLast.w8_12,        'bg-lime-50 text-lime-700 border-lime-100',     'RC-Datum wird in 8–12 Wochen fällig.'],
                        ['Später',     auswertungStats.rcLast.spaeter,      'bg-gray-50 text-gray-600 border-gray-200',     'RC-Datum wird erst in mehr als 12 Wochen fällig.'],
                      ] as const).map(([label, val, color, tip]) => (
                        <div key={label} title={tip} className={`flex flex-col px-3 py-2.5 rounded-xl border cursor-help ${color}`}>
                          <span className="text-xl font-bold tabular-nums">{val}</span>
                          <span className="text-[11px] font-medium opacity-90">{label}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-gray-400">Patienten mit «RC zu erstellen ab», aber noch ohne erstelltes Aufgebot. Fälligkeit ab heute gerechnet.</p>
                  </div>

                  {/* 3) Altersverteilung */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2 inline-flex items-center gap-1 cursor-help"
                        title="Anzahl der aktiven Patienten je Altersgruppe, berechnet aus dem Geburtsjahr (Stand heute). «unbekannt» = kein/ungültiges Geburtsdatum hinterlegt. Momentaufnahme, kein Zeitraum.">
                      Altersverteilung (aktive Patienten) <Info className="w-3 h-3 text-gray-400" />
                    </h4>
                    {(() => {
                      const ab = auswertungStats.ageBuckets
                      const order = ['0-17', '18-39', '40-59', '60-74', '75+', 'unbekannt']
                      const max = Math.max(...order.map(k => ab[k] || 0), 1)
                      return (
                        <div className="space-y-1.5">
                          {order.map(k => (
                            <div key={k} className="flex items-center gap-2">
                              <span className="w-20 text-xs text-gray-500 shrink-0">{k === 'unbekannt' ? 'unbekannt' : `${k} J.`}</span>
                              <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                                <div className="h-full bg-indigo-400" style={{ width: `${(ab[k] || 0) / max * 100}%` }} />
                              </div>
                              <span className="w-10 text-right text-xs tabular-nums font-medium text-gray-700">{ab[k] || 0}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* ── Sicherheitsnetz: Risikogruppen, in denen Patienten durchrutschen ── */}
              <div>
                <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" /> Sicherheitsnetz
                </h3>
                <p className="text-xs text-gray-400 mb-3">Risikogruppen, in denen Patienten unbemerkt liegen bleiben können — anklicken zum Bearbeiten.</p>
                {(() => {
                  const haengende = postausgang.items
                    .filter(it => !it.uploaded && !it.versendet && (Date.now() - it.createdAt) > 24 * 3600 * 1000)
                    .map(it => {
                      const p = (it.aufgebot as { patient?: RecallPatient } | undefined)?.patient
                      const tage = Math.floor((Date.now() - it.createdAt) / 864e5)
                      return { pid: it.pid ?? '', name: it.vorname || it.filename, grund: `seit ${tage} Tag(en) nicht hochgeladen`, patient: p as RecallPatient }
                    })
                  const cards = [
                    { key: 'zuw',   label: 'Zuweisung überfällig',     sub: 'Bericht > 8 Wochen ausstehend',     list: auswertungStats.riskZuweisung, color: 'amber'  },
                    { key: 'brief', label: 'Hängende Briefe',          sub: '> 24 h nicht hochgeladen/versandt',  list: haengende,                     color: 'red'    },
                    { key: 'rem',   label: 'Reminder ohne Reaktion',   sub: '8–26 Wochen, kein Termin gebucht',   list: auswertungStats.riskReminder,  color: 'sky'    },
                    { key: 'addr',  label: 'Adresse veraltet / retour', sub: 'Brief erreicht den Patienten nicht', list: auswertungStats.riskAdresse,   color: 'orange' },
                    { key: 'deakt', label: 'Kürzlich deaktiviert',      sub: 'inaktiv/kein Aufgebot < 30 Tage – prüfen', list: auswertungStats.riskDeaktiviert, color: 'amber' },
                    { key: 'ausg',  label: 'Ausgeschiedene Ärzte',      sub: 'Recall nötig, kein Verantwortlicher', list: auswertungStats.riskAusgeschieden, color: 'red' },
                  ]
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {cards.map(c => {
                        const n = c.list.length
                        const palette = n === 0 ? 'bg-gray-50 text-gray-400 border-gray-200'
                          : c.color === 'red'   ? 'bg-red-50 text-red-700 border-red-200'
                          : c.color === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : c.color === 'sky'   ? 'bg-sky-50 text-sky-700 border-sky-200'
                          :                       'bg-orange-50 text-orange-700 border-orange-200'
                        return (
                          <button key={c.key} disabled={n === 0}
                            onClick={() => setListePopup({ titel: c.label, subtitel: c.sub, list: c.list })}
                            className={`flex flex-col px-4 py-3 rounded-xl border text-left transition ${palette} ${n > 0 ? 'hover:opacity-80 active:scale-95 cursor-pointer' : 'cursor-default'}`}>
                            <span className="text-2xl font-bold tabular-nums">{n}</span>
                            <span className="text-xs mt-0.5 font-medium">{c.label}</span>
                            <span className="text-[10px] mt-0.5 opacity-70">{c.sub}</span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })()}
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
                        <th className="text-right px-4 py-2.5">Mit Termin</th>
                        <th className="text-right px-4 py-2.5">Im Recall</th>
                        <th className="text-right px-4 py-2.5" title="Aktive Patienten ohne Nächste Konst. und ohne RC-Datum — wirklich offen">Ohne Recall</th>
                        <th className="text-right px-4 py-2.5" title="Status «kein Aufgebot» — Self-Service, meldet sich selbst">kein Aufgebot</th>
                        <th className="text-right px-4 py-2.5" title="Wartet auf Abschluss-Bericht einer Zuweisung">wartet Bericht</th>
                        <th className="text-right px-4 py-2.5" title="Aktive Patienten, die in keine andere Kategorie fallen (z.B. verpasster Termin in der Vergangenheit, Aufgebot erstellt ohne neuen Termin)">Sonstige</th>
                        <th className="text-right px-4 py-2.5">Inaktiv/✝</th>
                        <th className="text-right px-4 py-2.5">Storniert</th>
                        <th className="text-right px-4 py-2.5 border-l border-gray-200" title="Querschnitt: davon Neupatienten (in den obigen Kategorien enthalten, NICHT Teil der Summe)">davon neu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {auswertungStats.docStats.map(d => (
                        <tr key={d.name} className={`hover:bg-gray-50 ${d.name === ZU_BEARB ? 'bg-amber-50/40' : ''}`}>
                          <td className="px-4 py-2.5 font-medium text-gray-800">{d.name}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{d.total}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-green-700 font-medium">{d.mitTermin || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{d.imRecall || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {d.ohneRecall > 0 && d.name !== ZU_BEARB ? (
                              <button
                                onClick={() => {
                                  setActiveTab(d.name)
                                  setFilterTermin('ohneTermin')
                                  setFilterNeupatient(false)
                                  setFilterStatus(null)
                                  setAuswertungOpen(false)
                                  setPage(1)
                                }}
                                title={`${d.ohneRecall} Patient(en) ohne geplanten Recall — anzeigen`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-300 text-xs font-semibold hover:bg-gray-200 hover:text-gray-900 transition-colors cursor-pointer"
                              >
                                {d.ohneRecall}
                              </button>
                            ) : <span className="text-gray-300">{d.ohneRecall || '—'}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{d.keinAufgebot || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-cyan-700">{d.wartetBericht || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                            {d.sonstige > 0 ? (
                              <button
                                onClick={() => setListePopup({ titel: `Sonstige — ${d.name}`, subtitel: 'Patienten ohne eindeutige Kategorie', list: d.sonstigeList })}
                                title={`${d.sonstige} Patient(en) ohne eindeutige Kategorie — Liste anzeigen:\n` +
                                  d.sonstigeList.slice(0, 12).map(s => `• ${s.name}${s.pid ? ` (${s.pid})` : ''} – ${s.grund}`).join('\n') +
                                  (d.sonstigeList.length > 12 ? `\n… und ${d.sonstigeList.length - 12} weitere` : '')}
                                className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-300 text-xs font-semibold hover:bg-gray-200 hover:text-gray-900 transition-colors cursor-pointer"
                              >
                                {d.sonstige}
                              </button>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">{d.inaktiv || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-red-500">{d.storniert || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-green-700 border-l border-gray-200">
                            {d.neupatient > 0
                              ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100 text-xs font-semibold">{d.neupatient}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      ))}
                      {/* Ausgeschiedene / inaktive Ärzte — pro ehemaligem Arzt, zugeklappt, separat vom Total der aktiven Ärzte */}
                      {auswertungStats.inactiveDocTotal > 0 && (
                        <>
                          <tr
                            className="bg-gray-50/60 hover:bg-gray-100 cursor-pointer"
                            onClick={() => setShowInactiveDocs(v => !v)}
                          >
                            <td className="px-4 py-2 text-gray-600 font-medium" colSpan={11}>
                              <span className="inline-flex items-center gap-1.5">
                                {showInactiveDocs
                                  ? <ChevronDown className="w-4 h-4 text-gray-400" />
                                  : <ChevronRight className="w-4 h-4 text-gray-400" />}
                                Ausgeschiedene Ärzte
                                <span className="text-xs font-normal text-gray-400">
                                  ({auswertungStats.inactiveDocStats.length} Ärzte · {auswertungStats.inactiveDocTotal} Patient{auswertungStats.inactiveDocTotal === 1 ? '' : 'en'} — im Total enthalten, hier aufklappen)
                                </span>
                              </span>
                            </td>
                          </tr>
                          {showInactiveDocs && auswertungStats.inactiveDocStats.map(d => (
                            <tr key={`inactive-${d.name}`} className="bg-gray-50/30 hover:bg-gray-50 text-gray-600">
                              <td className="px-4 py-2.5 pl-10 font-medium">{d.name}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{d.total}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{d.mitTermin || '—'}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{d.imRecall || '—'}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{d.ohneRecall || '—'}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{d.keinAufgebot || '—'}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-cyan-700">{d.wartetBericht || '—'}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                                {d.sonstige > 0 ? (
                                  <button
                                    onClick={() => setListePopup({ titel: `Sonstige — ${d.name}`, subtitel: 'Patienten ohne eindeutige Kategorie', list: d.sonstigeList })}
                                    className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-300 text-xs font-semibold hover:bg-gray-200 hover:text-gray-900 transition-colors cursor-pointer"
                                  >{d.sonstige}</button>
                                ) : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">{d.inaktiv || '—'}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-red-500">{d.storniert || '—'}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-green-700 border-l border-gray-200">{d.neupatient || '—'}</td>
                            </tr>
                          ))}
                        </>
                      )}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-700">
                      <tr>
                        <td className="px-4 py-2.5">Total <span className="font-normal text-gray-400 text-xs">(inkl. ausgeschiedene)</span></td>
                        {(['total','mitTermin','imRecall','ohneRecall','keinAufgebot','wartetBericht','sonstige','inaktiv','storniert','neupatient'] as const).map(k => (
                          <td key={k} className={`px-4 py-2.5 text-right tabular-nums${k === 'neupatient' ? ' border-l border-gray-200' : ''}`}>
                            {[...auswertungStats.docStats, ...auswertungStats.inactiveDocStats].reduce((sum, d) => sum + d[k], 0) || '—'}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* ── Inaktive / verstorbene Patienten ── */}
              <div>
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    <MinusCircle className="w-4 h-4 text-gray-400" />
                    Inaktive / verstorbene Patienten
                    <span className="text-xs font-normal text-gray-400 ml-1">
                      ({auswertungStats.inaktiveRows.length})
                    </span>
                    {/* Arzt-Abgleich (Batch-Scan, nur Desktop-App): liest den
                        letzten Konsultations-Arzt aus Liris aus und teilt
                        Patienten inaktiver Aerzte ggf. korrekt zu. */}
                    {isElectron && !arztScan?.running && (
                      <button type="button" onClick={startArztScan}
                        title="Liest für alle aktiven Patienten den Arzt der letzten Konsultation aus Liris aus (Akten werden automatisch durchgeblättert). Patienten inaktiver Ärzte werden dem zuletzt konsultierten aktiven Arzt zugeteilt."
                        className="text-xs border border-indigo-200 rounded-lg px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold"
                      >
                        Arzt-Abgleich starten{arztScan && !arztScan.running ? ` (${arztScan.found} ✓)` : ''}
                      </button>
                    )}
                  </h3>
                  {/* Period-Filter analog zu Aktivität + Neupatienten. Filtert
                      Tabelle UND Summary-Cards rückwirkend — Kind-Counts
                      reflektieren den gewählten Zeitraum. */}
                  <select
                    value={inaktivPeriod}
                    onChange={e => setInaktivPeriod(e.target.value as ActPeriod)}
                    className="sm:hidden text-xs font-medium px-2 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
                  >
                    {PERIODS.map(({ key, label }) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  <div className="hidden sm:flex flex-wrap rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                    {PERIODS.map(({ key, label }, i) => (
                      <button key={key} onClick={() => setInaktivPeriod(key)}
                        className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${inaktivPeriod === key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Summary cards pro Grund-Kategorie. Counts reflektieren den
                    gewählten Period-Filter (z.B. "Letzter Monat" → wie viele
                    Verstorbene/Arztwechsel/... in diesem Zeitraum). Click filtert
                    die Hauptliste auf Status "Inaktiv/✝" (alle, ungeachtet Grund). */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    { kind: 'verstorben'  as const, label: '✝ Verstorben', value: auswertungStats.inaktivCounts.verstorben,  color: 'bg-gray-50  text-gray-700  border-gray-200'  },
                    { kind: 'arztwechsel' as const, label: 'Arztwechsel',   value: auswertungStats.inaktivCounts.arztwechsel, color: 'bg-amber-50 text-amber-700 border-amber-200' },
                    { kind: 'wegzug'      as const, label: 'Wegzug',        value: auswertungStats.inaktivCounts.wegzug,      color: 'bg-sky-50   text-sky-700   border-sky-200'   },
                    { kind: 'inaktiv'     as const, label: 'Sonstige',      value: auswertungStats.inaktivCounts.inaktiv,     color: 'bg-gray-50  text-gray-600  border-gray-200'  },
                  ].map(({ kind, label, value, color }) => (
                    <button
                      key={kind}
                      onClick={() => { setFilterStatus('inaktiv'); setFilterTermin(null); setFilterNeupatient(false); setAuswertungOpen(false); setPage(1) }}
                      className={`flex flex-col px-4 py-3 rounded-xl border text-left transition-opacity hover:opacity-80 active:scale-95 cursor-pointer ${color}`}
                    >
                      <span className="text-2xl font-bold tabular-nums">{value}</span>
                      <span className="text-xs mt-0.5 opacity-75">{label}</span>
                    </button>
                  ))}
                </div>
                {/* Kreuztabelle Arzt × Kategorie — beantwortet «wie viele
                    Inaktive/Verstorbene hat welcher Arzt» auf einen Blick.
                    Respektiert den Zeitraum-Filter oben. */}
                {auswertungStats.inaktiveRows.length > 0 && (() => {
                  type K = 'verstorben' | 'arztwechsel' | 'wegzug' | 'inaktiv'
                  const byDoc = new Map<string, Record<K, number> & { total: number }>()
                  for (const r of auswertungStats.inaktiveRows) {
                    const doc = r.doctor === OFFEN_TAB ? 'ohne Zuordnung' : r.doctor
                    if (!byDoc.has(doc)) byDoc.set(doc, { verstorben: 0, arztwechsel: 0, wegzug: 0, inaktiv: 0, total: 0 })
                    const e = byDoc.get(doc)!
                    e[(r.kind as K) in e ? (r.kind as K) : 'inaktiv']++
                    e.total++
                  }
                  const rows = [...byDoc.entries()].sort((a, b) => b[1].total - a[1].total)
                  return (
                    <div className="overflow-auto rounded-xl border border-gray-200 mb-4">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          <tr>
                            <th className="text-left px-4 py-2">Arzt</th>
                            <th className="text-right px-4 py-2">✝ Verstorben</th>
                            <th className="text-right px-4 py-2">Arztwechsel</th>
                            <th className="text-right px-4 py-2">Wegzug</th>
                            <th className="text-right px-4 py-2">Sonstige</th>
                            <th className="text-right px-4 py-2 font-bold">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {rows.map(([doc, e]) => (
                            <tr key={doc} className="hover:bg-gray-50">
                              <td className="px-4 py-2 font-medium text-gray-800">{doc}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-gray-700">{e.verstorben || <span className="text-gray-300">—</span>}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-amber-700">{e.arztwechsel || <span className="text-gray-300">—</span>}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-sky-700">{e.wegzug || <span className="text-gray-300">—</span>}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-gray-600">{e.inaktiv || <span className="text-gray-300">—</span>}</td>
                              <td className="px-4 py-2 text-right tabular-nums font-bold text-gray-900">{e.total}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
                {/* History table */}
                {auswertungStats.inaktiveRows.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-3">
                    {inaktivPeriod === 'all'       ? 'Keine inaktiven Patienten.'
                   : inaktivPeriod === 'today'     ? 'Heute keine Deaktivierungen.'
                   : inaktivPeriod === 'week'      ? 'Diese Woche keine Deaktivierungen.'
                   : inaktivPeriod === 'lastWeek'  ? 'Letzte Woche keine Deaktivierungen.'
                   : inaktivPeriod === 'month'     ? 'Diesen Monat keine Deaktivierungen.'
                   : inaktivPeriod === 'lastMonth' ? 'Letzten Monat keine Deaktivierungen.'
                   : inaktivPeriod === 'year'      ? 'Dieses Jahr keine Deaktivierungen.'
                                                   : 'Letztes Jahr keine Deaktivierungen.'}
                  </p>
                ) : (
                  <div className="overflow-auto rounded-xl border border-gray-200 max-h-80">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 z-10 shadow-[inset_0_-1px_0_0_rgb(229_231_235)]">
                        <tr>
                          <th className="text-left px-4 py-2.5">Datum</th>
                          <th className="text-left px-4 py-2.5">Patient</th>
                          <th className="text-left px-4 py-2.5">Arzt</th>
                          <th className="text-left px-4 py-2.5">Status</th>
                          <th className="text-left px-4 py-2.5">Grund</th>
                          <th className="text-left px-4 py-2.5">Deaktiviert von</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {auswertungStats.inaktiveRows.map(r => {
                          // Pill-Farbe + Label pro Grund-Kategorie, damit Arztwechsel/Wegzug/
                          // Verstorben/generisch-Inaktiv auf einen Blick unterscheidbar sind.
                          const pill =
                            r.kind === 'verstorben'  ? { label: '✝ Verstorben', cls: 'bg-gray-100  text-gray-700  border-gray-200'  } :
                            r.kind === 'arztwechsel' ? { label: 'Arztwechsel',   cls: 'bg-amber-50  text-amber-700  border-amber-200' } :
                            r.kind === 'wegzug'      ? { label: 'Wegzug',        cls: 'bg-sky-50    text-sky-700    border-sky-200'    } :
                                                       { label: 'Inaktiv',       cls: 'bg-gray-50   text-gray-600   border-gray-200'   }
                          return (
                            <tr key={r.id} className="hover:bg-gray-50">
                              <td className="px-4 py-2.5 tabular-nums text-gray-500 text-xs">{r.dateStr || <span className="text-gray-300">—</span>}</td>
                              <td className="px-4 py-2.5 text-gray-800">
                                <span className="font-medium">{r.vorname || <span className="text-gray-400 italic">ohne Name</span>}</span>
                                {r.pid && <span className="ml-2 text-xs text-gray-400 tabular-nums">#{r.pid}</span>}
                              </td>
                              <td className="px-4 py-2.5 text-gray-600 text-xs">
                                <span>{r.doctor === OFFEN_TAB ? <span className="text-gray-400 italic">ohne Zuordnung</span> : r.doctor}</span>
                                {r.kind === 'arztwechsel' && (
                                  <span className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${r.doctorActive ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}
                                    title={r.doctorActive ? 'Wechsel zu einem aktiven Arzt der Praxis' : 'Zugeordneter Arzt ist ausgeschieden / inaktiv'}>
                                    {r.doctorActive ? 'aktiver Arzt' : 'ausgeschieden'}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${pill.cls}`}>
                                  {pill.label}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-gray-700 text-xs">{r.grund || <span className="text-gray-300">—</span>}</td>
                              <td className="px-4 py-2.5 text-gray-700 text-xs">{r.by ? r.by.split(' ')[0] : <span className="text-gray-300">—</span>}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-[11px] text-gray-400 mt-2">
                  Hinweis: «Deaktiviert von» basiert auf dem letzten Edit am Patient — falls jemand nach der Deaktivierung
                  nochmal editiert hat, kann das den ursprünglichen Deaktivierer überdecken.
                </p>
              </div>

              {/* ── Doppelte PIDs ── */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    <AlertTriangle className={`w-4 h-4 ${auswertungStats.duplicatePidGroups.length > 0 ? 'text-red-500' : 'text-gray-300'}`} />
                    Doppelte PIDs
                    <span className="text-xs font-normal text-gray-400 ml-1">
                      ({auswertungStats.duplicatePidGroups.length} PID{auswertungStats.duplicatePidGroups.length === 1 ? '' : 's'})
                    </span>
                  </h3>
                  {(() => {
                    // Count groups where a today-uploaded duplicate exists.
                    // Nur das wird beim Cleanup gelöscht — historische Duplikate
                    // bleiben unangetastet (manuelle Entscheidung notwendig).
                    const todayVictimsCount = auswertungStats.duplicatePidGroups
                      .filter(g => pickTodaysDuplicate(g.entries) !== null).length
                    if (todayVictimsCount === 0) return null
                    return (
                      <button
                        onClick={() => setShowDupCleanupConfirm(true)}
                        title="Entfernt nur Einträge die HEUTE hochgeladen wurden — historische Duplikate bleiben unverändert"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                        Heutige Duplikate löschen ({todayVictimsCount})
                      </button>
                    )
                  })()}
                </div>
                {auswertungStats.duplicatePidGroups.length === 0 ? (
                  <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    ✓ Keine doppelten PIDs gefunden.
                  </p>
                ) : (
                  <div className="overflow-auto rounded-xl border border-red-200 max-h-96">
                    <table className="w-full text-sm">
                      <thead className="bg-red-50 text-xs font-semibold text-red-700 uppercase tracking-wide sticky top-0 z-10 shadow-[inset_0_-1px_0_0_rgb(254_202_202)]">
                        <tr>
                          <th className="text-left px-4 py-2.5">PID</th>
                          <th className="text-left px-4 py-2.5">Vorname</th>
                          <th className="text-left px-4 py-2.5">Geb.-Datum</th>
                          <th className="text-left px-4 py-2.5">Arzt</th>
                          <th className="text-right px-4 py-2.5">Aktion</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {auswertungStats.duplicatePidGroups.flatMap(group =>
                          group.entries.map((p, idx) => (
                            <tr key={p.id} className={`hover:bg-red-50/30 ${idx === 0 ? 'border-t-2 border-t-red-300' : ''}`}>
                              <td className="px-4 py-2.5 tabular-nums font-mono text-xs">
                                {idx === 0 && <span className="font-bold text-red-700">#{group.pid}</span>}
                                {idx > 0 && <span className="text-gray-400">↳</span>}
                                {idx === 0 && group.entries.length > 2 && (
                                  <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                    {group.entries.length}×
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-medium text-gray-800">{p.vorname || <span className="italic text-gray-400">ohne Name</span>}</td>
                              <td className="px-4 py-2.5 text-xs text-gray-600">{p.gebDatum ? formatDate(p.gebDatum) : '—'}</td>
                              <td className="px-4 py-2.5 text-xs text-gray-700">{p.doctor}</td>
                              <td className="px-4 py-2.5 text-right">
                                <button
                                  onClick={() => { setAuswertungOpen(false); switchTab(p.doctor); openEdit(p) }}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white font-semibold rounded transition-colors">
                                  <Pencil className="w-3 h-3" /> Öffnen
                                </button>
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                {auswertungStats.duplicatePidGroups.length > 0 && (
                  <p className="text-[11px] text-gray-500 mt-2">
                    Tipp: Jede PID darf nur einmal vorkommen. Öffnen Sie die einzelnen Einträge und entscheiden Sie welcher
                    behalten und welche storniert/gelöscht werden. Beim manuellen Anlegen blockt das Edit-Modal jetzt
                    Doppelte PID-Eingaben.
                  </p>
                )}
              </div>

            </div>
          </div>
        </>
      )}

      {/* ── Edit / New modal ──────────────────────────────────────────────────── */}
      {editTarget !== null && (
        <>


          {/* Modal – draggable */}
          <div
            ref={modalRef}
            style={modalPos
              ? { position: 'fixed', left: modalPos.x, top: modalPos.y, zIndex: 56, width: 'min(32rem, calc(100vw - 2rem))' }
              // Standardposition: in der Mitte des SICHTBAREN App-Bereichs (links
              // vom Liris-Panel), damit der Dialog nicht von Liris überdeckt wird.
              : { position: 'fixed', left: `calc(50% - ${lirisPanelWidth / 2}px)`, top: '50%', zIndex: 56, width: 'min(32rem, calc(100vw - 2rem))', transform: 'translate(-50%,-50%)' }
            }
            className="bg-white rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
          >

            <div
              onMouseDown={onModalDragStart}
              className={`flex flex-col gap-0 border-b border-gray-200 shrink-0 ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
            >
              <div className="flex items-center justify-between px-6 py-4">
                <h2 className="font-bold text-gray-900 pointer-events-none flex items-center gap-2">
                  {editTarget === 'new' ? 'Neuer Patient' : 'Patient bearbeiten'}
                  <MinorBadge gebDatum={form.gebDatum} />
                </h2>
                {editTarget !== 'new' && (
                  <>
                    <span className="text-xs font-bold px-2 py-1 rounded-full bg-primary-100 text-primary-700 ml-3 pointer-events-none">
                      {editTarget.doctor}
                    </span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ml-1.5 mr-auto pointer-events-none ${
                      form.patientenStatus === 'verstorben' ? 'bg-red-100 text-red-700'
                      : form.patientenStatus === 'inaktiv' ? 'bg-gray-200 text-gray-600'
                      : form.patientenStatus === 'kein Aufgebot' ? 'bg-amber-100 text-amber-700'
                      : form.patientenStatus === 'Reminder' ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-green-100 text-green-700'
                    }`}>
                      {form.patientenStatus || 'aktiv'}
                    </span>
                  </>
                )}
                {editTarget !== 'new' && editTarget.aktualisiert && (() => {
                  const ps = parseStamp(editTarget.aktualisiert)
                  return ps ? <span className="text-[10px] text-gray-400 ml-auto mr-2 pointer-events-none">Aktualisiert: {ps.dateStr}{ps.user ? ` (${ps.user})` : ''}</span> : null
                })()}
                <button onClick={closeEdit}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {showNoChangesMsg && (
                <div className="mx-6 mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>
                    Bereits aktualisiert{(editTarget as RecallPatient).aktualisiert ? ` (${(editTarget as RecallPatient).aktualisiert})` : ''} — keine Änderungen nötig. Fenster kann geschlossen werden.
                  </span>
                </div>
              )}
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">

              {/* ── Quick-paste parser — nur bei Neuerfassung ── */}
              {editTarget === 'new' && !isElectron && <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
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

              {/* Hinweis-Banner: fehlende Pflichtfelder bei bestehendem Patient
                  (z.B. nach Excel-Import: Geburtsdatum nicht gesetzt, kein Arzt). */}
              {editTarget !== 'new' && (formErrors.gebDatum || (formErrors.assignDoctor && !assignDoctor) || formErrors.grundStornierung) && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-300 text-sm text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <div className="flex-1">
                    <p className="font-semibold mb-0.5">Bitte ergänzen:</p>
                    <ul className="text-xs space-y-0.5 ml-1">
                      {formErrors.gebDatum     && <li>• Geburtsdatum eintragen</li>}
                      {formErrors.assignDoctor && !assignDoctor && <li>• Arzt zuweisen (unten im Feld „Arzt zuweisen")</li>}
                      {formErrors.grundStornierung && <li>• Grund f. Stornierung angeben (Pflicht bei inaktiven Patienten)</li>}
                    </ul>
                  </div>
                </div>
              )}

              <div>
                <label className={labelCls}>Patienten-ID (PID){reqStar}</label>
                <div className={`flex items-stretch border rounded-lg overflow-hidden bg-white focus-within:ring-2 ${formErrors.pid ? 'border-red-400 focus-within:ring-red-300' : changedFields.has('pid') ? 'border-amber-300 ring-2 ring-amber-300 bg-amber-50 focus-within:ring-amber-400' : 'border-gray-200 focus-within:ring-primary-300'}`}>
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
                  className={(formErrors.vorname ? inputClsErr : inputCls) + chCls('vorname')} placeholder="Vorname" />
              </div>

              <div>
                <label className={labelCls}>Geb. Datum{reqStar}</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input type="date" value={form.gebDatum} {...dateDrop('gebDatum')}
                      onChange={e => setField('gebDatum', e.target.value)}
                      className={`w-full pr-6 ${formErrors.gebDatum ? inputClsErr : inputCls}${chCls('gebDatum')}`} />
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
                    <input type="date" value={form.letzteKons} {...dateDrop('letzteKons')}
                      onChange={e => {
                        const newDate = e.target.value
                        setField('letzteKons', newDate)
                        setField('storniert', '')
                        setField('grundStornierung', '')
                        if (!newDate) {
                          setField('konsInterval', '')
                          setField('naechsteKons', '')
                          setField('keinTermin', false)
                          setField('aufgebotFuer', '')
                          setField('aufgebotArt', '')
                          return
                        }
                        // Nur wenn das neue Datum SPÄTER als die zuletzt gespeicherte
                        // «Letzte Konst.» ist, gilt es als NEUE Konsultation → neuer
                        // Recall-Zyklus. Korrektur (gleich/älter) löst nichts aus.
                        const savedLK = (editTarget !== 'new' && editTarget) ? (editTarget.letzteKons ?? '') : ''
                        if (newDate <= savedLK) return
                        // Neuer Zyklus: altes Aufgebot/Termin ist obsolet.
                        setField('aufgebotErstellt', '')   // «Aufgebot/Reminder erstellt am» leeren
                        setField('aufgebotArt', '')
                        setField('naechsteKons', '')       // «Nächste Konst.» leeren
                        setField('keinTermin', false)
                        // Intervall (Formular oder aus Liris) → neues «RC zu erstellen ab»
                        let effectiveInterval = form.konsInterval
                        const lxWeeks = lirisExtract?.intervalWeeks || lastLirisExtract.current?.intervalWeeks
                        if (!effectiveInterval && lxWeeks) {
                          const w = lxWeeks
                          if      (w % 52 === 0 && w / 52 <= 120) effectiveInterval = `${w / 52}j`
                          else if (w % 4  === 0 && w / 4  <= 120) effectiveInterval = `${w / 4}m`
                          else if (w <= 120)                      effectiveInterval = `${w}w`
                          if (effectiveInterval) setField('konsInterval', effectiveInterval)
                        }
                        if (effectiveInterval) {
                          const computed = computeNextKons(newDate, effectiveInterval)
                          if (computed) {
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
                      className={`${inputCls} pr-6${chCls('letzteKons')}`} />
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
                        // Bei Intervall-Aktualisierung Storniert-Status leeren —
                        // wenn der Recall neu geplant wird, ist die Stornierung obsolet.
                        if (val.trim()) {
                          setField('storniert', '')
                          setField('grundStornierung', '')
                        }
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
                      className={`${inputCls} pr-6 placeholder:text-gray-300${chCls('konsInterval')}`}
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

                {/* Arzt zuweisen (im oberen Grid - prominent platziert,
                    Pflichtfeld wenn noch kein Arzt vorhanden). */}
                {(() => {
                  const noDoctorYet = editTarget === 'new' || (editTarget && editTarget.doctor === ZU_BEARB)
                  const isRequired  = noDoctorYet
                  // Nur rot wenn die Zuweisung erforderlich ist UND noch kein Arzt
                  // gewaehlt wurde. Sobald ein Arzt gewaehlt ist -> nicht mehr rot.
                  const hasError    = formErrors.assignDoctor === true && !assignDoctor
                  return (
                    <div>
                      <label className={labelCls}>
                        {noDoctorYet ? 'Arzt zuweisen' : 'Arzt wechseln'}
                        {isRequired && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      <select
                        value={assignDoctor}
                        onChange={e => {
                          setAssignDoctor(e.target.value)
                          if (formErrors.assignDoctor) setFormErrors(prev => ({ ...prev, assignDoctor: false }))
                        }}
                        className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 ${
                          hasError ? 'border-red-400 focus:ring-red-300' : 'border-gray-200 focus:ring-primary-300'
                        }`}
                      >
                        <option value="">
                          {noDoctorYet ? '— Arzt wählen —' : '— kein Wechsel —'}
                        </option>
                        {doctors.filter(d => editTarget === 'new' || d !== (editTarget as RecallPatient).doctor).map(d =>
                          <option key={d} value={d}>{d}</option>
                        )}
                        {/* 'offen' nur anzeigen wenn Patient bereits dort ist — nicht aktiv wählbar */}
                        {editTarget !== 'new' && (editTarget as RecallPatient).doctor === OFFEN_TAB && !assignDoctor && (
                          <option value="" disabled>Keinem Arzt zugewiesen (aktuell)</option>
                        )}
                        {/* Inaktive Ärzte: sichtbar wenn Patient verstorben oder inaktiv ist */}
                        {(form.patientenStatus === 'verstorben' || form.patientenStatus === 'inaktiv') && (() => {
                          const inaktive = new Set<string>()
                          if (assignDoctor && !doctors.includes(assignDoctor) && assignDoctor !== OFFEN_TAB && assignDoctor !== ZU_BEARB) {
                            inaktive.add(assignDoctor)
                          }
                          if (editTarget && editTarget !== 'new' && editTarget.doctor && !doctors.includes(editTarget.doctor) && editTarget.doctor !== OFFEN_TAB && editTarget.doctor !== ZU_BEARB) {
                            inaktive.add(editTarget.doctor)
                          }
                          if (lirisExtract?.autor) {
                            const cleaned = lirisExtract.autor.replace(/^(?:Dr|Prof|med)\.?\s+/gi, '').trim()
                            if (!doctors.find(d => d.toLowerCase().includes(cleaned.toLowerCase()))) {
                              inaktive.add(lirisExtract.autor)
                            }
                          }
                          if (!inaktive.size) return null
                          return <>
                            <option disabled>──── inaktiv ────</option>
                            {[...inaktive].map(name =>
                              <option key={name} value={name} style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                                {name} (inaktiv)
                              </option>
                            )}
                          </>
                        })()}
                      </select>
                      {hasError && <p className="mt-1 text-[11px] text-red-500">Bitte Arzt wählen.</p>}
                      {editTarget !== 'new' && assignDoctor && !noDoctorYet && (
                        <p className="mt-1 text-[11px] text-primary-500">(wird beim Speichern übernommen)</p>
                      )}
                    </div>
                  )
                })()}
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

                {/* Schnell-Merker: Details noch offen, aber die Zuweisung darf
                    nicht vergessen gehen. Erscheint als eigene Erinnerung im
                    ZW-Management ("Noch zuzuweisen"), unabhaengig vom Toggle
                    oben (der eine bereits konkrete Zuweisung anlegt). */}
                <button type="button"
                  onClick={() => setField('zuweisungNoetig', !form.zuweisungNoetig)}
                  className={`mb-2 w-full py-2 rounded-lg text-xs font-bold border-2 transition-colors flex items-center justify-center gap-1.5 ${
                    form.zuweisungNoetig
                      ? 'border-orange-400 bg-orange-100 text-orange-700'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-orange-300 hover:bg-orange-50'
                  }`}>
                  {form.zuweisungNoetig ? '✓ Zuweisung noch ausstehend' : 'Muss noch zugewiesen werden'}
                </button>

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
                          <input type="date" value={form.zuweisungDatum} {...dateDrop('zuweisungDatum')}
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
                              <input type="date" value={form.zuweisungErledigtAm} {...dateDrop('zuweisungErledigtAm')}
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

                {/* Weitere Zuweisungen (an verschiedene Orte) */}
                {form.zuweisungExtra.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {form.zuweisungExtra.map((zx, i) => (
                      <div key={zx.id || i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-violet-200 bg-violet-50/40 text-xs">
                        <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">{zx.typ === 'intern' ? 'Int.' : 'Ext.'}</span>
                        <span className="font-medium text-gray-800 truncate">→ {zx.ziel}</span>
                        {zx.grund && <span className="text-gray-500 truncate">· {zx.grund}</span>}
                        {zx.datum && <span className="text-gray-400 shrink-0">· {formatDate(zx.datum)}</span>}
                        <button type="button" onClick={() => setField('zuweisungExtra', form.zuweisungExtra.filter((_, j) => j !== i))}
                          title="Entfernen" className="ml-auto p-0.5 rounded text-gray-400 hover:text-red-500 shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* «+ weitere Zuweisung» — gleiche Felder wie 1. Zuweisung */}
                {zwAddOpen ? (
                  <div className="mt-2 p-3 rounded-xl border border-violet-200 bg-violet-50 space-y-2">
                    {/* Typ */}
                    <div className="flex gap-2">
                      {(['intern', 'extern'] as const).map(t => (
                        <button key={t} type="button" onClick={() => setZwAddDraft(d => ({ ...d, typ: t, ziel: '' }))}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors ${zwAddDraft.typ === t ? 'border-violet-500 bg-violet-100 text-violet-700' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'}`}>
                          {t === 'intern' ? 'Intern (Praxis)' : 'Extern (andere Praxis)'}
                        </button>
                      ))}
                    </div>
                    {/* Ziel: Praxis / Arzt */}
                    <div>
                      <label className={labelCls}>{zwAddDraft.typ === 'intern' ? 'Arzt / Abteilung' : 'Praxis / Klinik'}<span className="text-red-500 ml-0.5">*</span></label>
                      {(() => {
                        const opts = zwAddDraft.typ === 'intern' ? doctors : zuweisungPraxen
                        return (
                          <div className="space-y-1.5">
                            <select
                              value={opts.includes(zwAddDraft.ziel) ? zwAddDraft.ziel : (zwAddDraft.ziel ? '__custom__' : '')}
                              onChange={e => setZwAddDraft(d => ({ ...d, ziel: e.target.value === '__custom__' ? '' : e.target.value }))}
                              className={inputCls}>
                              <option value="">{zwAddDraft.typ === 'intern' ? '— Arzt wählen —' : '— Praxis wählen —'}</option>
                              {opts.map(o => <option key={o} value={o}>{o}</option>)}
                              <option value="__custom__">Sonstige…</option>
                            </select>
                            {!opts.includes(zwAddDraft.ziel) && (
                              <input type="text" value={zwAddDraft.ziel} onChange={e => setZwAddDraft(d => ({ ...d, ziel: e.target.value }))}
                                placeholder="Bezeichnung eingeben…" className={inputCls} />
                            )}
                          </div>
                        )
                      })()}
                    </div>
                    {/* Grund */}
                    <div>
                      <label className={labelCls}>Grund</label>
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {zuweisungGruende.map(g => (
                          <button key={g} type="button" onClick={() => setZwAddDraft(d => ({ ...d, grund: d.grund === g ? '' : g }))}
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${zwAddDraft.grund === g ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-300 hover:border-violet-400 hover:text-violet-700'}`}>{g}</button>
                        ))}
                      </div>
                      {!zuweisungGruende.includes(zwAddDraft.grund) && (
                        <input type="text" value={zwAddDraft.grund} onChange={e => setZwAddDraft(d => ({ ...d, grund: e.target.value }))}
                          placeholder="Grund (freitext)…" className={inputCls} />
                      )}
                    </div>
                    {/* Zugewiesen am */}
                    <div>
                      <label className={labelCls}>Zugewiesen am</label>
                      <input type="date" value={zwAddDraft.datum} onChange={e => setZwAddDraft(d => ({ ...d, datum: e.target.value }))} className={inputCls} />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={() => { setZwAddOpen(false); setZwAddDraft({ typ: 'extern', ziel: '', grund: '', datum: new Date().toISOString().slice(0, 10) }) }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100">Abbrechen</button>
                      <button type="button" disabled={!zwAddDraft.ziel.trim()}
                        onClick={() => {
                          const zw = { ...newZuweisung(zwAddDraft.typ, zwAddDraft.ziel.trim(), zwAddDraft.grund.trim(), displayLabel), datum: zwAddDraft.datum || new Date().toISOString().slice(0, 10) }
                          setField('zuweisungExtra', [...form.zuweisungExtra, zw])
                          setZwAddOpen(false); setZwAddDraft({ typ: 'extern', ziel: '', grund: '', datum: new Date().toISOString().slice(0, 10) })
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">Hinzufügen</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setZwAddOpen(true)}
                    className="mt-2 flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-800 hover:underline">
                    <Plus className="w-3.5 h-3.5" /> Weitere Zuweisung
                  </button>
                )}
              </div>

              {/* Aufgebot-Icons (volle Breite oben) */}
              <div>
                <label className={labelCls}>Aufgebot{changedFields.has('aufgebotArt') && <span className="ml-1.5 text-amber-600">●</span>}</label>
                <div className={`flex gap-2${changedFields.has('aufgebotArt') ? ' p-1 -m-1 rounded-lg ring-2 ring-amber-300 bg-amber-50' : ''}`}>
                  {/* Briefaufgebot + Reminder + Terminverschiebung zusammengefasst:
                      EIN Button, der direkt das Aufbieten-Modal oeffnet (dort
                      waehlt der User Art und Variante). */}
                  <button
                    type="button"
                    disabled={!editTarget || editTarget === 'new'}
                    onClick={() => {
                      if (editTarget && editTarget !== 'new') {
                        openAufgebotDialog({ patient: editTarget })
                        setEditTarget(null)
                      }
                    }}
                    title={editTarget === 'new' ? 'Erst nach dem Anlegen des Patienten verfügbar' : 'Aufbieten-Dialog öffnen (Briefaufgebot / Reminder / Terminverschiebung) — dort auch «Nur Datum eintragen» möglich'}
                    className={`flex-[2] flex flex-col items-center gap-1.5 py-2.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 ${
                      form.aufgebotArt === 'Brief' || form.aufgebotArt === 'Reminder'
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <Mail className="w-4 h-4" />
                    Aufbieten/Reminder/Verschiebung
                  </button>
                  {AUFGEBOT_OPTIONS.filter(o => o.value === 'Tel' || o.value === 'Praxis').map(({ value, Icon, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        const next = form.aufgebotArt === value ? '' : value
                        setField('aufgebotArt', next)
                        if (next) {
                          // Aufgebotsart gewählt (Reminder/Tel/Praxis) → das
                          // Aufgebot wird erstellt, «RC zu erstellen ab» ist obsolet.
                          setField('aufgebotFuer', '')
                          // Praxis-Aufgebot: meist beim letzten Konsil direkt
                          // vereinbart -> letzteKons als Default-Datum, sonst
                          // muss der User das nachtraeglich korrigieren.
                          const isPraxis = next === 'Praxis'
                          const defaultDate = (isPraxis && form.letzteKons)
                            ? form.letzteKons
                            : new Date().toISOString().slice(0, 10)
                          setField('aufgebotErstellt', defaultDate)
                          // Telefonaufgebot: Telefon-Panel (Grundvermerk,
                          // Erreicht/Nicht erreicht, Wieder-anrufen-Reminder)
                          // gleich mitöffnen — spart einen Klick.
                          if (next === 'Tel') {
                            setVorgehenTelOpen(true)
                            setVorgehenTelDatum(defaultDate)
                            setVorgehenEmailOpen(false)
                            setVorgehenReminderOpen(false)
                          }
                        } else {
                          setField('aufgebotErstellt', '')
                          setField('naechsteKons', '')
                          setField('keinTermin', false)
                          if (value === 'Tel') setVorgehenTelOpen(false)
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

              {/* Datums-Felder nebeneinander unter den Aufgebot-Icons */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* RC zu erstellen ab */}
                <div>
                  <label className={labelCls}>RC zu erstellen ab</label>
                  <div className="relative">
                    <input type="date" value={form.aufgebotFuer} {...dateDrop('aufgebotFuer')}
                      onChange={e => setField('aufgebotFuer', e.target.value)}
                      className={`${inputCls} pr-6${chCls('aufgebotFuer')}`} />
                    <ClearBtn show={!!form.aufgebotFuer} onClear={() => setField('aufgebotFuer', '')} />
                  </div>
                </div>
                {/* Aufgebot erstellt am (dynamisches Label je Aufgebot-Art) */}
                <div>
                  <label className={labelCls}>{
                    form.aufgebotArt === 'Brief'    ? 'Briefaufgebot erstellt am' :
                    form.aufgebotArt === 'Reminder' ? 'Reminder erstellt am' :
                    form.aufgebotArt === 'Tel'      ? 'Telefonaufgebot erstellt am' :
                    form.aufgebotArt === 'Praxis'   ? 'Vereinbarungsdatum' :
                    'Aufgebot erstellt am'
                  }</label>
                  <div className="relative">
                    <input type="date" value={form.aufgebotErstellt} {...dateDrop('aufgebotErstellt')}
                      onChange={e => setField('aufgebotErstellt', e.target.value)}
                      className={`${inputCls} pr-6${chCls('aufgebotErstellt')}`} />
                    <ClearBtn show={!!form.aufgebotErstellt} onClear={() => setField('aufgebotErstellt', '')} />
                  </div>
                  {/* Datum manuell eingetragen, aber Art noch unklar → nachfragen,
                      worum es sich handelt (Brief bereits anderweitig erstellt). */}
                  {form.aufgebotErstellt && !form.aufgebotArt && (
                    <div className="mt-1.5 p-2 rounded-lg border border-amber-300 bg-amber-50">
                      <p className="text-[11px] font-semibold text-amber-800 mb-1.5">Worum handelt es sich?</p>
                      <div className="flex gap-1.5 flex-wrap">
                        <button type="button"
                          onClick={() => setField('aufgebotArt', 'Brief')}
                          className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">
                          Briefaufgebot
                        </button>
                        <button type="button"
                          onClick={() => setField('aufgebotArt', 'Reminder')}
                          className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors">
                          Reminder
                        </button>
                        <button type="button"
                          onClick={() => {
                            // Terminverschiebung = Briefaufgebot + Verlaufs-Vermerk
                            setField('aufgebotArt', 'Brief')
                            setField('verlauf', [...form.verlauf, {
                              datum: new Date().toISOString().slice(0, 10),
                              aktion: 'Notiz',
                              ergebnis: 'Terminverschiebung',
                              von: displayLabel,
                            }])
                          }}
                          className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors">
                          Terminverschiebung
                        </button>
                      </div>
                    </div>
                  )}
                  {form.aufgebotArt === 'Praxis' && (
                    <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
                      <span>⚠️</span> Das Terminsdatum bitte unter <strong>«Nächste Konst.»</strong> eintragen.
                    </p>
                  )}
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
                    <input ref={naechsteKonsRef} type="date" value={form.naechsteKons} {...dateDrop('naechsteKons')}
                      className={`pr-6 ${form.storniert === 'Terminverschiebung' ? `${inputCls} ring-2 ring-amber-400` : inputCls}${chCls('naechsteKons')}`}
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
                          let effInterval = form.konsInterval
                          const lxW2 = lirisExtract?.intervalWeeks || lastLirisExtract.current?.intervalWeeks
                          if (!effInterval && lxW2) {
                            const w = lxW2
                            if      (w % 52 === 0 && w / 52 <= 120) effInterval = `${w / 52}j`
                            else if (w % 4  === 0 && w / 4  <= 120) effInterval = `${w / 4}m`
                            else if (w <= 120)                      effInterval = `${w}w`
                            if (effInterval) setField('konsInterval', effInterval)
                          }
                          if (effInterval) {
                            const computed = computeNextKons(newDate, effInterval)
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

              <div>
                <label className={labelCls}>Grund f. Stornierung / Terminverschiebung</label>
                {(() => {
                  const isCustom = form.grundStornierung !== '' && !STORNO_GRUENDE.includes(form.grundStornierung)
                  const selVal = isCustom ? 'Sonstiges' : form.grundStornierung
                  return (
                    <>
                      <select value={selVal}
                        onChange={e => {
                          const v = e.target.value
                          // Leer → alles zurücksetzen
                          if (v === '') {
                            setField('grundStornierung', '')
                            setField('storniert', '')
                            return
                          }
                          // Terminverschiebung = KEINE Stornierung, sondern neuer Termin.
                          // Offener RC wird obsolet, Fokus auf «Nächste Konst.» (oben).
                          if (v === 'Terminverschiebung') {
                            setField('grundStornierung', 'Terminverschiebung')
                            setField('storniert', '')
                            setField('aufgebotFuer', '')
                            setTimeout(() => naechsteKonsRef.current?.focus(), 50)
                            return
                          }
                          // Alle übrigen Gründe = Stornierung → storniert='ja',
                          // offener RC obsolet.
                          if (v === 'Sonstiges') setField('grundStornierung', ' ')
                          else setField('grundStornierung', v)
                          setField('storniert', 'ja')
                          setField('aufgebotFuer', '')
                          if (v === 'WV bei Bedarf' || v === 'Notfall - einmalige Konst.' || v === 'Zweitmeinung - einmalige Konst.') setField('patientenStatus', 'kein Aufgebot')
                          if (v === 'Wegzug' || v === 'Arztwechsel') setField('patientenStatus', 'inaktiv')
                          if (v === 'Verstorben') setField('patientenStatus', 'verstorben')
                          if (v === 'Verstorben' || v === 'Arztwechsel' || v === 'Wegzug') {
                            setField('verlauf', form.verlauf.map(ve =>
                              ve.ergebnis === 'noch zu erledigen' ? { ...ve, ergebnis: 'abgebrochen' } : ve
                            ))
                            if (lastLirisAutor.current) {
                              const cleaned = lastLirisAutor.current.replace(/^(?:Dr|Prof|med)\.?\s+/i, '').trim()
                              const words = cleaned.split(/\s+/)
                              let arztAktiv = false
                              for (let n = 1; n <= words.length; n++) {
                                const cand = words.slice(-n).join(' ').toLowerCase()
                                if (doctors.find(d => d.toLowerCase() === cand || d.toLowerCase().includes(cand))) { arztAktiv = true; break }
                              }
                              if (!arztAktiv) setAssignDoctor(lastLirisAutor.current)
                            }
                          }
                        }}
                        className={(formErrors.grundStornierung ? inputClsErr : inputCls) + chCls('grundStornierung')}>
                        <option value="">—</option>
                        {STORNO_GRUENDE.map(g => <option key={g} value={g}>{g}</option>)}
                        <option value="Sonstiges">Sonstiges…</option>
                      </select>
                      {selVal === 'Sonstiges' && (
                        <input type="text" value={form.grundStornierung.trimStart()}
                          onChange={e => setField('grundStornierung', e.target.value)}
                          className={`${inputCls} mt-2${chCls('grundStornierung')}`}
                          placeholder="Weiterer Grund…" autoFocus />
                      )}
                      {form.grundStornierung === 'Terminverschiebung' && (
                        <p className="mt-2 text-xs text-amber-600 font-medium leading-snug">
                          ↑ Bitte vereinbarten Termin unter <strong>«Nächste Konst.»</strong> oben eintragen.
                        </p>
                      )}
                    </>
                  )
                })()}
              </div>

              {/* ── Weiteres Vorgehen & Verlauf ──────────────────────────────────
                  Sichtbar wenn: Storno-Grund gesetzt, oder Storniert=nein gewählt
                  (auch ohne Grund — Patient soll dann angerufen/kontaktiert werden),
                  oder bereits Verlauf-Eintraege existieren, oder Telefonaufgebot
                  gewählt (Erreicht/Nicht erreicht/Grundvermerk/Wieder-anrufen-Reminder). */}
              {editTarget !== 'new' && ((form.grundStornierung !== '' && form.grundStornierung !== 'Terminverschiebung') || form.storniert === 'nein' || form.verlauf.length > 0 || form.aufgebotArt === 'Tel') && (
                <div className="pt-3 border-t border-amber-200 bg-amber-50 -mx-6 px-6 pb-4">
                  <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <ListChecks className="w-3.5 h-3.5" /> Weiteres Vorgehen
                  </p>

                  {/* Contact method toggles – wenn ein Storno-Grund gesetzt (ausser
                      Verstorben/Arztwechsel — bei denen ist Kontakt obsolet) ODER
                      Storniert=nein (Patient soll kontaktiert werden). */}
                  {((form.grundStornierung !== '' && form.grundStornierung !== 'Verstorben' && form.grundStornierung !== 'Arztwechsel' && form.grundStornierung !== 'Terminverschiebung') || form.storniert === 'nein' || form.aufgebotArt === 'Tel') && (
                    <>
                      {/* "Weshalb anrufen?" — gehört zum Schritt "Patient anrufen",
                          nicht ins Telefon-Detail-Panel. Wird beim Klick auf die
                          Quick-Action mit dem Verlaufseintrag verknuepft. Wird ausserdem
                          vom Telefon-Detail-Panel weitergenutzt (gleicher State). */}
                      <div className="mb-2">
                        <label className="text-xs font-semibold text-amber-700 block mb-1">Weshalb anrufen?</label>
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {['Termin vereinbaren','Termin verschieben','Rezept','Befundbesprechung','Nachfrage','Erinnerung'].map(g => (
                            <button key={g} type="button"
                              onClick={() => setVorgehenTelGrund(prev => prev ? `${prev}, ${g}` : g)}
                              className="px-2 py-0.5 text-[11px] font-medium border border-amber-200 bg-white text-amber-700 rounded-full hover:bg-amber-100 transition-colors"
                            >+ {g}</button>
                          ))}
                        </div>
                        <textarea
                          rows={2}
                          placeholder="z.B. Patient möchte Termin verschieben, fragt nach Rezept…"
                          value={vorgehenTelGrund}
                          onChange={e => setVorgehenTelGrund(e.target.value)}
                          className={`${inputCls} resize-none`}
                        />
                      </div>

                      <button type="button"
                        onClick={async () => {
                          if (!editTarget || (editTarget as unknown as string) === 'new') return
                          const entry: any = { datum: new Date().toISOString().slice(0, 10), aktion: 'Telefonanruf', ergebnis: 'noch zu erledigen', von: displayLabel }
                          // Grund aus dem Feld oberhalb mitnehmen, wenn vorhanden.
                          if (vorgehenTelGrund.trim()) entry.grund = vorgehenTelGrund.trim()
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
                          // Grund-Feld nach dem Speichern leeren — sonst klebt der
                          // Text fuer den naechsten Patienten.
                          setVorgehenTelGrund('')
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

                      {/* Telefon panel — Grund wird oben unter "Patient anrufen"
                          erfasst (gleicher State vorgehenTelGrund). Hier nur Datum
                          + Ergebnis-Buttons. */}
                      {vorgehenTelOpen && (
                        <div className="mb-3 bg-white rounded-xl border border-green-200 p-3 space-y-2">
                          <label className="text-xs font-semibold text-gray-600 block">Datum des Anrufs</label>
                          <input type="date" value={vorgehenTelDatum}
                            onChange={e => setVorgehenTelDatum(e.target.value)}
                            className={inputCls} />
                          {vorgehenTelDatum && <p className="text-xs text-gray-400 -mt-1">{formatDate(vorgehenTelDatum)}</p>}
                          {vorgehenTelGrund && (
                            <p className="text-[11px] text-gray-500 italic px-1 py-0.5 bg-amber-50 border border-amber-100 rounded">
                              Grund (oben erfasst): {vorgehenTelGrund}
                            </p>
                          )}
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
                                  const d = form.letzteKons ? new Date(form.letzteKons + 'T00:00:00') : new Date()
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
                              const d = form.letzteKons ? new Date(form.letzteKons + 'T00:00:00') : new Date()
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
                              setField('aufgebotArt', '')
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
                    if (v === 'kein Aufgebot') {
                      // Self-Service: keine Aufgebote/Recall-Planung → alles aufräumen,
                      // damit kein Widerspruch (offenes RC/Aufgebot) bestehen bleibt.
                      setField('aufgebotFuer', '')
                      setField('aufgebotArt', '')
                      setField('aufgebotErstellt', '')
                    }
                    if (v === 'verstorben') {
                      // Status Verstorben → Storno-Grund automatisch mitsetzen,
                      // damit Filter/Auswertung nach Grund konsistent sind.
                      setField('storniert', 'ja')
                      setField('grundStornierung', 'Verstorben')
                    }
                    if ((v === 'inaktiv' || v === 'verstorben') && lastLirisAutor.current) {
                      const cleaned = lastLirisAutor.current.replace(/^(?:Dr|Prof|med)\.?\s+/i, '').trim()
                      const words = cleaned.split(/\s+/)
                      let arztAktiv = false
                      for (let n = 1; n <= words.length; n++) {
                        const cand = words.slice(-n).join(' ').toLowerCase()
                        if (doctors.find(d => d.toLowerCase() === cand || d.toLowerCase().includes(cand))) { arztAktiv = true; break }
                      }
                      if (!arztAktiv) setAssignDoctor(lastLirisAutor.current)
                    }
                  }}
                  className={inputCls + chCls('patientenStatus')}>
                  <option value="">—</option>
                  <option value="aktiv">Aktiv</option>
                  <option value="inaktiv">Inaktiv</option>
                  <option value="verstorben">Verstorben</option>
                  <option value="Reminder">Reminder</option>
                  <option value="kein Aufgebot">kein Aufgebot - meldet sich b. Bedarf</option>
                </select>
                {/* Schnell-Button: Self-Service. Ein Klick setzt den Status und
                    räumt alle Aufgebot-/Recall-Felder auf (bzw. zurück zu aktiv). */}
                <button type="button"
                  onClick={() => {
                    if (form.patientenStatus === 'kein Aufgebot') {
                      setField('patientenStatus', 'aktiv')
                    } else {
                      setField('patientenStatus', 'kein Aufgebot')
                      setField('aufgebotFuer', '')
                      setField('aufgebotArt', '')
                      setField('aufgebotErstellt', '')
                      setField('naechsteKons', '')
                      setField('keinTermin', false)
                    }
                  }}
                  className={`mt-2 w-full py-2 rounded-lg text-xs font-bold border-2 transition-colors flex items-center justify-center gap-1.5 ${
                    form.patientenStatus === 'kein Aufgebot'
                      ? 'border-gray-400 bg-gray-200 text-gray-700'
                      : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  }`}>
                  <BellOff className="w-3.5 h-3.5" />
                  {form.patientenStatus === 'kein Aufgebot' ? '✓ Self-Service – meldet sich selbst' : 'Self-Service (kein Aufgebot)'}
                </button>
              </div>


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

      {/* Cleanup-Confirmation: Doppelte PIDs (neueste pro Gruppe) löschen */}
      {showDupCleanupConfirm && (() => {
        const groups = auswertungStats.duplicatePidGroups
        const victims = groups.map(g => ({ group: g, victim: pickTodaysDuplicate(g.entries) })).filter(v => v.victim) as Array<{ group: typeof groups[0]; victim: RecallPatient }>
        return (
          <div className="fixed inset-0 z-[65] bg-black/50 flex items-center justify-center p-4" onClick={() => !dupCleanupRunning && setShowDupCleanupConfirm(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[85vh]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <span className="font-bold text-gray-900">Doppelte PIDs bereinigen</span>
                </div>
                <button onClick={() => setShowDupCleanupConfirm(false)} disabled={dupCleanupRunning} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-5 py-4 overflow-auto flex-1">
                <p className="text-sm text-gray-700 mb-3">
                  Es werden nur Einträge gelöscht, die <strong>heute</strong> hochgeladen wurden — typischerweise frische Imports
                  die ein bestehendes PID-Duplikat erzeugt haben. Historische Duplikate bleiben unverändert.
                  Die folgenden <strong>{victims.length}</strong> Einträge werden entfernt:
                </p>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left px-3 py-2">PID</th>
                        <th className="text-left px-3 py-2">Vorname</th>
                        <th className="text-left px-3 py-2">Arzt</th>
                        <th className="text-left px-3 py-2">Erstellt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {victims.map(({ group, victim }) => {
                        const ps = parseStamp(victim.erstellt)
                        return (
                          <tr key={victim.id} className="hover:bg-red-50/30">
                            <td className="px-3 py-2 font-mono text-red-700">#{group.pid}</td>
                            <td className="px-3 py-2 font-medium">{victim.vorname || <span className="italic text-gray-400">ohne Name</span>}</td>
                            <td className="px-3 py-2 text-gray-600">{victim.doctor}</td>
                            <td className="px-3 py-2 text-gray-500 tabular-nums">{ps?.dateStr ?? '?'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {victims.length < groups.length && (
                  <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                    Hinweis: {groups.length - victims.length} Gruppe(n) haben keinen heute-hochgeladenen Eintrag.
                    Diese sind historische Duplikate und werden NICHT bereinigt — bitte manuell entscheiden welcher
                    Eintrag der richtige ist (über die Tabelle in der Doppelte-PIDs-Sektion).
                  </p>
                )}
              </div>
              <div className="px-5 py-3 border-t border-gray-100 shrink-0 flex justify-end gap-2">
                <button onClick={() => setShowDupCleanupConfirm(false)} disabled={dupCleanupRunning}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40">
                  Abbrechen
                </button>
                <button onClick={() => handleDeleteNewestDuplicates(auswertungStats.duplicatePidGroups)}
                  disabled={dupCleanupRunning || victims.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {dupCleanupRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {victims.length} Einträge löschen
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Unknown-Doctor-Popup entfernt — der inline-Hinweis am Arzt-Feld
          reicht (rote Border + 'Bitte Arzt waehlen' unter dem Dropdown). */}

      {/* «Sonstige»-Popup: Patienten ohne eindeutige Kategorie (Auswertung pro Arzt) */}
      {listePopup && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setListePopup(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-800">{listePopup.titel}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{listePopup.list.length} Patient(en) · {listePopup.subtitel}</p>
              </div>
              <button
                onClick={() => setListePopup(null)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2"
              >×</button>
            </div>
            <div className="overflow-auto p-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">PID</th>
                    <th className="px-3 py-2 font-medium">Grund</th>
                  </tr>
                </thead>
                <tbody>
                  {listePopup.list.map((s, i) => (
                    <tr
                      key={`${s.pid}-${i}`}
                      onClick={() => { if (!s.patient) return; setListePopup(null); setAuswertungOpen(false); switchTab(s.patient.doctor); openEdit(s.patient) }}
                      title={s.patient ? 'Patient bearbeiten' : 'Kein verknüpfter Patient'}
                      className={`border-b border-gray-50 ${s.patient ? 'hover:bg-blue-50 cursor-pointer' : 'cursor-default'}`}
                    >
                      <td className={`px-3 py-2 font-medium ${s.patient ? 'text-blue-700 hover:underline' : 'text-gray-700'}`}>{s.name}</td>
                      <td className="px-3 py-2 tabular-nums text-gray-500">{s.pid || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{s.grund}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 text-right">
              <button
                onClick={() => setListePopup(null)}
                className="px-4 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200"
              >Schliessen</button>
            </div>
          </div>
        </div>
      )}

      {/* Liris-Mismatch-Dialog: Patient existiert nicht (mehr) in Liris.
          Bietet "Patient loeschen" oder "Schliessen" an. */}
      {lirisMismatch && (
        <div className="fixed inset-0 z-[65] bg-black/50 flex items-center justify-center p-4"
             onClick={() => setLirisMismatch(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[85vh]"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <span className="font-bold text-gray-900">Patient nicht in Liris</span>
              </div>
              <button onClick={() => setLirisMismatch(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              <p className="text-gray-700">
                {lirisMismatch.reason}.
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5">
                <span className="text-gray-500">PID</span><span className="font-mono">#{lirisMismatch.pid}</span>
                <span className="text-gray-500">Vorname</span><span className="font-medium">{lirisMismatch.vorname}</span>
                <span className="text-gray-500">Arzt</span><span>{lirisMismatch.doctor}</span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">
                Möglich, dass dieser Patient nicht (mehr) in Liris existiert oder die PID falsch ist.
                <strong className="block mt-1">Empfehlung:</strong> Den Eintrag aus der Recall-Liste löschen, falls er nicht mehr benötigt wird.
              </p>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 shrink-0 flex justify-end gap-2">
              <button onClick={() => setLirisMismatch(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Schliessen
              </button>
              <button
                onClick={() => {
                  setDeleteTargetOverride({ id: lirisMismatch.patientId, label: `#${lirisMismatch.pid} ${lirisMismatch.vorname}`, doctor: lirisMismatch.doctor })
                  setDeletePassword('')
                  setDeleteErr('')
                  setShowDeleteConfirm(true)
                }}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors">
                <Trash2 className="w-4 h-4" />
                Patient aus Recall löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Liris-Kons älter als bestehende — Bestätigungsdialog */}
      {lirisOlderKons && (
        <div className="fixed inset-0 z-[65] bg-black/50 flex items-center justify-center p-4"
             onClick={() => setLirisOlderKons(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <span className="font-bold text-gray-900">Ältere Untersuchung</span>
              </div>
              <button onClick={() => setLirisOlderKons(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              <p className="text-gray-700">
                Die Untersuchung aus Liris (<strong>{formatDate(lirisOlderKons.lirisDate)}</strong>) liegt weiter zurück als die bereits eingetragene letzte Konst. (<strong>{formatDate(lirisOlderKons.formDate)}</strong>).
              </p>
              <p className="text-gray-600">Soll das ältere Datum trotzdem übernommen werden?</p>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 shrink-0 flex justify-end gap-2">
              <button onClick={() => setLirisOlderKons(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Nein, beibehalten
              </button>
              <button
                onClick={() => {
                  setField('letzteKons', lirisOlderKons.lirisDate)
                  toast.success(`Letzte Konst. auf ${formatDate(lirisOlderKons.lirisDate)} gesetzt.`)
                  setLirisOlderKons(null)
                }}
                className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition-colors">
                Ja, übernehmen
              </button>
            </div>
          </div>
        </div>
      )}

      {lirisNameChoice && (
        <div className="fixed inset-0 z-[65] bg-black/50 flex items-center justify-center p-4"
             onClick={() => setLirisNameChoice(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
              <span className="font-bold text-gray-900">Vorname wählen</span>
              <button onClick={() => setLirisNameChoice(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-gray-600 mb-3">Welcher Name soll als Vorname gespeichert werden?</p>
              {lirisNameChoice.options.map((opt, i) => (
                <button key={i} type="button"
                  onClick={() => { setField('vorname', opt); setLirisNameChoice(null) }}
                  className="w-full text-left px-4 py-2.5 text-sm rounded-lg border border-gray-200 hover:bg-primary-50 hover:border-primary-300 transition-colors font-medium">
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showUndoImportConfirm && lastImport && (
        <div className="fixed inset-0 z-[65] bg-black/50 flex items-center justify-center p-4"
             onClick={() => !undoImportRunning && setShowUndoImportConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[85vh]"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <span className="font-bold text-gray-900">Letzte Excel-Einlesung rückgängig machen</span>
              </div>
              <button onClick={() => setShowUndoImportConfirm(false)} disabled={undoImportRunning}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 overflow-auto flex-1 space-y-3 text-sm">
              <p className="text-gray-700">
                Alle Patienten der letzten Einlesung werden unwiderruflich gelöscht.
              </p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
                <span className="text-gray-500">Hochgeladen am</span>
                <span className="font-medium text-gray-900 tabular-nums">{lastImport.dateStr}</span>
                <span className="text-gray-500">Von</span>
                <span className="font-medium text-gray-900">{lastImport.user || <span className="italic text-gray-400">unbekannt</span>}</span>
                <span className="text-gray-500">Patienten</span>
                <span className="font-bold text-red-700 tabular-nums">{lastImport.count}</span>
                <span className="text-gray-500">Ärzte / Tabs</span>
                <span className="font-medium text-gray-900">{lastImport.doctors.join(', ') || '—'}</span>
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                Nur Einträge mit exakt diesem Import-Zeitstempel werden entfernt. Manuell danach erfasste
                Patienten bleiben unverändert.
              </p>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 shrink-0 flex justify-end gap-2">
              <button onClick={() => setShowUndoImportConfirm(false)} disabled={undoImportRunning}
                      className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40">
                Abbrechen
              </button>
              <button onClick={handleUndoLastImport} disabled={undoImportRunning}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {undoImportRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {lastImport.count} Einträge löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Passwort-Bestätigung für Patienten-Löschung ─────────────────────── */}
      {showDeleteConfirm && (deleteTargetOverride || (editTarget && editTarget !== 'new')) && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-500" />
                <span className="font-bold text-gray-900">Patient löschen</span>
              </div>
              <button onClick={() => { setShowDeleteConfirm(false); setDeleteTargetOverride(null) }} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-700">
                <strong>{deleteTargetOverride ? deleteTargetOverride.label : editTarget !== 'new' && editTarget ? (editTarget.vorname || '—') : ''}</strong> {!deleteTargetOverride && editTarget !== 'new' && editTarget?.pid ? `(#${editTarget.pid})` : ''} wirklich löschen?
              </p>
              <p className="text-xs text-gray-500">Diese Aktion kann nicht rückgängig gemacht werden. Bitte Passwort zur Bestätigung eingeben.</p>
              <input
                type="password"
                autoFocus
                placeholder="Passwort"
                value={deletePassword}
                onChange={e => { setDeletePassword(e.target.value); setDeleteErr('') }}
                onKeyDown={e => { if (e.key === 'Enter') confirmDelete() }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
              />
              {deleteErr && <p className="text-xs text-red-600 font-medium">{deleteErr}</p>}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => { setShowDeleteConfirm(false); setDeleteTargetOverride(null) }} disabled={deleting}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40">
                Abbrechen
              </button>
              <button onClick={confirmDelete} disabled={deleting || !deletePassword.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Endgültig löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
