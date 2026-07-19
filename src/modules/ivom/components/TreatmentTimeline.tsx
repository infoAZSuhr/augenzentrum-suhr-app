import { formatDate } from '../../../utils/dateUtils'
import type { Treatment } from '../../../types/ivom.types'

interface Props { treatments: Treatment[]; onSelect?: (t: Treatment) => void }

function weeksBetween(dateA: string, dateB: string): number {
  const diff = new Date(dateB).getTime() - new Date(dateA).getTime()
  return Math.round(diff / (7 * 24 * 60 * 60 * 1000))
}

function EyeTimeline({ items, color, label, ringColor, bgColor, onSelect }: {
  items: Treatment[]
  color: string
  label: string
  ringColor: string
  bgColor: string
  onSelect?: (t: Treatment) => void
}) {
  if (items.length === 0) return null

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${label === 'OD' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
          {label}
        </span>
        <span className="text-xs text-gray-400">{items.length} Injektion{items.length !== 1 ? 'en' : ''}</span>
      </div>

      <div className="relative overflow-x-auto pb-2">
        <div className="flex items-start gap-0 min-w-max">
          {items.map((t, i) => {
            const prev = items[i - 1]
            const weeks = prev ? weeksBetween(prev.treatmentDate, t.treatmentDate) : null
            const nextWeeks = t.nextIntervalWeeks

            return (
              <div key={t.id} className="flex items-center">
                {/* Verbindungslinie mit Wochenangabe */}
                {weeks !== null && (
                  <div className="flex flex-col items-center mx-1">
                    <span className="text-xs text-gray-400 mb-0.5 whitespace-nowrap">{weeks} W</span>
                    <div className="w-12 h-px bg-gray-300" />
                  </div>
                )}

                {/* Behandlungspunkt — Klick öffnet die Behandlung direkt
                    (Nutzerwunsch 2026-07-19) */}
                <div className="group relative flex flex-col items-center">
                  {/* Dot */}
                  <button type="button"
                    onClick={() => onSelect?.(t)}
                    title="Behandlung öffnen"
                    className={`w-4 h-4 rounded-full border-2 border-white ring-2 cursor-pointer transition-transform group-hover:scale-125 ${ringColor} ${bgColor}`} />

                  {/* Datum darunter */}
                  <span className="text-xs text-gray-500 mt-1 whitespace-nowrap">
                    {new Date(t.treatmentDate).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' })}
                  </span>

                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20 shadow-xl">
                    <p className="font-medium">{formatDate(t.treatmentDate)}</p>
                    {t.medicationName && <p className="text-gray-300">{t.medicationName}</p>}
                    {t.lotNumber && <p className="text-gray-400">Charge: {t.lotNumber}</p>}
                    {t.performedBy && <p className="text-gray-400">von {t.performedBy}</p>}
                    {nextWeeks && <p className="text-blue-300 mt-0.5">→ {nextWeeks} W geplant</p>}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Nächster geplanter Termin */}
          {items.length > 0 && items[items.length - 1].nextAppointment && (
            <div className="flex items-center">
              <div className="flex flex-col items-center mx-1">
                <span className="text-xs text-primary-500 mb-0.5 whitespace-nowrap font-medium">
                  {items[items.length - 1].nextIntervalWeeks
                    ? `${items[items.length - 1].nextIntervalWeeks} W`
                    : '—'}
                </span>
                <div className="w-12 h-px bg-primary-300 border-dashed" style={{ borderTop: '1px dashed' }} />
              </div>
              <div className="flex flex-col items-center">
                <div className="w-4 h-4 rounded-full border-2 border-primary-400 bg-white ring-2 ring-primary-200" />
                <span className="text-xs text-primary-600 font-medium mt-1 whitespace-nowrap">
                  {new Date(items[items.length - 1].nextAppointment!).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' })}
                </span>
                <span className="text-xs text-gray-400">geplant</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TreatmentTimeline({ treatments, onSelect }: Props) {
  const sorted = [...treatments].sort((a, b) => a.treatmentDate.localeCompare(b.treatmentDate))
  const od = sorted.filter(t => t.eyeSide === 'OD')
  const os = sorted.filter(t => t.eyeSide === 'OS')

  if (od.length === 0 && os.length === 0) {
    return <p className="text-sm text-gray-400">Keine Behandlungen.</p>
  }

  return (
    <div className="space-y-5">
      <EyeTimeline items={od} color="text-orange-600" label="OD" ringColor="ring-orange-400" bgColor="bg-orange-400" onSelect={onSelect} />
      <EyeTimeline items={os} color="text-blue-600" label="OS" ringColor="ring-blue-400" bgColor="bg-blue-400" onSelect={onSelect} />
    </div>
  )
}
