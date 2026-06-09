import { useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, verifyBeforeUpdateEmail } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { Mail, LogOut, CheckCircle2 } from 'lucide-react'
import { auth, db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'

/**
 * Forced-Screen: Admin hat `mustSetRealEmail` gesetzt, weil der Auth-Account
 * mit einer fiktiven E-Mail registriert wurde. User muss hier eine echte
 * Adresse + sein aktuelles Passwort eingeben. Firebase sendet eine
 * Verifizierungs-Mail an die neue Adresse — sobald der Link geklickt wird,
 * wechselt die Auth-Identitaet. Beim naechsten Login synct der Self-Heal in
 * AuthContext `authEmail` nach und entfernt das Flag automatisch.
 */
export default function ForceSetEmailPage() {
  const { profile, logout, refreshProfile } = useAuth()
  const [newEmail, setNewEmail] = useState('')
  const [pw,       setPw]       = useState('')
  const [error,    setError]    = useState('')
  const [saving,   setSaving]   = useState(false)
  const [sent,     setSent]     = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const trimmed = newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Bitte eine gültige E-Mail eingeben.'); return
    }
    if (!pw) { setError('Bitte aktuelles Passwort eingeben.'); return }
    setSaving(true)
    try {
      const user = auth.currentUser
      if (!user || !user.email) throw new Error('no user')
      const cred = EmailAuthProvider.credential(user.email, pw)
      await reauthenticateWithCredential(user, cred)
      await verifyBeforeUpdateEmail(user, trimmed)
      if (profile) {
        await updateDoc(doc(db, 'users', profile.uid), { email: trimmed })
        await refreshProfile()
      }
      setSent(true)
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') setError('Aktuelles Passwort falsch.')
      else if (code === 'auth/email-already-in-use') setError('Diese E-Mail wird bereits verwendet.')
      else if (code === 'auth/invalid-email') setError('Ungültige E-Mail-Adresse.')
      else setError('Fehler beim Senden der Verifizierungs-Mail.')
    } finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-amber-500 rounded-2xl mb-4 shadow-lg">
            <Mail className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">E-Mail hinterlegen</h1>
          <p className="text-sm text-gray-500 mt-1">
            Hallo {profile?.username || profile?.displayName} — bitte eine erreichbare E-Mail eingeben.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          {sent ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
              <p className="text-sm text-gray-700">
                Verifizierungs-Mail an <strong>{newEmail.trim().toLowerCase()}</strong> versandt.
              </p>
              <p className="text-xs text-gray-500 leading-relaxed">
                Bitte öffnen Sie die Mailbox, klicken Sie auf den Bestätigungs-Link, und melden Sie sich danach
                erneut an. Erst nach dem Klick wechselt der Login auf die neue E-Mail.
              </p>
              <button onClick={logout}
                className="w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors">
                Abmelden &amp; neu einloggen
              </button>
            </div>
          ) : (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
                <p className="text-sm text-amber-800 font-medium">Echte E-Mail erforderlich</p>
                <p className="text-xs text-amber-700 mt-0.5 leading-snug">
                  Ihr Konto wurde ohne erreichbare E-Mail-Adresse angelegt. Damit Sie z.B. ein Passwort
                  zurücksetzen können, hinterlegen Sie bitte jetzt eine echte Adresse.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Neue E-Mail</label>
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                    className="input" placeholder="name@beispiel.ch" required autoFocus autoComplete="off" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Aktuelles Passwort (Bestätigung)</label>
                  <input type="password" value={pw} onChange={e => setPw(e.target.value)}
                    className="input" required autoComplete="current-password" />
                </div>
                {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
                <button type="submit" disabled={saving}
                  className="w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-700 disabled:opacity-50
                    text-white text-sm font-semibold rounded-xl transition-colors">
                  {saving ? 'Wird versandt…' : 'Verifizierungs-Mail senden'}
                </button>
              </form>
            </>
          )}
        </div>

        <button onClick={logout}
          className="mt-4 flex items-center gap-2 mx-auto text-xs text-gray-400 hover:text-gray-600 transition-colors">
          <LogOut className="w-3.5 h-3.5" /> Abmelden
        </button>
      </div>
    </div>
  )
}
