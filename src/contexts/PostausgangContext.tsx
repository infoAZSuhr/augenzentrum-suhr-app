import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

/** Ein zum Versand vorbereiteter Brief. Blob liegt im Arbeitsspeicher;
 *  optional liegt eine temporaere Datei auf der Platte (path), die fuer
 *  Drag&Drop ins Liris und Mail-Attachment gebraucht wird. */
export interface PostausgangItem {
  id:          string
  pid:         string | null
  vorname:     string
  arzt:        string
  filename:    string
  blob:        Blob
  tmpPath?:    string         // gesetzt durch Electron-IPC (write-pdf-tmp)
  uploaded?:   boolean        // true sobald erfolgreich ins Liris hochgeladen
  printed?:    boolean        // true sobald gedruckt (Druckdialog gestartet)
  autoUpload?: boolean        // true → Postausgang-Panel importiert automatisch ins Liris
  skipPrint?: boolean         // true → Brief wurde per E-Mail versendet, muss NICHT gedruckt werden (nur Liris-Upload)
  versendet?:  boolean        // true sobald gebuendelt per E-Mail an die Praxis versandt
  // Payload (patient + form) — nur noch fuer die "Haengende Briefe"-Anzeige
  // im Sicherheitsnetz. Das 'aufgeboten markieren' selbst passiert seit dem
  // Klick auf Per Post/Per E-Mail sofort (nicht mehr abhaengig vom Liris-
  // Upload dieses Postausgang-Items).
  aufgebot?:   unknown
  createdAt:   number
}

interface PostausgangContextType {
  items: PostausgangItem[]
  restoredCount: number   // Anzahl beim Start wiederhergestellter Briefe (fuer die Erinnerung)
  add: (item: Omit<PostausgangItem, 'id' | 'createdAt'>) => Promise<PostausgangItem>
  remove: (id: string) => void
  markUploaded: (id: string) => void
  markPrinted: (ids: string[]) => void
  markVersendet: (ids: string[]) => void
  clear: () => void
}

const PostausgangContext = createContext<PostausgangContextType>({
  items: [],
  restoredCount: 0,
  add: async () => { throw new Error('Provider missing') },
  remove: () => {},
  markUploaded: () => {},
  markPrinted: () => {},
  markVersendet: () => {},
  clear: () => {},
})

