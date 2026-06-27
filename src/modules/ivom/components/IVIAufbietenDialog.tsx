import { useState } from 'react'
import { X, Mail, Printer, Loader2, Check, Bell, CalendarDays } from 'lucide-react'
import { useBrowser } from '../../../contexts/BrowserContext'
import { usePostausgang } from '../../../contexts/PostausgangContext'
import { buildPraxisBriefHtml, anredeForm, formatTerminLong } from '../../../lib/praxisBrief'
import type { Patient } from '../../../types/ivom.types'

type Art = 'Brief' | 'Reminder'

interface ElectronBriefApi {
  renderBriefPdf?: (html: string) => Promise<{ ok: boolean; buffer?: ArrayBuffer; error?: string }>
}

/** Wandelt VOLLSTÄNDIG grossgeschriebene Wörter in normale Schreibweise. */
function titleCase(s: string): string {
  return (s || '').replace(/\p{L}+/gu, w => (w.length > 1 && w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w))
}

/** IVI-Aufbieten: Brief- oder Reminder-Schreiben für den nächsten IVOM-Termin
 *  erstellen und in den Postausgang legen (→ Liris-Ablage). */
export default function IVIAufbietenDialog({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const { lirisExtract } = useBrowser()
  const postausgang = usePostausgang()

  const pid = (patient.patientNumber || '').replace(/\D/g, '').replace(/^0+(\d)/, '$1')
  const lx = lirisExtract && (lirisExtract.pid || '').replace(/\D/g, '').replace(/^0+(\d)/, '$1') === pid ? lirisExtract : null

  const [art, setArt] = useState<Art>('Brief')
  const [anrede, setAnrede] = useState<'Frau' | 'Herr' | 'Familie' | ''>(
    (lx?.anrede as any) || (patient.gender === 'M' ? 'Herr' : patient.gender === 'W' ? 'Frau' : '')
  )
  const [adressBlock, setAdressBlock] = useState<string>(() => {
    const name = `${titleCase(patient.firstName || '')} ${titleCase(patient.lastName || '')}`.trim()
    return (name ? name + '\n' : '') + (lx?.postAdresse || '')
  })
  const [terminDatum, setTerminDatum] = useState<string>(patient.nextAppointmentDate || '')
  const [terminZeit, setTerminZeit] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const nachname = titleCase(patient.lastName || (adressBlock.split('\n')[0] || '').split(/\s+/).slice(-1)[0] || '')
  const adressLines = adressBlock.split('\n').map(l => l.trim()).filter(Boolean)
  const nameDisplay = adressLines[0] || `${titleCase(patient.firstName || '')} ${nachname}`.trim()

  const canSave = art === 'Reminder'
    ? !!adressBlock.trim() && !!anrede
    : !!adressBlock.trim() && !!anrede && !!terminDatum

  const buildBody = (): string => {
    const salut = `<p class="salut">Sehr ${anredeForm(anrede)} ${nachname}</p>`
    if (art === 'Brief') {
      const terminZeile = formatTerminLong(terminDatum, terminZeit)
      return `${salut}
        <p>Im Rahmen Ihrer laufenden intravitrealen Therapie steht Ihre n&#228;chste Kontrolle bzw. Behandlung an. Wir haben f&#252;r Sie folgenden Termin <strong>reserviert</strong>:</p>
        <div class="termin-box-wrap"><div class="termin-box"><div class="termin-box-label">Reservierter Termin</div><div class="termin-box-date">${terminZeile}</div></div></div>
        <p>Sollten Sie diesen Termin nicht wahrnehmen k&#246;nnen, bitten wir Sie um eine R&#252;ckmeldung bis sp&#228;testens 24 Stunden vorher per Tel. <strong>062 842 18 46</strong> oder <a href="mailto:info@augenzentrum-suhr.ch">info@augenzentrum-suhr.ch</a>.</p>
        <p>Wir danken Ihnen f&#252;r Ihr Vertrauen.</p>`
    }
    return `${salut}
      <p>Im Rahmen Ihrer intravitrealen Therapie w&#228;re Ihre n&#228;chste Kontrolle bzw. Behandlung f&#228;llig. F&#252;r den bestm&#246;glichen Behandlungserfolg ist eine regelm&#228;ssige Kontrolle wichtig.</p>
      <p>Bitte vereinbaren Sie einen Termin mit uns. Sie erreichen uns telefonisch unter <strong>062 842 18 46</strong>, per E-Mail an <a href="mailto:info@augenzentrum-suhr.ch">info@augenzentrum-suhr.ch</a> oder &#252;ber unser Web-Formular auf <a href="https://www.augenzentrum-suhr.ch">www.augenzentrum-suhr.ch</a>.</p>
      <p>Sollten Sie bereits einen Termin bei uns vereinbart haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.</p>
      <p>Wir danken Ihnen f&#252;r Ihr Vertrauen.</p>`
  }

  const generate = async () => {
    const ea = (window as unknown as { electronApp?: ElectronBriefApi }).electronApp
    if (!ea?.renderBriefPdf) { setMsg({ kind: 'err', text: 'Nur in der Desktop-App verfügbar.' }); return }
    setSaving(true)
    setMsg(null)
    try {
      const title = art === 'Brief' ? 'Terminreservation &#8211; intravitreale Therapie' : 'Erinnerung &#8211; intravitreale Therapie'
      const html = buildPraxisBriefHtml({
        anrede, nameDisplay,
        addressLine2: adressLines[1] || '',
        addressLine3: adressLines[2] || '',
        title, bodyHtml: buildBody(),
      })
      const res = await ea.renderBriefPdf(html)
      if (!res.ok || !res.buffer) { setMsg({ kind: 'err', text: `PDF-Fehler: ${res.error || 'unbekannt'}` }); return }
      const blob = new Blob([res.buffer], { type: 'application/pdf' })
      const today = new Date().toISOString().slice(0, 10)
      await postausgang.add({
        pid: pid || null,
        vorname: `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || nameDisplay,
        arzt: '',
        filename: `IVI_${art}_${nachname || pid}_${today}.pdf`,
        blob,
      })
      setMsg({ kind: 'ok', text: '✓ Im Postausgang abgelegt — von dort drucken / ins Liris hochladen.' })
      setTimeout(onClose, 1200)
    } catch (e) {
      setMsg({ kind: 'err', text: 'Fehler: ' + String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-bold text-gray-900">IVI – Patient aufbieten</h2>
            <p className="text-xs text-gray-500">{patient.firstName} {patient.lastName}{pid ? ` · #${pid}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>

        {/* Art */}
        <div className="flex gap-2 mb-3">
          {([['Brief', 'Briefaufgebot', CalendarDays], ['Reminder', 'Reminder', Bell]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" onClick={() => setArt(v)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                art === v ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {/* Anrede */}
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Anrede</p>
        <div className="flex gap-2 mb-3">
          {(['Frau', 'Herr', 'Familie'] as const).map(a => (
            <button key={a} onClick={() => setAnrede(a)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${anrede === a ? 'border-gray-400 bg-gray-100 text-gray-800' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{a}</button>
          ))}
        </div>

        {/* Termin (nur Brief) */}
        {art === 'Brief' && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Reservierter Termin</p>
            <div className="flex gap-2">
              <input type="date" value={terminDatum} onChange={e => setTerminDatum(e.target.value)} className="input text-sm flex-1" />
              <input type="time" value={terminZeit} onChange={e => setTerminZeit(e.target.value)} className="input text-sm w-32" />
            </div>
          </div>
        )}

        {/* Adresse */}
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Adresse {lx?.postAdresse ? <span className="text-green-600 font-normal normal-case">(aus Liris)</span> : <span className="text-amber-600 font-normal normal-case">(aus Liris übernehmen oder eintragen)</span>}</p>
        <textarea rows={4} value={adressBlock} onChange={e => setAdressBlock(e.target.value)}
          placeholder={'Vorname Nachname\nStrasse Nr.\nPLZ Ort'} className="input text-sm w-full resize-none mb-3" />

        {msg && (
          <div className={`text-xs px-3 py-2 rounded-lg mb-3 ${msg.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary text-sm">Abbrechen</button>
          <button onClick={generate} disabled={!canSave || saving} className="btn btn-primary text-sm disabled:opacity-40">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            Erstellen &amp; in Postausgang
          </button>
        </div>
        <p className="mt-2 text-[10px] text-gray-400 flex items-center gap-1"><Mail className="w-3 h-3" /> Im Postausgang kannst du den Brief einzeln drucken oder automatisch ins Liris hochladen.</p>
      </div>
    </div>
  )
}
