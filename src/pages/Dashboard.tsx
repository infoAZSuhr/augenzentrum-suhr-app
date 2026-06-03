import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Package, AlertTriangle, ChevronRight, Stethoscope, UserCheck, Syringe, Scissors, Phone, Printer, Ban, RefreshCw, Loader2 } from 'lucide-react'
import Pinnwand from '../components/ui/Pinnwand'
import IviKatOverviewModal from '../components/ui/IviKatOverviewModal'
import { Link } from 'react-router-dom'
import { getAlerts, getZurRoseMeta, subscribeAlertSources } from '../lib/firestoreLager'
import { getPlannedIviDays, getUpcomingAppointments } from '../lib/firestorePatients'
import { loadPlanung, type PlanungData } from '../lib/firestorePlanung'
import { getRecallSummary, type RecallSummary } from '../lib/firestoreRecall'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/ToastContext'
import { syncZurRoseFromWorker, getNotaListeMetaFromFirestore } from '../lib/zurroseUpdate'
import type { Appointment } from '../types/ivom.types'

const WORKING_CODES = new Set(['GT', 'VM', 'NM', 'OP', 'W', 'NFD'])
const IN_HOUSE_CODES = new Set(['GT', 'VM', 'NM', 'NFD'])

const CODE_LABEL: Record<string, string> = {
  GT: 'Ganztag', VM: 'Vormittag', NM: 'Nachmittag',
  OP: 'OP KSA', W: 'Weiterbildung', NFD: 'Notfalldienst',
}
const CODE_COLOR: Record<string, string> = {
  GT:  'bg-green-100 text-green-700',
  VM:  'bg-blue-100 text-blue-700',
  NM:  'bg-indigo-100 text-indigo-700',
  OP:  'bg-purple-100 text-purple-700',
  W:   'bg-amber-100 text-amber-700',
  NFD: 'bg-red-100 text-red-700',
}

function getWeekDays(offsetWeeks: number) {
  const today = new Date()
  const day = today.getDay()
  const diffToMonday = day === 0 ? 1 : 1 - day
  const monday = new Date(today)
  monday.setDate(today.getDate() + diffToMonday + offsetWeeks * 7)
  const shorts = ['Mo', 'Di', 'Mi', 'Do', 'Fr']
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    return { key, short: shorts[i], date: d }
  })
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function formatWeekRange(days: { key: string }[]) {
  if (days.length < 5) return ''
  const f = days[0].key, t = days[4].key
  return `${f.slice(8,10)}.${f.slice(5,7)}. – ${t.slice(8,10)}.${t.slice(5,7)}.${t.slice(0,4)}`
}

