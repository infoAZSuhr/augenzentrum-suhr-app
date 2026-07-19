import { X, Printer } from 'lucide-react'
import { useDraggable } from '../../../hooks/useDraggable'
import type { Patient, Treatment } from '../../../types/ivom.types'

interface Props {
  patient: Patient
  treatments: Treatment[]
  onClose: () => void
}

function fmt(date?: string) {
  if (!date) return ''
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
}

function detectMeds(treatments: Treatment[]) {
  const names = treatments.map(t => (t.medicationName ?? '').toLowerCase())
  return {
    eylea2:   names.some(n => n.includes('eylea') && (n.includes('2mg') || n.includes('2 mg'))),
    eylea8:   names.some(n => n.includes('eylea') && (n.includes('8mg') || n.includes('8 mg'))),
    lucentis: names.some(n => n.includes('lucentis')),
    syfore:   names.some(n => n.includes('syfore')),
    avastin:  names.some(n => n.includes('avastin')),
  }
}

interface AutoEvent {
  date: string
  eye: 'OD' | 'OS'
  text: string
}

function buildAutoEvents(odRows: Treatment[], osRows: Treatment[]): AutoEvent[] {
  const events: AutoEvent[] = []

  for (const [rows, eye] of [[odRows, 'OD'], [osRows, 'OS']] as [Treatment[], 'OD' | 'OS'][]) {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]
      const curr = rows[i]

      // Medication change
      if (prev.medicationName && curr.medicationName && prev.medicationName !== curr.medicationName) {
        events.push({
          date: curr.treatmentDate,
          eye,
          text: `Medikamentenwechsel: ${prev.medicationName} → ${curr.medicationName}`,
        })
      }

      // Status change
      if (prev.behandlungsStatus !== curr.behandlungsStatus) {
        const labels: Record<string, string> = {
          aktiv: 'Aktiv', pausiert: 'Pausiert', abgeschlossen: 'Abgeschlossen',
        }
        events.push({
          date: curr.treatmentDate,
          eye,
          text: `Statuswechsel: ${labels[prev.behandlungsStatus] ?? prev.behandlungsStatus} → ${labels[curr.behandlungsStatus] ?? curr.behandlungsStatus}`,
        })
      }
    }

    // Notes
    for (const t of rows) {
      if (t.notes?.trim()) {
        events.push({ date: t.treatmentDate, eye, text: `Notiz: ${t.notes.trim()}` })
      }
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.eye.localeCompare(b.eye))
}

