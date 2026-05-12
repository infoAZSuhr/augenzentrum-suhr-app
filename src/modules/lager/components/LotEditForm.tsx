import { useForm } from 'react-hook-form'
import { X, Calendar, Hash, GripHorizontal } from 'lucide-react'
import type { InventoryLot } from '../../../types/inventory.types'
import { useDraggable } from '../../../hooks/useDraggable'

interface FormValues {
  lotNumber: string
  quantity: number
  expiryDate: string
  deliveryDate: string
}

interface Props {
  lot: InventoryLot
  unit: string
  onClose: () => void
  onSubmit: (data: Partial<InventoryLot>) => void
  isLoading?: boolean
}

export default function LotEditForm({ lot, unit, onClose, onSubmit, isLoading }: Props) {
  const { style: dragStyle, onHeaderMouseDown } = useDraggable()
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      lotNumber: lot.lotNumber ?? '',
      quantity: lot.quantity ?? 1,
      expiryDate: lot.expiryDate ?? '',
      deliveryDate: lot.deliveryDate ?? '',
    },
  })

  const handleSave = (data: FormValues) => {
    onSubmit({
      lotNumber: data.lotNumber,
      quantity: Number(data.quantity),
      expiryDate: data.expiryDate || undefined,
      deliveryDate: data.deliveryDate || undefined,
      isDepleted: Number(data.quantity) <= 0,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" style={dragStyle}>

        <div className="flex items-center justify-between mb-5 cursor-grab select-none" onMouseDown={onHeaderMouseDown}>
          <div className="flex items-center gap-2">
            <GripHorizontal className="w-4 h-4 text-gray-300" />
            <h2 className="text-lg font-semibold text-gray-900">Charge bearbeiten</h2>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(handleSave)} className="space-y-4">

          {/* Charge / Lot-Nr. */}
          <div>
            <label className="label flex items-center gap-1"><Hash className="w-3.5 h-3.5" /> Charge / Lot-Nr. *</label>
            <input
              className={`input font-mono ${errors.lotNumber ? 'border-red-400' : ''}`}
              {...register('lotNumber', { required: 'Pflichtfeld' })}
            />
            {errors.lotNumber && <p className="text-xs text-red-500 mt-1">{errors.lotNumber.message}</p>}
          </div>

          {/* Menge */}
          <div>
            <label className="label">Menge ({unit}) *</label>
            <input
              type="number"
              min={0}
              className={`input ${errors.quantity ? 'border-red-400' : ''}`}
              {...register('quantity', { valueAsNumber: true, required: true, min: 0 })}
            />
            {errors.quantity && <p className="text-xs text-red-500 mt-1">Mindestens 0</p>}
          </div>

          {/* MHD + Lieferdatum */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> MHD *</label>
              <input
                type="date"
                className={`input ${errors.expiryDate ? 'border-red-400' : ''}`}
                {...register('expiryDate', { required: 'MHD erforderlich' })}
              />
              {errors.expiryDate && <p className="text-xs text-red-500 mt-1">{errors.expiryDate.message}</p>}
            </div>
            <div>
              <label className="label flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Lieferdatum</label>
              <input type="date" className="input" {...register('deliveryDate')} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isLoading}>
              Abbrechen
            </button>
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? 'Speichern…' : 'Charge speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
