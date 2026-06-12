import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { Eye, EyeOff, X, KeyRound, Check, MessageSquare } from 'lucide-react'
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { UserProfile } from '../lib/AuthContext'

const CONTACT_TOPICS = [
  { value: 'login', label: 'Loginanfrage' },
  { value: 'other', label: 'Andere' },
] as const

export default function LoginPage() {
  const { login } = useAuth()

  // Login
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  // Passwort vergessen
  const [showReset,    setShowReset]    = useState(false)
  const [resetUser,    setResetUser]    = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError,   setResetError]   = useState('')
  const [resetSuccess, setResetSuccess] = useState(false)

  // Admin kontaktieren
  const [showContact,    setShowContact]    = useState(false)
  const [contactTopic,   setContactTopic]   = useState<'login'|'other'>('login')
  const [contactName,    setContactName]    = useState('')
  const [contactEmail,   setContactEmail]   = useState('')
  const [contactNote,    setContactNote]    = useState('')
  const [contactLoading, setContactLoading] = useState(false)
  const [contactError,   setContactError]   = useState('')
  const [contactSuccess, setContactSuccess] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username.trim(), password)
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/too-many-requests') {
        setError('Zu viele Fehlversuche — Konto gesperrt. Bitte Administrator kontaktieren.')
      } else if (code === 'auth/user-not-found') {
        setError('Benutzername nicht gefunden.')
      } else {
        setError('Benutzername oder Passwort falsch.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetError('')
    setResetLoading(true)
    try {
      // Resolve username → email
      const q = query(collection(db, 'users'), where('username', '==', resetUser.trim()))
      const snap = await getDocs(q)
      if (snap.empty) {
        setResetError('Benutzername nicht gefunden.')
        setResetLoading(false)
        return
      }
      const email = (snap.docs[0].data() as UserProfile).email
      await addDoc(collection(db, 'passwordResetRequests'), {
        email,
        username: resetUser.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
      })
      setResetSuccess(true)
    } catch {
      setResetError('Anfrage konnte nicht gesendet werden. Bitte Administrator direkt kontaktieren.')
    } finally {
      setResetLoading(false)
    }
  }

  const closeReset = () => {
    setShowReset(false)
    setResetUser('')
    setResetError('')
    setResetSuccess(false)
  }

  const SPAM_KEY = 'adminMsg_lastSent'
  const COOLDOWN_MS = 10 * 60 * 1000 // 10 Minuten

  const handleContact = async (e: React.FormEvent) => {
    e.preventDefault()
    setContactError('')

    if (contactTopic === 'login' && !contactEmail.trim()) {
      setContactError('Bitte geben Sie Ihre E-Mail-Adresse ein.')
      return
    }

    const lastSent = Number(localStorage.getItem(SPAM_KEY) ?? 0)
    const remaining = COOLDOWN_MS - (Date.now() - lastSent)
    if (remaining > 0) {
      const mins = Math.ceil(remaining / 60000)
      setContactError(`Bitte warten Sie noch ${mins} Minute${mins !== 1 ? 'n' : ''} bevor Sie eine weitere Nachricht senden.`)
      return
    }

    setContactLoading(true)
    try {
      await addDoc(collection(db, 'adminMessages'), {
        topic: contactTopic,
        senderName: contactName.trim(),
        ...(contactTopic === 'login' && { email: contactEmail.trim() }),
        note: contactNote.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
      })
      localStorage.setItem(SPAM_KEY, String(Date.now()))
      setContactSuccess(true)
    } catch {
      setContactError('Nachricht konnte nicht gesendet werden. Bitte nochmals versuchen.')
    } finally {
      setContactLoading(false)
    }
  }

  const closeContact = () => {
    setShowContact(false)
    setContactTopic('login')
    setContactName('')
    setContactEmail('')
    setContactNote('')
    setContactError('')
    setContactSuccess(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Augenzentrum Suhr" className="h-32 w-auto mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">Augenzentrum Suhr</h1>
          <p className="text-sm text-gray-500 mt-1">Praxis-Management</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-5">Anmelden</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Benutzername</label>
              <input
                type="text"
                className="input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="benutzername"
                required
                autoFocus
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Passwort</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input pr-10"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-700 disabled:opacity-50
                text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {loading ? 'Anmelden…' : 'Anmelden'}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => { setShowReset(true); setResetUser(username) }}
                className="text-xs text-gray-400 hover:text-primary-600 hover:underline transition-colors"
              >
                Passwort vergessen?
              </button>
            </div>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          Kein Konto?{' '}
          <button
            onClick={() => setShowContact(true)}
            className="text-primary-600 hover:text-primary-700 hover:underline font-medium"
          >
            Administrator kontaktieren
          </button>
        </p>

        {/* Entwickler-Credit */}
        <p className="mt-6 text-center text-[10px] text-gray-300">
          © {new Date().getFullYear()} Saran Pasquale · Entwicklung
        </p>
      </div>

      {/* Passwort vergessen Modal */}
      {showReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-primary-600" />
                <h2 className="text-base font-semibold text-gray-900">Passwort vergessen</h2>
              </div>
              <button onClick={closeReset} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5">
              {resetSuccess ? (
                <div className="text-center space-y-3">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <Check className="w-6 h-6 text-green-600" />
                  </div>
                  <p className="text-sm font-medium text-gray-800">Anfrage gesendet</p>
                  <p className="text-xs text-gray-500">
                    Der Administrator wurde benachrichtigt und wird ein neues Passwort einrichten.
                  </p>
                  <button onClick={closeReset}
                    className="w-full mt-2 py-2 px-4 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors">
                    Schliessen
                  </button>
                </div>
              ) : (
                <form onSubmit={handleReset} className="space-y-4">
                  <p className="text-sm text-gray-500">
                    Benutzername eingeben — der Administrator wird benachrichtigt und ein neues Passwort einrichten.
                  </p>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Benutzername</label>
                    <input
                      type="text"
                      className="input"
                      value={resetUser}
                      onChange={e => setResetUser(e.target.value)}
                      placeholder="benutzername"
                      required
                      autoFocus
                    />
                  </div>
                  {resetError && (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {resetError}
                    </p>
                  )}
                  <div className="flex gap-3">
                    <button type="button" onClick={closeReset}
                      className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                      Abbrechen
                    </button>
                    <button type="submit" disabled={resetLoading}
                      className="flex-1 py-2 px-4 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
                      {resetLoading ? 'Senden…' : 'Anfrage senden'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin kontaktieren Modal */}
      {showContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary-600" />
                <h2 className="text-base font-semibold text-gray-900">Administrator kontaktieren</h2>
              </div>
              <button onClick={closeContact} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5">
              {contactSuccess ? (
                <div className="text-center space-y-3">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <Check className="w-6 h-6 text-green-600" />
                  </div>
                  <p className="text-sm font-medium text-gray-800">Nachricht gesendet</p>
                  <p className="text-xs text-gray-500">
                    Der Administrator wurde benachrichtigt und wird sich um Ihr Anliegen kümmern.
                  </p>
                  <button onClick={closeContact}
                    className="w-full mt-2 py-2 px-4 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors">
                    Schliessen
                  </button>
                </div>
              ) : (
                <form onSubmit={handleContact} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Ihr Name (optional)</label>
                    <input
                      type="text"
                      className="input"
                      value={contactName}
                      onChange={e => setContactName(e.target.value)}
                      placeholder="Vor- und Nachname"
                    />
                  </div>

                  {contactTopic === 'login' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Ihre E-Mail *</label>
                      <input
                        type="email"
                        className="input"
                        value={contactEmail}
                        onChange={e => setContactEmail(e.target.value)}
                        placeholder="name@beispiel.ch"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Anliegen</label>
                    <div className="space-y-2">
                      {CONTACT_TOPICS.map(t => (
                        <label key={t.value} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                          contactTopic === t.value
                            ? 'border-primary-400 bg-primary-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}>
                          <input
                            type="radio"
                            name="topic"
                            value={t.value}
                            checked={contactTopic === t.value}
                            onChange={() => setContactTopic(t.value)}
                            className="accent-primary-600"
                          />
                          <span className="text-sm text-gray-700">{t.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {contactTopic === 'other' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Nachricht *</label>
                      <textarea
                        className="input resize-none"
                        rows={3}
                        value={contactNote}
                        onChange={e => setContactNote(e.target.value)}
                        placeholder="Bitte beschreiben Sie Ihr Anliegen…"
                        required
                      />
                    </div>
                  )}

                  {contactError && (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {contactError}
                    </p>
                  )}

                  <div className="flex gap-3">
                    <button type="button" onClick={closeContact}
                      className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                      Abbrechen
                    </button>
                    <button type="submit" disabled={contactLoading}
                      className="flex-1 py-2 px-4 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
                      {contactLoading ? 'Senden…' : 'Senden'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
