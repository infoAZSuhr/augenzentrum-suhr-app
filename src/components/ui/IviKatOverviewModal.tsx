import { useEffect, useState, useMemo } from 'react'
import { X, Printer, Syringe, Scissors, Stethoscope } from 'lucide-react'
import { getIviDaysFromPlanung, getPlannedIviDays } from '../../lib/firestorePatients'
import { loadPlanung, type PlanungData } from '../../lib/firestorePlanung'
import { useEscapeKey } from '../../hooks/useEscapeKey'

const IVI_DOCTORS_MATCH = ['tschopp', 'trachsler']
const IVI_WORKING = new Set(['GT', 'VM', 'NM'])
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function formatDate(date: string) {
  const d = new Date(date + 'T12:00:00')
  return `${WEEKDAYS[d.getDay()]}, ${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
}

function getMonthLabel(date: string) {
  const d = new Date(date + 'T12:00:00')
  return d.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })
}

function lastName(full: string) {
  return full.trim().split(/\s+/).pop() ?? full
}

interface IviDay {
  date: string
  doctors: string[]
  patientCount?: number
}

interface KatDay {
  date: string
  doctors: string[]
}

interface Props {
  open: boolean
  onClose: () => void
  initialView?: 'ivi' | 'kat'
}

export default function IviKatOverviewModal({ open, onClose, initialView = 'ivi' }: Props) {
  useEscapeKey(onClose, open)
  const [activeTab, setActiveTab] = useState<'ivi' | 'kat'>(initialView)
  const [iviDays, setIviDays] = useState<IviDay[]>([])
  const [katDays, setKatDays] = useState<KatDay[]>([])
  const [loading, setLoading] = useState(false)

  // Sync tab when modal re-opens with a different initialView
  useEffect(() => { if (open) setActiveTab(initialView) }, [open, initialView])

  // Inject @media print CSS while modal is open
  useEffect(() => {
    if (!open) return
    const style = document.createElement('style')
    style.id = 'ivi-kat-print-style'
    style.textContent = `
      @media print {
        body > * { visibility: hidden !important; }
        #ivi-kat-print-area, #ivi-kat-print-area * { visibility: visible !important; }
        #ivi-kat-print-area {
          position: fixed; top: 0; left: 0; width: 100%; padding: 24px;
          font-family: Arial, sans-serif;
        }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('ivi-kat-print-style')?.remove() }
  }, [open])

  // Fetch all data when modal opens
  useEffect(() => {
    if (!open) return
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const currentYear = new Date().getFullYear()

    async function load() {
      const [planIviDays, planned, plan1, plan2] = await Promise.all([
        getIviDaysFromPlanung(),
        getPlannedIviDays(),
        loadPlanung(currentYear),
        loadPlanung(currentYear + 1),
      ])

      const patientCounts = new Map<string, number>()
      planned.forEach(p => patientCounts.set(p.date, p.count))

      // IVI doctors per date
      const iviDoctorsByDate = new Map<string, string[]>()
      for (const plan of [plan1, plan2] as (PlanungData | null)[]) {
        if (!plan) continue
        for (const person of plan.sections.flatMap(s => s.persons)) {
          if (!IVI_DOCTORS_MATCH.some(d => person.toLowerCase().includes(d))) continue
          for (const [date, code] of Object.entries(plan.schedule[person] ?? {})) {
            if (IVI_WORKING.has(code) && date >= today) {
              if (!iviDoctorsByDate.has(date)) iviDoctorsByDate.set(date, [])
              iviDoctorsByDate.get(date)!.push(person)
            }
          }
        }
      }

      const computedIviDays: IviDay[] = planIviDays.map(date => ({
        date,
        doctors: iviDoctorsByDate.get(date) ?? [],
        patientCount: patientCounts.get(date),
      }))

      // KAT (OP) doctors per date
      const katByDate = new Map<string, string[]>()
      for (const plan of [plan1, plan2] as (PlanungData | null)[]) {
        if (!plan) continue
        for (const person of plan.sections.flatMap(s => s.persons)) {
          for (const [date, code] of Object.entries(plan.schedule[person] ?? {})) {
            if (code === 'OP' && date >= today) {
              if (!katByDate.has(date)) katByDate.set(date, [])
              katByDate.get(date)!.push(person)
            }
          }
        }
      }

      const computedKatDays: KatDay[] = [...katByDate.entries()]
        .map(([date, doctors]) => ({ date, doctors }))
        .sort((a, b) => a.date.localeCompare(b.date))

      setIviDays(computedIviDays)
      setKatDays(computedKatDays)
      setLoading(false)
    }

    load()
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-3 sm:p-6 overflow-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex bg-gray-100 rounded-xl p-1 gap-0.5 text-sm">
            <button
              onClick={() => setActiveTab('ivi')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === 'ivi'
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Syringe className="w-3.5 h-3.5" /> IVI-Tage
            </button>
            <button
              onClick={() => setActiveTab('kat')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === 'kat'
                  ? 'bg-white text-purple-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" /> KAT-Tage
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              <Printer className="w-3.5 h-3.5" /> Drucken
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable content */}
        <div id="ivi-kat-print-area" className="p-5 max-h-[75vh] overflow-y-auto">

          {/* Print-only heading */}
          <div className="hidden print:block mb-4 pb-3 border-b border-gray-300">
            <h1 className="text-lg font-bold text-gray-900">
              {activeTab === 'ivi' ? 'IVI-Tage — Gesamtübersicht' : 'KAT-Tage (OP KSA) — Gesamtübersicht'}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Augenzentrum Suhr · Stand: {new Date().toLocaleDateString('de-CH')}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-400" />
              <span className="text-sm text-gray-400">Wird geladen…</span>
            </div>
          ) : activeTab === 'ivi' ? (
            <IviTable days={iviDays} />
          ) : (
            <KatTable days={katDays} />
          )}
        </div>
      </div>
    </div>
  )
}

