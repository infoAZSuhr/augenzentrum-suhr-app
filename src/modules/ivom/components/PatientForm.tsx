import { useForm } from 'react-hook-form'
import { X, GripHorizontal } from 'lucide-react'
import type { Patient } from '../../../types/ivom.types'
import { useDraggable } from '../../../hooks/useDraggable'
import { useEscapeKey } from '../../../hooks/useEscapeKey'

const DIAGNOSEN = [
  'AMD (Altersbedingte Makuladegeneration)',
  'CNV (Choroidale Neovaskularisation)',
  'DMÖ (Diabetisches Makulaödem)',
  'RVV (Retinale Venenverschluss)',
  'RAV (Retinaler Arterienverschluss)',
  'Myopische CNV',
  'Diabetische Retinopathie',
  'Zentrale seröse Chorioretinopathie',
  'Andere',
]

type FormData = Omit<Patient, 'id'>

interface Props {
  initial?: Partial<FormData>
  onClose: () => void
  onSubmit: (data: FormData) => void
  isLoading?: boolean
}

// Helper: make an input accept drag & drop text from the webview
function droppableProps(onDrop: (text: string) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      ;(e.currentTarget as HTMLElement).classList.add('ring-2', 'ring-primary-400', 'bg-primary-50')
    },
    onDragLeave: (e: React.DragEvent) => {
      ;(e.currentTarget as HTMLElement).classList.remove('ring-2', 'ring-primary-400', 'bg-primary-50')
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).classList.remove('ring-2', 'ring-primary-400', 'bg-primary-50')
      const text = e.dataTransfer.getData('text/plain').trim()
      if (text) onDrop(text)
    },
  }
}

export default function PatientForm({ initial, onClose, onSubmit, isLoading }: Props) {
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormData>({
    defaultValues: { status: 'aktiv', ...initial },
  })
  const { style: dragStyle, onHeaderMouseDown } = useDraggable()
  useEscapeKey(onClose)

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={dragStyle}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 cursor-grab select-none" onMouseDown={onHeaderMouseDown}>
          <div className="flex items-center gap-2">
            <GripHorizontal className="w-4 h-4 text-gray-300" />
            <h2 className="font-semibold text-gray-900">{initial?.firstName ? 'Patient bearbeiten' : 'Neuer Patient'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        {/* Drag hint */}
        <div className="mx-6 mt-4 px-3 py-2 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-600">
          💡 Text aus dem Browser-Panel direkt auf ein Feld ziehen um es zu befüllen
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">

          {/* ID ganz oben */}
          <div>
            <label className="label">ID</label>
            <input
              className="input transition-all"
              placeholder="z.B. P-1001"
              {...register('patientNumber')}
              {...droppableProps(t => setValue('patientNumber', t))}
            />
          </div>

          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Nachname *</label>
              <input
                className="input transition-all"
                {...register('lastName', { required: true })}
                {...droppableProps(t => setValue('lastName', t))}
              />
              {errors.lastName && <p className="text-xs text-red-500 mt-1">Pflichtfeld</p>}
            </div>
            <div>
              <label className="label">Vorname *</label>
              <input
                className="input transition-all"
                {...register('firstName', { required: true })}
                {...droppableProps(t => setValue('firstName', t))}
              />
              {errors.firstName && <p className="text-xs text-red-500 mt-1">Pflichtfeld</p>}
            </div>
          </div>

          {/* Geburtsdatum */}
          <div>
            <label className="label">Geburtsdatum *</label>
            <input
              type="date"
              className="input transition-all"
              {...register('dateOfBirth', { required: true })}
              {...droppableProps(t => {
                // Try to parse common Swiss date formats: DD.MM.YYYY or YYYY-MM-DD
                let iso = t
                const swiss = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
                if (swiss) iso = `${swiss[3]}-${swiss[2].padStart(2,'0')}-${swiss[1].padStart(2,'0')}`
                setValue('dateOfBirth', iso)
              })}
            />
            {errors.dateOfBirth && <p className="text-xs text-red-500 mt-1">Pflichtfeld</p>}
          </div>

          {/* Diagnosen */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Diagnose OD (rechts)</label>
              <select className="input" {...register('diagnosisOd')}>
                <option value="">— Auswählen —</option>
                {DIAGNOSEN.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Diagnose OS (links)</label>
              <select className="input" {...register('diagnosisOs')}>
                <option value="">— Auswählen —</option>
                {DIAGNOSEN.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* Allergie */}
          <div>
            <label className="label">Allergie</label>
            <input
              className="input transition-all"
              placeholder="z.B. Penicillin, Jod, keine"
              {...register('allergies')}
              {...droppableProps(t => setValue('allergies', t))}
            />
          </div>

          {/* Notizen */}
          <div>
            <label className="label">Notizen</label>
            <textarea
              className="input transition-all"
              rows={3}
              {...register('notes')}
              {...droppableProps(t => setValue('notes', t))}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? 'Speichern…' : initial?.firstName ? 'Änderungen speichern' : 'Patient speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
