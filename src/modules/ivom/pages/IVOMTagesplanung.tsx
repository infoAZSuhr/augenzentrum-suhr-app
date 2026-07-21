import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Syringe, Package, AlertTriangle, Stethoscope, Plus, Printer, ShieldAlert, Search, Pencil, CalendarClock, Check, X } from 'lucide-react'
import { getIviDayPlan, createTreatment, getPatient } from '../../../lib/firestorePatients'
import { getArticleStocks, getArticleUnits } from '../../../lib/firestoreLager'
import { subscribePlanung, type PlanungData } from '../../../lib/firestorePlanung'
import { buildArztVerfuegbarkeit } from '../../../lib/iviPlanLogic'
import type { IviDayPlanEntry, IviDayPlan } from '../../../lib/firestorePatients'
import TreatmentForm, { type TreatmentFormValues } from '../components/TreatmentForm'
import PatientForm from '../components/PatientForm'
import IVIOverlayModal from '../components/IVIOverlayModal'
import type { Treatment, Patient } from '../../../types/ivom.types'
import { useToast } from '../../../lib/ToastContext'
import { useBrowser } from '../../../contexts/BrowserContext'
import { updatePatient } from '../../../lib/firestorePatients'

const WORKING_CODES = new Set(['GT', 'VM', 'NM', 'W', 'NFD'])
const CODE_LABEL: Record<string, string> = {
  GT: 'Ganztag', VM: 'Vormittag', NM: 'Nachmittag', W: 'Weiterbildung', NFD: 'Notfalldienst',
}
const CODE_COLOR: Record<string, string> = {
  GT: 'bg-green-100 text-green-700',
  VM: 'bg-blue-100 text-blue-700',
  NM: 'bg-orange-100 text-orange-700',
  W:  'bg-purple-100 text-purple-700',
  NFD: 'bg-red-100 text-red-700',
}

