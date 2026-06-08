import { useRef, useState, useEffect, useCallback } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw, X, GripVertical } from 'lucide-react'
import { useBrowser } from '../../contexts/BrowserContext'
import { useAuth } from '../../lib/AuthContext'

/** Extrahiert Geburtsdatum + Autor aus der aktuell in Liris geoeffneten
 *  Patient-Untersuchung. Heuristisch — versucht mehrere DOM-Patterns weil
 *  wir die genaue Liris-HTML-Struktur nicht kennen. Gibt null zurueck wenn
 *  nichts gefunden.
 *
 *  Wird nach PID-Inject + ~1.5s Render-Delay ausgefuehrt. */
async function extractLirisInfo(wv: any, pid: string): Promise<{ pid: string; lirisPid: string | null; gebDatum: string | null; autor: string | null; letzteKons: string | null; notFound: boolean } | null> {
  if (!wv?.executeJavaScript) return null
  const script = `
    (function() {
      var result = { lirisPid: null, gebDatum: null, autor: null, letzteKons: null, notFound: false, _debug: { textLen: 0 } };
      // Sammle Text auch aus iframes (Liris koennte verschachtelt sein).
      function collectText(doc) {
        var t = doc.body ? (doc.body.innerText || doc.body.textContent || '') : '';
        var frames = doc.querySelectorAll ? doc.querySelectorAll('iframe') : [];
        for (var i = 0; i < frames.length; i++) {
          try {
            var inner = frames[i].contentDocument;
            if (inner) t += '\\n' + collectText(inner);
          } catch (e) { /* cross-origin iframe — skip */ }
        }
        return t;
      }
      var allText = collectText(document);
      result._debug.textLen = allText.length;

      // 0) PID-Verifikation: Liris zeigt Patient-PID als "#12345" im Header.
      //    Wir extrahieren das erste #-Pattern und vergleichen spaeter mit
      //    der erwarteten PID (Caller macht den Match).
      var pidMatch = allText.match(/#\\s*(\\d{2,8})/);
      if (pidMatch) result.lirisPid = pidMatch[1];

      // not-found-Erkennung: typische Liris-Meldungen wenn keine Patient existiert.
      if (/Kein\\s+Patient/i.test(allText) ||
          /keine\\s+Treffer/i.test(allText) ||
          /nicht\\s+gefunden/i.test(allText) ||
          /nicht\\s+vorhanden/i.test(allText)) {
        result.notFound = true;
      }

      // 1) Geburtsdatum: DD.MM.YYYY-Pattern (Jahr 1900-2030).
      //    Pattern muss plausibles Datum sein.
      var birthRe = /(\\d{2})\\.(\\d{2})\\.(19\\d{2}|20[0-2]\\d)/g;
      var matches = [];
      var m;
      while ((m = birthRe.exec(allText)) !== null) matches.push(m);
      if (matches.length > 0) {
        // Nimm das ERSTE Match (typisch Patient-Header oben).
        var b = matches[0];
        result.gebDatum = b[3] + '-' + b[2] + '-' + b[1];
        result._debug.allBirths = matches.length;
      }

      // 2) Untersuchungs-Datum: "Untersuchung vom DD.MM.YYYY" → letzteKons
      var untersMatch = allText.match(/Untersuchung\\s+vom\\s+(\\d{2})\\.(\\d{2})\\.(19\\d{2}|20[0-2]\\d)/i);
      if (untersMatch) {
        result.letzteKons = untersMatch[3] + '-' + untersMatch[2] + '-' + untersMatch[1];
      }

      // 3) Autor: "Autor: Dr. Name" / "Autor Prof. ..." / "Autor: Name"
      var autorMatch = allText.match(/Autor:?\\s*([^\\n\\r]{1,80})/);
      if (autorMatch && autorMatch[1]) {
        result.autor = autorMatch[1].trim().replace(/\\s+/g, ' ').slice(0, 80);
        var stop = result.autor.search(/[,\\n\\r]|  /);
        if (stop > 0) result.autor = result.autor.slice(0, stop).trim();
      }
      return result;
    })();
  `
  // Bis zu 3 Versuche mit zunehmender Wartezeit — Liris-Untersuchung kann
  // einige Sekunden brauchen bis sie fertig gerendert ist.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1200))
    }
    try {
      const res = await wv.executeJavaScript(script)
      if (res?.gebDatum || res?.autor || res?.letzteKons || res?.notFound || res?.lirisPid) {
        console.log('[Liris-Extract] attempt', attempt + 1, 'success:', res)
        return {
          pid,
          lirisPid:   res.lirisPid   ?? null,
          gebDatum:   res.gebDatum   ?? null,
          autor:      res.autor      ?? null,
          letzteKons: res.letzteKons ?? null,
          notFound:   !!res.notFound,
        }
      }
      console.log('[Liris-Extract] attempt', attempt + 1, 'nothing yet, debug:', res?._debug)
    } catch (e) {
      console.warn('[Liris-Extract] attempt', attempt + 1, 'error:', e)
    }
  }
  console.warn('[Liris-Extract] all attempts failed')
  return null
}

