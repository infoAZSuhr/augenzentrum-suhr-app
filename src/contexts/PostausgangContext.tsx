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
  createdAt:   number
}

interface PostausgangContextType {
  items: PostausgangItem[]
  add: (item: Omit<PostausgangItem, 'id' | 'createdAt'>) => Promise<PostausgangItem>
  remove: (id: string) => void
  clear: () => void
}

const PostausgangContext = createContext<PostausgangContextType>({
  items: [],
  add: async () => { throw new Error('Provider missing') },
  remove: () => {},
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

  const clear = useCallback(() => {
    if (electronApi?.deletePdfTmp) {
      items.forEach(i => { if (i.tmpPath) electronApi.deletePdfTmp!(i.tmpPath).catch(() => {}) })
    }
    setItems([])
  }, [items, electronApi])

  // Warnung beim Schliessen wenn Postausgang nicht leer
  useEffect(() => {
    if (items.length === 0) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = `Es liegen noch ${items.length} unbearbeitete Briefe im Postausgang. Wirklich schliessen?`
      return e.returnValue
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [items.length])

  return (
    <PostausgangContext.Provider value={{ items, add, remove, clear }}>
      {children}
    </PostausgangContext.Provider>
  )
}

export const usePostausgang = () => useContext(PostausgangContext)
