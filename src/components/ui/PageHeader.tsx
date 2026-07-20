import { ReactNode } from 'react'

interface Props {
  title: string | ReactNode
  subtitle?: string | ReactNode
  actions?: ReactNode
  /** Optionales Element (z.B. <BackButton/>) vor dem Titel, in derselben Zeile. */
  back?: ReactNode
}

export default function PageHeader({ title, subtitle, actions, back }: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-200 bg-white">
      <div>
        <div className="flex items-center gap-2">
          {back}
          <h1 className="text-lg sm:text-xl font-semibold text-gray-900">{title}</h1>
        </div>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}