function countBy(entries: IviDayPlanEntry[], key: (e: IviDayPlanEntry) => string | undefined): { label: string; count: number }[] {
  const map = new Map<string, number>()
  for (const e of entries) {
    const k = key(e)
    if (!k) continue
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

// Build running balance: articleId → date → balance after that day's consumption
function buildRunningBalance(
  plan: IviDayPlan[],
  stockMap: Map<string, number>
): Map<string, Map<string, number>> {
  // Collect per-article per-day usage (plan is already sorted by date)
  const usage = new Map<string, Map<string, number>>() // articleId → date → count
  for (const day of plan) {
    for (const e of day.entries) {
      for (const artId of [e.medicationArticleId, e.setArticleId]) {
        if (!artId) continue
        if (!usage.has(artId)) usage.set(artId, new Map())
        const dayMap = usage.get(artId)!
        dayMap.set(day.date, (dayMap.get(day.date) ?? 0) + 1)
      }
    }
  }

  // Compute running balance per article
  const result = new Map<string, Map<string, number>>()
  for (const [artId, dayMap] of usage) {
    const stock = stockMap.get(artId) ?? 0
    let balance = stock
    const balanceMap = new Map<string, number>()
    for (const day of plan) {
      const consumed = dayMap.get(day.date) ?? 0
      if (consumed > 0) {
        balance -= consumed
        balanceMap.set(day.date, balance)
      }
    }
    result.set(artId, balanceMap)
  }
  return result
}

export default function IVOMTagesplanung() {
  const [planung, setPlanung] = useState<PlanungData | null>(null)
  const [formEntry, setFormEntry] = useState<(IviDayPlanEntry & { iviDate: string }) | null>(null)
  const [editPatientData, setEditPatientData] = useState<Patient | null>(null)
  const [showOverlay, setShowOverlay] = useState(false)
  const year = new Date().getFullYear()
  const qc = useQueryClient()
  const toast = useToast()
  const { openWithPid, open: openLiris } = useBrowser()

  useEffect(() => {
    if ((window as any).electronApp) openLiris()
  }, [])

  const [planungNext, setPlanungNext] = useState<PlanungData | null>(null)
  useEffect(() => {
    const unsub1 = subscribePlanung(year, data => {
      setPlanung(data)
      qc.invalidateQueries({ queryKey: ['ivi-day-plan'] })
    })
    const unsub2 = subscribePlanung(year + 1, data => {
      setPlanungNext(data)
      qc.invalidateQueries({ queryKey: ['ivi-day-plan'] })
    })
    return () => { unsub1(); unsub2() }
  }, [year])

  // «Wer wäre da?» — Arzt-Verfügbarkeit für die Planung kommender IVI-Tage.
  const [showVerfuegbar, setShowVerfuegbar] = useState(false)
  const verfuegbarkeit = useMemo(
    () => buildArztVerfuegbarkeit([planung, planungNext], new Date().toISOString().slice(0, 10)),
    [planung, planungNext],
  )

  const createMut = useMutation({
    mutationFn: async (data: TreatmentFormValues) => {
      await createTreatment(data as unknown as Omit<Treatment, 'id'>)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ivi-day-plan'] })
      qc.invalidateQueries({ queryKey: ['patients'] })
      setFormEntry(null)
    },
    onError: (err: any) => toast.error('Fehler: ' + err.message),
  })

  const { data: iviPlan = [], isLoading: planLoading } = useQuery({
    queryKey: ['ivi-day-plan'],
    queryFn: getIviDayPlan,
  })

  const allArticleIds = useMemo(() => {
    const ids = new Set<string>()
    for (const day of iviPlan) {
      for (const e of day.entries) {
        if (e.medicationArticleId) ids.add(e.medicationArticleId)
        if (e.setArticleId) ids.add(e.setArticleId)
      }
    }
    return [...ids]
  }, [iviPlan])

  const { data: stockMap = new Map<string, number>() } = useQuery({
    queryKey: ['article-stocks', allArticleIds],
    queryFn: () => getArticleStocks(allArticleIds),
    enabled: allArticleIds.length > 0,
  })

  const { data: unitMap = new Map<string, string>() } = useQuery({
    queryKey: ['article-units', allArticleIds],
    queryFn: () => getArticleUnits(allArticleIds),
    enabled: allArticleIds.length > 0,
  })

  // Running balance per article per day
  const runningBalance = useMemo(
    () => buildRunningBalance(iviPlan, stockMap),
    [iviPlan, stockMap]
  )

  // Get balance for an article on a specific day (undefined = no stock data)
  const getBalance = (articleId: string | undefined, date: string) => {
    if (!articleId || !runningBalance.has(articleId)) return undefined
    return runningBalance.get(articleId)!.get(date)
  }

  const getDoctors = (date: string) => {
    if (!planung) return []
    return (planung.sections[0]?.persons ?? []).flatMap(p => {
      const code = planung.schedule[p]?.[date]
      return code && WORKING_CODES.has(code) ? [{ name: p, code }] : []
    })
  }

  if (planLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-400" />
        <span className="text-sm">IVI-Tagesplan wird geladen…</span>
      </div>
    )
  }

  if (iviPlan.length === 0) {
    return (
      <div className="p-6 text-center text-gray-400">
        <Syringe className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Keine IVI-Tage in der Einsatzplanung gefunden.</p>
        <p className="text-xs mt-1">Markus Tschopp oder Stefan Trachsler müssen als GT/VM/NM eingetragen sein.</p>
      </div>
    )
  }

  // «Aktueller» IVI-Tag = der erste nicht vergangene; nur dort sitzt der
  // Overlay-Button in der Kopfzeile.
  const heute = new Date().toISOString().slice(0, 10)
  const aktuellerTag = iviPlan.find(d => d.date >= heute)?.date ?? iviPlan[iviPlan.length - 1]?.date

  return (
    <div className="p-3 sm:p-6 space-y-4">

      {/* Planungshilfe: an welchen Tagen käme eine IVI-Konstellation zustande? */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowVerfuegbar(true)}
          title="Zeigt kommende Tage mit den IVI-Ärzten — Grundlage für die Planung neuer IVI-Tage"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-primary-700 hover:border-primary-200 transition-colors shadow-sm"
        >
          <CalendarClock className="w-3.5 h-3.5" />
          Wer wäre da?
        </button>
      </div>

      {iviPlan.map(({ date, entries }) => {
        const weekday = new Date(date + 'T12:00:00').toLocaleDateString('de-CH', { weekday: 'long' })
        const dateLabel = `${date.slice(8,10)}.${date.slice(5,7)}.${date.slice(0,4)}`
        const todayStr = new Date().toISOString().slice(0, 10)
        const isPast   = date < todayStr   // vergangener Termin, noch nicht erfasst (sonst waere er rausgefiltert)
        const meds = countBy(entries, e => e.medicationName)
        const sets = countBy(entries, e => e.setName)
        const doctors = getDoctors(date)

        const medShortage = meds.some(({ label }) => {
          const id = entries.find(e => e.medicationName === label)?.medicationArticleId
          const b = getBalance(id, date)
          return b !== undefined && b < 0
        })
        const setShortage = sets.some(({ label }) => {
          const id = entries.find(e => e.setName === label)?.setArticleId
          const b = getBalance(id, date)
          return b !== undefined && b < 0
        })
        const hasWarning = medShortage || setShortage

        return (
          <div key={date} className={`card overflow-hidden ${
            isPast ? 'border-amber-300 ring-2 ring-amber-100' :
            hasWarning ? 'border-red-200' : ''
          }`}>
            {/* Day header */}
            <div className={`px-4 py-3 border-b flex items-center justify-between ${
              isPast ? 'bg-amber-50 border-amber-100' :
              hasWarning ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'
            }`}>
              <div className="flex items-center gap-3 flex-wrap">
                <div>
                  <span className="text-xs font-bold uppercase text-gray-400 mr-2">{weekday}</span>
                  <span className="text-base font-bold text-gray-900">{dateLabel}</span>
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700">
                  {entries.length} Auge{entries.length !== 1 ? 'n' : ''}
                </span>
                {isPast && (
                  <span className="flex items-center gap-1 text-xs font-bold text-amber-700 bg-white px-2 py-0.5 rounded-full border border-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5" /> verpasst / nicht erfasst
                  </span>
                )}
                {hasWarning && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-red-600">
                    <AlertTriangle className="w-3.5 h-3.5" /> Lager prüfen
                  </span>
                )}
              </div>

              {date === aktuellerTag && (
                <button
                  onClick={() => setShowOverlay(true)}
                  title="Overlay drucken"
                  aria-label="Overlay drucken"
                  className="shrink-0 inline-flex items-center justify-center sm:gap-2 p-2 sm:px-3 sm:py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-primary-700 hover:border-primary-200 transition-colors shadow-sm"
                >
                  <Printer className="w-4 h-4 shrink-0" />
                  <span className="hidden sm:inline">Overlay drucken</span>
                </button>
              )}
            </div>

            <div className="p-4 space-y-4">
              {/* Doctors from Einsatzplanung */}
              {doctors.length > 0 && (
                <div className="flex items-start gap-2">
                  <Stethoscope className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div className="flex flex-wrap gap-2">
                    {doctors.map(({ name, code }) => (
                      <span key={name} className="flex items-center gap-1.5 text-sm">
                        <span className="font-medium text-gray-800">{name}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${CODE_COLOR[code] ?? 'bg-gray-100 text-gray-600'}`}>
                          {CODE_LABEL[code] ?? code}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {entries.length === 0 ? (
                <div className="flex items-center gap-2 py-2 text-gray-400 text-sm">
                  <Syringe className="w-4 h-4 opacity-40" />
                  <span>Noch keine Patienten geplant</span>
                </div>
              ) : (
                <>
                  {/* Medications */}
                  <div className="flex items-start gap-2">
                    <Syringe className={`w-4 h-4 mt-0.5 shrink-0 ${medShortage ? 'text-red-500' : 'text-primary-500'}`} />
                    <div className="flex flex-wrap gap-2">
                      {meds.map(({ label, count }) => {
                        const artId = entries.find(e => e.medicationName === label)?.medicationArticleId
                        const balance = getBalance(artId, date)
                        const unit = artId ? unitMap.get(artId) : undefined
                        const shortage = balance !== undefined && balance < 0
                        return (
                          <span key={label} className={`inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-lg font-medium border ${
                            shortage ? 'bg-red-50 text-red-700 border-red-200' : 'bg-primary-50 text-primary-800 border-primary-100'
                          }`}>
                            <span className="font-bold text-base leading-none">{count}×</span>
                            {label}
                            {balance !== undefined && (
                              <span className={`text-xs font-normal border-l pl-1.5 ml-0.5 ${shortage ? 'text-red-600 border-red-200' : 'text-green-600 border-primary-100'}`}>
                                Lager: {balance}{unit ? ` ${unit}` : ''}
                              </span>
                            )}
                          </span>
                        )
                      })}
                    </div>
                  </div>

                  {/* Sets / Material */}
                  {sets.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Package className={`w-4 h-4 mt-0.5 shrink-0 ${setShortage ? 'text-red-500' : 'text-gray-400'}`} />
                      <div className="flex flex-wrap gap-2">
                        {sets.map(({ label, count }) => {
                          const artId = entries.find(e => e.setName === label)?.setArticleId
                          const balance = getBalance(artId, date)
                          const unit = artId ? unitMap.get(artId) : undefined
                          const shortage = balance !== undefined && balance < 0
                          return (
                            <span key={label} className={`inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-lg font-medium border ${
                              shortage ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-700 border-gray-200'
                            }`}>
                              <span className="font-bold text-base leading-none">{count}×</span>
                              {label}
                              {balance !== undefined && (
                                <span className={`text-xs font-normal border-l pl-1.5 ml-0.5 ${shortage ? 'text-red-600 border-gray-200' : 'text-green-600 border-gray-200'}`}>
                                  Lager: {balance}{unit ? ` ${unit}` : ''}
                                </span>
                              )}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Patient list */}
                  <div className="border-t border-gray-100 pt-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 font-medium">
                          <th className="text-left pb-1.5 pr-4">Patient</th>
                          <th className="text-left pb-1.5 pr-4">Auge</th>
                          <th className="text-left pb-1.5 pr-4">Medikament</th>
                          <th className="text-left pb-1.5 pr-4">Set</th>
                          <th className="text-left pb-1.5 pr-4">Letzter Arzt</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {entries.map((e) => (
                          <tr key={`${e.id}-${e.eyeSide}`} className="hover:bg-gray-50 group">
                            <td className="py-1.5 pr-4">
                              <div className="flex items-center gap-1.5">
                                <Link to={`/ivom/${e.id}`} className="font-medium text-gray-800 hover:text-primary-700">
                                  {e.name}
                                </Link>
                                {(window as any).electronApp && e.patientNumber && (
                                  <button
                                    onClick={() => openWithPid(e.patientNumber!)}
                                    className="p-0.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                    title="In Liris öffnen"
                                  >
                                    <Search className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={async () => {
                                    const p = await getPatient(e.id)
                                    if (p) setEditPatientData(p)
                                  }}
                                  className="p-0.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                  title="Patient bearbeiten"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                {e.allergies && (
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200"
                                    title={`Allergie: ${e.allergies}`}
                                  >
                                    <ShieldAlert className="w-2.5 h-2.5" />
                                    {e.allergies}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-1.5 pr-4">
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${e.eyeSide === 'OD' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                                {e.eyeSide}
                              </span>
                            </td>
                            <td className="py-1.5 pr-4 text-gray-600">{e.medicationName}</td>
                            <td className="py-1.5 pr-4 text-gray-500">{e.setName || '—'}</td>
                            <td className="py-1.5 pr-4 text-gray-400 text-xs">{e.performedBy || '—'}</td>
                            <td className="py-1.5 text-right">
                              <button
                                onClick={() => setFormEntry({ ...e, iviDate: date })}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium"
                                title="Neue Behandlung erfassen"
                              >
                                <Plus className="w-3 h-3" /> Behandlung
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })}

      {formEntry && (
        <TreatmentForm
          patientId={formEntry.id}
          onClose={() => setFormEntry(null)}
          onSubmit={(data) => createMut.mutate(data)}
          isLoading={createMut.isPending}
          initial={{
            treatmentDate: formEntry.iviDate,
            eyeSide: formEntry.eyeSide,
            inventoryArticleId: formEntry.medicationArticleId ?? '',
            medicationName: formEntry.medicationName,
            setArticleId: formEntry.setArticleId ?? '',
            setName: formEntry.setName ?? '',
            performedBy: formEntry.performedBy ?? '',
          }}
        />
      )}

      {editPatientData && (
        <PatientForm
          initial={editPatientData as any}
          onClose={() => setEditPatientData(null)}
          onSubmit={async (data) => {
            await updatePatient(editPatientData.id, data)
            qc.invalidateQueries({ queryKey: ['ivi-day-plan'] })
            qc.invalidateQueries({ queryKey: ['patients'] })
            setEditPatientData(null)
            toast.success('Patient gespeichert')
          }}
        />
      )}

      {showVerfuegbar && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowVerfuegbar(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Wer wäre da?</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Kommende Tage mit Artemiev, Tschopp und Trachsler — Grundlage für neue IVI-Tage
                </p>
              </div>
              <button onClick={() => setShowVerfuegbar(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto">
              {verfuegbarkeit.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-gray-400">
                  Keine kommenden Einsätze dieser Ärzte in der Einsatzplanung.
                </p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {verfuegbarkeit.map(t => {
                    const wd = new Date(t.date + 'T12:00:00').toLocaleDateString('de-CH', { weekday: 'short' })
                    const dl = `${t.date.slice(8,10)}.${t.date.slice(5,7)}.${t.date.slice(0,4)}`
                    const geplant = iviPlan.some(d => d.date === t.date)
                    return (
                      <li key={t.date} className={`px-5 py-2.5 flex items-start gap-3 ${t.passend ? '' : 'opacity-60'}`}>
                        <div className="w-24 shrink-0">
                          <span className="text-xs font-bold text-gray-400 uppercase mr-1.5">{wd}</span>
                          <span className="text-sm font-semibold text-gray-800">{dl}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap gap-1.5">
                            {t.anwesend.map(a => (
                              <span key={a.name}
                                className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
                                  a.injector ? 'bg-primary-50 text-primary-700 font-semibold' : 'bg-gray-100 text-gray-600'
                                }`}>
                                {a.name.split(' ').slice(-1)[0]}
                                <span className="opacity-60">{a.code}</span>
                              </span>
                            ))}
                          </div>
                          {t.passend
                            ? <p className="text-[11px] text-green-700 mt-1">IVI möglich · {t.fenster}</p>
                            : <p className="text-[11px] text-gray-400 mt-1">
                                {t.anwesend.some(a => a.injector) ? 'kein Partner mit Überlappung' : 'Artemiev fehlt'}
                              </p>}
                        </div>
                        {geplant && (
                          <span className="shrink-0 text-[10px] font-bold text-primary-700 bg-primary-50 border border-primary-100 px-1.5 py-0.5 rounded-full">
                            geplant
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50/60 text-[11px] text-gray-500">
              «IVI möglich» heisst: Artemiev und mindestens einer der beiden Partner sind gleichzeitig da.
              Ist der eine nur vormittags und der andere nur nachmittags, zählt der Tag nicht.
            </div>
          </div>
        </div>
      )}

      {showOverlay && (
        <IVIOverlayModal
          eyeSide="OD"
          withLiris
          onClose={() => setShowOverlay(false)}
        />
      )}
    </div>
  )
}
