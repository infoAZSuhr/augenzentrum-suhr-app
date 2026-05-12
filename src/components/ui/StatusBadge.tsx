import { cn } from '../../utils/cn'

const variants = {
  aktiv:          'bg-green-100 text-green-800',
  pausiert:       'bg-yellow-100 text-yellow-800',
  abgeschlossen:  'bg-gray-100 text-gray-600',
  geplant:        'bg-blue-100 text-blue-800',
  durchgeführt:   'bg-green-100 text-green-800',
  abgesagt:       'bg-red-100 text-red-700',
  erschienen:     'bg-green-100 text-green-800',
  verschoben:     'bg-yellow-100 text-yellow-800',
  bestellt:       'bg-blue-100 text-blue-800',
  geliefert:      'bg-green-100 text-green-800',
  teilgeliefert:  'bg-yellow-100 text-yellow-800',
  ok:             'bg-green-100 text-green-800',
  low:            'bg-yellow-100 text-yellow-800',
  critical:       'bg-red-100 text-red-700',
  out:            'bg-red-200 text-red-900',
  warning:        'bg-yellow-100 text-yellow-800',
  expired:        'bg-red-200 text-red-900',
}

interface Props {
  status: keyof typeof variants
  className?: string
}

export default function StatusBadge({ status, className }: Props) {
  return (
    <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', variants[status], className)}>
      {status}
    </span>
  )
}