export default function BrowserPanel() {
  const { isOpen, close, defaultUrl, pendingPid, clearPendingPid, setLirisExtract } = useBrowser()
  const { user } = useAuth()
  const partition = user?.uid ? `persist:liris-${user.uid}` : 'persist:liris-guest'
  const [inputUrl, setInputUrl] = useState(defaultUrl)
  const [currentUrl, setCurrentUrl] = useState(defaultUrl)
  const [loading, setLoading] = useState(false)
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem('liris-panel-width'))
    return saved >= 300 && saved <= 1200 ? saved : 480
  })
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

  // Webview-Blur-Workaround: Electron behaelt manchmal "Geist-Focus" im
  // webview, auch nachdem der User in der Host-App auf ein Input geklickt hat
  // — Folge: Tastatureingaben gehen ins Leere. Wir lauschen global auf
  // mousedown (Capture-Phase, damit BEVOR der Click target verarbeitet wird)
  // und blurren das webview wenn der Klick NICHT im webview war.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const wv = webviewRef.current
      if (!wv) return
      if (wv.contains(e.target as Node)) return  // Klick IM webview -> nichts tun
      // Klick ausserhalb -> webview-Focus loslassen (egal ob er noch dran ist
      // oder nicht — schadet nicht, schuetzt aber gegen Geister-Focus).
      try { (wv as any).blur?.() } catch { /* ignore */ }
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
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
    console.log('[Liris] inject-useEffect fired, pendingPid=', pendingPid, 'isOpen=', isOpen)
    if (!pendingPid || !isOpen) {
      console.log('[Liris] early return — no pendingPid or panel closed')
      return
    }

    const pid = pendingPid
    // ALLE setTimeouts in diesem Effect tracken, damit Cleanup sauber alles
    // abraeumt (Inject-Delay, etc.).
    const timers: number[] = []
    const setT = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms)
      timers.push(id)
      return id
    }
    // Fokus-Management entfernt — verursachte Race-Conditions die manuelle
    // Tastatureingaben im "Patient bearbeiten"-Modal blockieren konnten.
    // User muss ggf. selbst zurueck ins Input klicken nach Liris-Injection.

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
        .then((res: any) => {
          console.log('[Liris] inject script done, result=', res)
          clearPendingPid()
          // Extract-Timer NICHT ueber setT (=in timers-Array) anlegen —
          // clearPendingPid loest gleich einen useEffect-Re-Run aus, dessen
          // Cleanup alle Timer abraeumt. Wir wollen aber dass dieser Timer
          // fest steht. Daher window.setTimeout direkt + KEIN tracking.
          window.setTimeout(() => {
            console.log('[Liris] starting extract for pid=', pid)
            extractLirisInfo(wv, pid).then(info => {
              console.log('[Liris] extract result:', info)
              if (info) setLirisExtract({ ...info, at: Date.now() })
            }).catch((err: unknown) => console.warn('[Liris] extract threw:', err))
          }, 1500)
        })
        .catch((err: unknown) => {
          console.warn('[Liris] inject script error:', err)
          clearPendingPid()
        })
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
      const newW = Math.max(300, Math.min(1200, resizeRef.current.startW + delta))
      setWidth(newW)
    }
    const onUp = () => {
      if (resizeRef.current) {
        // Endbreite persistieren, damit sie nach Neustart erhalten bleibt
        setWidth(w => { localStorage.setItem('liris-panel-width', String(w)); return w })
      }
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
