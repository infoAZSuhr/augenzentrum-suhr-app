import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

interface Props {
  /** Route to navigate to when there is no browser history (e.g. page opened directly) */
  fallback?: string
  /** Button label — pass empty string to show icon only */
  label?: string
  className?: string
}

/**
 * Back button using navigate(-1) with a fallback route when
 * no history entry is available (direct URL access).
 */
export default function BackButton({ fallback = '/', label = 'Zurück', className }: Props) {
  const navigate = useNavigate()

  const goBack = () => {
    // React Router v6 stores the history index in window.history.state.idx
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) {
      navigate(-1)
    } else {
      navigate(fallback)
    }
  }

  return (
    <button
      onClick={goBack}
      className={className ?? 'btn-secondary'}
    >
      <ArrowLeft className="w-4 h-4" />
      {label && <span>{label}</span>}
    </button>
  )
}
