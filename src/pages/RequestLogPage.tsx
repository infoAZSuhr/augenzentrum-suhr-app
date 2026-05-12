import { useAuth } from '../lib/AuthContext'
import RequestLogContent from '../components/RequestLogContent'
import BackButton from '../components/ui/BackButton'

export default function RequestLogPage() {
  const { isAdmin, isGeschaeftsleitung } = useAuth()

  if (!isAdmin && !isGeschaeftsleitung) {
    return <div className="p-6 text-center text-gray-500">Kein Zugriff.</div>
  }

  return (
    <div className="p-3 sm:p-6 w-full max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Antragsprotokoll</h1>
          <p className="text-sm text-gray-500 mt-0.5">Alle Anträge — vollständige Aufzeichnung</p>
        </div>
        <BackButton />
      </div>
      <RequestLogContent isAdmin={isAdmin} />
    </div>
  )
}