const PRINT_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9pt; padding: 12mm 15mm; color: #000; }
  h1 { font-size: 14pt; font-weight: bold; text-align: center; text-decoration: underline; margin-bottom: 10px; }
  .med-row { display: flex; gap: 0; border: 1.5px solid #000; }
  .med-cell { flex: 1; padding: 5px 8px; border-right: 1.5px solid #000; font-size: 10pt; }
  .med-cell:last-child { border-right: none; }
  .med-cell strong { font-size: 11pt; }
  .eyes { display: flex; gap: 0; border: 1.5px solid #000; margin-top: 10px; }
  .eye-col { flex: 1; border-right: 1.5px solid #000; }
  .eye-col:last-child { border-right: none; }
  .eye-title { text-align: center; font-size: 13pt; font-weight: bold; padding: 6px; border-bottom: 1.5px solid #000; }
  .consent-row { padding: 4px 8px; border-bottom: 1.5px solid #000; font-size: 8pt; display: flex; align-items: center; gap: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { border: 1px solid #000; padding: 3px 5px; font-size: 8pt; font-weight: bold; background: #f5f5f5; text-align: left; }
  td { border: 1px solid #000; padding: 3px 5px; font-size: 8pt; height: 15px; }
  .nr-col { width: 18px; text-align: right; font-weight: bold; }
  .checkbox { display: inline-block; width: 10px; height: 10px; border: 1px solid #000; margin-right: 3px; vertical-align: middle; background: transparent; }
  .checkbox.checked { background: #000; }
  .patient-box { border: 1.5px dashed #aaa; padding: 8px; margin-bottom: 10px; font-size: 10pt; min-height: 50px; }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .events { margin-top: 12px; border: 1.5px solid #000; }
  .events-title { background: #f0f0f0; padding: 4px 8px; font-weight: bold; font-size: 9pt; border-bottom: 1px solid #000; }
  .event-row { padding: 3px 8px; border-bottom: 1px solid #ddd; font-size: 8pt; display: flex; gap: 10px; }
  .event-row:last-child { border-bottom: none; }
  .eye-badge { font-weight: bold; min-width: 24px; }
  .eye-od { color: #b45309; }
  .eye-os { color: #1d4ed8; }
  .changed { background: #fffbeb; }
`

export default function IVTIntervallblatt({ patient, treatments, onClose }: Props) {
  const { style: dragStyle, onHeaderMouseDown } = useDraggable('ivt-intervallblatt')
  const meds = detectMeds(treatments)

  const odRows = treatments
    .filter(t => t.eyeSide === 'OD')
    .sort((a, b) => a.treatmentDate.localeCompare(b.treatmentDate))

  const osRows = treatments
    .filter(t => t.eyeSide === 'OS')
    .sort((a, b) => a.treatmentDate.localeCompare(b.treatmentDate))

  const autoEvents = buildAutoEvents(odRows, osRows)

  const ROWS = 20

  const Check = ({ on }: { on: boolean }) => (
    <span className={`inline-block w-3 h-3 border border-gray-800 ${on ? 'bg-gray-800' : 'bg-white'} shrink-0 align-middle`} />
  )

  const today = new Date().toISOString().slice(0, 10)
  function isPast(d?: string) { return !!d && d <= today }

  function buildHtml() {
    const cb = (on: boolean) => `<span class="checkbox${on ? ' checked' : ''}"></span>`

    // Row 0 OCT = rows[0].erstesOctDatum
    // Row i>0 OCT = rows[i-1].kontrolldatum (follow-up after previous injection)
    // Planned row OCT = rows[last].kontrolldatum
    function nkForRow(rows: Treatment[], i: number, isPlanned: boolean): { text: string; date: string } {
      if (isPlanned) {
        const src = rows[rows.length - 1]
        if (!src) return { text: '', date: '' }
        if (src.kontrolldatumAmSpritztag) return { text: `${fmt(src.treatmentDate)}`, date: src.treatmentDate }
        return { text: src.kontrolldatum ? fmt(src.kontrolldatum) : '', date: src.kontrolldatum ?? '' }
      }
      if (i === 0) {
        const d = rows[0]?.erstesOctDatum ?? ''
        return { text: fmt(d), date: d }
      }
      const prev = rows[i - 1]
      if (!prev) return { text: '', date: '' }
      if (prev.kontrolldatumAmSpritztag) return { text: `${fmt(prev.treatmentDate)}`, date: prev.treatmentDate }
      return { text: prev.kontrolldatum ? fmt(prev.kontrolldatum) : '', date: prev.kontrolldatum ?? '' }
    }

    function eyeRows(rows: Treatment[]) {
      const last = rows[rows.length - 1]
      const plannedDate = last?.nextAppointment ?? ''
      return Array.from({ length: ROWS }, (_, i) => {
        const t = rows[i]
        const isPlanned = !t && i === rows.length && !!plannedDate
        const changed = i > 0 && t && rows[i - 1].medicationName !== t.medicationName
        const rowStyle = changed ? ' class="changed"' : isPlanned ? ' style="color:#999"' : ''
        const { text: nk, date: nkD } = nkForRow(rows, i, isPlanned)
        const nkColor = nkD && isPast(nkD) ? '' : ' style="color:#999"'
        return `<tr${rowStyle}>
          <td class="nr-col">${i + 1}.</td>
          <td${nk ? nkColor : ''}>${nk}</td>
          <td${isPlanned ? ' style="color:#999;font-style:italic"' : ''}>${
            t ? fmt(t.treatmentDate) : isPlanned ? fmt(plannedDate) : ''
          }</td>
          <td>${t?.nextIntervalWeeks ? t.nextIntervalWeeks + 'W' : ''}</td>
        </tr>`
      }).join('')
    }

    const eventsHtml = autoEvents.length === 0
      ? '<div class="event-row"><span style="color:#888;font-style:italic">Keine Ereignisse</span></div>'
      : autoEvents.map(e => `
          <div class="event-row">
            <span class="eye-badge eye-${e.eye.toLowerCase()}">${e.eye}</span>
            <span style="min-width:70px">${fmt(e.date)}</span>
            <span>${e.text}</span>
          </div>`).join('')

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Intervallblatt – ${patient.firstName}</title>
    <style>${PRINT_STYLE}</style></head><body>
    <div class="header-row">
      <div class="patient-box">
        <div><strong>${patient.firstName}</strong></div>
        <div>Geb. ${fmt(patient.dateOfBirth)}</div>
        ${patient.patientNumber ? `<div>Pat.-Nr. ${patient.patientNumber}</div>` : ''}
      </div>
      <div style="text-align:right; font-size:8pt; color:#555;">Augenzentrum Suhr</div>
    </div>

    <h1>Intravitreale Injektion – Intervallblatt</h1>

    <div class="med-row">
      <div class="med-cell"><strong>Eylea</strong> ${cb(meds.eylea2)} 2mg &nbsp; ${cb(meds.eylea8)} 8mg</div>
      <div class="med-cell"><strong>Lucentis</strong> ${cb(meds.lucentis)}</div>
      <div class="med-cell"><strong>Syfore</strong> ${cb(meds.syfore)}</div>
      <div class="med-cell"><strong>Avastin 5mg</strong> ${cb(meds.avastin)}</div>
    </div>

    <div class="eyes">
      <div class="eye-col">
        <div class="eye-title">Rechtes Auge ${cb(!!odRows.length)}</div>
        <div class="consent-row">Einverständniserklärung unterschrieben: ${cb(false)} &nbsp; Kürzel:________</div>
        <table>
          <thead><tr>
            <th class="nr-col">&nbsp;</th>
            <th>OCT</th>
            <th>OP-Termin</th>
            <th>Intervall</th>
          </tr></thead>
          <tbody>${eyeRows(odRows)}</tbody>
        </table>
      </div>
      <div class="eye-col">
        <div class="eye-title">Linkes Auge ${cb(!!osRows.length)}</div>
        <div class="consent-row">Einverständniserklärung unterschrieben: ${cb(false)} &nbsp; Kürzel:________</div>
        <table>
          <thead><tr>
            <th class="nr-col">&nbsp;</th>
            <th>OCT</th>
            <th>OP-Termin</th>
            <th>Intervall</th>
          </tr></thead>
          <tbody>${eyeRows(osRows)}</tbody>
        </table>
      </div>
    </div>

    <div class="events">
      <div class="events-title">Automatische Dokumentation</div>
      ${eventsHtml}
    </div>
    </body></html>`
  }

  const handlePrint = async () => {
    const html = buildHtml()
    const eApp = (window as any).electronApp

    if (eApp?.openPrintHtml) {
      await eApp.openPrintHtml(html)
    } else if (eApp?.printHtml) {
      await eApp.printHtml(html)
    } else {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;border:none;'
      document.body.appendChild(iframe)
      iframe.contentDocument!.open()
      iframe.contentDocument!.write(html)
      iframe.contentDocument!.close()
      iframe.onload = () => {
        iframe.contentWindow!.focus()
        iframe.contentWindow!.print()
        setTimeout(() => iframe.remove(), 1000)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl" style={dragStyle}>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 cursor-grab select-none" onMouseDown={onHeaderMouseDown}>
          <h2 className="font-semibold text-gray-800">Intervallblatt — {patient.firstName}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
            >
              <Printer className="w-4 h-4" /> Drucken
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="p-5 overflow-y-auto max-h-[80vh] space-y-4">

          {/* Patient */}
          <div className="flex justify-between items-start">
            <div className="border border-dashed border-gray-300 rounded p-3 text-sm min-w-[200px]">
              <p className="font-semibold">{patient.firstName}</p>
              <p className="text-gray-500 text-xs">Geb. {fmt(patient.dateOfBirth)}</p>
              {patient.patientNumber && <p className="text-gray-500 text-xs">Pat.-Nr. {patient.patientNumber}</p>}
            </div>
            <p className="text-xs text-gray-400 mt-1">Augenzentrum Suhr</p>
          </div>

          <h1 className="text-center text-lg font-bold underline">Intravitreale Injektion – Intervallblatt</h1>

          {/* Medication */}
          <div className="border border-gray-800 flex text-sm">
            <div className="flex-1 px-3 py-2 border-r border-gray-800">
              <span className="font-bold">Eylea</span>
              <span className="ml-2 inline-flex items-center gap-1"><Check on={meds.eylea2} /> 2mg</span>
              <span className="ml-3 inline-flex items-center gap-1"><Check on={meds.eylea8} /> 8mg</span>
            </div>
            <div className="flex-1 px-3 py-2 border-r border-gray-800 font-bold flex items-center gap-1">
              Lucentis <Check on={meds.lucentis} />
            </div>
            <div className="flex-1 px-3 py-2 border-r border-gray-800 font-bold flex items-center gap-1">
              Syfore <Check on={meds.syfore} />
            </div>
            <div className="flex-1 px-3 py-2 font-bold flex items-center gap-1">
              Avastin 5mg <Check on={meds.avastin} />
            </div>
          </div>

          {/* Eye tables */}
          <div className="flex border border-gray-800 text-xs">
            {([
              { label: 'Rechtes Auge', side: 'OD', rows: odRows },
              { label: 'Linkes Auge',  side: 'OS', rows: osRows },
            ] as const).map(({ label, side, rows }, ci) => (
              <div key={side} className={`flex-1 ${ci === 0 ? 'border-r border-gray-800' : ''}`}>
                <div className={`text-center text-sm font-bold py-2 border-b border-gray-800 flex items-center justify-center gap-1.5 ${side === 'OD' ? 'text-orange-700' : 'text-blue-700'}`}>
                  {label} <Check on={rows.length > 0} />
                </div>
                <div className="px-2 py-1 border-b border-gray-800 flex items-center gap-1 text-[11px]">
                  Einverständniserklärung: <span className="inline-block w-2.5 h-2.5 border border-gray-800 shrink-0" /> Kürzel:________
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-400 px-1 py-1 w-5 text-right font-semibold">&nbsp;</th>
                      <th className="border border-gray-400 px-1 py-1 font-semibold">OCT</th>
                      <th className="border border-gray-400 px-1 py-1 font-semibold">OP-Termin</th>
                      <th className="border border-gray-400 px-1 py-1 font-semibold">Intervall</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const last = rows[rows.length - 1]
                      const plannedDate = last?.nextAppointment ?? ''

                      function getNkDisplay(rowIdx: number, isPlanned: boolean): { text: string; tick: boolean; date: string } {
                        if (isPlanned) {
                          const src = rows[rows.length - 1]
                          if (!src) return { text: '', tick: false, date: '' }
                          if (src.kontrolldatumAmSpritztag) return { text: fmt(src.treatmentDate), tick: true, date: src.treatmentDate }
                          return { text: src.kontrolldatum ? fmt(src.kontrolldatum) : '', tick: false, date: src.kontrolldatum ?? '' }
                        }
                        if (rowIdx === 0) {
                          const d = rows[0]?.erstesOctDatum ?? ''
                          return { text: fmt(d), tick: false, date: d }
                        }
                        const prev = rows[rowIdx - 1]
                        if (!prev) return { text: '', tick: false, date: '' }
                        if (prev.kontrolldatumAmSpritztag) return { text: fmt(prev.treatmentDate), tick: true, date: prev.treatmentDate }
                        return { text: prev.kontrolldatum ? fmt(prev.kontrolldatum) : '', tick: false, date: prev.kontrolldatum ?? '' }
                      }

                      return Array.from({ length: ROWS }, (_, i) => {
                        const t = rows[i]
                        const isPlanned = !t && i === rows.length && !!plannedDate
                        const nk = getNkDisplay(i, isPlanned)
                        const nkPast = isPast(nk.date)
                        const medChanged = i > 0 && t && rows[i - 1]?.medicationName !== t.medicationName
                        return (
                          <tr key={i} className={medChanged ? 'bg-amber-50' : isPlanned ? '' : t ? 'bg-blue-50/20' : ''}>
                            <td className="border border-gray-300 px-1 py-0.5 text-right font-semibold text-gray-400">{i + 1}.</td>
                            <td className={`border border-gray-300 px-1 py-0.5 whitespace-nowrap ${nk.date ? (nkPast ? 'text-gray-900 font-medium' : 'text-gray-400 italic') : ''}`}>
                              {nk.text}
                            </td>
                            <td className={`border border-gray-300 px-1 py-0.5 whitespace-nowrap ${isPlanned ? 'text-gray-400 italic' : 'font-medium'}`}>
                              {t ? fmt(t.treatmentDate) : isPlanned ? fmt(plannedDate) : ''}
                            </td>
                            <td className="border border-gray-300 px-1 py-0.5">{t?.nextIntervalWeeks ? `${t.nextIntervalWeeks}W` : ''}</td>
                          </tr>
                        )
                      })
                    })()}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {/* Auto documentation */}
          <div className="border border-gray-300 rounded-lg overflow-hidden">
            <div className="bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 border-b border-gray-300">
              Automatische Dokumentation
            </div>
            {autoEvents.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400 italic">Keine Ereignisse</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {autoEvents.map((e, i) => (
                  <div key={i} className="flex items-baseline gap-3 px-3 py-1.5 text-xs">
                    <span className={`font-bold shrink-0 ${e.eye === 'OD' ? 'text-orange-600' : 'text-blue-600'}`}>{e.eye}</span>
                    <span className="text-gray-500 shrink-0 tabular-nums">{fmt(e.date)}</span>
                    <span className="text-gray-800">{e.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