function WeekBlock({
  weekOffset,
  planung,
  apptsByDate,
  feiertage,
}: {
  weekOffset: number
  planung: PlanungData
  apptsByDate: Record<string, Appointment[]>
  feiertage: Record<string, string>
}) {
  const days = getWeekDays(weekOffset)
  const kw = getISOWeek(days[0].date)
  const today = new Date().toISOString().slice(0, 10)

  const staffedDays = days.filter(day =>
    (planung.sections[0]?.persons ?? []).some(p => {
      const code = planung.schedule[p]?.[day.key]
      return code && IN_HOUSE_CODES.has(code)
    })
  ).length

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-primary-700">KW {kw}</span>
          <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
            {staffedDays}/5 <Stethoscope className="w-2.5 h-2.5 inline-block -mt-0.5 ml-0.5" />
          </span>
        </div>
        <span className="text-[11px] text-gray-400">{formatWeekRange(days)}</span>
      </div>

      {/* Days */}
      <div className="divide-y divide-gray-50">
        {days.map(day => {
          const ftName = feiertage[day.key]
          const isToday = day.key === today
          const doctors: { name: string; code: string }[] = []
          const support: { name: string; code: string }[] = []
          const mpas: { name: string; code: string }[] = []
          planung.sections[0]?.persons.forEach(p => {
            const code = planung.schedule[p]?.[day.key]
            if (code && WORKING_CODES.has(code)) doctors.push({ name: p, code })
          })
          planung.sections[1]?.persons.forEach(p => {
            const code = planung.schedule[p]?.[day.key]
            if (code && WORKING_CODES.has(code)) support.push({ name: p, code })
          })
          const mpaSection = planung.sections.find(s => s.label === 'Mitarbeiter SU')
          mpaSection?.persons.forEach(p => {
            const code = planung.schedule[p]?.[day.key]
            if (code && WORKING_CODES.has(code)) mpas.push({ name: p, code })
          })
          const dayAppts = apptsByDate[day.key] ?? []
          const empty = !ftName && doctors.length === 0 && support.length === 0 && mpas.length === 0 && dayAppts.length === 0

          return (
            <div key={day.key} className={`px-3 py-1.5 flex items-start gap-2 ${isToday ? 'bg-primary-50' : ftName ? 'bg-orange-50/60' : ''}`}>
              {/* Day label */}
              <div className="w-14 shrink-0 pt-0.5">
                <span className={`text-[11px] font-bold ${isToday ? 'text-primary-700' : 'text-gray-500'}`}>{day.short} </span>
                <span className="text-[11px] text-gray-400">{day.key.slice(8,10)}.{day.key.slice(5,7)}.</span>
              </div>

              {ftName ? (
                <div className="flex-1 pt-0.5 space-y-0.5">
                  <span className="text-[11px] font-semibold text-orange-600">{ftName}</span>
                  {(doctors.length > 0 || support.length > 0 || mpas.length > 0) && (
                    <div className="space-y-0.5">
                      {doctors.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <Stethoscope className="w-3 h-3 text-primary-400 shrink-0" />
                          {doctors.map(({ name, code }) => (
                            <span key={name} className="flex items-center gap-1">
                              <span className="text-xs font-bold text-gray-900">{name}</span>
                              <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full ${CODE_COLOR[code] ?? 'bg-gray-100 text-gray-600'}`}>{CODE_LABEL[code] ?? code}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {mpas.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <UserCheck className="w-3 h-3 text-teal-400 shrink-0" />
                          {mpas.map(({ name }) => (
                            <span key={name} className="text-[10px] text-teal-700 font-medium">{name}</span>
                          ))}
                        </div>
                      )}
                      {support.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <UserCheck className="w-3 h-3 text-gray-300 shrink-0" />
                          {support.map(({ name, code }) => (
                            <span key={name} className="flex items-center gap-1">
                              <span className="text-[10px] text-gray-400">{name}</span>
                              <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full opacity-60 ${CODE_COLOR[code] ?? 'bg-gray-100 text-gray-600'}`}>{CODE_LABEL[code] ?? code}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : empty ? (
                <p className="text-[11px] text-gray-300 italic pt-0.5">—</p>
              ) : (
                <div className="flex-1 space-y-0.5 pt-0.5">
                  {doctors.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Stethoscope className="w-3 h-3 text-primary-400 shrink-0" />
                      {doctors.map(({ name, code }) => (
                        <span key={name} className="flex items-center gap-1">
                          <span className="text-xs font-bold text-gray-900">{name}</span>
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full ${CODE_COLOR[code] ?? 'bg-gray-100 text-gray-600'}`}>{CODE_LABEL[code] ?? code}</span>
                        </span>
                      ))}
                      {dayAppts.length > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] font-semibold text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded-full ml-auto">
                          <Syringe className="w-2.5 h-2.5" />{dayAppts.length}
                        </span>
                      )}
                    </div>
                  )}
                  {mpas.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <UserCheck className="w-3 h-3 text-teal-400 shrink-0" />
                      {mpas.map(({ name }) => (
                        <span key={name} className="text-[10px] text-teal-700 font-medium">{name}</span>
                      ))}
                    </div>
                  )}
                  {support.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <UserCheck className="w-3 h-3 text-gray-300 shrink-0" />
                      {support.map(({ name, code }) => (
                        <span key={name} className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400">{name}</span>
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full opacity-60 ${CODE_COLOR[code] ?? 'bg-gray-100 text-gray-600'}`}>{CODE_LABEL[code] ?? code}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getUpcomingOpDays(planung: PlanungData, daysAhead = 90): { date: string; persons: string[] }[] {
  const today = new Date()
  const result: { date: string; persons: string[] }[] = []
  const allPersons = planung.sections.flatMap(s => s.persons)
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    const persons = allPersons.filter(p => planung.schedule[p]?.[key] === 'OP')
    if (persons.length > 0) result.push({ date: key, persons })
  }
  return result.slice(0, 10)
}

export default function Dashboard() {
  const { profile, canAccessIvom, canAccessLager, canAccessPlanung, isGuest } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [planung, setPlanung] = useState<PlanungData | null>(null)
  const [visibleWeeks, setVisibleWeeks] = useState(8)
  const [showOverview, setShowOverview] = useState<'ivi' | 'kat' | null>(null)
  const [zurroseUpdating, setZurroseUpdating] = useState(false)
  const year = new Date().getFullYear()

  useEffect(() => {
    if (canAccessPlanung) loadPlanung(year).then(setPlanung)
  }, [year, canAccessPlanung])

  const { data: alerts = [] } = useQuery({
    queryKey: ['inventory-alerts'],
    queryFn: getAlerts,
    enabled: canAccessLager,
  })

  // Live-Updates: bei jeder Artikel- oder Lot-Änderung (irgendwo in der
  // Praxis) invalidate die Alerts-Query → recompute. Debounce auf 800ms
  // im Helper, damit Batch-Buchungen nicht 20 Refetches triggern.
  useEffect(() => {
    if (!canAccessLager) return
    return subscribeAlertSources(() => {
      queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] })
    })
  }, [canAccessLager, queryClient])

  // IVI days from treatment nextAppointment fields
  const { data: iviDays = [] } = useQuery({
    queryKey: ['planned-ivi-days'],
    queryFn: getPlannedIviDays,
    enabled: canAccessIvom,
  })

  const { data: recallSummary } = useQuery<RecallSummary>({
    queryKey: ['recall-summary'],
    queryFn: getRecallSummary,
    enabled: !isGuest,
    staleTime: 1000 * 60 * 5,   // 5 min
  })

  // Next 21 days for week schedule IVI badges
  const { data: upcoming = [] } = useQuery({
    queryKey: ['upcoming-21'],
    queryFn: () => getUpcomingAppointments(21),
    enabled: canAccessIvom && canAccessPlanung,
  })

  const { data: zurRoseMeta } = useQuery({
    queryKey: ['zurrose-meta'],
    // Firestore-Doc bevorzugen (vom User-Click oder Worker-Cron geschrieben),
    // Fallback auf das alte public/-JSON aus dem CI-Bundle.
    queryFn: async () => (await getNotaListeMetaFromFirestore()) ?? (await getZurRoseMeta()),
    enabled: canAccessLager,
    staleTime: 1000 * 60,
  })

  async function handleZurroseUpdate() {
    if (zurroseUpdating) return
    setZurroseUpdating(true)
    try {
      const result = await syncZurRoseFromWorker(profile?.displayName ?? profile?.username ?? 'Unbekannt')
      toast.success(`Nota-Liste aktualisiert · Stand ${result.stand} · ${result.articlesMatched} Artikel als nicht lieferbar markiert`)
      // Caches invalidieren damit Meta + Alerts neu geladen werden
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['zurrose-meta'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] }),
      ])
    } catch (e) {
      toast.error(`Aktualisierung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setZurroseUpdating(false)
    }
  }

  const criticalAlerts = alerts.filter(a => a.severity === 'critical')
  const stockAlerts = alerts.filter(a => a.type !== 'not_deliverable')
  const notDeliverableAlerts = alerts.filter(a => a.type === 'not_deliverable')

  // Group upcoming by date (for week schedule badges)
  const apptsByDate = upcoming.reduce<Record<string, Appointment[]>>((acc, a) => {
    const d = a.scheduledDate.slice(0, 10)
    ;(acc[d] ??= []).push(a)
    return acc
  }, {})

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Guten Morgen'
    if (h < 18) return 'Guten Tag'
    return 'Guten Abend'
  }
  const firstName = profile?.displayName?.split(' ')[0] ?? profile?.username ?? ''

  return (
    <div className="p-3 sm:p-6 w-full space-y-5">

      {/* Greeting */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">
          {greeting()}{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Übersicht — Augenzentrum Suhr</p>
      </div>

      {/* Pinnwand */}
      <Pinnwand />

      {/* Top cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

        {/* IVI geplante Tage */}
        {canAccessIvom && <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Syringe className="w-4 h-4 text-primary-600" />
              <span className="text-sm font-semibold text-gray-800">Geplante IVI-Tage</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowOverview('ivi')}
                className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                title="Übersicht drucken"
              >
                <Printer className="w-3.5 h-3.5" />
              </button>
              <Link to="/ivom/tagesplanung" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Alle →</Link>
            </div>
          </div>
          <div className="divide-y divide-gray-50 overflow-y-auto max-h-64">
            {iviDays.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-400 italic">Keine Termine geplant</p>
            ) : (
              iviDays.map(({ date, count }) => {
                const weekday = new Date(date + 'T12:00:00').toLocaleDateString('de-CH', { weekday: 'short' })
                const doctors = planung
                  ? (planung.sections[0]?.persons ?? []).flatMap(p => {
                      const code = planung.schedule[p]?.[date]
                      return code && WORKING_CODES.has(code) ? [{ name: p, code }] : []
                    })
                  : []
                return (
                  <div key={date} className="px-4 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 w-6 shrink-0">{weekday}</span>
                        <span className="text-sm text-gray-800">
                          {date.slice(8,10)}.{date.slice(5,7)}.{date.slice(0,4)}
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full shrink-0">
                        {count} Patient{count !== 1 ? 'en' : ''}
                      </span>
                    </div>
                    {doctors.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 pl-8">
                        <Stethoscope className="w-3 h-3 text-gray-400 shrink-0" />
                        {doctors.map(({ name, code }) => (
                          <span key={name} className="flex items-center gap-1">
                            <span className="text-[11px] text-gray-600">{name}</span>
                            <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full ${CODE_COLOR[code] ?? 'bg-gray-100 text-gray-600'}`}>
                              {CODE_LABEL[code] ?? code}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>}

        {/* KAT / OP-Tage */}
        {canAccessPlanung && <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Scissors className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-semibold text-gray-800">KAT-Tage (OP KSA)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowOverview('kat')}
                className="p-1 text-gray-400 hover:text-purple-600 transition-colors"
                title="Übersicht drucken"
              >
                <Printer className="w-3.5 h-3.5" />
              </button>
              <Link to="/planung" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Planung →</Link>
            </div>
          </div>
          <div className="divide-y divide-gray-50 overflow-y-auto max-h-64">
            {!planung ? (
              <p className="px-4 py-3 text-sm text-gray-400 italic">Wird geladen…</p>
            ) : getUpcomingOpDays(planung).length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-400 italic">Keine OP-Tage geplant</p>
            ) : (
              getUpcomingOpDays(planung).map(({ date, persons }) => {
                const weekday = new Date(date + 'T12:00:00').toLocaleDateString('de-CH', { weekday: 'short' })
                return (
                  <div key={date} className="px-4 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 w-6 shrink-0">{weekday}</span>
                        <span className="text-sm text-gray-800">
                          {date.slice(8,10)}.{date.slice(5,7)}.{date.slice(0,4)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 pl-8">
                      <Stethoscope className="w-3 h-3 text-gray-400 shrink-0" />
                      {persons.map(name => (
                        <span key={name} className="flex items-center gap-1">
                          <span className="text-[11px] text-gray-600">{name}</span>
                          <span className="text-[9px] font-bold px-1 py-0.5 rounded-full bg-purple-100 text-purple-700">OP KSA</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>}

        {/* Lager Warnungen */}
        {canAccessLager && <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Package className={`w-4 h-4 ${criticalAlerts.length > 0 ? 'text-red-600' : stockAlerts.length > 0 ? 'text-amber-500' : 'text-green-600'}`} />
              <span className="text-sm font-semibold text-gray-800">Lager-Warnungen</span>
              {stockAlerts.length > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${criticalAlerts.length > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  {stockAlerts.length}
                </span>
              )}
            </div>
            <Link to="/lager" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Lager →</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {stockAlerts.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-400 italic">Kein Handlungsbedarf</p>
            ) : (
              stockAlerts.slice(0, 6).map((a, i) => (
                <div key={i} className="px-4 py-2 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${a.severity === 'critical' ? 'bg-red-500' : 'bg-amber-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{a.articleName}</p>
                    <p className="text-xs text-gray-500">{a.detail}</p>
                  </div>
                  {a.severity === 'critical' && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0">Kritisch</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>}

        {/* Nicht lieferbar */}
        {canAccessLager && <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Ban className={`w-4 h-4 ${notDeliverableAlerts.length > 0 ? 'text-blue-500' : 'text-green-600'}`} />
              <span className="text-sm font-semibold text-gray-800">Nicht lieferbar</span>
              {notDeliverableAlerts.length > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  {notDeliverableAlerts.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {zurRoseMeta?.stand && (() => {
                // "Veraltet"-Marker wenn der Stand älter als 7 Tage ist.
                // Format kann "DD.MM.YYYY" sein → parsen für age-check.
                let isStale = false
                const m = zurRoseMeta.stand.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
                if (m) {
                  const standDate = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`)
                  if (!isNaN(standDate.getTime())) {
                    isStale = (Date.now() - standDate.getTime()) / 86400000 > 7
                  }
                }
                return (
                  <span className={`text-[10px] ${isStale ? 'text-amber-600 font-medium' : 'text-gray-400'}`}
                    title={isStale ? 'Stand älter als 7 Tage — Klick auf "Aktualisieren" lädt die aktuelle Nota-Liste' : 'Aktueller Zur-Rose-Stand'}>
                    Zur Rose {zurRoseMeta.stand}{isStale ? ' ⚠' : ''}
                  </span>
                )
              })()}
              <button
                onClick={handleZurroseUpdate}
                disabled={zurroseUpdating}
                title="Nota-Liste manuell aktualisieren (umgeht Cloudflare via Cloudflare-Worker-Proxy)"
                className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium disabled:opacity-50 disabled:cursor-wait"
              >
                {zurroseUpdating
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Lädt…</>
                  : <><RefreshCw className="w-3 h-3" /> Aktualisieren</>}
              </button>
              <Link to="/lager" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Lager →</Link>
            </div>
          </div>
          <div className="divide-y divide-gray-50 overflow-y-auto max-h-64">
            {notDeliverableAlerts.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-400 italic">Alle Artikel lieferbar</p>
            ) : (
              notDeliverableAlerts.map((a, i) => (
                <div key={i} className="px-4 py-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-blue-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{a.articleName}</p>
                    <p className="text-xs text-blue-600">{a.detail}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>}

        {/* Recall Übersicht */}
        {!isGuest && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-primary-600" />
                <span className="text-sm font-semibold text-gray-800">Recall</span>
                {recallSummary && recallSummary.overdueRC > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                    {recallSummary.overdueRC} überfällig
                  </span>
                )}
                {recallSummary && recallSummary.reminderFaellig > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                    {recallSummary.reminderFaellig} Reminder fällig
                  </span>
                )}
              </div>
              <Link to="/recall" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Recall →</Link>
            </div>
            <div className="divide-y divide-gray-50">
              {!recallSummary ? (
                <p className="px-4 py-3 text-sm text-gray-400 italic">Wird geladen…</p>
              ) : (
                <>
                  <div className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-sm text-gray-600">Patienten (zugeordnet)</span>
                    <span className="text-sm font-semibold text-gray-800">{recallSummary.total}</span>
                  </div>
                  {recallSummary.zuBearbeiten > 0 && (
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-sm text-gray-600">Zu bearbeiten</span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{recallSummary.zuBearbeiten}</span>
                    </div>
                  )}
                  {recallSummary.overdueRC > 0 && (
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-sm text-gray-600">RC überfällig</span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{recallSummary.overdueRC}</span>
                    </div>
                  )}
                  {recallSummary.keinTermin > 0 && (
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-sm text-gray-600">In Recall erstellt</span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">{recallSummary.keinTermin}</span>
                    </div>
                  )}
                  {recallSummary.reminderFaellig > 0 && (
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-sm text-gray-600">Reminder fällig</span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{recallSummary.reminderFaellig}</span>
                    </div>
                  )}
                  {recallSummary.overdueRC === 0 && recallSummary.zuBearbeiten === 0 && recallSummary.keinTermin === 0 && recallSummary.reminderFaellig === 0 && (
                    <p className="px-4 py-3 text-sm text-gray-400 italic">Kein Handlungsbedarf</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Scrollable weekly schedule */}
      {canAccessPlanung && <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700">Einsatzplanung</h2>
          </div>
          <Link to="/planung" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Planung →</Link>
        </div>

        {!planung ? (
          <div className="bg-white border border-gray-200 rounded-xl flex items-center justify-center py-10 text-sm text-gray-400">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-400 mr-2" />
            Wird geladen…
          </div>
        ) : (
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3" style={{ width: 'max-content' }}>
              {Array.from({ length: visibleWeeks }, (_, i) => (
                <div key={i} className="w-72 shrink-0">
                  <WeekBlock
                    weekOffset={i}
                    planung={planung}
                    apptsByDate={apptsByDate}
                    feiertage={planung.feiertage ?? {}}
                  />
                </div>
              ))}
              <div className="w-36 shrink-0 flex items-center justify-center">
                <button
                  onClick={() => setVisibleWeeks(v => v + 4)}
                  className="px-3 py-2 text-xs font-semibold text-primary-600 border border-primary-200 bg-primary-50 hover:bg-primary-100 rounded-xl transition-colors"
                >
                  + 4 Wochen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>}

      <IviKatOverviewModal
        open={showOverview !== null}
        initialView={showOverview ?? 'ivi'}
        onClose={() => setShowOverview(null)}
      />
    </div>
  )
}
