import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import { getPatients } from '../../../lib/firestorePatients'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

function isoDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getMonthDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  // Monday = 0
  const startPad = (first.getDay() + 6) % 7
  const days: (Date | null)[] = Array(startPad).fill(null)
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month, d))
  }
  return days
}

export default function IVOMCalendar() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const { data: patients = [] } = useQuery({
    queryKey: ['patients', '', 'aktiv'],
    queryFn: () => getPatients(undefined, 'aktiv'),
  })

  // Map: date → patients with appointment on that day
  const appointmentMap = new Map<string, typeof patients>()
  for (const p of patients) {
    if (p.nextAppointmentDate) {
      const key = p.nextAppointmentDate.slice(0, 10)
      if (!appointmentMap.has(key)) appointmentMap.set(key, [])
      appointmentMap.get(key)!.push(p)
    }
  }

  const days = getMonthDays(year, month)
  const todayStr = isoDate(today)

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  const selectedPatients = selectedDay ? (appointmentMap.get(selectedDay) ?? []) : []

  // Upcoming appointments (next 30 days)
  const in30 = new Date(today)
  in30.setDate(in30.getDate() + 30)
  const upcoming = patients
    .filter(p => p.nextAppointmentDate && p.nextAppointmentDate >= todayStr && p.nextAppointmentDate <= isoDate(in30))
    .sort((a, b) => (a.nextAppointmentDate || '').localeCompare(b.nextAppointmentDate || ''))

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Kalender */}
        <div className="lg:col-span-2 card p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">{MONTHS[month]} {year}</h2>
            <div className="flex gap-1">
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
              <button onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()) }}
                className="px-3 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                Heute
              </button>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </button>
            </div>
          </div>

          {/* Wochentage */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-xs font-medium text-gray-400 text-center py-1">{d}</div>
            ))}
          </div>

          {/* Tage */}
          <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-lg overflow-hidden">
            {days.map((day, i) => {
              if (!day) return <div key={`pad-${i}`} className="bg-white h-14" />
              const key = isoDate(day)
              const apps = appointmentMap.get(key) ?? []
              const isToday = key === todayStr
              const isSelected = key === selectedDay
              const isPast = key < todayStr
              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(isSelected ? null : key)}
                  className={`bg-white h-14 p-1 flex flex-col items-center relative transition-colors hover:bg-primary-50 ${
                    isSelected ? 'bg-primary-50 ring-2 ring-inset ring-primary-400' : ''
                  }`}
                >
                  <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-primary-600 text-white' :
                    isPast ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    {day.getDate()}
                  </span>
                  {apps.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-0.5 justify-center">
                      {apps.slice(0, 3).map((_, j) => (
                        <div key={j} className={`w-1.5 h-1.5 rounded-full ${isPast ? 'bg-gray-300' : 'bg-primary-500'}`} />
                      ))}
                      {apps.length > 3 && <span className="text-xs text-primary-500 leading-none">+{apps.length - 3}</span>}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Ausgewählter Tag */}
          {selectedDay && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">
                {new Date(selectedDay).toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' })}
                {' — '}{selectedPatients.length} Patient{selectedPatients.length !== 1 ? 'en' : ''}
              </p>
              {selectedPatients.length === 0 ? (
                <p className="text-sm text-gray-400">Keine Termine an diesem Tag.</p>
              ) : (
                <div className="space-y-2">
                  {selectedPatients.map(p => (
                    <Link key={p.id} to={`/ivom/${p.id}`}
                      className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-primary-50 transition-colors group">
                      <div>
                        <p className="font-medium text-sm text-gray-900 group-hover:text-primary-700">
                          {p.firstName}
                        </p>
                        <div className="flex gap-3 text-xs text-gray-400 mt-0.5">
                          {p.diagnosisOd && <span className="flex items-center gap-1"><Eye className="w-3 h-3 text-orange-400" /> OD: {p.diagnosisOd}</span>}
                          {p.diagnosisOs && <span className="flex items-center gap-1"><Eye className="w-3 h-3 text-blue-400" /> OS: {p.diagnosisOs}</span>}
                        </div>
                      </div>
                      <span className="text-xs text-primary-600 font-medium">→</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nächste 30 Tage */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Nächste 30 Tage</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-gray-400">Keine anstehenden Termine.</p>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {upcoming.map(p => {
                const daysUntil = Math.ceil((new Date(p.nextAppointmentDate!).getTime() - today.getTime()) / 86400000)
                return (
                  <Link key={p.id} to={`/ivom/${p.id}`}
                    className="block p-3 rounded-lg border border-gray-100 hover:border-primary-200 hover:bg-primary-50 transition-colors group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-gray-900 group-hover:text-primary-700 truncate">
                          {p.firstName}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {new Date(p.nextAppointmentDate!).toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                        daysUntil === 0 ? 'bg-red-100 text-red-700' :
                        daysUntil <= 3 ? 'bg-orange-100 text-orange-700' :
                        daysUntil <= 7 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {daysUntil === 0 ? 'Heute' : `${daysUntil}d`}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
