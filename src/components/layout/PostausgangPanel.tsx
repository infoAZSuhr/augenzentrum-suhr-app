import { useState, useEffect, useRef } from 'react'
// pdf-lib STATISCH importieren — der fruehere dynamische import() brach nach
// jedem Deploy ("Failed to fetch dynamically imported module"), weil der alte
// Chunk-Hash auf dem Server nicht mehr existiert, solange eine aeltere
// App-Sitzung noch offen ist.
import { PDFDocument } from 'pdf-lib'
import { Mail, Trash2, X, FileText, Inbox, Upload, Printer, CheckCircle2, Loader2 } from 'lucide-react'
import { addDoc, collection } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { usePostausgang, type PostausgangItem } from '../../contexts/PostausgangContext'
import { useBrowser } from '../../contexts/BrowserContext'
import { useToast } from '../../lib/ToastContext'

interface ElectronPostausgangApi {
  startPdfDrag?: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  openMailWithAttachments?: (filePaths: string[], subject: string, recipient?: string, bodyText?: string) => Promise<{ ok: boolean; error?: string }>
  writePdfTmp?: (buf: ArrayBuffer, filename: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  uploadPdfToLiris?: (webContentsId: number, filePath: string) => Promise<{ ok: boolean; error?: string }>
  autoImportToLiris?: (webContentsId: number, filePath: string, doctorLastName: string) => Promise<{ ok: boolean; error?: string; log?: string[] }>
}

const PRAXIS_EMAIL = 'info@augenzentrum-suhr.ch'

/** Schwebendes Mini-Panel unten rechts. Zeigt die Liste vorbereiteter
 *  Brief-PDFs mit Aktionen pro Eintrag: Drag&Drop ins Liris, per Mail
 *  versenden, loeschen. */
export default function PostausgangPanel() {
  const { items, remove, markUploaded, markPrinted, markVersendet } = usePostausgang()
  // Per E-Mail versendete Briefe (skipPrint) laufen nur als unsichtbarer
  // Liris-Upload-Job im Hintergrund mit — sie erscheinen NICHT in der Liste
  // und zaehlen nicht im Badge (Postausgang = nur zu druckende Briefe).
  const visibleItems = items.filter(i => !i.skipPrint)
  const { lirisWebContentsId, openWithPid } = useBrowser()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string; log?: string[] } | null>(null)
  const [printPreviewUrl, setPrintPreviewUrl] = useState<string | null>(null)
  const [printPreviewTitle, setPrintPreviewTitle] = useState('Druckvorschau')
  const [printAuto, setPrintAuto] = useState(false)
  const [printingIds, setPrintingIds] = useState<string[]>([])
  const [merging, setMerging] = useState(false)

  // Druckvorschau als In-Page-Popup öffnen (KEIN window.open — das löst im
  // Browser eine Download-/App-Aufforderung aus). Der Druckdialog startet
  // automatisch, sobald die PDF im iframe geladen ist (printAuto).
  const openPrint = (url: string, title: string) => {
    setPrintPreviewTitle(title)
    setPrintAuto(true)
    setPrintPreviewUrl(url)
  }

  // Einzelnen Brief drucken.
  const printOne = (it: PostausgangItem) => {
    setPrintingIds([it.id])
    openPrint(URL.createObjectURL(it.blob), `Brief — ${it.vorname || it.filename}`)
  }

  // Druck auslösen (Auto beim Laden ODER manueller Button). Öffnet nur den
  // Druckdialog — ob wirklich gedruckt wurde, kann man daraus nicht sicher
  // wissen (Dialog kann abgebrochen werden). Als "gedruckt" markiert wird
  // erst beim Schliessen der Vorschau, nach Rückfrage (siehe closePrintPreview).
  const triggerPrint = (win: Window | null | undefined) => {
    try { win?.focus(); win?.print() } catch { /* Fallback: manueller Button */ }
  }

  // Hochgeladene UND gedruckte Briefe automatisch entfernen — gilt für
  // Aufgebot UND Reminder. Das 'aufgeboten markieren' selbst passiert bereits
  // beim Klick auf Per Post/Per E-Mail (RecallPage), unabhängig vom
  // Upload-/Druckstatus dieses Postausgang-Items.
  useEffect(() => {
    const done = items.filter(it => it.uploaded && (it.printed || it.skipPrint))
    if (done.length === 0) return
    done.forEach(it => remove(it.id))
  }, [items, remove])
  const electronApi = (window as unknown as { electronApp?: ElectronPostausgangApi }).electronApp
  const appVersion = (window as unknown as { electronApp?: { version?: string } }).electronApp?.version || '—'
  // Liris-Upload ist NUR in der Desktop-App (Electron) möglich. In der
  // Web-Version wird der Upload-Button ausgegraut und ist nicht klickbar.
  const canUploadLiris = !!electronApi?.autoImportToLiris
  // Mail-an-Praxis nutzt Outlook mit Datei-Anhang (Electron-IPC) — im Browser
  // nicht möglich, Buttons dort ausblenden.
  const canMailPraxis = !!electronApi?.openMailWithAttachments

