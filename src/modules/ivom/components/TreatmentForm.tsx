import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, UserPlus, CalendarDays, GripHorizontal } from 'lucide-react'
import { getDoctors, addDoctor, getPatient, subscribeIviDaysFromPlanung } from '../../../lib/firestorePatients'
import { getArticles, getArticleLots } from '../../../lib/firestoreLager'
import { today, addWeeks } from '../../../utils/dateUtils'
import { useDraggable } from '../../../hooks/useDraggable'
import { useEscapeKey } from '../../../hooks/useEscapeKey'

const INTERVALLE = [4, 6, 8, 10, 12, 16, 24]

export interface TreatmentFormValues {
  patientId: string
  treatmentDate: string
  eyeSide: 'OD' | 'OS'
  inventoryArticleId: string
  medicationName: string
  inventoryLotId: string
  lotNumber: string
  setArticleId: string
  setName: string
  setLotId: string
  setLotNumber: string
  octFindings: string
  nextAppointment: string
  nextIntervalWeeks: number | undefined
  erstesOctDatum: string
  kontrolldatum: string
  kontrolldatumAmSpritztag: boolean
  performedBy: string
  notes: string
  behandlungsStatus: 'aktiv' | 'pausiert' | 'abgeschlossen'
}

interface Props {
  patientId: string
  onClose: () => void
  onSubmit: (data: TreatmentFormValues) => void
  isLoading?: boolean
  initial?: Partial<TreatmentFormValues>
  firstTreatmentForEyes?: { OD: boolean; OS: boolean }
}

