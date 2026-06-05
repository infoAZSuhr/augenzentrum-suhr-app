import { useRef, useState, useEffect, useCallback } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw, X, Globe, Copy, Check, GripVertical } from 'lucide-react'
import { useBrowser } from '../../contexts/BrowserContext'
import { useAuth } from '../../lib/AuthContext'

export default function BrowserPanel() {
  const { isOpen, close, selectedText, setSelectedText, defaultUrl, pendingPid, clearPendingPid } = useBrowser()
  const { user } = useAuth()
  const partition = user?.uid ? `persist:liris-${user.uid}` : 'persist:liris-guest'
  const [inputUrl, setInputUrl] = useState(defaultUrl)
  const [currentUrl, setCurrentUrl] = useState(defaultUrl)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [width, setWidth] = useState(480)
  const webviewRef   = useRef<HTMLElement>(null)
  const resizeRef    = useRef<{ startX: number; startW: number } | null>(null)
  const webviewReady = useRef(false)   // true sobald dom-ready einmal gefeuert hat

  const navigate = useCallback((target: string) => {
    let url = target.trim()
    if (!url) return
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }
    setCurrentUrl(url)
    setInputUrl(url)
  }, [])

  // Inject selection listener into webview after page loads
  useEffect(() => {
    if (!isOpen) return
    const wv = webviewRef.current as any
    if (!wv) return

    const onDomReady = () => {
      setLoading(false)
      webviewReady.current = true
      // Inject a listener that sends selected text via console.log (intercepted by host)
      wv.executeJavaScript(`
        if (!window.__azSelInject) {
          window.__azSelInject = true;
          document.addEventListener('mouseup', function() {
            const t = window.getSelection().toString().trim();
            if (t.length > 1 && t.length < 500) {
              console.log('__AZ_SEL__:' + t);
            }
          });
          document.addEventListener('dragstart', function(e) {
            const t = window.getSelection().toString().trim();
            if (t) {
              e.dataTransfer.setData('text/plain', t);
              console.log('__AZ_DRAG__:' + t);
            }
          });
        }
      `).catch(() => {})
    }

    const onConsole = (e: any) => {
      const msg = e.message || ''
      if (msg.startsWith('__AZ_SEL__:') || msg.startsWith('__AZ_DRAG__:')) {
        const text = msg.replace(/^__AZ_(SEL|DRAG)__:/, '')
        setSelectedText(text)
      }
    }

    const onDidNavigate = (e: any) => {
      if (e.url) setInputUrl(e.url)
      setLoading(false)
    }

    const onLoadStart = () => setLoading(true)
    const onLoadStop  = () => setLoading(false)

    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('console-message', onConsole)
    wv.addEventListener('did-navigate', onDidNavigate)
    wv.addEventListener('did-navigate-in-page', onDidNavigate)
    wv.addEventListener('did-start-loading', onLoadStart)
    wv.addEventListener('did-stop-loading', onLoadStop)

    return () => {
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('console-message', onConsole)
      wv.removeEventListener('did-navigate', onDidNavigate)
      wv.removeEventListener('did-navigate-in-page', onDidNavigate)
      wv.removeEventListener('did-start-loading', onLoadStart)
      wv.removeEventListener('did-stop-loading', onLoadStop)
    }
  }, [isOpen, setSelectedText])

  // PID-Injection: feuert jedes Mal wenn pendingPid sich ändert.
  // Funktioniert auch wenn das Panel schon offen ist (dom-ready feuert dann nicht mehr).
  useEffect(() => {
    if (!pendingPid || !isOpen) return

    const pid = pendingPid
    // Fokus VOR der Injection merken, damit wir ihn danach zurueckgeben koennen.
    // Typischerweise ist das ein Input im "Patient bearbeiten"-Modal, das offen
    // war als der User auf "-> Liris" klickte. Wenn nichts fokussiert war
    // (z.B. ueber Tabellen-Klick aufgerufen), nehmen wir document.body als Fallback.
    const previouslyFocused = document.activeElement as HTMLElement | null
    const restoreFocus = () => {
      // Webview im Panel zuerst blurren — sonst kann der Browser den Focus
      // im Webview halten, auch wenn wir ein anderes Element fokussieren.
      const wv = webviewRef.current as any
      if (wv?.blur) wv.blur()
      if (previouslyFocused && document.contains(previouslyFocused)) {
        try { previouslyFocused.focus() } catch { /* ignore */ }
      }
    }

    const doInject = () => {
      const wv = webviewRef.current as any
      if (!wv?.executeJavaScript) return
      const script = `
        (function() {
          var sel = 'input[placeholder^="Allgemeine Suche"]';
          var el = document.querySelector(sel);
          if (!el) return 'no-input-found';
          var proto = Object.getPrototypeOf(el);
          var desc = Object.getOwnPropertyDescriptor(proto, 'value');
          var setter = desc && desc.set;
          if (setter) setter.call(el, ${JSON.stringify(pid)});
          else el.value = ${JSON.stringify(pid)};
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.focus();

          // Autocomplete-Dropdown abwarten und ersten Treffer auswaehlen.
          // Liris laedt die Vorschlaege per AJAX -> kurz warten.
          function selectFirst() {
            // 1) Versuch: sichtbares Dropdown-Item finden und klicken.
            var itemSelectors = [
              '.ui-autocomplete li:first-child a',
              '.ui-autocomplete li:first-child',
              '.autocomplete-suggestion',
              '.dropdown-menu li:first-child a',
              '.dropdown-menu li:first-child',
              '[role="option"]',
              '.tt-suggestion',
              'ul.typeahead li:first-child'
            ];
            for (var i = 0; i < itemSelectors.length; i++) {
              var item = document.querySelector(itemSelectors[i]);
              if (item && item.offsetParent !== null) {
                item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                item.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
                item.click();
                return 'clicked';
              }
            }
            // 2) Fallback: Pfeil-runter + Enter im Suchfeld (Keyboard-Navigation).
            ['keydown','keyup'].forEach(function(t) {
              el.dispatchEvent(new KeyboardEvent(t, {
                key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true
              }));
            });
            ['keydown','keypress','keyup'].forEach(function(t) {
              el.dispatchEvent(new KeyboardEvent(t, {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
              }));
            });
            return 'keyboard';
          }

          // Mehrere Versuche, falls das Dropdown langsam laedt.
          var tries = 0;
          var iv = setInterval(function() {
            tries++;
            var res = selectFirst();
            if (res === 'clicked' || tries >= 6) clearInterval(iv);
          }, 350);

          return 'ok';
        })();
      `
      wv.executeJavaScript(script)
        .then((res: string) => {
          if (res === 'ok' || res === 'no-input-found') clearPendingPid()
          // Nach kurzer Verzoegerung (Liris muss die Auswahl uebernehmen +
          // ggf. die Detail-Ansicht rendern, sonst klauen wir uns selbst
          // den Fokus zurueck waehrend Liris noch arbeitet) Fokus zurueck
          // ins Hauptfenster setzen — typischerweise ins zuletzt aktive
          // Input-Feld des Patient-bearbeiten-Modals.
          setTimeout(restoreFocus, 700)
        })
        .catch(() => {})
    }

    if (webviewReady.current) {
      // Webview bereits geladen — sofort injizieren
      const t = setTimeout(doInject, 300)
      return () => clearTimeout(t)
    }

    // Webview lädt noch oder wurde noch nicht gemountet —
    // dom-ready abwarten. Guard NACH dem dom-ready-Event, nicht vorher.
    const onReady = () => {
      webviewReady.current = true
      setTimeout(doInject, 800)
    }

    // Webview-Element könnte noch nicht im DOM sein wenn isOpen soeben true wurde.
    // Polling bis das Ref gesetzt ist, dann Listener registrieren.
    let wv = webviewRef.current as any
    if (wv) {
      wv.addEventListener('dom-ready', onReady)
      return () => wv.removeEventListener('dom-ready', onReady)
    }

    // Ref noch null — kurz warten und nochmal versuchen
    const t = setTimeout(() => {
      wv = webviewRef.current as any
      if (wv) wv.addEventListener('dom-ready', onReady)
    }, 50)
    return () => {
      clearTimeout(t)
      const w = webviewRef.current as any
      if (w) w.removeEventListener('dom-ready', onReady)
    }
  }, [pendingPid, isOpen, clearPendingPid])

  // Resize panel by dragging the grip
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startW: width }
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const delta = resizeRef.current.startX - ev.clientX
      const newW = Math.max(300, Math.min(900, resizeRef.current.startW + delta))
      setWidth(newW)
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const copyToClipboard = () => {
    if (!selectedText) return
    navigator.clipboard.writeText(selectedText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (!isOpen) return null

  return (
    <div
      className="flex flex-row flex-shrink-0 border-l border-gray-200 bg-white relative"
      style={{ width }}
    >
      {/* Resize grip */}
      <div
        className="absolute left-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize z-10 hover:bg-primary-50 group"
        onMouseDown={onResizeMouseDown}
      >
        <GripVertical className="w-3 h-3 text-gray-300 group-hover:text-primary-400" />
      </div>

      {/* Panel content */}
      <div className="flex flex-col flex-1 pl-3 min-w-0">

        {/* URL bar */}
        <div className="flex items-center gap-1 px-2 py-2 border-b border-gray-200 bg-gray-50 shrink-0">
          <button
            onClick={() => (webviewRef.current as any)?.goBack()}
            className="p-1.5 rounded hover:bg-gray-200 transition-colors"
            title="Zurück"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-gray-600" />
          </button>
          <button
            onClick={() => (webviewRef.current as any)?.goForward()}
            className="p-1.5 rounded hover:bg-gray-200 transition-colors"
            title="Vorwärts"
          >
            <ArrowRight className="w-3.5 h-3.5 text-gray-600" />
          </button>
          <button
            onClick={() => (webviewRef.current as any)?.reload()}
            className="p-1.5 rounded hover:bg-gray-200 transition-colors"
            title="Neu laden"
          >
            <RotateCcw className={`w-3.5 h-3.5 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <form
            className="flex-1 flex min-w-0"
            onSubmit={e => { e.preventDefault(); navigate(inputUrl) }}
          >
            <input
              value={inputUrl}
              onChange={e => setInputUrl(e.target.value)}
              placeholder="URL eingeben…"
              className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:border-primary-400 bg-white"
            />
          </form>

          <button
            onClick={close}
            className="p-1.5 rounded hover:bg-red-50 hover:text-red-500 transition-colors ml-1"
            title="Browser schliessen"
          >
            <X className="w-3.5 h-3.5 text-gray-500" />
          </button>
        </div>

        {/* Selected text bar */}
        {selectedText ? (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border-b border-blue-100 shrink-0">
            <Globe className="w-3 h-3 text-blue-500 flex-shrink-0" />
            <span className="text-xs text-blue-700 flex-1 truncate">
              <span className="font-semibold">Ausgewählt:</span> {selectedText}
            </span>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium flex-shrink-0"
              title="In Zwischenablage kopieren"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
            <button
              onClick={() => setSelectedText('')}
              className="text-blue-400 hover:text-blue-600 flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100 shrink-0">
            <span className="text-xs text-gray-400">
              Text auf der Website markieren → auf ein Formularfeld ziehen
            </span>
          </div>
        )}

        {/* Webview — partition ist pro User, damit Liris-Logins nicht geteilt werden */}
        {/* @ts-ignore */}
        <webview
          ref={webviewRef as any}
          src={currentUrl}
          partition={partition}
          className="flex-1 w-full"
          allowpopups="true"
          disablewebsecurity="false"
          style={{ minHeight: 0 }}
        />
      </div>
    </div>
  )
}
