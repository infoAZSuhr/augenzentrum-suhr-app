import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, RefreshCw, Search } from 'lucide-react'

const LIRIS_URL = 'https://vip.liris.ch/'

/**
 * Eingebettetes Liris-Fenster. Nur in Electron sinnvoll — im Browser kann
 * eine fremde Domain nicht in einem iframe gesteuert werden (CORS/COOP).
 *
 * Funktion: PID aus dem Query-String wird automatisch in das Liris-
 * Suchfeld ("Allgemeine Suche") geschrieben und mit Enter abgeschickt.
 *
 * Aufruf z.B. via `/liris?pid=12345` aus der Recall-Liste.
 */
export default function LirisPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const pid = params.get('pid')?.trim() ?? ''
  const webviewRef = useRef<HTMLElement | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [manualPid, setManualPid] = useState(pid)
  const [lastSent, setLastSent] = useState<string | null>(null)

  // True wenn wir in der Electron-Hülle laufen. Im Browser greift CORS und
  // wir koennen das eingebettete Liris nicht steuern -> Fallback-UI.
  const isElectron = typeof window !== 'undefined' && /Electron/i.test(navigator.userAgent)

  /** Fuellt PID in das Liris-Suchfeld + drueckt Enter. Wird im Kontext der
   *  eingebetteten Liris-Seite ausgefuehrt — kein CORS-Problem in Electron-
   *  webview, weil das eine echte Browser-Instanz mit eigenem Sicherheits-
   *  Modell ist (wie ein zweiter Tab). */
  function sendToLiris(value: string) {
    if (!value) return
    if (!webviewRef.current) return
    const wv = webviewRef.current as any
    if (!wv.executeJavaScript) {
      console.warn('[Liris] webview noch nicht bereit')
      return
    }
    // Wir suchen das Suchfeld via Placeholder-Prefix. Setzen value, feuern
    // input + change Events (React/Angular/Vue brauchen das, sonst merken
    // sie den value-Change nicht), dann Enter via KeyboardEvent.
    const script = `
      (function() {
        var sel = 'input[placeholder^="Allgemeine Suche"]';
        var el = document.querySelector(sel);
        if (!el) return 'no-input-found';
        // React-friendly: set via the native value setter, sonst sieht React
        // den Change nicht (es vergleicht intern den letzten value).
        var proto = Object.getPrototypeOf(el);
        var setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
        if (setter) setter.call(el, ${JSON.stringify(value)});
        else el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.focus();
        // Enter simulieren — manche Apps wollen keypress, manche keydown
        ['keydown','keypress','keyup'].forEach(function(t) {
          el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        });
        return 'ok';
      })();
    `
    wv.executeJavaScript(script).then((res: string) => {
      console.log('[Liris] sendToLiris result:', res)
      setLastSent(value)
    }).catch((err: any) => {
      console.warn('[Liris] sendToLiris error:', err?.message ?? err)
    })
  }

  // Auto-fill sobald die webview fertig geladen hat und eine PID gegeben ist.
  useEffect(() => {
    if (!isElectron || !pid || !isReady) return
    // Kleiner Delay, damit Liris seine eigenen Components rendern kann
    const t = setTimeout(() => sendToLiris(pid), 800)
    return () => clearTimeout(t)
  }, [isElectron, pid, isReady])

  // Webview-Events: dom-ready feuert wenn der DOM bereit ist
  useEffect(() => {
    const wv = webviewRef.current as any
    if (!wv || !isElectron) return
    const onReady = () => setIsReady(true)
    const onLoad  = () => setIsReady(true)
    wv.addEventListener('dom-ready',                      onReady)
    wv.addEventListener('did-finish-load',                onLoad)
    return () => {
      wv.removeEventListener('dom-ready',       onReady)
      wv.removeEventListener('did-finish-load', onLoad)
    }
  }, [isElectron])

  function handleManualSearch() {
    const v = manualPid.trim()
    if (!v) return
    sendToLiris(v)
  }

  function handleReload() {
    const wv = webviewRef.current as any
    if (wv?.reload) wv.reload()
  }

  // ── Browser-Fallback ────────────────────────────────────────────────────
  if (!isElectron) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" title="Zurück">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-base font-semibold text-gray-900">Liris</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="max-w-md space-y-3">
            <p className="text-sm text-gray-600">
              Die Liris-Einbettung funktioniert nur in der <strong>Desktop-App</strong>.
              Im Browser blockieren Cross-Origin-Regeln die Auto-Übertragung der PID.
            </p>
            <a
              href={LIRIS_URL + (pid ? `?pid=${encodeURIComponent(pid)}` : '')}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Liris in neuem Tab öffnen
            </a>
            {pid && (
              <p className="text-xs text-gray-400">
                PID <span className="font-mono text-gray-600">{pid}</span> wurde mitgegeben — in der Desktop-App würde sie automatisch eingefügt.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Electron: eingebettetes Liris-Fenster ───────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" title="Zurück">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-sm font-semibold text-gray-900 mr-2">Liris</h1>
        {/* Manueller PID-Sender — wenn die Auto-Übertragung nicht griff */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            value={manualPid}
            onChange={e => setManualPid(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleManualSearch() }}
            placeholder="PID zur Liris-Suche…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300"
          />
        </div>
        <button
          onClick={handleManualSearch}
          disabled={!manualPid.trim()}
          className="px-3 py-1.5 text-xs font-semibold bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
        >
          Senden
        </button>
        <button
          onClick={handleReload}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          title="Liris neu laden"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        {lastSent && (
          <span className="text-[11px] text-gray-400 italic">zuletzt: {lastSent}</span>
        )}
      </div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <webview
        ref={webviewRef as any}
        src={LIRIS_URL}
        // partition: persistente Session -> Login bleibt erhalten
        partition="persist:liris"
        className="flex-1 w-full h-full"
        allowpopups="true"
      />
    </div>
  )
}
