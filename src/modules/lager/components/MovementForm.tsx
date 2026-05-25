import { useForm } from 'react-hook-form'
import { X } from 'lucide-react'
import type { InventoryLot } from '../../../types/inventory.types'
import { useEscapeKey } from '../../../hooks/useEscapeKey'

interface FormValues {
  movementType: 'Eingang' | 'Abgang' | 'Korrektur'
  lotId: string
  quantity: number
  reason: string
}

interface Props {
  articleName: string
  unit: string
  lots: InventoryLot[]
  onClose: () => void
  onSubmit: (data: { lotId: string; movementType: string; quantityDelta: number; reason: string }) => void
  isLoading?: boolean
}

export default function MovementForm({ articleName, unit, lots, onClose, onSubmit, isLoading }: Props) {
  const { register, handleSubmit, watch } = useForm<FormValues>({
    defaultValues: {
      movementType: 'Abgang',
      reason: 'Verbrauch',
      quantity: 1,
      lotId: lots[0]?.id || '',
    },
  })
  useEscapeKey(onClose)

  const movType = watch('movementType')

  const onSubmitForm = (data: FormValues) => {
    const delta = data.movementType === 'Eingang' ? data.quantity : -data.quantity
    onSubmit({ lotId: data.lotId, movementType: data.movementType, quantityDelta: delta, reason: data.reason })
  }

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Buchung — {articleName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit(onSubmitForm)} className="p-6 space-y-4">
          <div>
            <label className="label">Buchungstyp</label>
            <div className="flex gap-2">
              {(['Eingang', 'Abgang', 'Korrektur'] as const).map(t => (
                <label key={t} className={`flex-1 text-center py-2 rounded-lg border-2 text-sm font-medium cursor-pointer transition-colors ${
                  movType === t ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'
                }`}>
                  <input type="radio" value={t} {...register('movementType')} className="sr-only" />
                  {t}
                </label>
              ))}
            </div>
          </div>
          {lots.length > 0 && (
            <div>
              <label className="label">Lot</label>
              <select className="input" {...register('lotId')}>
                {lots.map(l => (
                  <option key={l.id} value={l.id}>{l.lotNumber} ({l.quantity} {unit})</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Menge ({unit}) *</label>
              <input type="number" className="input" min={1} {...register('quantity', { valueAsNumber: true, required: true })} />
            </div>
            <div>
              <label className="label">Grund</label>
              <input className="input" {...register('reason')} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? 'Buchen…' : 'Buchen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
