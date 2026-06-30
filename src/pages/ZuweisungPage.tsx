import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Filter, CheckCircle2, Clock, ExternalLink, Building2,
  Users, CalendarDays, StickyNote, ChevronDown, ChevronUp, FileText, Mail, Plus, Trash2, Search, X,
  Pencil, Save, Loader2,
} from 'lucide-react'
import { RecallPatient, Zuweisung, subscribeZuweisungPatients, patientZuweisungen, saveZuweisungen, newZuweisung, updateRecallPatient, assignRecallPatient } from '../lib/firestoreRecall'
import { useAuth } from '../lib/AuthContext'
import { useBrowser } from '../contexts/BrowserContext'

const isElectron = typeof window !== 'undefined' && !!(window as { electronApp?: unknown }).electronApp

function formatDate(s: string | null | undefined): string {
  if (!s || s === 'kein Termin') return '—'
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return s
  return `${m[3]}.${m[2]}.${m[1]}`
}

/** Vergangene volle Wochen seit dem Datum (oder null wenn ungültig). */
function wochenSeit(datum: string | null | undefined): number | null {
  if (!datum) return null
  const m = datum.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const diff = Date.now() - d.getTime()
  return diff < 0 ? 0 : Math.floor(diff / (7 * 24 * 3600 * 1000))
}

/** Vollständiger Name inkl. Nachname. `vorname` enthält bei Liris-Daten meist
 *  schon «Nachname Vorname»; das Legacy-Feld `name` wird kombiniert, falls der
 *  Nachname dort separat liegt. */
function vollName(p: RecallPatient): string {
  const v = (p.vorname || '').trim()
  const n = ((p as { name?: string | null }).name || '').trim()
  if (n && (!v || !v.toLowerCase().includes(n.toLowerCase()))) return `${n} ${v}`.trim()
  return v || n
}

/** Bekannte E-Mail-Empfänger je Zuweisungsziel (Bericht-Sekretariate).
 *  Erweiterbar: neue Zielstelle → Treffer-Funktion + Adresse ergänzen. */
function zielEmail(ziel: string | null | undefined): string {
  const z = (ziel || '').toLowerCase()
  if (!z) return ''
  // KSA Augenklinik (Kantonsspital Aarau)
  if ((z.includes('ksa') || z.includes('kantonsspital aarau') || z.includes('aarau')) && z.includes('augen')) {
    return 'berichtesekretariat-augenklinik@ksa.ch'
  }
  return ''
}

/** Öffnet eine vorbereitete E-Mail (Bericht-Nachfrage) im Standard-Mailprogramm.
 *  Empfänger wird – wenn bekannt – automatisch gesetzt (z. B. KSA Augenklinik),
 *  sonst leer gelassen. Patient: Nach-/Vorname + Geburtsdatum (keine interne PID). */
interface MailOpts { name?: string; geb?: string | null; anrede?: string | null; mpaName?: string }

