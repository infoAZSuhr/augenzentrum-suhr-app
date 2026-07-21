import { AlertTriangle, X, GripHorizontal } from 'lucide-react'
import { useDraggable } from '../../hooks/useDraggable'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useAutoFocus } from '../../hooks/useAutoFocus'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  isLoading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Löschen',
  danger = true,
  isLoading = false,
  onConfirm,
  onCancel,
}: Props) {
  const { style: dragStyle, onHeaderMouseDown } = useDraggable()
  const confirmRef = useAutoFocus<HTMLButtonElement>(!isLoading)
  useEscapeKey(onCancel, !isLoading)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
        style={dragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 cursor-grab select-none" onMouseDown={onHeaderMouseDown}>
          <GripHorizontal className="w-4 h-4 text-gray-300 mt-1 flex-shrink-0" />
          <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${danger ? 'bg-red-100' : 'bg-yellow-100'}`}>
            <AlertTriangle className={`w-5 h-5 ${danger ? 'text-red-600' : 'text-yellow-600'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-500 mt-1 whitespace-pre-line">{message}</p>
          </div>
          <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-3 mt-6 justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="btn-secondary"
          >
            Abbrechen
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {isLoading ? 'Bitte warten…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