function IviTable({ days }: { days: IviDay[] }) {
  const grouped = useMemo(() => groupByMonth(days.map(d => d.date)), [days])
  const dayMap = useMemo(() => new Map(days.map(d => [d.date, d])), [days])

  if (days.length === 0)
    return <p className="text-sm text-gray-400 italic text-center py-8">Keine IVI-Tage geplant</p>

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b-2 border-gray-200 text-left">
          <th className="pb-2 pr-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Datum</th>
          <th className="pb-2 pr-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Arzt</th>
          <th className="pb-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide text-right">Pat.</th>
        </tr>
      </thead>
      <tbody>
        {grouped.map(({ month, dates }) => (
          <>
            <tr key={`m-${month}`}>
              <td colSpan={3} className="pt-4 pb-1">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{month}</span>
              </td>
            </tr>
            {dates.map(date => {
              const d = dayMap.get(date)!
              return (
                <tr key={date} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-2 pr-4 font-medium text-gray-800 whitespace-nowrap">{formatDate(date)}</td>
                  <td className="py-2 pr-4">
                    {d.doctors.length > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <Stethoscope className="w-3 h-3 text-primary-400 shrink-0" />
                        <span className="text-[11px] text-gray-700">{d.doctors.map(lastName).join(', ')}</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-gray-300 italic">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {d.patientCount !== undefined && d.patientCount > 0 ? (
                      <span className="text-xs font-semibold text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full">
                        {d.patientCount}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">0</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </>
        ))}
      </tbody>
    </table>
  )
}

function KatTable({ days }: { days: KatDay[] }) {
  const grouped = useMemo(() => groupByMonth(days.map(d => d.date)), [days])
  const dayMap = useMemo(() => new Map(days.map(d => [d.date, d])), [days])

  if (days.length === 0)
    return <p className="text-sm text-gray-400 italic text-center py-8">Keine KAT-Tage (OP KSA) geplant</p>

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b-2 border-gray-200 text-left">
          <th className="pb-2 pr-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Datum</th>
          <th className="pb-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Ärzte (OP KSA)</th>
        </tr>
      </thead>
      <tbody>
        {grouped.map(({ month, dates }) => (
          <>
            <tr key={`m-${month}`}>
              <td colSpan={2} className="pt-4 pb-1">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{month}</span>
              </td>
            </tr>
            {dates.map(date => {
              const d = dayMap.get(date)!
              return (
                <tr key={date} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-2 pr-4 font-medium text-gray-800 whitespace-nowrap">{formatDate(date)}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-1.5">
                      <Stethoscope className="w-3 h-3 text-purple-400 shrink-0" />
                      <span className="text-[11px] text-purple-700">{d.doctors.map(lastName).join(', ')}</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </>
        ))}
      </tbody>
    </table>
  )
}

function groupByMonth(dates: string[]): { month: string; dates: string[] }[] {
  const map = new Map<string, string[]>()
  for (const date of dates) {
    const m = getMonthLabel(date)
    if (!map.has(m)) map.set(m, [])
    map.get(m)!.push(date)
  }
  return [...map.entries()].map(([month, dates]) => ({ month, dates }))
}
