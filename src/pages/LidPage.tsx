import { Construction } from 'lucide-react'

export default function LidPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col items-center justify-center h-48 gap-4 text-gray-400">
        <Construction className="w-12 h-12" />
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-600">Lid-Chirurgie</p>
          <p className="text-sm">Dieser Bereich wird noch entwickelt.</p>
        </div>
      </div>
    </div>
  )
}