interface ElectronPostausgangApi {
  writePdfTmp?: (blob: ArrayBuffer, filename: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  startPdfDrag?: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  openMailWithAttachments?: (filePaths: string[], subject: string) => Promise<{ ok: boolean; error?: string }>
  deletePdfTmp?: (filePath: string) => Promise<{ ok: boolean }>
}

// ── Persistenz (IndexedDB) ────────────────────────────────────────────────
// Die Brief-PDFs lagen frueher NUR im Arbeitsspeicher — ein Reload/Absturz
// verwarf sie kommentarlos und der Druck wurde vergessen. Jetzt wird jeder
// Brief (inkl. PDF-Blob) in IndexedDB gespeichert und beim Start
// wiederhergestellt, bis er wirklich gedruckt/hochgeladen und entfernt ist.
const IDB_NAME = 'azs-postausgang'
const IDB_STORE = 'items'
function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE, { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbSaveAll(items: PostausgangItem[]): Promise<void> {
  const db = await openIdb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const store = tx.objectStore(IDB_STORE)
    store.clear()
    // tmpPath nicht persistieren — die Temp-Datei ueberlebt den Neustart
    // evtl. nicht und wird beim Restore neu geschrieben. aufgebot-Payload
    // per JSON-Runde entschaerfen (koennte Nicht-Klonbares enthalten, das
    // sonst die GANZE Transaktion und damit alle Briefe scheitern liesse).
    for (const it of items) {
      let aufgebot: unknown
      try { aufgebot = it.aufgebot ? JSON.parse(JSON.stringify(it.aufgebot)) : undefined } catch { aufgebot = undefined }
      store.put({ ...it, tmpPath: undefined, aufgebot })
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
async function idbLoadAll(): Promise<PostausgangItem[]> {
  const db = await openIdb()
  const items = await new Promise<PostausgangItem[]>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).getAll()
    req.onsuccess = () => resolve((req.result as PostausgangItem[]) ?? [])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export function PostausgangProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<PostausgangItem[]>([])
  const [restoredCount, setRestoredCount] = useState(0)

  const electronApi = (typeof window !== 'undefined'
    ? (window as unknown as { electronApp?: ElectronPostausgangApi }).electronApp
    : undefined)

  // Beim Start gespeicherte Briefe wiederherstellen; fuer Electron die
  // Temp-Dateien (Drag&Drop/Upload) neu schreiben.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const restored = await idbLoadAll()
        if (cancelled || restored.length === 0) return
        if (electronApi?.writePdfTmp) {
          for (const it of restored) {
            try {
              const res = await electronApi.writePdfTmp(await it.blob.arrayBuffer(), it.filename)
              if (res.ok && res.path) it.tmpPath = res.path
            } catch { /* Brief bleibt ohne tmpPath nutzbar (Druck geht via Blob) */ }
          }
        }
        if (cancelled) return
        setItems(prev => {
          const have = new Set(prev.map(i => i.id))
          return [...restored.filter(r => !have.has(r.id)), ...prev]
        })
        setRestoredCount(restored.length)
      } catch (e) { console.warn('[Postausgang] Restore fehlgeschlagen', e) }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Jede Aenderung persistieren — so ueberleben Briefe Reload & Neustart.
  useEffect(() => {
    idbSaveAll(items).catch(e => console.warn('[Postausgang] Persistieren fehlgeschlagen', e))
  }, [items])

  const add = useCallback(async (item: Omit<PostausgangItem, 'id' | 'createdAt'>) => {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random()
    let tmpPath: string | undefined
    // Falls Electron verfuegbar: PDF in eine temporaere Datei schreiben,
    // damit Drag&Drop und Mail-Attachments funktionieren.
    if (electronApi?.writePdfTmp) {
      try {
        const buf = await item.blob.arrayBuffer()
        const res = await electronApi.writePdfTmp(buf, item.filename)
        if (res.ok && res.path) tmpPath = res.path
        else console.warn('[Postausgang] writePdfTmp fehlgeschlagen:', res.error)
      } catch (e) { console.warn('[Postausgang] writePdfTmp exception:', e) }
    }
    const full: PostausgangItem = { ...item, id, tmpPath, createdAt: Date.now() }
    setItems(prev => [full, ...prev])
    return full
  }, [electronApi])

  const remove = useCallback((id: string) => {
    setItems(prev => {
      const target = prev.find(i => i.id === id)
      if (target?.tmpPath && electronApi?.deletePdfTmp) {
        electronApi.deletePdfTmp(target.tmpPath).catch(() => {})
      }
      return prev.filter(i => i.id !== id)
    })
  }, [electronApi])

  const markUploaded = useCallback((id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, uploaded: true } : i))
  }, [])

  const markPrinted = useCallback((ids: string[]) => {
    const set = new Set(ids)
    setItems(prev => prev.map(i => set.has(i.id) ? { ...i, printed: true } : i))
  }, [])

  const markVersendet = useCallback((ids: string[]) => {
    const set = new Set(ids)
    setItems(prev => prev.map(i => set.has(i.id) ? { ...i, versendet: true } : i))
  }, [])

  const clear = useCallback(() => {
    if (electronApi?.deletePdfTmp) {
      items.forEach(i => { if (i.tmpPath) electronApi.deletePdfTmp!(i.tmpPath).catch(() => {}) })
    }
    setItems([])
  }, [items, electronApi])

  // Warnung beim Schliessen nur wenn noch NICHT hochgeladene Briefe haengen.
  // NUR im Browser: Electron zeigt bei beforeunload KEINEN Dialog, sondern
  // blockiert das Schliessen still und dauerhaft — die App liess sich weder
  // beenden noch aktualisieren, solange ein Brief im Postausgang hing.
  const isElectron = typeof window !== 'undefined' && !!(window as { electronApp?: unknown }).electronApp
  const pendingCount = items.filter(i => !i.uploaded && !i.versendet).length
  useEffect(() => {
    if (isElectron || pendingCount === 0) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = `Es liegen noch ${pendingCount} unbearbeitete Briefe im Postausgang. Wirklich schliessen?`
      return e.returnValue
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [pendingCount, isElectron])

  return (
    <PostausgangContext.Provider value={{ items, restoredCount, add, remove, markUploaded, markPrinted, markVersendet, clear }}>
      {children}
    </PostausgangContext.Provider>
  )
}

export const usePostausgang = () => useContext(PostausgangContext)
