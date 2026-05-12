import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { KeyRound, Eye, EyeOff, LogOut } from 'lucide-react'

export default function ForceChangePasswordPage() {
  const { changePassword, logout, profile } = useAuth()
  const [pw,     setPw]     = useState('')
  const [pw2,    setPw2]    = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (pw.length < 6) { setError('Passwort muss mindestens 6 Zeichen haben.'); return }
    if (pw !== pw2)    { setError('Passwörter stimmen nicht überein.'); return }
    setSaving(true)
    try {
      await changePassword(pw)
    } catch {
      setError('Fehler beim Ändern des Passworts. Bitte erneut einloggen.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-amber-500 rounded-2xl mb-4 shadow-lg">
            <KeyRound className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Passwort ändern</h1>
          <p className="text-sm text-gray-500 mt-1">
            Hallo {profile?.username || profile?.displayName} — bitte legen Sie ein neues Passwort fest.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
            <p className="text-sm text-amber-800 font-medium">Provisorisches Passwort</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Ihr Konto wurde mit einem temporären Passwort versehen. Bitte wählen Sie jetzt ein persönliches Passwort.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Neues Passwort</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  className="input pr-10"
                  placeholder="Mindestens 6 Zeichen"
                  required autoFocus
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Passwort bestätigen</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={pw2}
                onChange={e => setPw2(e.target.value)}
                className="input"
                placeholder="Wiederholen"
                required
              />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <button type="submit" disabled={saving}
              className="w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-700 disabled:opacity-50
                text-white text-sm font-semibold rounded-xl transition-colors">
              {saving ? 'Wird gespeichert…' : 'Passwort festlegen'}
            </button>
          </form>
        </div>

        <button onClick={logout}
          className="mt-4 flex items-center gap-2 mx-auto text-xs text-gray-400 hover:text-gray-600 transition-colors">
          <LogOut className="w-3.5 h-3.5" /> Abmelden
        </button>
      </div>
    </div>
  )
}
