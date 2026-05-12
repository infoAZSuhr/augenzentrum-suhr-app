import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { X, PackagePlus, PackageMinus, ScanLine, AlertTriangle, Calendar, Hash, GripHorizontal } from 'lucide-react'
import BarcodeScanner from '../../../components/ui/BarcodeScanner'
import type { InventoryLot } from '../../../types/inventory.types'
import { useDraggable } from '../../../hooks/useDraggable'
import { getPatientNames } from '../../../lib/firestorePatients'

type Modus = 'eingang' | 'ausgang'

interface EingangValues {
  lotNumber: string
  quantity: number
  expiryDate: string
  deliveryDate: string
}

interface AusgangValues {
  lotId: string
  quantity: number
  reason: string
  patientName: string
  notes: string
}

interface Props {
  articleName: string
  unit: string
  quantityPerUnit?: number
  quantityUnit?: string
  lots: InventoryLot[]
  onClose: () => void
  onEingang: (data: { lotNumber: string; quantity: number; expiryDate?: string; deliveryDate?: string }) => void
  onAusgang: (data: { lotId: string; lotNumber: string; movementType: string; quantityDelta: number; reason: string; patientName?: string; notes?: string }) => void
  isLoading?: boolean
}

function expiryInfo(dateStr?: string): { label: string; color: string; warn: boolean } {
  if (!dateStr) return { label: '—', color: 'text-gray-400', warn: false }
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
  if (days < 0)  return { label: 'Abgelaufen!', color: 'text-red-600', warn: true }
  if (days <= 30) return { label: `Läuft in ${days} Tagen ab`, color: 'text-red-500', warn: true }
  if (days <= 90) return { label: `Läuft in ${days} Tagen ab`, color: 'text-yellow-600', warn: false }
  return { label: `${days} Tage`, color: 'text-green-600', warn: false }
}

type UnitMode = 'packung' | 'menge'

