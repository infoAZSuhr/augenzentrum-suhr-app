import { LucideIcon } from 'lucide-react'
import { cn } from '../../utils/cn'

interface Props {
  label: string
  value: string | number
  icon: LucideIcon
  color?: 'blue' | 'green' | 'yellow' | 'red'
  sub?: string
}

const colors = {
  blue:   { bg: 'bg-blue-50',   icon: 'text-blue-600',   val: 'text-blue-700' },
  green:  { bg: 'bg-green-50',  icon: 'text-green-600',  val: 'text-green-700' },
  yellow: { bg: 'bg-yellow-50', icon: 'text-yellow-600', val: 'text-yellow-700' },
  red:    { bg: 'bg-red-50',    icon: 'text-red-600',    val: 'text-red-700' },
}

export default function StatCard({ label, value, icon: Icon, color = 'blue', sub }: Props) {
  const c = colors[color]
  return (
    <div className="card p-5 flex items-start gap-4">
      <div className={cn('p-2 rounded-lg', c.bg)}>
        <Icon className={cn('w-5 h-5', c.icon)} />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className={cn('text-2xl font-bold', c.val)}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
