import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Filter, CheckCircle2, Clock, ExternalLink, Building2,
  Users, CalendarDays, StickyNote, ChevronDown, ChevronUp, FileText, Mail, Plus, Trash2, Search, X,
  AlertTriangle, BarChart3, Download, Printer,
} from 'lucide-react'
import { RecallPatient, Zuweisung, subscribeZuweisungPatients, patientZuweisungen, saveZuweisungen, newZuweisung, updateRecallPatient } from '../lib/firestoreRecall'
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

  // Patienten, bei denen «Muss noch zugewiesen werden» im Patient-bearbeiten-
  // Formular markiert wurde — noch OHNE konkrete Zuweisung erfasst. Damit sie
  // beim Zuweisen nicht vergessen gehen.
  const noetigList = patients.filter(p => p.zuweisungNoetig === true)
  const [clearingId, setClearingId] = useState<string | null>(null)
  async function clearZuweisungNoetig(p: RecallPatient) {
    setClearingId(p.id)
    try { await updateRecallPatient(p.id, { zuweisungNoetig: null } as Partial<RecallPatient>, displayLabel) }
    finally { setClearingId(null) }
  }

  // ── Quartalsbericht ────────────────────────────────────────────────────
  const [showReport, setShowReport] = useState(false)
  const now = new Date()
  const [reportYear, setReportYear] = useState(now.getFullYear())
  const [reportQuarter, setReportQuarter] = useState<1 | 2 | 3 | 4>((Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4)

  const report = useMemo(() => {
    const qStartMonth = (reportQuarter - 1) * 3
    const start = `${reportYear}-${String(qStartMonth + 1).padStart(2, '0')}-01`
    const endDate = new Date(reportYear, qStartMonth + 3, 1)
    const end = endDate.toISOString().slice(0, 10) // exklusiv

    const rows = patients
      .flatMap(p => patientZuweisungen(p).map(z => ({ p, z })))
      .filter(({ z }) => z.typ === 'extern' && z.datum >= start && z.datum < end)

    const zurueckgekehrt = (p: RecallPatient, z: Zuweisung) => {
      const nk = p.naechsteKons && p.naechsteKons !== 'kein Termin' ? p.naechsteKons : ''
      return !!(p.letzteKons && p.letzteKons > z.datum) || !!(nk && nk > z.datum)
    }

    const byGrund = new Map<string, number>()
    const byZiel  = new Map<string, number>()
    let rueckkehrCount = 0
    let berichtCount = 0
    let ueberfaelligCount = 0
    const detailRows: { name: string; pid: string; doctor: string; ziel: string; grund: string; datum: string; status: string; zurueckgekehrt: boolean; berichtErhalten: boolean }[] = []
    for (const { p, z } of rows) {
      const g = z.grund.trim() || 'ohne Angabe'
      const zi = z.ziel.trim() || 'ohne Angabe'
      byGrund.set(g, (byGrund.get(g) ?? 0) + 1)
      byZiel.set(zi, (byZiel.get(zi) ?? 0) + 1)
      const zk = zurueckgekehrt(p, z)
      if (zk) rueckkehrCount++
      if (z.berichtErhalten) berichtCount++
      if (normStatus(z.status) === 'pendent' && (wochenSeit(z.datum) ?? 0) >= 8) ueberfaelligCount++
      detailRows.push({
        name: vollName(p) || '—', pid: p.pid || '', doctor: p.doctor || '',
        ziel: zi, grund: g, datum: z.datum, status: normStatus(z.status),
        zurueckgekehrt: zk, berichtErhalten: !!z.berichtErhalten,
      })
    }
    const total = rows.length
    return {
      start, end, total,
      rueckkehrQuote: total > 0 ? Math.round((rueckkehrCount / total) * 100) : 0,
      berichtQuote:   total > 0 ? Math.round((berichtCount   / total) * 100) : 0,
      ueberfaelligCount,
      byGrund: [...byGrund.entries()].sort((a, b) => b[1] - a[1]),
      byZiel:  [...byZiel.entries()].sort((a, b) => b[1] - a[1]),
      detailRows,
    }
  }, [patients, reportYear, reportQuarter])

  function exportReportCsv() {
    const header = ['Status', 'PID', 'Name', 'Zuweisender Arzt', 'Zielort', 'Grund', 'Zurückgekehrt', 'Bericht']
    const csvEscape = (v: string) => /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const lines = [
      header.join(';'),
      ...report.detailRows.map(r => [
        r.status === 'erledigt' ? 'Erledigt' : 'Pendent',
        r.pid, r.name, r.doctor, r.ziel, r.grund,
        r.zurueckgekehrt ? 'Ja' : 'Nein',
        r.berichtErhalten ? 'Ja' : 'Nein',
      ].map(v => csvEscape(String(v))).join(';')),
    ]
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Quartalsbericht_Zuweisungen_Q${reportQuarter}_${reportYear}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const reportPrintRef = { current: null as HTMLIFrameElement | null }
  function exportReportPdf() {
    const rowsHtml = report.detailRows.map(r => {
      const isErledigt = r.status === 'erledigt'
      return `
      <tr>
        <td><span class="badge ${isErledigt ? 'badge-green' : 'badge-amber'}">${isErledigt ? 'Erledigt' : 'Pendent'}</span></td>
        <td>${r.pid}</td><td>${r.name}</td><td>${r.doctor}</td><td>${r.ziel}</td><td>${r.grund}</td>
        <td><span class="badge ${r.zurueckgekehrt ? 'badge-green' : 'badge-red'}">${r.zurueckgekehrt ? 'Ja' : 'Nein'}</span></td>
        <td><span class="badge ${r.berichtErhalten ? 'badge-blue' : 'badge-gray'}">${r.berichtErhalten ? 'Ja' : 'Nein'}</span></td>
      </tr>`
    }).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quartalsbericht Q${reportQuarter}/${reportYear}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px;}
        h1{font-size:18px;margin-bottom:2px;color:#5b21b6;}
        .sub{color:#666;font-size:12px;margin-bottom:16px;}
        .kpis{display:flex;gap:12px;margin-bottom:20px;}
        .kpi{border-radius:8px;padding:8px 14px;color:#fff;}
        .kpi.k1{background:#7c3aed;} .kpi.k2{background:#059669;} .kpi.k3{background:#2563eb;} .kpi.k4{background:#ea580c;}
        .kpi .n{font-size:20px;font-weight:bold;}
        .kpi .l{font-size:10px;opacity:.9;}
        h2{font-size:13px;margin:18px 0 6px;color:#5b21b6;}
        table{width:100%;border-collapse:collapse;margin-bottom:14px;}
        th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;font-size:11px;}
        th{background:#5b21b6;color:#fff;}
        tr:nth-child(even) td{background:#f8f7ff;}
        .badge{display:inline-block;padding:1px 7px;border-radius:9999px;font-size:10px;font-weight:bold;}
        .badge-green{background:#d1fae5;color:#065f46;} .badge-amber{background:#fef3c7;color:#92400e;}
        .badge-red{background:#fee2e2;color:#991b1b;} .badge-blue{background:#dbeafe;color:#1e40af;}
        .badge-gray{background:#f3f4f6;color:#4b5563;}
      </style></head><body>
      <h1>Quartalsbericht — externe Zuweisungen</h1>
      <p class="sub">Q${reportQuarter} ${reportYear} &nbsp;(${formatDate(report.start)} – ${formatDate(report.end)})</p>
      <div class="kpis">
        <div class="kpi k1"><div class="n">${report.total}</div><div class="l">Externe Zuweisungen</div></div>
        <div class="kpi k2"><div class="n">${report.rueckkehrQuote}%</div><div class="l">Rückkehrquote</div></div>
        <div class="kpi k3"><div class="n">${report.berichtQuote}%</div><div class="l">Bericht erhalten</div></div>
        <div class="kpi k4"><div class="n">${report.ueberfaelligCount}</div><div class="l">Überfällig (&gt;8 Wo.)</div></div>
      </div>
      <h2>Nach Grund</h2>
      <table><tr><th>Grund</th><th>Anzahl</th></tr>${report.byGrund.map(([g, n]) => `<tr><td>${g}</td><td>${n}</td></tr>`).join('')}</table>
      <h2>Nach Zielort</h2>
      <table><tr><th>Zielort</th><th>Anzahl</th></tr>${report.byZiel.map(([z, n]) => `<tr><td>${z}</td><td>${n}</td></tr>`).join('')}</table>
      <h2>Details</h2>
      <table><tr><th>Status</th><th>PID</th><th>Name</th><th>Zuw. Arzt</th><th>Zielort</th><th>Grund</th><th>Zurückgekehrt</th><th>Bericht</th></tr>${rowsHtml}</table>
      </body></html>`
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)
    reportPrintRef.current = iframe
    iframe.onload = () => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      window.setTimeout(() => { document.body.removeChild(iframe) }, 1000)
    }
    iframe.srcdoc = html
  }

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
          <button onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors shrink-0"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Quartalsbericht
          </button>
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

      {/* Noch zuzuweisen — Merker aus "Patient bearbeiten", noch ohne konkrete Zuweisung */}
      {noetigList.length > 0 && (
        <div className="max-w-4xl mx-auto px-4 pt-4">
          <div className="rounded-xl border-2 border-orange-300 bg-orange-50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <p className="text-xs font-bold text-orange-800">
                {noetigList.length} {noetigList.length === 1 ? 'Patient muss' : 'Patienten müssen'} noch zugewiesen werden
              </p>
            </div>
            <div className="space-y-1.5">
              {noetigList.map(p => (
                <div key={p.id} className="flex items-center gap-2 flex-wrap bg-white rounded-lg border border-orange-200 px-3 py-2">
                  <span className="font-semibold text-gray-900 text-sm">{p.vorname || '—'}</span>
                  {p.pid && <span className="font-mono text-xs text-gray-400">#{p.pid}</span>}
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">{p.doctor}</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    {isElectron && p.pid && (
                      <button onClick={() => openInLiris(p)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors">
                        <ExternalLink className="w-3.5 h-3.5" />
                        Liris
                      </button>
                    )}
                    <button
                      onClick={() => { setAddFor(addFor === p.id ? null : p.id); setAddForm({ typ: 'extern', ziel: '', grund: '', datum: new Date().toISOString().slice(0, 10) }) }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors">
                      <Plus className="w-3.5 h-3.5" />
                      Zuweisen
                    </button>
                    <button
                      onClick={() => clearZuweisungNoetig(p)}
                      disabled={clearingId === p.id}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition-colors disabled:opacity-40"
                      title="Merker entfernen (ohne Zuweisung anzulegen)">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {addFor === p.id && (
                    <div className="w-full mt-2 p-3 rounded-lg border border-violet-200 bg-violet-50/40 space-y-2">
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
                        <button onClick={async () => { await addWeitereZuweisung(p, addForm.typ, addForm.ziel, addForm.grund, addForm.datum); await clearZuweisungNoetig(p); setAddFor(null) }}
                          disabled={!addForm.ziel.trim()}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">Zuweisen &amp; Merker entfernen</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
                      <span className="font-semibold text-gray-900 text-sm">
                        {p.vorname || '—'}
                      </span>
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

      {/* Quartalsbericht-Modal */}
      {showReport && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowReport(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-violet-600" />
                Quartalsbericht — externe Zuweisungen
              </h2>
              <button onClick={() => setShowReport(false)} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Quartal-Auswahl */}
              <div className="flex items-center gap-2">
                <select value={reportQuarter} onChange={e => setReportQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300">
                  {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
                </select>
                <select value={reportYear} onChange={e => setReportYear(Number(e.target.value))}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300">
                  {Array.from({ length: 4 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <span className="text-xs text-gray-400 ml-1">{formatDate(report.start)} – {formatDate(report.end)}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button onClick={exportReportCsv} disabled={report.total === 0}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors disabled:opacity-40"
                    title="Als CSV exportieren">
                    <Download className="w-3.5 h-3.5" />
                    CSV
                  </button>
                  <button onClick={exportReportPdf} disabled={report.total === 0}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-40"
                    title="Als PDF exportieren / drucken">
                    <Printer className="w-3.5 h-3.5" />
                    PDF
                  </button>
                </div>
              </div>

              {report.total === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Keine externen Zuweisungen in diesem Quartal.</p>
              ) : (
                <>
                  {/* Kernzahlen */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <p className="text-2xl font-bold text-gray-900">{report.total}</p>
                      <p className="text-xs text-gray-500">Externe Zuweisungen</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <p className="text-2xl font-bold text-gray-900">{report.rueckkehrQuote}%</p>
                      <p className="text-xs text-gray-500">Rückkehrquote</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <p className="text-2xl font-bold text-gray-900">{report.berichtQuote}%</p>
                      <p className="text-xs text-gray-500">Bericht erhalten</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <p className={`text-2xl font-bold ${report.ueberfaelligCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>{report.ueberfaelligCount}</p>
                      <p className="text-xs text-gray-500">Überfällig (&gt;8 Wo. pendent)</p>
                    </div>
                  </div>

                  {/* Nach Grund */}
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1.5">Nach Grund</p>
                    <div className="space-y-1">
                      {report.byGrund.map(([g, n]) => (
                        <div key={g} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700">{g}</span>
                          <span className="font-semibold text-gray-900">{n}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Nach Zielort */}
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1.5">Nach Zielort</p>
                    <div className="space-y-1">
                      {report.byZiel.map(([zi, n]) => (
                        <div key={zi} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700">{zi}</span>
                          <span className="font-semibold text-gray-900">{n}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Details */}
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1.5">Details</p>
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-violet-600 text-white">
                            <th className="px-2 py-1.5 text-left font-semibold">Status</th>
                            <th className="px-2 py-1.5 text-left font-semibold">PID</th>
                            <th className="px-2 py-1.5 text-left font-semibold">Name</th>
                            <th className="px-2 py-1.5 text-left font-semibold">Zuw. Arzt</th>
                            <th className="px-2 py-1.5 text-left font-semibold">Zielort</th>
                            <th className="px-2 py-1.5 text-left font-semibold">Grund</th>
                            <th className="px-2 py-1.5 text-left font-semibold">Zurückgekehrt</th>
                            <th className="px-2 py-1.5 text-left font-semibold">Bericht</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.detailRows.map((r, i) => (
                            <tr key={i} className={i % 2 === 1 ? 'bg-violet-50/50' : 'bg-white'}>
                              <td className="px-2 py-1.5 whitespace-nowrap">
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  r.status === 'erledigt' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {r.status === 'erledigt' ? 'Erledigt' : 'Pendent'}
                                </span>
                              </td>
                              <td className="px-2 py-1.5 font-mono text-gray-500 whitespace-nowrap">{r.pid || '—'}</td>
                              <td className="px-2 py-1.5 font-medium text-gray-900 whitespace-nowrap">{r.name}</td>
                              <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{r.doctor || '—'}</td>
                              <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{r.ziel}</td>
                              <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{r.grund}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap">
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  r.zurueckgekehrt ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                }`}>
                                  {r.zurueckgekehrt ? 'Ja' : 'Nein'}
                                </span>
                              </td>
                              <td className="px-2 py-1.5 whitespace-nowrap">
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  r.berichtErhalten ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                                }`}>
                                  {r.berichtErhalten ? 'Ja' : 'Nein'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
