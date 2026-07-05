import { useEffect } from 'react'
import { addDoc, collection } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/ToastContext'

/** Zentrale Fehlererfassung: faengt unbehandelte Fehler und Promise-
 *  Rejections ab, zeigt einen Toast (statt still zu scheitern) und schreibt
 *  einen Eintrag in die `error_log`-Collection zur spaeteren Diagnose.
 *
 *  Hintergrund: Mehrere Bugs blieben unbemerkt, weil Fehler nur in der
 *  Konsole landeten (Firestore-Speichern, mailto, Liris-Injection). Diese
 *  Komponente macht Fehler SICHTBAR und NACHVOLLZIEHBAR.
 *
 *  Rate-Limit: max. 5 Meldungen pro Minute — verhindert Toast-/Log-Spam,
 *  falls ein Fehler in einer Schleife auftritt. */
export default function GlobalErrorHandler() {
  const toast = useToast()
  const { profile } = useAuth()
  const username = profile?.displayName || profile?.username || 'unbekannt'

  useEffect(() => {
    let count = 0
    let windowStart = Date.now()

    // Bekannte harmlose Browser-Meldungen nicht rapportieren.
    const IGNORE = [
      /ResizeObserver loop/i,
      /Loading chunk .* failed/i,           // veraltete Session nach Deploy — eigener Hinweis unten
      /dynamically imported module/i,
    ]

    const report = (kind: string, message: unknown, stack?: string) => {
      const msg = String(message ?? 'Unbekannter Fehler')
      // Veraltete App-Version nach einem Deploy: klarer Hinweis statt Kryptik.
      if (/Loading chunk|dynamically imported module/i.test(msg)) {
        toast.warning('Neue App-Version verfügbar — bitte Seite neu laden (Strg+R).')
        return
      }
      if (IGNORE.some(re => re.test(msg))) return
      if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); count = 0 }
      if (++count > 5) return
      console.error('[GlobalError]', kind, msg)
      toast.error(`Unerwarteter Fehler: ${msg.slice(0, 140)}`)
      addDoc(collection(db, 'error_log'), {
        kind,
        message: msg.slice(0, 500),
        stack: String(stack ?? '').slice(0, 1500),
        url: window.location.hash || window.location.pathname,
        user: username,
        ua: navigator.userAgent.slice(0, 150),
        at: new Date().toISOString(),
      }).catch(() => { /* Logging darf nie selbst zum Fehler werden */ })
    }

    const onError = (e: ErrorEvent) => report('error', e.message, e.error?.stack)
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | undefined
      report('unhandledrejection', r?.message ?? String(e.reason), r?.stack)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [toast, username])

  return null
}