  // Upload-Fehler duerfen NICHT nur im (meist minimierten) Panel landen:
  // E-Mail-Briefe (skipPrint) sind dort sogar unsichtbar — Fehler waeren
  // komplett stumm. Daher zusaetzlich Toast + Eintrag ins error_log.
  const reportUploadFehler = (it: PostausgangItem, text: string, log?: string[]) => {
    toast.error(`Liris-Upload fehlgeschlagen (${it.vorname || it.filename}): ${text}`)
    addDoc(collection(db, 'error_log'), {
      kind: 'liris-upload',
      message: `${it.filename}: ${text}`.slice(0, 500),
      stack: (log || []).join('\n').slice(0, 1500),
      url: window.location.hash || window.location.pathname,
      user: it.arzt || '—',
      ua: navigator.userAgent.slice(0, 150),
      at: new Date().toISOString(),
    }).catch(() => {})
  }

  // Voll-Automatik: Arzt waehlen + 'Mail gesendet' + Datei. Vorbedingung:
  // Patient ist in Liris geoeffnet.
  const uploadToLiris = async (it: PostausgangItem) => {
    setStatusMsg(null)
    if (!it.tmpPath || !electronApi?.autoImportToLiris) {
      const text = `Auto-Import nicht verfügbar — App-Update nötig (aktuell v${appVersion}, mind. v1.1.22).`
      setStatusMsg({ kind: 'err', text })
      reportUploadFehler(it, text)
      return
    }
    if (!lirisWebContentsId) {
      const text = 'Liris-Browser ist nicht offen. Bitte auf der Recall-Seite Liris öffnen.'
      setStatusMsg({ kind: 'err', text })
      reportUploadFehler(it, text)
      return
    }
    setUploadingId(it.id)
    // Patientenakte automatisch in Liris öffnen (per PID), damit der Import
    // nicht voraussetzt, dass der Patient schon offen ist.
    if (it.pid) {
      setStatusMsg({ kind: 'ok', text: 'Öffne Patientenakte in Liris…' })
      openWithPid(it.pid)
      await new Promise(r => setTimeout(r, 4500))  // auf das Laden der Akte warten
    }
    setStatusMsg({ kind: 'ok', text: 'Auto-Import läuft…' })
    try {
      const res = await electronApi.autoImportToLiris(lirisWebContentsId, it.tmpPath, it.arzt || '')
      if (res.log) { console.log('%c[Auto-Import] Ablauf:', 'color:#16a34a;font-weight:bold'); res.log.forEach(l => console.log('  ' + l)) }
      if (res.ok) {
        setStatusMsg({ kind: 'ok', text: '✓ Ins Liris hochgeladen' })
        toast.success(`Brief ins Liris hochgeladen (${it.vorname || it.filename})`)
        markUploaded(it.id)
      } else {
        setStatusMsg({ kind: 'err', text: res.error || 'Unbekannter Fehler', log: res.log })
        reportUploadFehler(it, res.error || 'Unbekannter Fehler', res.log)
      }
    } catch (e) {
      setStatusMsg({ kind: 'err', text: String(e) })
      reportUploadFehler(it, String(e))
    } finally {
      setUploadingId(null)
    }
  }

