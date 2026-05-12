import { useForm } from 'react-hook-form'
import { X } from 'lucide-react'
import { today } from '../../../utils/dateUtils'

interface FormValues {
  lotNumber: string
  quantity: number
  expiryDate: string
  deliveryDate: string
}

interface Props {
  articleName: string
  unit: string
  quantityPerUnit?: number
  quantityUnit?: string
  onClose: () => void
  onSubmit: (data: FormValues) => void
  isLoading?: boolean
}

export default function LotForm({ articleName, unit, quantityPerUnit, quantityUnit, onClose, onSubmit, isLoading }: Props) {
  const displayUnit = quantityUnit || unit
  const { register, handleSubmit } = useForm<FormValues>({
    defaultValues: { deliveryDate: today(), quantity: quantityPerUnit ?? 1 },
  })

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Lot einbuchen — {articleName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          <div>
            <label className="label">Charge / Lot-Nummer *</label>
            <input className="input font-mono" {...register('lotNumber', { required: true })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Menge ({displayUnit}) *</label>
              <input type="number" className="input" min={1} {...register('quantity', { valueAsNumber: true, required: true })} />
            </div>
            <div>
              <label className="label">MHD (Verfalldatum)</label>
              <input type="date" className="input" {...register('expiryDate')} />
            </div>
          </div>
          <div>
            <label className="label">Lieferdatum</label>
            <input type="date" className="input" {...register('deliveryDate')} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? 'Buchen…' : 'Einbuchen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
