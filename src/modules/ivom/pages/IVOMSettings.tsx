import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getIVOMSettings, updateIVOMSettings } from '../../../lib/firestorePatients'
import { WEEKDAY_LABELS } from '../../../utils/dateUtils'
import PageHeader from '../../../components/ui/PageHeader'
import { Save } from 'lucide-react'
import { useState, useEffect } from 'react'

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]

export default function IVOMSettings() {
  const qc = useQueryClient()
  const [iviDays, setIviDays] = useState<number[]>([])
  const [saved, setSaved] = useState(false)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['ivom-settings'],
    queryFn: getIVOMSettings,
  })

  useEffect(() => {
    if (settings) setIviDays(settings.iviDays)
  }, [settings])

  const saveMut = useMutation({
    mutationFn: () => updateIVOMSettings({ iviDays }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ivom-settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const toggle = (day: number) => {
    setIviDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    )
  }

  if (isLoading) return <div className="p-6 text-gray-400">Laden…</div>

  return (
    <div>
      <PageHeader
        title="Einstellungen"
        subtitle="IVI-Manager Konfiguration"
        actions={
          <button
            className="btn-primary"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            title="Speichern"
          >
            <Save className="w-4 h-4" />
            <span className="hidden sm:inline">{saved ? 'Gespeichert ✓' : saveMut.isPending ? 'Speichern…' : 'Speichern'}</span>
          </button>
        }
      />

      <div className="p-6 space-y-6 max-w-2xl">

        {/* IVI-Tage */}
        <div className="card p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-900">IVI-Behandlungstage</h2>
            <p className="text-sm text-gray-500 mt-1">
              Definiere, an welchen Wochentagen IVI-Behandlungen durchgeführt werden.
              Bei der Intervall-Berechnung wird automatisch der nächste IVI-Tag gewählt.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {ALL_DAYS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => toggle(day)}
                className={`w-14 h-14 rounded-xl text-sm font-semibold border-2 transition-all ${
                  iviDays.includes(day)
                    ? 'bg-primary-600 border-primary-600 text-white shadow-md'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-primary-300 hover:text-primary-600'
                }`}
              >
                {WEEKDAY_LABELS[day]}
              </button>
            ))}
          </div>

          {iviDays.length > 0 ? (
            <div className="flex items-center gap-2 p-3 bg-primary-50 rounded-lg">
              <span className="text-sm text-primary-700 font-medium">
                IVI-Tage: {iviDays.map(d => WEEKDAY_LABELS[d]).join(', ')}
              </span>
            </div>
          ) : (
            <div className="p-3 bg-yellow-50 rounded-lg">
              <p className="text-sm text-yellow-700">
                Keine IVI-Tage definiert – der Termin wird ohne Anpassung berechnet.
              </p>
            </div>
          )}
        </div>

        {/* Hinweis */}
        <div className="card p-4 bg-gray-50 border border-gray-200">
          <p className="text-xs text-gray-500">
            <strong>Beispiel:</strong> Intervall 8 Wochen ab 21.03.2026 → berechnet: 16.05.2026 (Samstag)
            → verschoben auf nächsten IVI-Tag: 18.05.2026 (Montag)
          </p>
        </div>
      </div>
    </div>
  )
}