export default function BookingForm({ articleName, unit, quantityPerUnit, quantityUnit, lots, onClose, onEingang, onAusgang, isLoading }: Props) {
  const [modus, setModus] = useState<Modus>(lots.length > 0 ? 'ausgang' : 'eingang')
  const [showScanner, setShowScanner] = useState(false)
  const [unitMode, setUnitMode] = useState<UnitMode>('packung')
  const { style: dragStyle, onHeaderMouseDown } = useDraggable()
  const { data: patientNames = [] } = useQuery({ queryKey: ['patient-names'], queryFn: getPatientNames })

  // Ob Umschalter angezeigt wird (nur wenn beide Einheiten definiert)
  const hasTwo = !!(quantityPerUnit && quantityPerUnit > 1 && quantityUnit)
  const activeUnit = !hasTwo ? (quantityUnit || unit) : unitMode === 'packung' ? unit : quantityUnit!

  const eingangForm = useForm<EingangValues>({
    defaultValues: { quantity: unitMode === 'packung' ? 1 : (quantityPerUnit ?? 1) },
  })

  const ausgangForm = useForm<AusgangValues>({
    defaultValues: { lotId: lots[0]?.id || '', quantity: 1, reason: 'Verbrauch', patientName: '', notes: '' },
  })

  const selectedLotId = ausgangForm.watch('lotId')
  const selectedLot = lots.find(l => l.id === selectedLotId)
  const expInfo = expiryInfo(selectedLot?.expiryDate)

  // Umrechnung: Packung → tatsächliche Menge in Mengeneinheit (fürs Speichern)
  const toActual = (entered: number) =>
    hasTwo && unitMode === 'packung' ? entered * quantityPerUnit! : entered

  // Umrechnung: gespeicherte Basismenge → angezeigte Einheit
  const toDisplay = (stored: number) =>
    hasTwo && unitMode === 'packung' ? stored / quantityPerUnit! : stored

  const maxAusgang = selectedLot ? Math.floor(toDisplay(selectedLot.quantity)) : undefined

  const handleEingang = (data: EingangValues) => {
    onEingang({
      lotNumber: data.lotNumber,
      quantity: toActual(data.quantity),
      expiryDate: data.expiryDate || undefined,
      deliveryDate: data.deliveryDate || undefined,
    })
  }

  const handleAusgang = (data: AusgangValues) => {
    onAusgang({
      lotId: data.lotId,
      lotNumber: selectedLot?.lotNumber ?? '',
      movementType: 'Abgang',
      quantityDelta: -toActual(data.quantity),
      reason: data.reason,
      patientName: data.patientName || undefined,
      notes: data.notes || undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" style={dragStyle}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 cursor-grab select-none" onMouseDown={onHeaderMouseDown}>
          <div className="flex items-center gap-2">
            <GripHorizontal className="w-4 h-4 text-gray-300" />
            <h2 className="font-semibold text-gray-900">Buchung — <span className="text-primary-700">{articleName}</span></h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        {/* Modus-Umschalter */}
        <div className="flex gap-3 px-6 pt-5">
          <button type="button" onClick={() => setModus('eingang')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${
              modus === 'eingang'
                ? 'bg-green-600 border-green-600 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-600 hover:border-green-400'
            }`}>
            <PackagePlus className="w-4 h-4" /> Einbuchen
          </button>
          <button type="button" onClick={() => setModus('ausgang')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${
              modus === 'ausgang'
                ? 'bg-red-500 border-red-500 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-600 hover:border-red-400'
            }`}>
            <PackageMinus className="w-4 h-4" /> Ausbuchen
          </button>
        </div>

        {/* Einheiten-Umschalter – nur wenn Packungseinheit + Mengeneinheit definiert */}
        {hasTwo && (
          <div className="flex gap-2 px-6 pt-3">
            <button type="button" onClick={() => { setUnitMode('packung'); eingangForm.setValue('quantity', 1); ausgangForm.setValue('quantity', 1) }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                unitMode === 'packung' ? 'bg-primary-50 border-primary-500 text-primary-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              }`}>
              {unit} <span className="opacity-60 font-normal">(= {quantityPerUnit} {quantityUnit})</span>
            </button>
            <button type="button" onClick={() => { setUnitMode('menge'); eingangForm.setValue('quantity', quantityPerUnit ?? 1); ausgangForm.setValue('quantity', quantityPerUnit ?? 1) }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                unitMode === 'menge' ? 'bg-primary-50 border-primary-500 text-primary-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              }`}>
              {quantityUnit}
            </button>
          </div>
        )}

        {/* ── EINBUCHEN ── */}
        {modus === 'eingang' && (
          <form onSubmit={eingangForm.handleSubmit(handleEingang)} className="p-6 space-y-4">

            {/* Charge / Lot-Nr. */}
            <div>
              <label className="label flex items-center gap-1"><Hash className="w-3.5 h-3.5" /> Charge / Lot-Nr. *</label>
              <div className="flex gap-2">
                <input className={`input flex-1 font-mono ${eingangForm.formState.errors.lotNumber ? 'border-red-400' : ''}`}
                  placeholder="z.B. LOT-2025-001"
                  {...eingangForm.register('lotNumber', { required: 'Pflichtfeld' })} />
                <button type="button" onClick={() => setShowScanner(true)}
                  className="btn-secondary px-3 flex items-center gap-1.5" title="Scannen">
                  <ScanLine className="w-4 h-4" />
                </button>
              </div>
              {eingangForm.formState.errors.lotNumber && (
                <p className="text-xs text-red-500 mt-1">{eingangForm.formState.errors.lotNumber.message}</p>
              )}
            </div>

            {/* Menge + MHD + Lieferdatum */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Menge ({activeUnit}) *</label>
                <input type="number" className="input" min={1}
                  {...eingangForm.register('quantity', { valueAsNumber: true, required: true, min: 1 })} />
                {hasTwo && unitMode === 'packung' && (eingangForm.watch('quantity') || 0) > 0 && (
                  <p className="text-xs text-gray-400 mt-1">= {(eingangForm.watch('quantity') || 0) * quantityPerUnit!} {quantityUnit}</p>
                )}
              </div>
              <div>
                <label className="label flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> MHD *</label>
                <input type="date" className="input"
                  {...eingangForm.register('expiryDate', { required: 'MHD ist erforderlich' })} />
                {eingangForm.formState.errors.expiryDate && (
                  <p className="text-xs text-red-500 mt-1">{eingangForm.formState.errors.expiryDate.message}</p>
                )}
              </div>
              <div>
                <label className="label flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Lieferdatum</label>
                <input type="date" className="input"
                  {...eingangForm.register('deliveryDate')} />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
              <button type="submit" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium text-sm transition-colors disabled:opacity-50" disabled={isLoading}>
                <PackagePlus className="w-4 h-4" /> {isLoading ? 'Buchen…' : 'Einbuchen'}
              </button>
            </div>
          </form>
        )}

        {/* ── AUSBUCHEN ── */}
        {modus === 'ausgang' && (
          <form onSubmit={ausgangForm.handleSubmit(handleAusgang)} className="p-6 space-y-4">

            {lots.length === 0 ? (
              <div className="text-center py-6 text-gray-400">
                <PackageMinus className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Keine aktiven Lots vorhanden.</p>
                <p className="text-xs mt-1">Bitte zuerst einbuchen.</p>
              </div>
            ) : (
              <>
                {/* Lot-Auswahl */}
                <div>
                  <label className="label flex items-center gap-1"><Hash className="w-3.5 h-3.5" /> Charge / Lot-Nr. *</label>
                  <select className="input" {...ausgangForm.register('lotId', { required: true })}>
                    {lots.map(l => {
                      const dispQty = toDisplay(l.quantity)
                      const dispQtyStr = Number.isInteger(dispQty) ? String(dispQty) : dispQty.toFixed(2)
                      return (
                        <option key={l.id} value={l.id}>
                          {l.lotNumber} — {dispQtyStr} {activeUnit}
                          {l.expiryDate ? ` · MHD: ${new Date(l.expiryDate).toLocaleDateString('de-CH')}` : ''}
                        </option>
                      )
                    })}
                  </select>
                </div>

                {/* Lot-Detailkarte */}
                {selectedLot && (
                  <div className={`rounded-lg border p-3 text-sm space-y-1.5 ${expInfo.warn ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-gray-500">{selectedLot.lotNumber}</span>
                      {expInfo.warn && <AlertTriangle className="w-4 h-4 text-red-500" />}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs text-gray-400">Restbestand</p>
                        <p className="font-semibold text-gray-800">
                          {(() => { const d = toDisplay(selectedLot.quantity); return Number.isInteger(d) ? d : d.toFixed(2) })()} {activeUnit}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">MHD</p>
                        <p className={`font-semibold ${expInfo.color}`}>
                          {selectedLot.expiryDate
                            ? new Date(selectedLot.expiryDate).toLocaleDateString('de-CH')
                            : '—'}
                        </p>
                        {selectedLot.expiryDate && <p className={`text-xs ${expInfo.color}`}>{expInfo.label}</p>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Menge + Grund */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Menge ({activeUnit}) *</label>
                    <input type="number" className="input" min={1} max={maxAusgang}
                      {...ausgangForm.register('quantity', {
                        valueAsNumber: true, required: true, min: 1,
                        max: maxAusgang,
                      })} />
                    {ausgangForm.formState.errors.quantity && (
                      <p className="text-xs text-red-500 mt-1">Max. {maxAusgang} {activeUnit}</p>
                    )}
                  </div>
                  <div>
                    <label className="label">Grund</label>
                    <select className="input" {...ausgangForm.register('reason')}>
                      <option>Verbrauch</option>
                      <option>IVOM-Behandlung</option>
                      <option>Ablauf / Entsorgung</option>
                      <option>Rückgabe</option>
                      <option>Korrektur</option>
                    </select>
                  </div>
                </div>

                {/* Patient + Notiz */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Patient (optional)</label>
                    <input className="input" placeholder="Vor- und Nachname"
                      list="patient-names-list"
                      {...ausgangForm.register('patientName')} />
                    <datalist id="patient-names-list">
                      {patientNames.map(n => <option key={n} value={n} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="label">Notiz (optional)</label>
                    <input className="input" placeholder="z.B. rechtes Auge"
                      {...ausgangForm.register('notes')} />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                  <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
                  <button type="submit" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium text-sm transition-colors disabled:opacity-50" disabled={isLoading}>
                    <PackageMinus className="w-4 h-4" /> {isLoading ? 'Buchen…' : 'Ausbuchen'}
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </div>

      {showScanner && (
        <BarcodeScanner key={Date.now()}
          onResult={(r) => {
            if (r.lot) eingangForm.setValue('lotNumber', r.lot)
            if (r.expiry) eingangForm.setValue('expiryDate', r.expiry)
            if (!r.lot) eingangForm.setValue('lotNumber', r.value)
            setShowScanner(false)
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}
