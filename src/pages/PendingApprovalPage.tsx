import { Clock, LogOut } from 'lucide-react'
import { useAuth } from '../lib/AuthContext'

export default function PendingApprovalPage() {
  const { profile, logout } = useAuth()

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-2xl mb-5">
          <Clock className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Konto wird geprüft</h1>
        <p className="text-sm text-gray-500 mb-1">
          Hallo <strong>{profile?.displayName}</strong>,
        </p>
        <p className="text-sm text-gray-500 mb-6">
          Ihr Konto wartet auf die Freigabe durch einen Administrator.
          Sie erhalten Zugriff, sobald Ihr Konto freigeschaltet wurde.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-left">
          <p className="text-xs font-semibold text-amber-700 mb-1">Ihr Konto</p>
          <p className="text-xs text-amber-800">{profile?.email}</p>
          <p className="text-xs text-amber-800 capitalize">Funktion: {profile?.role === 'mpa' ? 'MPA' : profile?.role === 'arzt' ? 'Arzt/Ärztin' : profile?.role}</p>
        </div>
        <button onClick={logout}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600
            bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
          <LogOut className="w-4 h-4" /> Abmelden
        </button>
      </div>
    </div>
  )
}