export default function TreatmentForm({ patientId, onClose, onSubmit, isLoading, initial, firstTreatmentForEyes }: Props) {
  const [neuerArzt, setNeuerArzt] = useState(false)
  const { style: dragStyle, onHeaderMouseDown } = useDraggable()
  useEscapeKey(onClose)
  const [neuerArztName, setNeuerArztName] = useState('')
  const qc = useQueryClient()

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => getPatient(patientId),
    enabled: !!patientId,
  })

  const { data: medArticles = [] } = useQuery({
    queryKey: ['inventory_articles', 'Medikament'],
    queryFn: () => getArticles({ category: 'Medikament' }),
  })

  const { data: setArticles = [] } = useQuery({
    queryKey: ['inventory_articles', 'Verbrauchsmaterial'],
    queryFn: () => getArticles({ category: 'Verbrauchsmaterial' }),
  })

  const [planIviDays, setPlanIviDays] = useState<string[]>([])
  useEffect(() => subscribeIviDaysFromPlanung(setPlanIviDays), [])

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<TreatmentFormValues>({
    defaultValues: {
      patientId, treatmentDate: today(), eyeSide: 'OD',
      behandlungsStatus: 'aktiv',
      inventoryArticleId: '', medicationName: '', inventoryLotId: '', lotNumber: '',
      setArticleId: '', setName: '', setLotId: '', setLotNumber: '',
      erstesOctDatum: '',
      kontrolldatum: '',
      kontrolldatumAmSpritztag: false,
      ...initial,
    },
  })

  const selectedArticleId = watch('inventoryArticleId')
  const selectedSetArticleId = watch('setArticleId')
  const treatmentDate = watch('treatmentDate')
  const selectedLotId = watch('inventoryLotId')
  const selectedSetLotId = watch('setLotId')

  /** Returns up to `count` IVI days from the Planung closest to (and >= ) the approx date */
  function closestIVIDays(approx: string, count = 3): string[] {
    const future = planIviDays.filter(d => d >= approx)
    if (future.length > 0) return future.slice(0, count)
    // fallback: last known days
    return planIviDays.slice(-count)
  }

  const { data: medLots = [] } = useQuery({
    queryKey: ['inventory_lots', selectedArticleId],
    queryFn: () => getArticleLots(selectedArticleId),
    enabled: !!selectedArticleId,
  })

  const { data: setLots = [] } = useQuery({
    queryKey: ['inventory_lots', selectedSetArticleId],
    queryFn: () => getArticleLots(selectedSetArticleId),
    enabled: !!selectedSetArticleId,
  })

  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: getDoctors })

  const addDoctorMut = useMutation({
    mutationFn: (name: string) => addDoctor(name),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ['doctors'] })
      setValue('performedBy', doc.name)
      setNeuerArzt(false)
      setNeuerArztName('')
    },
  })

  const handleArticleChange = (id: string) => {
    const art = medArticles.find(a => a.id === id)
    setValue('inventoryArticleId', id)
    setValue('medicationName', art?.name || '')
    setValue('inventoryLotId', '')
    setValue('lotNumber', '')
  }

  const handleLotChange = (id: string) => {
    const lot = medLots.find(l => l.id === id)
    setValue('inventoryLotId', id)
    setValue('lotNumber', lot?.lotNumber || '')
  }

  const handleSetArticleChange = (id: string) => {
    const art = setArticles.find(a => a.id === id)
    setValue('setArticleId', id)
    setValue('setName', art?.name || '')
    setValue('setLotId', '')
    setValue('setLotNumber', '')
  }

  const handleSetLotChange = (id: string) => {
    const lot = setLots.find(l => l.id === id)
    setValue('setLotId', id)
    setValue('setLotNumber', lot?.lotNumber || '')
  }

  const handleIntervall = (weeks: number) => {
    setValue('nextIntervalWeeks', weeks)
    if (treatmentDate) {
      const approx = addWeeks(treatmentDate, weeks)
      const options = closestIVIDays(approx)
      setValue('nextAppointment', options[0] ?? approx)
    }
  }

  const nextIntervalWeeks = watch('nextIntervalWeeks')
  const nextAppointment = watch('nextAppointment')
  const eyeSide = watch('eyeSide')
  const behandlungsStatus = watch('behandlungsStatus')
  const performedBy = watch('performedBy')

  const STATUS_OPTIONS = [
    { value: 'aktiv',        label: 'Aktiv',        color: 'bg-green-500 border-green-500' },
    { value: 'pausiert',     label: 'Pausiert',     color: 'bg-yellow-500 border-yellow-500' },
    { value: 'abgeschlossen',label: 'Abgeschlossen',color: 'bg-gray-500 border-gray-500' },
  ] as const

  const LotSelect = ({ lots, value, onChange, error }: { lots: any[], value: string, onChange: (id: string) => void, error?: string }) => (
    <>
      {lots.length === 0
        ? <p className="text-sm text-amber-600 italic py-1">Keine Chargen vorhanden</p>
        : <select className={`input ${error ? 'border-red-400' : ''}`} value={value} onChange={e => onChange(e.target.value)}>
            <option value="">— Charge auswählen —</option>
            {lots.map(l => (
              <option key={l.id} value={l.id}>
                {l.lotNumber}
                {l.expiryDate ? ` · Ablauf: ${new Date(l.expiryDate).toLocaleDateString('de-CH')}` : ''}
                {l.quantity !== undefined ? ` · Bestand: ${l.quantity}` : ''}
              </option>
            ))}
          </select>
      }
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </>
  )


  // Artikel nach treatmentCategory gruppieren (IVI zuerst, dann alphabetisch)
  function groupByCategory<T extends { treatmentCategory?: string | string[]; name: string }>(articles: T[]) {
    const groups: Record<string, T[]> = {}
    for (const a of articles) {
      const cats = Array.isArray(a.treatmentCategory)
        ? (a.treatmentCategory.length > 0 ? a.treatmentCategory : ['Sonstige'])
        : [a.treatmentCategory || 'Sonstige']
      for (const cat of cats) {
        if (!groups[cat]) groups[cat] = []
        groups[cat].push(a)
      }
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'IVI') return -1
      if (b === 'IVI') return 1
      if (a === 'Sonstige') return 1
      if (b === 'Sonstige') return -1
      return a.localeCompare(b)
    })
  }

  const medGroups = groupByCategory(medArticles)
  const setGroups = groupByCategory(setArticles)

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]" style={dragStyle}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0 cursor-grab select-none" onMouseDown={onHeaderMouseDown}>
          <div className="flex items-center gap-2">
            <GripHorizontal className="w-4 h-4 text-gray-300" />
            <h2 className="font-semibold text-gray-900">{initial?.treatmentDate ? 'Behandlung bearbeiten' : 'Neue Behandlung'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5 overflow-y-auto flex-1">

          {/* Patienteninfo */}
          {patient && (
            <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-primary-700">
                  {patient.firstName[0]}{patient.lastName[0]}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{patient.lastName}, {patient.firstName}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  {patient.patientNumber && (
                    <span className="text-xs text-gray-500">ID: <span className="font-medium text-gray-700">{patient.patientNumber}</span></span>
                  )}
                  {patient.dateOfBirth && (
                    <span className="text-xs text-gray-500">Geb.: <span className="font-medium text-gray-700">{new Date(patient.dateOfBirth).toLocaleDateString('de-CH')}</span></span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Datum + Auge */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Datum *</label>
              <input type="date" className="input" {...register('treatmentDate', { required: true })} />
            </div>
            <div>
              <label className="label">Auge *</label>
              <div className="flex gap-2">
                {(['OD', 'OS'] as const).map(eye => (
                  <button key={eye} type="button" onClick={() => setValue('eyeSide', eye)}
                    className={`flex-1 py-2 rounded-lg font-bold text-sm border-2 transition-colors ${
                      eyeSide === eye
                        ? eye === 'OD' ? 'bg-orange-500 border-orange-500 text-white' : 'bg-blue-500 border-blue-500 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                    }`}>
                    {eye} ({eye === 'OD' ? 'rechts' : 'links'})
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Medikament ── */}
          <div className="border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Medikament</p>
            <div>
              <label className="label">Artikel *</label>
              <select className={`input ${errors.inventoryArticleId ? 'border-red-400' : ''}`}
                value={selectedArticleId} onChange={e => handleArticleChange(e.target.value)}>
                <option value="">— Medikament auswählen —</option>
                {medGroups.map(([cat, arts]) => (
                  <optgroup key={cat} label={cat}>
                    {arts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}{a.currentStock !== undefined ? ` (${a.currentStock} ${a.quantityUnit || a.unit})` : ''}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <input type="hidden" {...register('inventoryArticleId', { required: 'Medikament erforderlich' })} />
              {errors.inventoryArticleId && <p className="text-xs text-red-500 mt-1">{errors.inventoryArticleId.message}</p>}
            </div>
            <div>
              <label className="label">Charge / Lot-Nr. *</label>
              {!selectedArticleId
                ? <p className="text-sm text-gray-400 italic py-1">Bitte zuerst Medikament auswählen</p>
                : <LotSelect lots={medLots} value={selectedLotId} onChange={handleLotChange} error={errors.inventoryLotId?.message} />
              }
              <input type="hidden" {...register('inventoryLotId', { required: 'Charge erforderlich' })} />
            </div>
          </div>

          {/* ── Set ── */}
          <div className="border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Set / Verbrauchsmaterial</p>
            <div>
              <label className="label">Set-Artikel *</label>
              <select className={`input ${errors.setArticleId ? 'border-red-400' : ''}`}
                value={selectedSetArticleId} onChange={e => handleSetArticleChange(e.target.value)}>
                <option value="">— Set auswählen —</option>
                {setGroups.map(([cat, arts]) => (
                  <optgroup key={cat} label={cat}>
                    {arts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}{a.currentStock !== undefined ? ` (${a.currentStock} ${a.quantityUnit || a.unit})` : ''}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <input type="hidden" {...register('setArticleId', { required: 'Set erforderlich' })} />
              {errors.setArticleId && <p className="text-xs text-red-500 mt-1">{errors.setArticleId.message}</p>}
            </div>
            <div>
              <label className="label">Set Charge / Lot-Nr. *</label>
              {!selectedSetArticleId
                ? <p className="text-sm text-gray-400 italic py-1">Bitte zuerst Set auswählen</p>
                : <LotSelect lots={setLots} value={selectedSetLotId} onChange={handleSetLotChange} error={errors.setLotId?.message} />
              }
              <input type="hidden" {...register('setLotId', { required: 'Set-Charge erforderlich' })} />
            </div>
          </div>

          {/* OCT Befund */}
          <div>
            <label className="label">OCT-Befund</label>
            <textarea className="input" rows={2} {...register('octFindings')} />
          </div>

          {/* Durchgeführt von */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Durchgeführt von *</label>
              <button type="button" onClick={() => setNeuerArzt(!neuerArzt)}
                className="text-xs text-primary-600 hover:underline flex items-center gap-1">
                <UserPlus className="w-3 h-3" /> Neuer Arzt
              </button>
            </div>
            {neuerArzt ? (
              <div className="flex gap-2">
                <input className="input" placeholder="Name des Arztes" value={neuerArztName}
                  onChange={e => setNeuerArztName(e.target.value)} />
                <button type="button" className="btn-primary whitespace-nowrap"
                  disabled={!neuerArztName || addDoctorMut.isPending}
                  onClick={() => addDoctorMut.mutate(neuerArztName)}>
                  {addDoctorMut.isPending ? '…' : 'Speichern'}
                </button>
              </div>
            ) : (
              <select className={`input ${errors.performedBy ? 'border-red-400' : ''}`}
                value={performedBy || ''} onChange={e => setValue('performedBy', e.target.value)}>
                <option value="">— Arzt auswählen —</option>
                {doctors.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            )}
            <input type="hidden" {...register('performedBy', { required: 'Durchgeführt von erforderlich' })} />
            {errors.performedBy && <p className="text-xs text-red-500 mt-1">{errors.performedBy.message}</p>}
          </div>

          {/* Nächster Termin */}
          <div>
            <label className="label mb-2">Nächster Termin *</label>
            <div className="space-y-3">
              {/* Intervall-Buttons */}
              <div className="flex flex-wrap gap-2">
                {INTERVALLE.map(w => (
                  <button key={w} type="button" onClick={() => handleIntervall(w)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                      nextIntervalWeeks === w
                        ? 'bg-primary-600 border-primary-600 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-primary-400'
                    }`}>
                    {w} W
                  </button>
                ))}
              </div>

              {/* IVI-Termin-Optionen aus Einsatzplanung */}
              {nextIntervalWeeks && treatmentDate && (() => {
                const approx = addWeeks(treatmentDate, nextIntervalWeeks)
                const options = closestIVIDays(approx)
                return (
                  <div className="space-y-1.5">
                    <p className="text-xs text-primary-600 flex items-center gap-1">
                      <CalendarDays className="w-3.5 h-3.5" />
                      IVI-Tage aus Einsatzplanung — Datum auswählen:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {options.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Keine IVI-Tage in der Einsatzplanung gefunden</p>
                      ) : options.map(dateStr => {
                        const weeks = Math.round((new Date(dateStr).getTime() - new Date(treatmentDate).getTime()) / (7 * 86400000))
                        return (
                          <button key={dateStr} type="button"
                            onClick={() => setValue('nextAppointment', dateStr)}
                            title={`${weeks} Wochen`}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                              nextAppointment === dateStr
                                ? 'bg-primary-600 border-primary-600 text-white'
                                : 'bg-white border-gray-200 text-gray-700 hover:border-primary-400'
                            }`}>
                            {new Date(dateStr).toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Manuelles Datum */}
            <div className="flex items-center gap-2 mt-2">
              <input
                type="date"
                className="input flex-1"
                value={nextAppointment || ''}
                onChange={e => setValue('nextAppointment', e.target.value, { shouldValidate: true })}
              />
              {nextAppointment && (
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {new Date(nextAppointment).toLocaleDateString('de-CH', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              )}
            </div>

            <input type="hidden" {...register('nextAppointment', { required: 'Nächster Termin erforderlich' })} />
            {errors.nextAppointment && <p className="text-xs text-red-500 mt-1">{errors.nextAppointment.message}</p>}
          </div>

          {/* Erstes OCT-Datum — nur bei erster Injektion pro Auge */}
          {firstTreatmentForEyes?.[eyeSide] && (
            <div>
              <label className="label">Initiales OCT-Datum (vor 1. Injektion)</label>
              <input type="date" className="input" {...register('erstesOctDatum')} />
              <p className="text-xs text-gray-400 mt-1">OCT-Befund vor der ersten Injektion dieses Auges</p>
            </div>
          )}

          {/* Kontrolltermin */}
          <div>
            <label className="label">Kontrolltermin (OCT / Nachkontrolle)</label>
            <input type="date" className="input mb-2" {...register('kontrolldatum')} />
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <input
                type="checkbox"
                className="w-4 h-4 rounded accent-primary-600"
                {...register('kontrolldatumAmSpritztag')}
                onChange={e => {
                  setValue('kontrolldatumAmSpritztag', e.target.checked)
                  if (e.target.checked) setValue('kontrolldatum', watch('treatmentDate'))
                }}
              />
              <span className="text-sm text-gray-700">Kein separater Kontrolltermin gewünscht</span>
            </label>
          </div>

          {/* Behandlungsstatus */}
          <div>
            <label className="label">Behandlungsstatus</label>
            <div className="flex gap-2">
              {STATUS_OPTIONS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setValue('behandlungsStatus', opt.value)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                    behandlungsStatus === opt.value
                      ? `${opt.color} text-white`
                      : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notizen */}
          <div>
            <label className="label">Notizen</label>
            <textarea className="input" rows={2} {...register('notes')} />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? 'Speichern…' : initial?.treatmentDate ? 'Änderungen speichern' : 'Behandlung speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
