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
  autoUpload?: boolean        // true → Postausgang-Panel importiert automatisch ins Liris
  versendet?:  boolean        // true sobald gebuendelt per E-Mail an die Praxis versandt
  recallSaved?: boolean       // true sobald der Recall-Patient als 'aufgeboten' markiert wurde
  aufgebot?:   unknown        // Payload (patient + form) fuer das automatische 'aufgeboten markieren'
  createdAt:   number
}

interface PostausgangContextType {
  items: PostausgangItem[]
  add: (item: Omit<PostausgangItem, 'id' | 'createdAt'>) => Promise<PostausgangItem>
  remove: (id: string) => void
  markUploaded: (id: string) => void
  markVersendet: (ids: string[]) => void
  markRecallSaved: (id: string) => void
  clear: () => void
}

const PostausgangContext = createContext<PostausgangContextType>({
  items: [],
  add: async () => { throw new Error('Provider missing') },
  remove: () => {},
  markUploaded: () => {},
  markVersendet: () => {},
  markRecallSaved: () => {},
  clear: () => {},
})

interface ElectronPostausgangApi {
  writePdfTmp?: (blob: ArrayBuffer, filename: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  startPdfDrag?: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  openMailWithAttachments?: (filePaths: string[], subject: string) => Promise<{ ok: boolean; error?: string }>
  deletePdfTmp?: (filePath: string) => Promise<{ ok: boolean }>
}

export function PostausgangProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<PostausgangItem[]>([])

  const electronApi = (typeof window !== 'undefined'
    ? (window as unknown as { electronApp?: ElectronPostausgangApi }).electronApp
    : undefined)

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

  const markVersendet = useCallback((ids: string[]) => {
    const set = new Set(ids)
    setItems(prev => prev.map(i => set.has(i.id) ? { ...i, versendet: true } : i))
  }, [])

  const markRecallSaved = useCallback((id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, recallSaved: true } : i))
  }, [])

  const clear = useCallback(() => {
    if (electronApi?.deletePdfTmp) {
      items.forEach(i => { if (i.tmpPath) electronApi.deletePdfTmp!(i.tmpPath).catch(() => {}) })
    }
    setItems([])
  }, [items, electronApi])

  // Warnung beim Schliessen nur wenn noch NICHT hochgeladene Briefe haengen
  const pendingCount = items.filter(i => !i.uploaded && !i.versendet).length
  useEffect(() => {
    if (pendingCount === 0) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = `Es liegen noch ${pendingCount} unbearbeitete Briefe im Postausgang. Wirklich schliessen?`
      return e.returnValue
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [pendingCount])

  return (
    <PostausgangContext.Provider value={{ items, add, remove, markUploaded, markVersendet, markRecallSaved, clear }}>
      {children}
    </PostausgangContext.Provider>
  )
}

export const usePostausgang = () => useContext(PostausgangContext)
