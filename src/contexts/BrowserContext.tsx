import { createContext, useContext, useState, type ReactNode } from 'react'

/** Daten die aus dem Liris-Webview nach PID-Inject extrahiert wurden.
 *  Wird vom BrowserPanel gesetzt und kann z.B. von RecallPage konsumiert
 *  werden um leere Felder (Geburtsdatum, Arzt) automatisch zu fuellen. */
export interface LirisExtract {
  pid:              string              // PID die wir gesendet haben
  pidMatchesLiris?: boolean             // true wenn unsere PID im Liris-Text vorkommt
  vorname?:         string | null       // Patient-Name aus Liris-Header
  gebDatum?:        string | null       // ISO YYYY-MM-DD — Geburtsdatum
  autor?:           string | null       // Name (oben rechts in Liris-Untersuchung)
  letzteKons?:      string | null       // ISO YYYY-MM-DD — Datum der Untersuchung
  intervalWeeks?:   number | null       // Naechster-Termin-Intervall in Wochen (z.B. 4 fuer "in 4 Wochen")
  notFound?:        boolean             // Liris meldete "Kein Patient / nicht gefunden"
  at:               number              // Timestamp damit Consumer nur frisches sehen
}

interface BrowserContextType {
  isOpen: boolean
  selectedText: string
  defaultUrl: string
  pendingPid: string | null
  lirisExtract: LirisExtract | null
  toggle: () => void
  open: () => void
  close: () => void
  setSelectedText: (t: string) => void
  setDefaultUrl: (url: string) => void
  openWithPid: (pid: string) => void
  clearPendingPid: () => void
  setLirisExtract: (e: LirisExtract | null) => void
}

const BrowserContext = createContext<BrowserContextType>({
  isOpen: false,
  selectedText: '',
  defaultUrl: 'https://vip.liris.ch',
  pendingPid: null,
  lirisExtract: null,
  toggle: () => {},
  open: () => {},
  close: () => {},
  setSelectedText: () => {},
  setDefaultUrl: () => {},
  openWithPid: () => {},
  clearPendingPid: () => {},
  setLirisExtract: () => {},
})

export function BrowserProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [defaultUrl, setDefaultUrl] = useState('https://vip.liris.ch')
  const [pendingPid, setPendingPid] = useState<string | null>(null)
  const [lirisExtract, setLirisExtract] = useState<LirisExtract | null>(null)

  return (
    <BrowserContext.Provider value={{
      isOpen,
      selectedText,
      defaultUrl,
      pendingPid,
      lirisExtract,
      toggle: () => setIsOpen(o => !o),
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      setSelectedText,
      setDefaultUrl,
      openWithPid: (pid: string) => {
        const withHash = pid.startsWith('#') ? pid : `#${pid}`
        setPendingPid(withHash)
        setIsOpen(true)
      },
      clearPendingPid: () => setPendingPid(null),
      setLirisExtract,
    }}>
      {children}
    </BrowserContext.Provider>
  )
}

export const useBrowser = () => useContext(BrowserContext)
