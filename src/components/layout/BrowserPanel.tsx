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
async function extractLirisInfo(wv: any, pid: string): Promise<{ pid: string; pidMatchesLiris: boolean; vorname: string | null; gebDatum: string | null; autor: string | null; letzteKons: string | null; intervalWeeks: number | null; notFound: boolean } | null> {
  if (!wv?.executeJavaScript) return null
  // PID ohne # — Liris zeigt evtl. mit oder ohne Padding (0042 vs 42).
  const expectedPidDigits = (pid || '').replace(/\D/g, '').replace(/^0+/, '')
  const script = `
    (function() {
      var expectedPid = ${JSON.stringify(expectedPidDigits)};
      var result = { pidMatchesLiris: false, vorname: null, gebDatum: null, autor: null, letzteKons: null, intervalWeeks: null, notFound: false, _debug: { textLen: 0 } };
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

      // 0) PID-Verifikation: pruefe ob die ERWARTETE PID irgendwo im Text vorkommt.
      //    Liris padded gelegentlich Zeros ("#0042"), wir normalisieren auf reine
      //    Ziffern ohne Leading-Zeros. Match-Pattern: #?0*<pid>(?!\\d) — verhindert
      //    dass "#42" auch in "#420" matched.
      if (expectedPid) {
        var pidRe = new RegExp('#?0*' + expectedPid + '(?!\\\\d)');
        result.pidMatchesLiris = pidRe.test(allText);
      }

      // Not-Found-Erkennung
      if (/Kein\\s+Patient/i.test(allText) ||
          /keine\\s+Treffer/i.test(allText) ||
          /nicht\\s+gefunden/i.test(allText) ||
          /nicht\\s+vorhanden/i.test(allText)) {
        result.notFound = true;
      }

      // 1) Geburtsdatum: nur DD.MM.YYYY MIT "(NN Jahre)"-Suffix akzeptieren.
      //    Verhindert dass "Untersuchung vom 14.01.2026" als gebDatum gelesen wird.
      var birthRe = /(\\d{2})\\.(\\d{2})\\.(19\\d{2}|20[0-2]\\d)\\s*\\(\\s*\\d+\\s*Jahre?\\s*\\)/;
      var bm = allText.match(birthRe);
      if (bm) result.gebDatum = bm[3] + '-' + bm[2] + '-' + bm[1];

      // 2) Vorname (eigentlich der ganze Name vor dem Geburtsdatum):
      //    Pattern: "(Frau|Herr|...) <Wort+> , DD.MM.YYYY (NN Jahre)"
      var nameRe = /(?:Frau|Herr|Fr\\.|Hr\\.)\\s+([A-ZÄÖÜ][\\wäöüÄÖÜß-]+(?:\\s+[A-ZÄÖÜ][\\wäöüÄÖÜß-]+)*?)\\s*,?\\s*\\d{2}\\.\\d{2}\\.\\d{4}\\s*\\(/;
      var nm = allText.match(nameRe);
      if (nm) result.vorname = nm[1].trim();

      // 3) Untersuchungs-Datum: "Untersuchung vom DD.MM.YYYY" → letzteKons
      var untersMatch = allText.match(/Untersuchung\\s+vom\\s+(\\d{2})\\.(\\d{2})\\.(19\\d{2}|20[0-2]\\d)/i);
      if (untersMatch) result.letzteKons = untersMatch[3] + '-' + untersMatch[2] + '-' + untersMatch[1];

      // 4) Naechster Termin in N Wochen — z.B. "Naechster Termin in 4 Wochen"
      //    oder isoliert "4 Wochen" direkt unter "Naechster Termin".
      //    Akzeptiert auch Monate ("in 3 Monaten") und konvertiert zu Wochen
      //    (1 Monat ~ 4 Wochen, grob, das exakte Intervall ist eh nur Hinweis).
      //    Toleranter: erlaubt Zwischenwoerter wie "Kontrolle in" zwischen
      //    "Naechster Termin" und der Zahl (z.B. "Naechster Termin: Kontrolle
      //    in 12 Monaten" oder "Naechster Termin\\n12 Monate, Myd und OCT").
      var intervalRe = /N(?:ä|ae)chster\\s+Termin\\s*:?\\s*[^\\d\\n]{0,30}?(\\d+)\\s*(Wochen?|Monate?n?|Jahre?n?)/i;
      var iv = allText.match(intervalRe);
      if (iv) {
        var n = parseInt(iv[1], 10);
        if (/Monat/i.test(iv[2])) n = n * 4;
        else if (/Jahr/i.test(iv[2])) n = n * 52;
        if (n > 0 && n <= 260) result.intervalWeeks = n;
      }

      // 4b) Fallback: wenn "Naechster Termin" leer / nicht gefunden, scanne
      //     "Beurteilung und Prozedere"-Abschnitt nach Intervallangaben wie
      //     "Kontrolle in 6 Monaten", "Wiedervorstellung in 4 Wochen", "in 3 Wochen wieder",
      //     oder auch ausgeschriebene Monatsnamen ("Kontrolle November", "VK im Mai 2027").
      if (!result.intervalWeeks) {
        var bpStart = allText.search(/Beurteilung\\s+und\\s+Prozedere/i);
        if (bpStart >= 0) {
          // Abschnitt bis Doc-Ende (oder bis zur naechsten typischen Liris-Sektion)
          var bpText = allText.slice(bpStart, bpStart + 4000);
          var bpEnd = bpText.search(/\\n\\s*(?:Diagnose|Anamnese|Befund|Untersuchung\\s+vom|Autor)\\b/i);
          if (bpEnd > 0) bpText = bpText.slice(0, bpEnd);
          // 4b-i) numerische Phrase "in N Wochen/Monaten/Jahren"
          var fallbackRe = /(?:Kontrolle|Wiedervorstellung|Nachkontrolle|VK|Verlaufskontrolle|wieder)\\D{0,40}?in\\s+(\\d+)\\s+(Wochen?|Monate?n?|Jahre?n?)|in\\s+(\\d+)\\s+(Wochen?|Monate?n?|Jahre?n?)\\D{0,15}?wieder/i;
          var fm = bpText.match(fallbackRe);
          if (fm) {
            var num = parseInt(fm[1] || fm[3], 10);
            var unit = fm[2] || fm[4];
            if (/Monat/i.test(unit)) num = num * 4;
            else if (/Jahr/i.test(unit)) num = num * 52;
            if (num > 0 && num <= 260) result.intervalWeeks = num;
          }
          // 4b-ii) Monatsname: "Kontrolle November", "VK im Mai 2027",
          //        "Wiedervorstellung Januar 2027". Distanz ab letzteKons
          //        (Fallback: heute) bis zum 15. des Zielmonats → Wochen.
          if (!result.intervalWeeks) {
            var monthMap = { januar:0, februar:1, märz:2, maerz:2, april:3, mai:4, juni:5,
                             juli:6, august:7, september:8, oktober:9, november:10, dezember:11 };
            var monthRe = /(?:Kontrolle|Wiedervorstellung|Nachkontrolle|VK|Verlaufskontrolle)\\D{0,30}?(?:im\\s+|am\\s+|ab\\s+)?(Januar|Februar|M(?:\\u00e4|ae)rz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)(?:\\s+(\\d{4}))?/i;
            var mm = bpText.match(monthRe);
            if (mm) {
              var monKey = mm[1].toLowerCase().replace('ä','ae');
              var monIdx = monthMap[monKey];
              if (monIdx === undefined) monIdx = monthMap[mm[1].toLowerCase()];
              if (typeof monIdx === 'number') {
                // Referenzdatum: letzteKons falls extrahiert, sonst heute
                var refMs;
                if (result.letzteKons) {
                  var lk = result.letzteKons.split('-');
                  refMs = Date.UTC(parseInt(lk[0],10), parseInt(lk[1],10)-1, parseInt(lk[2],10));
                } else {
                  var now = new Date();
                  refMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
                }
                var refY = new Date(refMs).getUTCFullYear();
                var targetY = mm[2] ? parseInt(mm[2], 10) : refY;
                // Zieldatum = 15. des Monats. Ohne Jahresangabe wird das
                // Jahr des Referenzdatums verwendet (kein Roll-Over ins
                // naechste Jahr) — wenn der Monat dieses Jahres schon vorbei
                // ist, wird das Intervall einfach nicht gesetzt.
                var targetMs = Date.UTC(targetY, monIdx, 15);
                var diffWeeks = Math.round((targetMs - refMs) / (7 * 86400000));
                if (diffWeeks > 0 && diffWeeks <= 260) result.intervalWeeks = diffWeeks;
              }
            }
          }
        }
      }

      // 5) Autor: "Autor: Dr. Name" / "Autor Prof. ..."
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
      if (res?.gebDatum || res?.autor || res?.letzteKons || res?.notFound || res?.vorname || res?.pidMatchesLiris || res?.intervalWeeks) {
        console.log('[Liris-Extract] attempt', attempt + 1, 'success:', res)
        return {
          pid,
          pidMatchesLiris: !!res.pidMatchesLiris,
          vorname:       res.vorname       ?? null,
          gebDatum:      res.gebDatum      ?? null,
          autor:         res.autor         ?? null,
          letzteKons:    res.letzteKons    ?? null,
          intervalWeeks: res.intervalWeeks ?? null,
          notFound:      !!res.notFound,
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
  const { isOpen, close, defaultUrl, pendingPid, clearPendingPid, setLirisExtract, requestRecallByPid, staleRecallPids, knownRecallPids, staleReferenceDate, setStaleReferenceDate } = useBrowser()
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
  const lastDetailPid = useRef<string | null>(null)  // zuletzt im Liris-Header erkannte PID
  const staleRecallPidsRef = useRef<string[]>([])   // wird unten via Effect synchron gehalten
  const knownRecallPidsRef = useRef<string[]>([])
  const staleRefDateRef    = useRef<string>(staleReferenceDate)

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

    // Klick-Listener im Liris-Kalender: erkennt PID des angeklickten Patienten
    // und meldet sie via console.log('__AZ_PID__:<pid>') zurueck an den Host.
    // Sucht die PID im angeklickten Element und bis zu 8 Eltern-Ebenen:
    // zuerst im Text (#1234), dann in Attributen (data-pid, title, href, onclick…).
    const PID_CLICK_INJECT = `
      (function() {
        if (window.__azPidClick) return 'already';
        window.__azPidClick = true;
        document.addEventListener('click', function(e) {
          var node = e.target;
          var pid = null;
          for (var i = 0; i < 8 && node; i++) {
            // 1) Text des Elements: "#1234" (kleinste Einheit zuerst -> richtiger Patient)
            var txt = (node.textContent || '');
            var m = txt.match(/#\\s*(\\d{1,7})(?!\\d)/);
            if (m) { pid = m[1]; break; }
            // 2) Attribute durchsuchen
            if (node.getAttribute) {
              var attrs = ['data-pid','data-patient','data-patientid','data-patid','title','href','id','onclick','data-id'];
              for (var a = 0; a < attrs.length; a++) {
                var v = node.getAttribute(attrs[a]);
                if (v) {
                  var am = String(v).match(/(?:pid[=:_\\-]?|patient[=:_\\-]?|#)\\s*(\\d{1,7})(?!\\d)/i);
                  if (am) { pid = am[1]; break; }
                }
              }
              if (pid) break;
            }
            node = node.parentElement;
          }
          if (pid) console.log('__AZ_PID__:' + pid);
        }, true);
        return 'injected';
      })();
    `

    // Liest die PID aus dem Patienten-Detail-Header von Liris.
    // Header-Muster: "Herr Keller Peter , 10.12.1958 (67 Jahre) , Buchs AG … #05162"
    // Die PID (#NNNNN) wird nur akzeptiert wenn sie nach "(NN Jahre)" steht —
    // so wird sie eindeutig dem geoeffneten Patienten zugeordnet.
    // Patient-PID aus dem Liris-Header lesen. Heuristik:
    // 1) Suche im 300-Zeichen-Fenster nach "(NN Jahre)".
    // 2) Sammle ALLE #NN-Vorkommen in diesem Fenster.
    // 3) Waehle die laengste Zahl — echte PIDs sind typischerweise laenger
    //    als sonstige #-Werte (Tarifnummern, Positionen, etc.) die nahebei
    //    erscheinen koennen. Bei Gleichstand wird die erste genommen.
    // Strenges Pattern fuer den Liris-Detail-Header:
    //   "DD.MM.YYYY (NN Jahre) ... #PID"
    // alles im SELBEN Textabschnitt — keine Zeilenumbrueche, kein
    // weiteres '#' dazwischen. Damit werden Kalenderwochen-Indikatoren
    // (z.B. "#24" im Tab-Strip oben) zuverlaessig ausgeschlossen.
    // Zusaetzlich: nur ein einziges "(NN Jahre)"-Vorkommen erlaubt
    // (sonst sind wir in einer Listenansicht).
    const DETAIL_PID_SCRIPT = `
      (function() {
        var txt = document.body ? (document.body.innerText || '') : '';
        var anchors = txt.match(/\\(\\s*\\d+\\s*Jahre?\\s*\\)/g);
        if (!anchors || anchors.length !== 1) return null;
        var headerRe = /\\d{2}\\.\\d{2}\\.\\d{4}\\s*\\(\\s*\\d+\\s*Jahre?\\s*\\)[^\\n#]{0,150}#\\s*0*(\\d+)(?!\\d)/;
        var m = txt.match(headerRe);
        return m ? m[1] : null;
      })();
    `
    // Prueft den Detail-Header; bei NEUER PID -> Recall-Popup anfordern.
    const checkDetailPid = () => {
      wv.executeJavaScript(DETAIL_PID_SCRIPT).then((pid: string | null) => {
        if (!pid) {
          // Kein Patient-Header sichtbar (Kalender/Suche). NICHT lastDetailPid
          // zuruecksetzen — sonst feuert dieselbe PID nach jedem AJAX-Refresh
          // (Header verschwindet/erscheint wieder) erneut. Der Reset
          // passiert nur bei echter Navigation (did-navigate-Handler unten).
          return
        }
        if (pid !== lastDetailPid.current) {
          lastDetailPid.current = pid
          console.log('[Liris] Patient-Detail geoeffnet, PID=', pid)
          requestRecallByPid(pid)
          // Zusaetzlich die Detail-Infos extrahieren (Intervall, Geburtsdatum,
          // letzte Kons.) damit das Recall-Popup diese Felder auto-fuellen kann
          // — wie beim Recall->Liris-Fluss.
          extractLirisInfo(wv, '#' + pid).then(info => {
            if (info) {
              console.log('[Liris] Detail-Extract:', info)
              setLirisExtract({ ...info, at: Date.now() })
            }
          }).catch(() => {})
        }
      }).catch(() => {})
    }
    // Mehrere Versuche, da die Detailseite asynchron nachlaedt.
    const scheduleDetailCheck = () => {
      [500, 1200, 2200].forEach(ms => window.setTimeout(checkDetailPid, ms))
    }

    const onDomReady = () => {
      setLoading(false)
      webviewReady.current = true
      wv.executeJavaScript(PID_CLICK_INJECT).catch(() => {})
      scheduleDetailCheck()
      scheduleRecallHighlight()
    }
    const onConsole = (e: any) => {
      const msg = e?.message || ''
      if (msg.indexOf('__AZ_PID__:') === 0) {
        const pid = msg.slice('__AZ_PID__:'.length).trim()
        if (pid) {
          console.log('[Liris] Patient im Kalender angeklickt, PID=', pid)
          requestRecallByPid(pid)
        }
      }
    }
    const onDidNavigate = (e: any) => {
      if (e.url) setInputUrl(e.url)
      setLoading(false)
      // Nach echter Navigation Detail-PID-Merker zuruecksetzen, damit derselbe
      // Patient nach Wechsel und Rueckkehr wieder als "neu" zaehlt.
      lastDetailPid.current = null
      // Nach Navigation neu injizieren (window-Flag ist auf neuer Seite weg)
      wv.executeJavaScript(PID_CLICK_INJECT).catch(() => {})
      // Detail-Header pruefen — neuer Patient geoeffnet?
      scheduleDetailCheck()
      // Recall-PIDs neu markieren
      scheduleRecallHighlight()
    }

    // PIDs hervorheben, die in den letzten 30 Tagen im Recall aktualisiert
    // wurden. Wird nach jeder Navigation/Refresh ausgeloest, Mehrfach-Anwendung
    // wird ueber data-Attribut idempotent gemacht.
    const scheduleRecallHighlight = () => {
      [600, 1500, 3000].forEach(ms => window.setTimeout(highlightRecallPids, ms))
    }
    const highlightRecallPids = () => {
      const stalePids = staleRecallPidsRef.current
      const knownPids = knownRecallPidsRef.current
      if (!stalePids.length && !knownPids.length) return
      const refDate = staleRefDateRef.current
      const refDisplay = refDate ? refDate.split('-').reverse().join('.') : ''
      const tooltipStale  = `Recall seit ${refDisplay} nicht aktualisiert`
      const tooltipMissing = 'Patient ist nicht im Recall erfasst — noch aufzunehmen'
      const script = `
        (function() {
          var STALE = ${JSON.stringify(stalePids)};
          var KNOWN = ${JSON.stringify(knownPids)};
          var T_STALE   = ${JSON.stringify(tooltipStale)};
          var T_MISSING = ${JSON.stringify(tooltipMissing)};
          var staleSet = {}; for (var i=0; i<STALE.length; i++) staleSet[STALE[i]] = true;
          var knownSet = {}; for (var j=0; j<KNOWN.length; j++) knownSet[KNOWN[j]] = true;
          if (!document.getElementById('__az_recall_css')) {
            var st = document.createElement('style');
            st.id = '__az_recall_css';
            st.textContent =
              '.az-recall-stale{background:#fef3c7 !important;color:#92400e !important;border-radius:3px;padding:0 3px;font-weight:600;outline:1px solid #fbbf24;}'+
              '.az-recall-missing{background:#fee2e2 !important;color:#991b1b !important;border-radius:3px;padding:0 3px;font-weight:600;outline:1px solid #f87171;}';
            document.documentElement.appendChild(st);
          }
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function(n) {
              if (!n.nodeValue || n.nodeValue.indexOf('#') < 0) return NodeFilter.FILTER_REJECT;
              var p = n.parentNode;
              if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || (p.classList && (p.classList.contains('az-recall-stale') || p.classList.contains('az-recall-missing')))) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            }
          });
          var nodes = []; var n; while ((n = walker.nextNode())) nodes.push(n);
          var re = /#\\s*0*(\\d+)(?!\\d)/g;
          nodes.forEach(function(node) {
            var txt = node.nodeValue;
            re.lastIndex = 0;
            var matches = []; var m;
            while ((m = re.exec(txt)) !== null) {
              var pid = m[1];
              var kind = null;
              if (staleSet[pid]) kind = 'stale';
              else if (!knownSet[pid]) kind = 'missing';
              if (kind) matches.push({ start: m.index, end: m.index + m[0].length, kind: kind });
            }
            if (!matches.length) return;
            var frag = document.createDocumentFragment();
            var cursor = 0;
            matches.forEach(function(mt) {
              if (mt.start > cursor) frag.appendChild(document.createTextNode(txt.slice(cursor, mt.start)));
              var span = document.createElement('span');
              span.className = mt.kind === 'stale' ? 'az-recall-stale' : 'az-recall-missing';
              span.title = mt.kind === 'stale' ? T_STALE : T_MISSING;
              span.textContent = txt.slice(mt.start, mt.end);
              frag.appendChild(span);
              cursor = mt.end;
            });
            if (cursor < txt.length) frag.appendChild(document.createTextNode(txt.slice(cursor)));
            node.parentNode.replaceChild(frag, node);
          });
        })();
      `
      wv.executeJavaScript(script).catch(() => {})
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
  }, [isOpen, requestRecallByPid])

  // Recall-PIDs in einer Ref spiegeln (damit der Inject-Effekt sie ohne
  // Re-Render erreicht) UND bei jeder Aenderung Liris neu highlighten:
  // erst alte Markierungen entfernen, dann mit aktuellem Set neu anwenden.
  useEffect(() => {
    staleRecallPidsRef.current = staleRecallPids
    knownRecallPidsRef.current = knownRecallPids
    staleRefDateRef.current    = staleReferenceDate
    if (!isOpen) return
    const wv = webviewRef.current as any
    if (!wv?.executeJavaScript) return
    const refDisplay = staleReferenceDate ? staleReferenceDate.split('-').reverse().join('.') : ''
    const tooltipStale  = `Recall seit ${refDisplay} nicht aktualisiert`
    const tooltipMissing = 'Patient ist nicht im Recall erfasst — noch aufzunehmen'
    const script = `
      (function() {
        // 1) Alte Markierungen entfernen (beide Sorten)
        var olds = document.querySelectorAll('.az-recall-stale,.az-recall-missing');
        olds.forEach(function(el){var p=el.parentNode;if(p){p.replaceChild(document.createTextNode(el.textContent),el);p.normalize();}});
        var STALE = ${JSON.stringify(staleRecallPids)};
        var KNOWN = ${JSON.stringify(knownRecallPids)};
        if (!STALE.length && !KNOWN.length) return 0;
        var T_STALE   = ${JSON.stringify(tooltipStale)};
        var T_MISSING = ${JSON.stringify(tooltipMissing)};
        var staleSet = {}; for (var i=0; i<STALE.length; i++) staleSet[STALE[i]] = true;
        var knownSet = {}; for (var j=0; j<KNOWN.length; j++) knownSet[KNOWN[j]] = true;
        if (!document.getElementById('__az_recall_css')) {
          var st = document.createElement('style');
          st.id = '__az_recall_css';
          st.textContent =
            '.az-recall-stale{background:#fef3c7 !important;color:#92400e !important;border-radius:3px;padding:0 3px;font-weight:600;outline:1px solid #fbbf24;}'+
            '.az-recall-missing{background:#fee2e2 !important;color:#991b1b !important;border-radius:3px;padding:0 3px;font-weight:600;outline:1px solid #f87171;}';
          document.documentElement.appendChild(st);
        }
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: function(n) {
            if (!n.nodeValue || n.nodeValue.indexOf('#') < 0) return NodeFilter.FILTER_REJECT;
            var p = n.parentNode;
            if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        var nodes = [], n; while ((n = walker.nextNode())) nodes.push(n);
        var re = /#\\s*0*(\\d+)(?!\\d)/g;
        nodes.forEach(function(node) {
          var txt = node.nodeValue;
          re.lastIndex = 0;
          var matches = [], m;
          while ((m = re.exec(txt)) !== null) {
            var pid = m[1];
            var kind = null;
            if (staleSet[pid]) kind = 'stale';
            else if (!knownSet[pid]) kind = 'missing';
            if (kind) matches.push({ start: m.index, end: m.index + m[0].length, kind: kind });
          }
          if (!matches.length) return;
          var frag = document.createDocumentFragment();
          var cursor = 0;
          matches.forEach(function(mt) {
            if (mt.start > cursor) frag.appendChild(document.createTextNode(txt.slice(cursor, mt.start)));
            var span = document.createElement('span');
            span.className = mt.kind === 'stale' ? 'az-recall-stale' : 'az-recall-missing';
            span.title = mt.kind === 'stale' ? T_STALE : T_MISSING;
            span.textContent = txt.slice(mt.start, mt.end);
            frag.appendChild(span);
            cursor = mt.end;
          });
          if (cursor < txt.length) frag.appendChild(document.createTextNode(txt.slice(cursor)));
          node.parentNode.replaceChild(frag, node);
        });
      })();
    `
    window.setTimeout(() => { wv.executeJavaScript(script).catch(() => {}) }, 100)
  }, [staleRecallPids, knownRecallPids, staleReferenceDate, isOpen])

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

          // Prueft ob ueberhaupt Dropdown-Treffer sichtbar sind.
          function hasDropdownItems() {
            var sels = ['.ui-autocomplete li', '.autocomplete-suggestion',
              '.dropdown-menu li', '[role="option"]', '.tt-suggestion', 'ul.typeahead li'];
            for (var i = 0; i < sels.length; i++) {
              var items = document.querySelectorAll(sels[i]);
              for (var j = 0; j < items.length; j++) {
                if (isVisible(items[j]) && (items[j].textContent || '').trim()) return true;
              }
            }
            // Auch: ein klickbares Element das die PID enthaelt
            var clickables = document.querySelectorAll('a, li, [role="option"], tr[onclick]');
            for (var m = 0; m < clickables.length; m++) {
              if (isVisible(clickables[m]) && (clickables[m].textContent || '').indexOf(pidStr) !== -1) return true;
            }
            return false;
          }

          // Mehrere Versuche, falls das Dropdown langsam laedt.
          // Promise resolved mit 'selected' (Treffer geklickt),
          // 'navigated' (Seite hat sich geaendert) oder 'no-result' (leeres Dropdown).
          return new Promise(function(resolve) {
            var tries = 0;
            var sawItems = false;
            var iv = setInterval(function() {
              tries++;
              if (hasDropdownItems()) sawItems = true;
              var res = selectFirst();
              if (res && res.indexOf('clicked') === 0) { clearInterval(iv); resolve('selected'); return; }
              if (tries >= 6) {
                clearInterval(iv);
                // Wenn nie ein Dropdown-Item erschien -> Patient nicht gefunden.
                resolve(sawItems ? 'selected' : 'no-result');
              }
            }, 350);
          });
        })();
      `
      wv.executeJavaScript(script)
        .then((res: any) => {
          console.log('[Liris] inject script done, result=', res)
          clearPendingPid()
          // Leeres Dropdown = Patient existiert nicht in Liris -> sofort melden,
          // ohne auf die (ergebnislose) Extraktion zu warten.
          if (res === 'no-result') {
            console.log('[Liris] no dropdown result -> patient not found')
            setLirisExtract({
              pid, pidMatchesLiris: false, vorname: null, gebDatum: null,
              autor: null, letzteKons: null, intervalWeeks: null,
              notFound: true, at: Date.now(),
            })
            return
          }
          // Extract-Timer NICHT ueber setT (=in timers-Array) anlegen —
          // clearPendingPid loest gleich einen useEffect-Re-Run aus, dessen
          // Cleanup alle Timer abraeumt. Wir wollen aber dass dieser Timer
          // fest steht. Daher window.setTimeout direkt + KEIN tracking.
          window.setTimeout(() => {
            console.log('[Liris] starting extract for pid=', pid)
            extractLirisInfo(wv, pid).then(info => {
              console.log('[Liris] extract result:', info)
              if (info) {
                setLirisExtract({ ...info, at: Date.now() })
              } else {
                // Extraktion lieferte gar nichts -> als nicht gefunden werten,
                // damit der User eine Meldung erhaelt statt stiller Stille.
                console.log('[Liris] extract empty -> treating as not found')
                setLirisExtract({
                  pid, pidMatchesLiris: false, vorname: null, gebDatum: null,
                  autor: null, letzteKons: null, intervalWeeks: null,
                  notFound: true, at: Date.now(),
                })
              }
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

          {/* Stale-Recall-Referenzdatum: PIDs werden hervorgehoben sofern
              ihr aktualisiert-Feld vor diesem Datum liegt. Default heute,
              kann zurueck-/vorgesetzt werden um z.B. die Liste letzter
              Woche zu pruefen. */}
          <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-1.5 py-0.5"
               title="Markiere im Liris-Kalender PIDs deren Recall seit diesem Datum NICHT mehr aktualisiert wurde (Patient am 12.02 -> markiert wenn aktualisiert vor dem 12.02 oder nie)">
            <span className="text-[10px] font-semibold text-amber-700 select-none">Recall seit</span>
            <input
              type="date"
              value={staleReferenceDate}
              onChange={e => setStaleReferenceDate(e.target.value || new Date().toISOString().slice(0, 10))}
              className="text-[11px] bg-transparent border-0 text-amber-900 focus:outline-none cursor-pointer"
            />
          </div>

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
