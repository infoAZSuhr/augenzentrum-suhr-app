import { useForm } from 'react-hook-form'
import { X, GripHorizontal } from 'lucide-react'
import type { Supplier } from '../../../lib/firestoreLager'
import { useDraggable } from '../../../hooks/useDraggable'

type FormData = Omit<Supplier, 'id'>

interface Props {
  initial?: Supplier
  onClose: () => void
  onSubmit: (data: FormData) => void
  isLoading?: boolean
}

export default function SupplierForm({ initial, onClose, onSubmit, isLoading }: Props) {
  const { style: dragStyle, onHeaderMouseDown } = useDraggable()
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      name: initial?.name ?? '',
      contact: initial?.contact ?? '',
      phone: initial?.phone ?? '',
      email: initial?.email ?? '',
      website: initial?.website ?? '',
      address: initial?.address ?? '',
      notes: initial?.notes ?? '',
    },
  })

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" style={dragStyle}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 cursor-grab select-none" onMouseDown={onHeaderMouseDown}>
          <div className="flex items-center gap-2">
            <GripHorizontal className="w-4 h-4 text-gray-300" />
            <h2 className="font-semibold text-gray-900">{initial ? 'Lieferant bearbeiten' : 'Neuer Lieferant'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          <div>
            <label className="label">Firmenname *</label>
            <input className={`input ${errors.name ? 'border-red-400' : ''}`}
              {...register('name', { required: 'Name ist erforderlich' })} />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Kontaktperson</label>
              <input className="input" {...register('contact')} />
            </div>
            <div>
              <label className="label">Telefon</label>
              <input className="input" type="tel" {...register('phone')} />
            </div>
          </div>
          <div>
            <label className="label">E-Mail</label>
            <input className="input" type="email" {...register('email')} />
          </div>
          <div>
            <label className="label">Website</label>
            <input className="input" type="url" placeholder="https://..." {...register('website')} />
          </div>
          <div>
            <label className="label">Adresse</label>
            <input className="input" {...register('address')} placeholder="Strasse, PLZ Ort" />
          </div>
          <div>
            <label className="label">Notizen</label>
            <textarea className="input" rows={2} {...register('notes')} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? 'Speichern…' : 'Lieferant speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
