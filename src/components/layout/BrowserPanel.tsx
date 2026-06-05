import { useRef, useState, useEffect, useCallback } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw, X, GripVertical } from 'lucide-react'
import { useBrowser } from '../../contexts/BrowserContext'
import { useAuth } from '../../lib/AuthContext'

export default function BrowserPanel() {
  const { isOpen, close, defaultUrl, pendingPid, clearPendingPid } = useBrowser()
  const { user } = useAuth()
  const partition = user?.uid ? `persist:liris-${user.uid}` : 'persist:liris-guest'
  const [inputUrl, setInputUrl] = useState(defaultUrl)
  const [currentUrl, setCurrentUrl] = useState(defaultUrl)
  const [loading, setLoading] = useState(false)
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

  // Webview-Events binden (Navigation, Loading). Die frueher hier inject-ierte
  // Selection-Capture (mouseup -> setSelectedText) wurde entfernt: sie hat
  // bei jedem Markieren von Text in Liris (z.B. VEKA-Nr fuer Copy) den
  // Browser-Context aktualisiert -> alle Context-Subscriber (RecallPage etc.)
  // re-renderten. Das hat Eingabefelder im Patient-bearbeiten-Modal
  // zwischenzeitlich blockiert. User koennen weiterhin nativ via Ctrl+C in
  // der Webview kopieren — die Auto-Anzeige "Ausgewaehlt: ..." ist verzichtbar.
  useEffect(() => {
    if (!isOpen) return
    const wv = webviewRef.current as any
    if (!wv) return

    const onDomReady = () => {
      setLoading(false)
      webviewReady.current = true
    }
    const onDidNavigate = (e: any) => {
      if (e.url) setInputUrl(e.url)
      setLoading(false)
    }
    const onLoadStart = () => setLoading(true)
    const onLoadStop  = () => setLoading(false)

    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-navigate', onDidNavigate)
    wv.addEventListener('did-navigate-in-page', onDidNavigate)
    wv.addEventListener('did-start-loading', onLoadStart)
    wv.addEventListener('did-stop-loading', onLoadStop)

    return () => {
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('did-navigate', onDidNavigate)
      wv.removeEventListener('did-navigate-in-page', onDidNavigate)
      wv.removeEventListener('did-start-loading', onLoadStart)
      wv.removeEventListener('did-stop-loading', onLoadStop)
    }
  }, [isOpen])

  // PID-Injection: feuert jedes Mal wenn pendingPid sich ändert.
  // Funktioniert auch wenn das Panel schon offen ist (dom-ready feuert dann nicht mehr).
  useEffect(() => {
    if (!pendingPid || !isOpen) return

    const pid = pendingPid
    // ALLE setTimeouts in diesem Effect tracken, damit Cleanup sauber alles
    // abraeumt. Sonst feuert ein 700-ms-restoreFocus-Timer aus einer alten
    // Patienten-Session auf das aktuelle Modal — kann Fokus klauen.
    const timers: number[] = []
    const setT = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms)
      timers.push(id)
      return id
    }
    // Fokus VOR der Injection merken, damit wir ihn danach zurueckgeben koennen.
    // Typischerweise ist das ein Input im "Patient bearbeiten"-Modal, das offen
    // war als der User auf "-> Liris" klickte. Wenn nichts fokussiert war
    // (z.B. ueber Tabellen-Klick aufgerufen), nehmen wir document.body als Fallback.
    const previouslyFocused = document.activeElement as HTMLElement | null
    const restoreFocus = () => {
      // WICHTIG: Nur restore-en wenn der Fokus zur Zeit IM WEBVIEW liegt
      // (also vom Inject-Script geklaut wurde). Falls der User inzwischen
      // schon in ein anderes Feld geklickt hat (z.B. PID-Input im Edit-
      // Modal), wuerden wir ihm sonst den Fokus wieder wegnehmen waehrend
      // er tippt — das war ein Bug der manchmal Buchstaben verschluckte.
      const now = document.activeElement
      const wv = webviewRef.current as HTMLElement | null
      const focusInWebview = !!wv && (now === wv || wv.contains(now as Node))
      if (!focusInWebview) return                  // User ist woanders — nicht stoeren
      if (wv && (wv as any).blur) (wv as any).blur()
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
          var pidStr = ${JSON.stringify(pid)};
          function isVisible(node) {
            if (!node || node.offsetParent === null) return false;
            var r = node.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          }
          function selectFirst() {
            // 1) PID-spezifisch: suche ein klickbares Element, dessen Text die
            //    PID enthaelt (z.B. "Sestito Heidi #961"). Das ist robust
            //    gegen unbekannte Klassen-Namen / Framework-Wechsel.
            var clickables = document.querySelectorAll('a, button, li, [role="option"], [role="button"], div[onclick], tr[onclick]');
            for (var k = 0; k < clickables.length; k++) {
              var c = clickables[k];
              if (!isVisible(c)) continue;
              // gleichen Knoten nicht doppelt zaehlen — Eltern haben Text der Kinder
              var ownText = c.textContent || '';
              if (ownText.indexOf(pidStr) === -1) continue;
              // Suchfeld selbst nicht klicken
              if (c.tagName === 'INPUT' || c.contains(el)) continue;
              c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              c.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
              c.click();
              return 'clicked-by-pid';
            }

            // 2) Klasse-basiert: sichtbares Dropdown-Item finden und klicken.
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
              if (item && isVisible(item)) {
                item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                item.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
                item.click();
                return 'clicked-by-class';
              }
            }
            // 3) Fallback: Pfeil-runter + Enter im Suchfeld (Keyboard-Navigation).
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
            // bei jedem "clicked-*"-Ergebnis aufhoeren — der Patient ist offen
            if (res && res.indexOf('clicked') === 0) { clearInterval(iv); return; }
            if (tries >= 6) clearInterval(iv);
          }, 350);

          return 'ok';
        })();
      `
      wv.executeJavaScript(script)
        .then((res: string) => {
          // pendingPid IMMER clearen — auch bei "keyboard"/"clicked-by-class"/
          // "clicked-by-pid"/"no-input-found". Sonst kann ein nicht-aufgeraeumter
          // pendingPid spaetere openWithPid-Aufrufe blockieren (gleicher Wert
          // -> kein useEffect-Re-Run).
          clearPendingPid()
          // Nach kurzer Verzoegerung Fokus zurueck ins Hauptfenster — typischerweise
          // ins zuletzt aktive Input-Feld des Patient-bearbeiten-Modals.
          setT(restoreFocus, 700)
        })
        .catch(() => { clearPendingPid() })
    }

    let detachReady: (() => void) | null = null

    if (webviewReady.current) {
      // Webview bereits geladen — sofort injizieren
      setT(doInject, 300)
    } else {
      // Webview lädt noch oder wurde noch nicht gemountet —
      // dom-ready abwarten. Guard NACH dem dom-ready-Event, nicht vorher.
      const onReady = () => {
        webviewReady.current = true
        setT(doInject, 800)
      }
      const attach = () => {
        const wv = webviewRef.current as any
        if (!wv) return false
        wv.addEventListener('dom-ready', onReady)
        detachReady = () => wv.removeEventListener('dom-ready', onReady)
        return true
      }
      // Webview-Element könnte noch nicht im DOM sein wenn isOpen soeben true wurde.
      if (!attach()) setT(() => { attach() }, 50)
    }

    return () => {
      timers.forEach(clearTimeout)
      detachReady?.()
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
