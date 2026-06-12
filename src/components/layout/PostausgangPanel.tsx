import { useState } from 'react'
import { Mail, Trash2, X, FileText, Inbox, Upload, Printer, CheckCircle2, Loader2 } from 'lucide-react'
import { usePostausgang, type PostausgangItem } from '../../contexts/PostausgangContext'
import { useBrowser } from '../../contexts/BrowserContext'

interface ElectronPostausgangApi {
  startPdfDrag?: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  openMailWithAttachments?: (filePaths: string[], subject: string) => Promise<{ ok: boolean; error?: string }>
  uploadPdfToLiris?: (webContentsId: number, filePath: string) => Promise<{ ok: boolean; error?: string }>
  autoImportToLiris?: (webContentsId: number, filePath: string, doctorLastName: string) => Promise<{ ok: boolean; error?: string; log?: string[] }>
}

/** Schwebendes Mini-Panel unten rechts. Zeigt die Liste vorbereiteter
 *  Brief-PDFs mit Aktionen pro Eintrag: Drag&Drop ins Liris, per Mail
 *  versenden, loeschen. */
export default function PostausgangPanel() {
  const { items, remove, markUploaded } = usePostausgang()
  const { lirisWebContentsId } = useBrowser()
  const [open, setOpen] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string; log?: string[] } | null>(null)
  const [printPreviewUrl, setPrintPreviewUrl] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const electronApi = (window as unknown as { electronApp?: ElectronPostausgangApi }).electronApp
  const appVersion = (window as unknown as { electronApp?: { version?: string } }).electronApp?.version || '—'

  // Voll-Automatik: Arzt waehlen + 'Mail gesendet' + Datei. Vorbedingung:
  // Patient ist in Liris geoeffnet.
  const uploadToLiris = async (it: PostausgangItem) => {
    setStatusMsg(null)
    if (!it.tmpPath || !electronApi?.autoImportToLiris) {
      setStatusMsg({ kind: 'err', text: `Auto-Import nicht verfügbar — App-Update nötig (aktuell v${appVersion}, mind. v1.1.22).` })
      return
    }
    if (!lirisWebContentsId) {
      setStatusMsg({ kind: 'err', text: 'Liris-Browser ist nicht offen. Bitte auf der Recall-Seite Liris öffnen.' })
      return
    }
    setUploadingId(it.id)
    setStatusMsg({ kind: 'ok', text: 'Auto-Import läuft…' })
    try {
      const res = await electronApi.autoImportToLiris(lirisWebContentsId, it.tmpPath, it.arzt || '')
      if (res.log) { console.log('%c[Auto-Import] Ablauf:', 'color:#16a34a;font-weight:bold'); res.log.forEach(l => console.log('  ' + l)) }
      if (res.ok) {
        setStatusMsg({ kind: 'ok', text: '✓ Ins Liris hochgeladen' })
        markUploaded(it.id)
      } else {
        setStatusMsg({ kind: 'err', text: res.error || 'Unbekannter Fehler', log: res.log })
      }
    } catch (e) {
      setStatusMsg({ kind: 'err', text: String(e) })
    } finally {
      setUploadingId(null)
    }
  }

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
    if (!it.tmpPath) { alert('Datei nicht verfuegbar — in Electron-App nutzen.'); return }
    if (electronApi?.openMailWithAttachments) {
      await electronApi.openMailWithAttachments([it.tmpPath], `Brief ${it.vorname}${it.pid ? ' #' + it.pid : ''}`)
    }
  }

  const mailAll = async () => {
    const paths = items.map(i => i.tmpPath).filter(Boolean) as string[]
    if (paths.length === 0) return
    if (electronApi?.openMailWithAttachments) {
      await electronApi.openMailWithAttachments(paths, `${paths.length} Briefe aus Augenzentrum Suhr`)
    }
  }

  // Alle Briefe zu EINEM PDF buendeln (pdf-lib) und als Vorschau anzeigen —
  // von dort kann gesammelt gedruckt werden.
  const printAll = async () => {
    if (items.length === 0 || merging) return
    setMerging(true)
    setStatusMsg(null)
    try {
      const { PDFDocument } = await import('pdf-lib')
      const merged = await PDFDocument.create()
      for (const it of items) {
        const bytes = await it.blob.arrayBuffer()
        const src = await PDFDocument.load(bytes)
        const pages = await merged.copyPages(src, src.getPageIndices())
        pages.forEach(p => merged.addPage(p))
      }
      const out = await merged.save()
      const url = URL.createObjectURL(new Blob([out.buffer as ArrayBuffer], { type: 'application/pdf' }))
      setPrintPreviewUrl(url)
    } catch (e) {
      setStatusMsg({ kind: 'err', text: 'Buendeln fehlgeschlagen: ' + String(e) })
    } finally {
      setMerging(false)
    }
  }

  const closePrintPreview = () => {
    if (printPreviewUrl) URL.revokeObjectURL(printPreviewUrl)
    setPrintPreviewUrl(null)
  }

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {open ? (
        <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[340px] max-h-[60vh] flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-primary-600" />
              <span className="text-sm font-bold text-gray-800">Postausgang</span>
              <span className="text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full font-semibold">{items.length}</span>
            </div>
            <div className="flex gap-1">
              {items.length > 0 && (
                <button onClick={printAll} disabled={merging} title="Alle Briefe gebuendelt drucken (mit Vorschau)" className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-primary-600 disabled:opacity-50">
                  {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                </button>
              )}
              {items.length > 1 && (
                <button onClick={mailAll} title="Alle per E-Mail" className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-primary-600">
                  <Mail className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-xs py-8 px-4 text-center gap-2">
              <Inbox className="w-8 h-8 opacity-50" />
              <span>Keine vorbereiteten Briefe</span>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              {items.map(it => (
                <div
                  key={it.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, it)}
                  title="Ziehen zum Hochladen ins Liris"
                  className="group flex items-center gap-2 px-3 py-2 border-b border-gray-100 hover:bg-primary-50 cursor-grab active:cursor-grabbing"
                >
                  {it.uploaded
                    ? <CheckCircle2 className="w-4 h-4 shrink-0 text-green-500" />
                    : <FileText className="w-4 h-4 shrink-0 text-blue-500" />}
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-semibold truncate ${it.uploaded ? 'text-green-700' : 'text-blue-700'}`}>{it.vorname || it.filename}</div>
                    <div className="text-[10px] text-gray-400 truncate">
                      {it.pid ? '#' + it.pid + ' · ' : ''}{it.arzt}
                      {it.uploaded && <span className="ml-1 text-green-600 font-semibold">· hochgeladen</span>}
                    </div>
                  </div>
                  {!it.uploaded && (
                    <button onClick={() => uploadToLiris(it)} disabled={uploadingId === it.id} title="Auto-Import ins Liris: Dokument importieren + Arzt + Mail gesendet + Datei. Patient muss in Liris geoeffnet sein." className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white text-gray-400 hover:text-green-600 transition-opacity disabled:opacity-50">
                      <Upload className={`w-3.5 h-3.5 ${uploadingId === it.id ? 'animate-pulse' : ''}`} />
                    </button>
                  )}
                  <button onClick={() => mailOne(it)} title="Per E-Mail" className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white text-gray-400 hover:text-primary-600 transition-opacity">
                    <Mail className="w-3.5 h-3.5" />
                  </button>
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
            items.length > 0
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'bg-white text-gray-400 border border-gray-200 hover:bg-gray-50'
          }`}
          title={items.length > 0 ? `${items.length} Brief${items.length === 1 ? '' : 'e'} im Postausgang` : 'Postausgang (leer)'}
        >
          <Inbox className="w-4 h-4" />
          {items.length > 0 && <span className="text-xs font-bold">{items.length}</span>}
        </button>
      )}

      {/* Sammeldruck-Vorschau: alle Briefe zu einem PDF gebuendelt */}
      {printPreviewUrl && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black/60">
          <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 shadow-sm">
            <span className="font-semibold text-gray-800 text-sm">
              Sammeldruck — {items.length} Brief{items.length === 1 ? '' : 'e'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const frame = document.getElementById('postausgang-print-frame') as HTMLIFrameElement | null
                  frame?.contentWindow?.print()
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
            className="flex-1 w-full border-none bg-gray-200"
            title="Sammeldruck-Vorschau"
          />
        </div>
      )}
    </div>
  )
}
