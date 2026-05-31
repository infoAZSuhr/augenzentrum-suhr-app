import { ReactNode } from 'react'
import { Glossarized } from './Glossarized'

interface Props {
  title: string
  subtitle?: string | ReactNode
  actions?: ReactNode
}

export default function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-200 bg-white">
      <div>
        <Glossarized as="h1" className="text-lg sm:text-xl font-semibold text-gray-900">
          {title}
        </Glossarized>
        {subtitle && (
          typeof subtitle === 'string'
            ? <Glossarized as="p" className="text-sm text-gray-500 mt-0.5">{subtitle}</Glossarized>
            : <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}
