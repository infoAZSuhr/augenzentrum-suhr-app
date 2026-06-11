import { useState } from 'react'
import { Mail, Trash2, X, FileText, Inbox, Upload } from 'lucide-react'
import { usePostausgang, type PostausgangItem } from '../../contexts/PostausgangContext'
import { useBrowser } from '../../contexts/BrowserContext'

interface ElectronPostausgangApi {
  startPdfDrag?: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  openMailWithAttachments?: (filePaths: string[], subject: string) => Promise<{ ok: boolean; error?: string }>
  uploadPdfToLiris?: (webContentsId: number, filePath: string) => Promise<{ ok: boolean; error?: string }>
  autoImportToLiris?: (webContentsId: number, filePath: string, doctorLastName: string) => Promise<{ ok: boolean; error?: string }>
}

/** Schwebendes Mini-Panel unten rechts. Zeigt die Liste vorbereiteter
 *  Brief-PDFs mit Aktionen pro Eintrag: Drag&Drop ins Liris, per Mail
 *  versenden, loeschen. */
export default function PostausgangPanel() {
  const { items, remove } = usePostausgang()
  const { lirisWebContentsId } = useBrowser()
  const [open, setOpen] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const electronApi = (window as unknown as { electronApp?: ElectronPostausgangApi }).electronApp

  // Voll-Automatik: Arzt waehlen + 'Mail gesendet' + Datei. Vorbedingung:
  // User hat in Liris "Dokument importieren" geoeffnet (Arzt-Auswahl sichtbar).
  const uploadToLiris = async (it: PostausgangItem) => {
    if (!it.tmpPath || !electronApi?.autoImportToLiris) { alert('Nur in der Electron-App verfuegbar (App-Update noetig).'); return }
    if (!lirisWebContentsId) { alert('Liris-Browser ist nicht offen. Bitte zuerst Liris oeffnen (Recall-Seite).'); return }
    setUploadingId(it.id)
    try {
      const res = await electronApi.autoImportToLiris(lirisWebContentsId, it.tmpPath, it.arzt || '')
      if (res.ok) {
        remove(it.id)
      } else {
        alert('Auto-Import fehlgeschlagen:\n' + (res.error || 'unbekannt') + '\n\nBitte sicherstellen, dass der richtige Patient in Liris geoeffnet ist. Der Rest (Dokument importieren, Arzt, Mail gesendet, Datei) laeuft automatisch.')
      }
    } catch (e) {
      alert('Auto-Import fehlgeschlagen: ' + String(e))
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
                  <FileText className="w-4 h-4 shrink-0 text-primary-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-800 truncate">{it.vorname || it.filename}</div>
                    <div className="text-[10px] text-gray-400 truncate">{it.pid ? '#' + it.pid + ' · ' : ''}{it.arzt}</div>
                  </div>
                  <button onClick={() => uploadToLiris(it)} disabled={uploadingId === it.id} title="Auto-Import ins Liris: Dokument importieren + Arzt + Mail gesendet + Datei. Patient muss in Liris geoeffnet sein." className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white text-gray-400 hover:text-green-600 transition-opacity disabled:opacity-50">
                    <Upload className={`w-3.5 h-3.5 ${uploadingId === it.id ? 'animate-pulse' : ''}`} />
                  </button>
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
          <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50 text-[10px] text-gray-400 text-center">
            Eintraege ziehen oder klicken
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
    </div>
  )
}