function sendBerichtNachfrage(p: RecallPatient, z: Zuweisung, opts: MailOpts = {}) {
  const name = (opts.name && opts.name.trim()) || vollName(p) || 'unbekannt'
  const gebSrc = (opts.geb && opts.geb.trim()) || p.gebDatum
  const geb = gebSrc ? formatDate(gebSrc) : ''
  const ident = `${name}${geb ? `, geb. ${geb}` : ''}`
  const empfaenger = zielEmail(z.ziel)

  // Geschlecht aus der Liris-Anrede ableiten (Frau/Herr); sonst neutral.
  const a = (opts.anrede || '').toLowerCase()
  const zuweisungsSatz = a.startsWith('frau')
    ? 'Folgende Patientin wurde Ihnen zugewiesen'
    : a.startsWith('herr')
      ? 'Folgender Patient wurde Ihnen zugewiesen'
      : 'Folgende Patientin / folgender Patient wurde Ihnen zugewiesen'

  const subject = `Bericht-Nachfrage – ${ident}`
  const body = [
    'Sehr geehrte Damen und Herren',
    '',
    `${zuweisungsSatz}${z.grund ? ` (Grund: ${z.grund})` : ''}:`,
    '',
    `    ${ident}`,
    '',
    'Bisher ist bei uns noch kein Abschlussbericht eingegangen. Wir bitten Sie freundlich um Zustellung des Berichts.',
    '',
  ].join('\n')
  const url = `mailto:${empfaenger}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  try { window.open(url) } catch { window.location.href = url }
}

type FilterStatus = 'alle' | 'pendent' | 'erledigt'
type FilterTyp    = 'alle' | 'intern' | 'extern'

export default function ZuweisungPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { open: openBrowser, openWithPid, lirisExtract } = useBrowser()
  const displayLabel = profile?.displayName || profile?.username || 'System'
  const [search, setSearch] = useState('')

  // ── Patienten-Bearbeiten-Modal (bleibt auf ZW-Management) ───────────────────
  const DOCTORS_DEFAULT = ['Artemiev', 'Menke', 'Malinina', 'Tschopp', 'Trachsler', 'Kirr', 'Papazoglou']
  const STORNO_GRUENDE  = ['Terminverschiebung', 'WV bei Bedarf', 'Wegzug', 'Verstorben', 'Arztwechsel', 'no Show', 'Brief ungeöffnet retourniert', 'Krankheit', 'Zweitmeinung - einmalige Konst.', 'Notfall - einmalige Konst.']
  const INTERVALL_OPTS  = ['3 Monate', '4 Monate', '6 Monate', '9 Monate', '1 Jahr', '1.5 Jahre', '2 Jahre', '3 Jahre', '4 Jahre', '5 Jahre']
  const PATIENTENSTATUS = ['', 'inaktiv', 'verstorben', 'Reminder', 'kein Aufgebot']

  type EditDraft = {
    vorname: string; pid: string; gebDatum: string
    letzteKons: string; naechsteKons: string; keinTermin: boolean
    konsInterval: string; doctor: string
    patientenStatus: string; grundStornierung: string
  }
  const [editPatient, setEditPatient] = useState<RecallPatient | null>(null)
  const [editDraft,   setEditDraft]   = useState<EditDraft | null>(null)
  const [editSaving,  setEditSaving]  = useState(false)

  const openRecallEdit = (p: RecallPatient) => {
    if (p.pid) openInLiris(p)
    setEditPatient(p)
    setEditDraft({
      vorname:          p.vorname          ?? '',
      pid:              p.pid              ?? '',
      gebDatum:         (p.gebDatum        ?? '').slice(0, 10),
      letzteKons:       (p.letzteKons      ?? '').slice(0, 10),
      naechsteKons:     p.naechsteKons && p.naechsteKons !== 'kein Termin' ? p.naechsteKons.slice(0, 10) : '',
      keinTermin:       p.naechsteKons === 'kein Termin',
      konsInterval:     '',
      doctor:           p.doctor           ?? '',
      patientenStatus:  p.patientenStatus  ?? '',
      grundStornierung: p.grundStornierung ?? '',
    })
  }

  const setED = <K extends keyof EditDraft>(k: K, v: EditDraft[K]) =>
    setEditDraft(d => d ? { ...d, [k]: v } : d)

  const saveEdit = async () => {
    if (!editPatient || !editDraft) return
    setEditSaving(true)
    try {
      const naechsteKons = editDraft.keinTermin ? 'kein Termin' : (editDraft.naechsteKons || null)
      await updateRecallPatient(editPatient.id, {
        vorname:          editDraft.vorname.trim()          || null,
        pid:              editDraft.pid.trim()              || null,
        gebDatum:         editDraft.gebDatum                || null,
        letzteKons:       editDraft.letzteKons              || null,
        naechsteKons,
        patientenStatus:  editDraft.patientenStatus         || null,
        grundStornierung: editDraft.grundStornierung        || null,
        storniert:        editDraft.grundStornierung ? 'ja' : (editPatient.storniert ?? null),
      }, displayLabel)
      if (editDraft.doctor && editDraft.doctor !== editPatient.doctor) {
        await assignRecallPatient(editPatient.id, editDraft.doctor, displayLabel)
      }
      setEditPatient(null); setEditDraft(null)
    } catch (e) {
      console.warn('[ZW] Patient-Update fehlgeschlagen', e)
      alert('Speichern fehlgeschlagen.')
    } finally { setEditSaving(false) }
  }

  // Bericht-Mail, die auf den Namen aus der Liris-Akte wartet (für eine Zuweisung)
  const [pendingMail, setPendingMail] = useState<{ p: RecallPatient; z: Zuweisung & { id: string } } | null>(null)
  const pendingMailTimer = useState<{ id: number | null }>(() => ({ id: null }))[0]

  const onlyDigits = (s: string | null | undefined) => (s || '').replace(/\D/g, '').replace(/^0+/, '')

  const openInLiris = (p: RecallPatient) => {
    if (!p.pid) return
    openBrowser()
    openWithPid(p.pid)
  }

  // Eine einzelne Zuweisung eines Patienten patchen (rebuilt die Liste, migriert Legacy).
  async function patchZuweisung(p: RecallPatient, zid: string, patch: Partial<Zuweisung>) {
    const list = patientZuweisungen(p).map(x => x.id === zid ? { ...x, ...patch } : x)
    try { await saveZuweisungen(p.id, list, displayLabel) } catch (e) { console.warn('[Zuweisung] patch fehlgeschlagen', e) }
  }

  // Klick «Bericht anfragen»: Zuweisung als angefragt markieren; in der Desktop-
  // App zuerst die Liris-Akte öffnen und den Namen daraus lesen.
  const onBerichtAnfragen = (p: RecallPatient, z: Zuweisung & { id: string }) => {
    patchZuweisung(p, z.id, { berichtAngefragt: true, berichtAngefragtAm: new Date().toISOString().slice(0, 10) })
    if (isElectron && p.pid) {
      openBrowser()
      openWithPid(p.pid)
      setPendingMail({ p, z })
      if (pendingMailTimer.id) window.clearTimeout(pendingMailTimer.id)
      pendingMailTimer.id = window.setTimeout(() => {
        setPendingMail(cur => { if (cur && cur.p.id === p.id && cur.z.id === z.id) { sendBerichtNachfrage(cur.p, cur.z, { mpaName: displayLabel }); return null } return cur })
      }, 12000)
    } else {
      sendBerichtNachfrage(p, z, { mpaName: displayLabel })
    }
  }

  useEffect(() => {
    if (!pendingMail || !lirisExtract) return
    if (onlyDigits(lirisExtract.pid) !== onlyDigits(pendingMail.p.pid)) return
    const name = [lirisExtract.nachname, lirisExtract.vorname].filter(Boolean).join(' ').trim()
    if (!name) return
    if (pendingMailTimer.id) { window.clearTimeout(pendingMailTimer.id); pendingMailTimer.id = null }
    sendBerichtNachfrage(pendingMail.p, pendingMail.z, { name, geb: lirisExtract.gebDatum, anrede: lirisExtract.anrede, mpaName: displayLabel })
    setPendingMail(null)
  }, [lirisExtract, pendingMail]) // eslint-disable-line react-hooks/exhaustive-deps

  const [patients, setPatients] = useState<RecallPatient[]>([])
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pendent')
  const [filterTyp, setFilterTyp] = useState<FilterTyp>('alle')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  // Inline-Formular «weitere Zuweisung» (pro Patient)
  const [addFor, setAddFor] = useState<string | null>(null)   // patient.id
  const [addForm, setAddForm] = useState<{ typ: 'intern' | 'extern'; ziel: string; grund: string; datum: string }>({ typ: 'extern', ziel: '', grund: '', datum: new Date().toISOString().slice(0, 10) })

  useEffect(() => subscribeZuweisungPatients(setPatients), [])

  // normalise legacy 'ausstehend' / null / undefined → 'pendent'
  function normStatus(s: string | null | undefined): string { return (!s || s === 'ausstehend') ? 'pendent' : s }

  // Eine Zeile PRO Zuweisung (Patient kann mehrfach erscheinen).
  type Row = { p: RecallPatient; z: Zuweisung & { id: string }; key: string }
  const rows: Row[] = patients
    .flatMap(p => patientZuweisungen(p).map(z => ({ p, z, key: `${p.id}:${z.id}` })))
    .filter(({ p, z }) => {
      if (filterStatus !== 'alle' && normStatus(z.status) !== filterStatus) return false
      if (filterTyp !== 'alle' && z.typ !== filterTyp) return false
      const q = search.trim().toLowerCase()
      if (q) {
        const hay = `${p.vorname ?? ''} ${(p as { name?: string }).name ?? ''} ${p.pid ?? ''} ${z.ziel ?? ''} ${z.grund ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    .sort((a, b) => {
      const sa = normStatus(a.z.status), sb = normStatus(b.z.status)
      if (sa !== sb) return sa === 'pendent' ? -1 : 1
      return (b.z.datum ?? '').localeCompare(a.z.datum ?? '')
    })

  async function markErledigt(p: RecallPatient, z: Zuweisung & { id: string }) {
    if (savingId) return
    setSavingId(`${p.id}:${z.id}`)
    try { await patchZuweisung(p, z.id, { status: 'erledigt', erledigtAm: new Date().toISOString().slice(0, 10) }) }
    finally { setSavingId(null) }
  }

  async function reopen(p: RecallPatient, z: Zuweisung & { id: string }) {
    if (savingId) return
    setSavingId(`${p.id}:${z.id}`)
    try { await patchZuweisung(p, z.id, { status: 'pendent', erledigtAm: '' }) }
    finally { setSavingId(null) }
  }

  // «Weitere Zuweisung» zu einem Patienten hinzufügen.
  async function addWeitereZuweisung(p: RecallPatient, typ: 'intern' | 'extern', ziel: string, grund: string, datum?: string) {
    if (!ziel.trim()) return
    const zw = { ...newZuweisung(typ, ziel.trim(), grund.trim(), displayLabel), ...(datum ? { datum } : {}) }
    const list = [...patientZuweisungen(p), zw]
    try { await saveZuweisungen(p.id, list, displayLabel) } catch (e) { console.warn('[Zuweisung] hinzufügen fehlgeschlagen', e) }
  }

  // Eine Zuweisung löschen (aus der Liste entfernen).
  async function deleteZuweisung(p: RecallPatient, z: Zuweisung & { id: string }) {
    if (!window.confirm(`Zuweisung an «${z.ziel || '—'}» wirklich löschen?`)) return
    setSavingId(`${p.id}:${z.id}`)
    try {
      const list = patientZuweisungen(p).filter(x => x.id !== z.id)
      await saveZuweisungen(p.id, list, displayLabel)
    } finally { setSavingId(null) }
  }

  const allZ = patients.flatMap(p => patientZuweisungen(p))
  const ausstehendCount = allZ.filter(z => normStatus(z.status) === 'pendent').length
  const erledigtCount   = allZ.filter(z => z.status === 'erledigt').length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-900 leading-tight">ZW-Management</h1>
            <p className="text-xs text-gray-400 leading-tight">
              {ausstehendCount} pendent · {erledigtCount} erledigt
            </p>
          </div>
          <div className="relative flex-1 min-w-0 max-w-xs ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Patient, PID, Ziel, Grund…"
              className="w-full pl-8 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            {search && (
              <button onClick={() => setSearch('')} title="Suche leeren"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="max-w-4xl mx-auto px-4 pb-3 flex flex-wrap gap-2">
          <div className="flex gap-1 items-center">
            <Filter className="w-3.5 h-3.5 text-gray-400" />
            {(['pendent', 'erledigt', 'alle'] as FilterStatus[]).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  filterStatus === s
                    ? s === 'pendent'  ? 'bg-amber-100 text-amber-700 border border-amber-300'
                    : s === 'erledigt' ? 'bg-green-100 text-green-700 border border-green-300'
                    :                    'bg-gray-200 text-gray-700 border border-gray-300'
                    : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
                }`}
              >
                {s === 'alle' ? 'Alle' : s === 'pendent' ? 'Pendent' : 'Erledigt'}
              </button>
            ))}
          </div>
          <div className="flex gap-1 items-center ml-2">
            {(['alle', 'intern', 'extern'] as FilterTyp[]).map(t => (
              <button key={t} onClick={() => setFilterTyp(t)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  filterTyp === t
                    ? 'bg-violet-100 text-violet-700 border border-violet-300'
                    : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
                }`}
              >
                {t === 'alle' ? 'Alle Typen' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-2">
        {rows.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Keine Zuweisungen gefunden</p>
            <p className="text-xs mt-1">
              {filterStatus === 'pendent' ? 'Alle Zuweisungen sind erledigt.' : 'Noch keine Einträge.'}
            </p>
          </div>
        )}

        {rows.map(({ p, z, key }) => {
          const isExpanded = expandedId === key
          const isErledigt = normStatus(z.status) === 'erledigt'
          const isSaving   = savingId === key

          return (
            <div key={key}
              className={`bg-white rounded-xl border transition-all ${
                isErledigt ? 'border-green-200 opacity-75' : 'border-gray-200 shadow-sm'
              }`}
            >
              {/* Main row */}
              <div className="p-4">
                <div className="flex items-start gap-3">
                  {/* Status icon */}
                  <div className={`mt-0.5 shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    isErledigt ? 'bg-green-100' : 'bg-amber-100'
                  }`}>
                    {isErledigt
                      ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                      : <Clock className="w-4 h-4 text-amber-600" />
                    }
                  </div>

                  {/* Patient info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => openRecallEdit(p)}
                        title="Patient bearbeiten (im Recall öffnen)"
                        className="font-semibold text-primary-700 text-sm hover:underline">
                        {p.vorname || '—'}
                      </button>
                      {p.pid && (
                        <span className="font-mono text-xs text-gray-400">#{p.pid}</span>
                      )}
                      {p.gebDatum && (
                        <span className="text-xs text-gray-400">*{formatDate(p.gebDatum)}</span>
                      )}
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                        {p.doctor}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full border font-semibold ${
                        z.typ === 'intern'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-violet-50 text-violet-700 border-violet-200'
                      }`}>
                        {z.typ === 'intern' ? <><Users className="w-3 h-3 inline mr-1" />Intern</> : <><ExternalLink className="w-3 h-3 inline mr-1" />Extern</>}
                      </span>
                    </div>

                    {/* Ziel */}
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="text-sm font-medium text-gray-800">→ {z.ziel || '—'}</span>
                    </div>

                    {/* Grund */}
                    {z.grund && (
                      <p className="mt-1 text-xs text-gray-500 italic">{z.grund}</p>
                    )}

                    {/* Datum + erledigt */}
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" />
                        Zugewiesen: {formatDate(z.datum)}
                      </span>
                      {!isErledigt && (() => {
                        const w = wochenSeit(z.datum)
                        if (w === null) return null
                        const cls = w >= 8 ? 'bg-red-50 text-red-700 border-red-200'
                          : w >= 4 ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-gray-50 text-gray-500 border-gray-200'
                        return (
                          <span className={`flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded-full border ${cls}`}
                            title={w >= 8 ? 'Bericht überfällig (> 8 Wochen)' : 'Wochen seit der Zuweisung'}>
                            <Clock className="w-3 h-3" />
                            {w === 0 ? 'diese Woche' : `seit ${w} Woche${w === 1 ? '' : 'n'}`}
                          </span>
                        )
                      })()}
                      {isErledigt && z.erledigtAm && (
                        <span className="text-green-600 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Erledigt: {formatDate(z.erledigtAm)}
                        </span>
                      )}
                      {isErledigt && (
                        <span className={`flex items-center gap-1 font-medium ${z.berichtErhalten ? 'text-blue-600' : 'text-gray-400'}`}>
                          <FileText className="w-3 h-3" />
                          {z.berichtErhalten ? 'Bericht erhalten' : 'Kein Bericht'}
                        </span>
                      )}
                      {z.berichtAngefragt && !z.berichtErhalten && (
                        <span className="flex items-center gap-1 font-medium text-blue-600"
                          title="Bericht-Nachfrage wurde verschickt">
                          <Mail className="w-3 h-3" />
                          Bericht angefragt{z.berichtAngefragtAm ? `: ${formatDate(z.berichtAngefragtAm)}` : ''}
                        </span>
                      )}
                      {z.von && (
                        <span>von {z.von}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-1.5">
                    {isElectron && p.pid && (
                      <button
                        onClick={() => openInLiris(p)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors"
                        title="Patient in Liris öffnen"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Liris
                      </button>
                    )}
                    {!z.berichtErhalten && (() => {
                      const wartet = pendingMail?.p.id === p.id && pendingMail?.z.id === z.id
                      const angefragt = !!z.berichtAngefragt
                      return (
                        <button
                          onClick={() => onBerichtAnfragen(p, z)}
                          disabled={wartet}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-60 ${angefragt ? 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}
                          title={zielEmail(z.ziel) ? `Bericht per E-Mail nachfragen an ${zielEmail(z.ziel)}` : 'Bericht per E-Mail nachfragen (Empfänger ergänzen)'}
                        >
                          <Mail className="w-3.5 h-3.5" />
                          {wartet ? 'Lese Namen…' : angefragt ? 'Erneut anfragen' : 'Bericht anfragen'}
                        </button>
                      )
                    })()}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : key)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      title="Details"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {!isErledigt ? (
                      <button
                        onClick={() => markErledigt(p, z)}
                        disabled={isSaving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors disabled:opacity-40"
                        title="Als erledigt markieren"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Erledigt
                      </button>
                    ) : (
                      <button
                        onClick={() => reopen(p, z)}
                        disabled={isSaving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-40"
                        title="Wieder öffnen"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        Öffnen
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded: notiz + link to recall */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-2 bg-gray-50 rounded-b-xl">
                  {z.notiz ? (
                    <div className="flex items-start gap-2 text-sm text-gray-600">
                      <StickyNote className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
                      <p>{z.notiz}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Keine Notiz hinterlegt.</p>
                  )}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => openRecallEdit(p)}
                      className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-800 hover:underline transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Patient bearbeiten
                    </button>
                    <button
                      onClick={() => { setAddFor(addFor === p.id ? null : p.id); setAddForm({ typ: 'extern', ziel: '', grund: '', datum: new Date().toISOString().slice(0, 10) }) }}
                      className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-800 hover:underline transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Weitere Zuweisung
                    </button>
                    <button
                      onClick={() => deleteZuweisung(p, z)}
                      disabled={isSaving}
                      className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 hover:underline transition-colors ml-auto disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Diese Zuweisung löschen
                    </button>
                  </div>
                  {addFor === p.id && (
                    <div className="mt-2 p-3 rounded-lg border border-violet-200 bg-violet-50/40 space-y-2">
                      <div className="flex gap-2">
                        {(['extern', 'intern'] as const).map(t => (
                          <button key={t} onClick={() => setAddForm(f => ({ ...f, typ: t }))}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${addForm.typ === t ? 'bg-violet-100 text-violet-700 border-violet-300' : 'bg-white text-gray-500 border-gray-200'}`}>
                            {t === 'extern' ? 'Extern' : 'Intern'}
                          </button>
                        ))}
                      </div>
                      <input type="text" value={addForm.ziel} onChange={e => setAddForm(f => ({ ...f, ziel: e.target.value }))}
                        placeholder="Klinik / Praxis / Arzt (z. B. Augenklinik KSA)" autoFocus
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" />
                      <input type="text" value={addForm.grund} onChange={e => setAddForm(f => ({ ...f, grund: e.target.value }))}
                        placeholder="Grund (z. B. YAG, OP, Abklärung)"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" />
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 shrink-0">ZW-Datum</label>
                        <input type="date" value={addForm.datum} onChange={e => setAddForm(f => ({ ...f, datum: e.target.value }))}
                          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setAddFor(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100">Abbrechen</button>
                        <button onClick={() => { addWeitereZuweisung(p, addForm.typ, addForm.ziel, addForm.grund, addForm.datum); setAddFor(null) }}
                          disabled={!addForm.ziel.trim()}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">Hinzufügen</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Patienten-Bearbeiten-Modal ─────────────────────────────────────── */}
      {editPatient && editDraft && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
          onClick={() => { if (!editSaving) { setEditPatient(null); setEditDraft(null) } }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <h3 className="flex items-center gap-2 font-semibold text-gray-900">
                <Pencil className="w-4 h-4 text-primary-600" />
                Patient bearbeiten
              </h3>
              <button onClick={() => { setEditPatient(null); setEditDraft(null) }} disabled={editSaving}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-40">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Name + PID */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name / Vorname</label>
                <input type="text" value={editDraft.vorname} onChange={e => setED('vorname', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">PID</label>
                  <input type="text" value={editDraft.pid} onChange={e => setED('pid', e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Geburtsdatum</label>
                  <input type="date" value={editDraft.gebDatum} onChange={e => setED('gebDatum', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300" />
                </div>
              </div>

              {/* Letzte / Nächste Konst. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Letzte Konst.</label>
                  <input type="date" value={editDraft.letzteKons} onChange={e => setED('letzteKons', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nächste Konst.</label>
                  {editDraft.keinTermin ? (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-gray-500 italic">kein Termin</span>
                      <button onClick={() => setED('keinTermin', false)}
                        className="text-xs text-primary-600 hover:underline">ändern</button>
                    </div>
                  ) : (
                    <input type="date" value={editDraft.naechsteKons} onChange={e => setED('naechsteKons', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300" />
                  )}
                  {!editDraft.keinTermin && (
                    <button onClick={() => { setED('keinTermin', true); setED('naechsteKons', '') }}
                      className="mt-1 text-xs text-gray-400 hover:text-gray-600 hover:underline">kein Termin setzen</button>
                  )}
                </div>
              </div>

              {/* Intervall */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Konsultationsintervall</label>
                <div className="flex flex-wrap gap-1.5">
                  {INTERVALL_OPTS.map(opt => (
                    <button key={opt} onClick={() => setED('konsInterval', editDraft.konsInterval === opt ? '' : opt)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${editDraft.konsInterval === opt ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'}`}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Arzt */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Arzt</label>
                <select value={editDraft.doctor} onChange={e => setED('doctor', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300 bg-white">
                  {editDraft.doctor && !DOCTORS_DEFAULT.includes(editDraft.doctor) && (
                    <option value={editDraft.doctor}>{editDraft.doctor}</option>
                  )}
                  {DOCTORS_DEFAULT.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Patientenstatus */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Patientenstatus</label>
                <select value={editDraft.patientenStatus} onChange={e => setED('patientenStatus', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300 bg-white">
                  <option value="">aktiv</option>
                  {PATIENTENSTATUS.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Grund Stornierung */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Grund f. Stornierung / Terminverschiebung</label>
                <div className="flex flex-wrap gap-1.5">
                  {STORNO_GRUENDE.map(g => (
                    <button key={g} onClick={() => setED('grundStornierung', editDraft.grundStornierung === g ? '' : g)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${editDraft.grundStornierung === g ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-600 border-gray-300 hover:border-rose-400'}`}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {editPatient.pid && (
                <p className="flex items-center gap-1.5 text-xs text-gray-400">
                  <ExternalLink className="w-3 h-3" />
                  Liris-Akte wurde geöffnet.
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-100 bg-gray-50">
              <button onClick={() => { setEditPatient(null); setEditDraft(null) }} disabled={editSaving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40">
                Abbrechen
              </button>
              <button onClick={saveEdit} disabled={editSaving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