  // Auto-Import: Briefe mit autoUpload-Flag (aus «Per Post» / «Per E-Mail»)
  // automatisch ins Liris hochladen — einzeln, nacheinander. Fehlgeschlagene
  // werden NICHT endlos wiederholt (autoTried-Set). Wenn Liris/Electron nicht
  // verfügbar ist, bleibt der Brief liegen (kein Fehler-Spam, manueller Fallback).
  const autoTried = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (uploadingId) return  // ein Upload läuft bereits → seriell abarbeiten
    const next = items.find(it => it.autoUpload && !it.uploaded && !autoTried.current.has(it.id))
    if (!next) return
    if (!electronApi?.autoImportToLiris || !lirisWebContentsId || !next.tmpPath) return
    autoTried.current.add(next.id)
    // Panel bleibt bewusst minimiert — läuft im Hintergrund, Badge zeigt Anzahl/Status.
    uploadToLiris(next)
  }, [items, uploadingId, lirisWebContentsId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Panel ist immer sichtbar — auch leer — damit der User direkt sieht
  // wo Briefe landen. Bei leerem Postausgang verkleinert sich der Button
  // und wirkt dezenter (kein Anzahl-Badge).

  const handleDragStart = (e: React.DragEvent, it: PostausgangItem) => {
    // Drag muss synchron initiiert werden — preventDefault() + IPC-send
    // moeglichst im selben Tick, sonst startDrag kommt zu spaet und der
    // Browser-Default-Drag wird abgebrochen.
    console.log('[Postausgang] dragstart', it.filename, 'tmpPath:', it.tmpPath)
    if (it.tmpPath && electronApi?.startPdfDrag) {
      e.preventDefault()
      electronApi.startPdfDrag(it.tmpPath).catch(err => console.warn('[Postausgang] startPdfDrag failed', err))
      return
    }
    // Browser-Fallback: blob als URL anbieten (kein echter File-Drop ins
    // Liris-Webview moeglich, aber Drag innerhalb der Seite funktioniert).
    try {
      const url = URL.createObjectURL(it.blob)
      e.dataTransfer.setData('DownloadURL', `application/pdf:${it.filename}:${url}`)
      e.dataTransfer.setData('text/uri-list', url)
    } catch (err) { console.warn('[Postausgang] DataTransfer fallback failed', err) }
  }

  const mailOne = async (it: PostausgangItem) => {
    if (!it.tmpPath || !electronApi?.openMailWithAttachments) { setStatusMsg({ kind: 'err', text: 'Nur in der Electron-App verfügbar.' }); return }
    const res = await electronApi.openMailWithAttachments([it.tmpPath], `Aufgebotsbrief ${it.vorname}${it.pid ? ' #' + it.pid : ''}`, PRAXIS_EMAIL, 'Aufgebotsbrief im Anhang zum Drucken/Versenden.')
    if (res.ok) { markVersendet([it.id]); setStatusMsg({ kind: 'ok', text: `✓ E-Mail an ${PRAXIS_EMAIL} vorbereitet — bitte in Outlook senden.` }) }
    else setStatusMsg({ kind: 'err', text: 'E-Mail fehlgeschlagen: ' + (res.error || 'unbekannt') })
  }

  // Gebuendelt an die Praxis (info@augenzentrum-suhr.ch) — fuer Home-Office-
  // Mitarbeiter die Briefe erstellt aber nicht drucken konnten. Nach dem
  // Versand gelten die Patienten als aufgeboten (markVersendet -> RecallPage
  // loest 'aufgeboten markieren' aus).
  const mailAllToPraxis = async () => {
    const offen = visibleItems.filter(i => !i.versendet && !i.uploaded)
    if (offen.length === 0) { setStatusMsg({ kind: 'ok', text: 'Keine offenen Briefe zum Senden.' }); return }
    if (!electronApi?.openMailWithAttachments || !electronApi?.writePdfTmp) {
      setStatusMsg({ kind: 'err', text: 'Nur in der Electron-App verfügbar (App-Update nötig).' }); return
    }
    setMerging(true)
    setStatusMsg({ kind: 'ok', text: 'E-Mail wird vorbereitet…' })
    try {
      // Alle offenen Briefe zu EINER PDF buendeln (wie beim Drucken).
      const merged = await PDFDocument.create()
      for (const it of offen) {
        const bytes = await it.blob.arrayBuffer()
        const src = await PDFDocument.load(bytes)
        const pages = await merged.copyPages(src, src.getPageIndices())
        pages.forEach(p => merged.addPage(p))
      }
      const out = await merged.save()
      const today = new Date().toISOString().slice(0, 10)
      const tmp = await electronApi.writePdfTmp(out.buffer as ArrayBuffer, `Aufgebotsbriefe_${today}.pdf`)
      if (!tmp.ok || !tmp.path) { setStatusMsg({ kind: 'err', text: 'PDF-Buendelung fehlgeschlagen: ' + (tmp.error || 'unbekannt') }); return }
      const body = `Beigefügt ${offen.length} Aufgebotsbrief(e) in einer PDF zum Ausdrucken und Versenden.`
      const res = await electronApi.openMailWithAttachments([tmp.path], 'E-Mail zum Ausdrucken und Versenden', PRAXIS_EMAIL, body)
      if (res.ok) {
        markVersendet(offen.map(i => i.id))
        setStatusMsg({ kind: 'ok', text: `✓ E-Mail an ${PRAXIS_EMAIL} vorbereitet (${offen.length} Briefe in 1 PDF) — bitte in Outlook senden.` })
      } else {
        setStatusMsg({ kind: 'err', text: 'E-Mail fehlgeschlagen: ' + (res.error || 'unbekannt') })
      }
    } catch (e) {
      setStatusMsg({ kind: 'err', text: 'Fehler: ' + String(e) })
    } finally {
      setMerging(false)
    }
  }

  // Alle Briefe zu EINEM PDF buendeln (pdf-lib) und als Vorschau anzeigen —
  // von dort kann gesammelt gedruckt werden.
  const printAll = async () => {
    // Per E-Mail versendete Briefe (skipPrint) muessen nicht gedruckt werden
    // — nur ins Liris hochgeladen. Aus dem Sammeldruck ausschliessen.
    const printable = visibleItems
    if (printable.length === 0) {
      setStatusMsg({ kind: 'ok', text: 'Nichts zu drucken — alle Briefe wurden per E-Mail versendet.' })
      return
    }
    if (merging) return
    setMerging(true)
    setStatusMsg(null)
    setPrintingIds(printable.map(i => i.id))
    try {
      const merged = await PDFDocument.create()
      for (const it of printable) {
        const bytes = await it.blob.arrayBuffer()
        const src = await PDFDocument.load(bytes)
        const pages = await merged.copyPages(src, src.getPageIndices())
        pages.forEach(p => merged.addPage(p))
      }
      const out = await merged.save()
      const url = URL.createObjectURL(new Blob([out.buffer as ArrayBuffer], { type: 'application/pdf' }))
      openPrint(url, `Sammeldruck — ${printable.length} Brief${printable.length === 1 ? '' : 'e'}`)
    } catch (e) {
      setStatusMsg({ kind: 'err', text: 'Buendeln fehlgeschlagen: ' + String(e) })
    } finally {
      setMerging(false)
    }
  }

  const closePrintPreview = () => {
    // Vor dem Schliessen nachfragen ob wirklich gedruckt wurde — nur dann
    // gelten die Briefe als "gedruckt" und werden (nach Liris-Upload)
    // automatisch aus dem Postausgang entfernt. Bei "Nein"/Abbruch bleiben
    // sie unangetastet liegen, damit nichts verloren geht.
    if (printingIds.length > 0) {
      const wurdeGedruckt = window.confirm('Wurde erfolgreich gedruckt?\n\nBei "Abbrechen"/"Nein" bleiben die Briefe im Postausgang erhalten.')
      if (wurdeGedruckt) markPrinted(printingIds)
    }
    if (printPreviewUrl) URL.revokeObjectURL(printPreviewUrl)
    setPrintPreviewUrl(null)
    setPrintAuto(false)
    setPrintingIds([])
  }

  return (
    <div className="fixed bottom-4 left-4 z-40">
      {open ? (
        <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[340px] max-h-[60vh] flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-primary-600" />
              <span className="text-sm font-bold text-gray-800">Postausgang</span>
              <span className="text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full font-semibold">{visibleItems.length}</span>
            </div>
            <div className="flex gap-1">
              {visibleItems.length > 0 && (
                <button onClick={printAll} disabled={merging} title="Alle Briefe gebuendelt drucken (mit Vorschau)" className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-primary-600 disabled:opacity-50">
                  {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                </button>
              )}
              {canMailPraxis && visibleItems.some(i => !i.versendet && !i.uploaded) && (
                <button onClick={mailAllToPraxis} title={`Alle offenen Briefe gebündelt an ${PRAXIS_EMAIL} senden`} className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-primary-600">
                  <Mail className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {visibleItems.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-xs py-8 px-4 text-center gap-2">
              <Inbox className="w-8 h-8 opacity-50" />
              <span>Keine vorbereiteten Briefe</span>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              {visibleItems.map(it => (
                <div
                  key={it.id}
                  draggable={canUploadLiris}
                  onDragStart={(e) => { if (canUploadLiris) handleDragStart(e, it) }}
                  title={canUploadLiris ? 'Ziehen zum Hochladen ins Liris' : undefined}
                  className={`group flex items-center gap-2 px-3 py-2 border-b border-gray-100 hover:bg-primary-50 ${canUploadLiris ? 'cursor-grab active:cursor-grabbing' : ''}`}
                >
                  {(it.uploaded || it.versendet)
                    ? <CheckCircle2 className="w-4 h-4 shrink-0 text-green-500" />
                    : <FileText className="w-4 h-4 shrink-0 text-blue-500" />}
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-semibold truncate ${(it.uploaded || it.versendet) ? 'text-green-700' : 'text-blue-700'}`}>{it.vorname || it.filename}</div>
                    <div className="text-[10px] text-gray-400 truncate">
                      {it.pid ? '#' + it.pid + ' · ' : ''}{it.arzt}
                      {it.uploaded && <span className="ml-1 text-green-600 font-semibold">· hochgeladen</span>}
                      {!it.uploaded && it.versendet && <span className="ml-1 text-green-600 font-semibold">· an Praxis gesendet</span>}
                    </div>
                  </div>
                  <button onClick={() => printOne(it)} title="Diesen Brief einzeln drucken" className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white text-gray-400 hover:text-primary-600 transition-opacity">
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                  {/* Liris-Upload & Mail-an-Praxis sind Electron-only — in der
                      Web-Version komplett ausblenden statt ausgrauen. */}
                  {!it.uploaded && canUploadLiris && (
                    <button onClick={() => uploadToLiris(it)} disabled={uploadingId === it.id} title="Auto-Import ins Liris: Dokument importieren + Arzt + Mail gesendet + Datei. Patient muss in Liris geoeffnet sein." className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white text-gray-400 hover:text-green-600 transition-opacity disabled:opacity-50">
                      <Upload className={`w-3.5 h-3.5 ${uploadingId === it.id ? 'animate-pulse' : ''}`} />
                    </button>
                  )}
                  {!it.versendet && !it.uploaded && canMailPraxis && (
                    <button onClick={() => mailOne(it)} title={`An ${PRAXIS_EMAIL} senden`} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white text-gray-400 hover:text-primary-600 transition-opacity">
                      <Mail className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => remove(it.id)} title="Loeschen" className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white text-gray-400 hover:text-red-500 transition-opacity">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Status / Fehler-Anzeige (statt window.alert) */}
          {statusMsg && (
            <div className={`px-3 py-2 border-t text-xs ${statusMsg.kind === 'ok' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{statusMsg.text}</span>
                <button onClick={() => setStatusMsg(null)} className="shrink-0 text-gray-400 hover:text-gray-600"><X className="w-3 h-3" /></button>
              </div>
              {statusMsg.log && statusMsg.log.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[10px] text-gray-500">Ablauf anzeigen</summary>
                  <ul className="mt-1 text-[10px] text-gray-500 leading-relaxed">
                    {statusMsg.log.map((l, i) => <li key={i}>• {l}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
          <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50 text-[10px] text-gray-400 text-center flex items-center justify-between">
            <span>Eintraege ziehen oder klicken</span>
            <span className="text-gray-300">v{appVersion}</span>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className={`flex items-center gap-2 px-3 py-2 rounded-full shadow-lg transition-colors ${
            visibleItems.length > 0
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'bg-white text-gray-400 border border-gray-200 hover:bg-gray-50'
          }`}
          title={visibleItems.length > 0 ? `${visibleItems.length} Brief${visibleItems.length === 1 ? '' : 'e'} im Postausgang` : 'Postausgang (leer)'}
        >
          <Inbox className="w-4 h-4" />
          {visibleItems.length > 0 && <span className="text-xs font-bold">{visibleItems.length}</span>}
        </button>
      )}

      {/* Sammeldruck-Vorschau: alle Briefe zu einem PDF gebuendelt */}
      {printPreviewUrl && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black/60">
          <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 shadow-sm">
            <span className="font-semibold text-gray-800 text-sm">{printPreviewTitle}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const frame = document.getElementById('postausgang-print-frame') as HTMLIFrameElement | null
                  triggerPrint(frame?.contentWindow)
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold transition-colors"
              >
                <Printer className="w-4 h-4" /> Drucken
              </button>
              <button onClick={closePrintPreview} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <iframe
            id="postausgang-print-frame"
            src={printPreviewUrl}
            onLoad={e => {
              // Druckdialog automatisch starten, sobald die PDF geladen ist.
              if (!printAuto) return
              triggerPrint(e.currentTarget.contentWindow)
            }}
            className="flex-1 w-full border-none bg-gray-200"
            title="Druckvorschau"
          />
        </div>
      )}
    </div>
  )
}
