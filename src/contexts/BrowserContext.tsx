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
  anrede?:          string | null       // "Herr" / "Frau" / "Familie" aus Patient-Header
  postAdresse?:     string | null       // Multi-line: Strasse / PLZ Ort aus Kontaktangaben-Block
  email?:           string | null       // E-Mail-Adresse aus Kontaktangaben (falls vorhanden)
  bpKeywords?:      string[]            // Schlagwoerter aus Beurteilung+Prozedere (z.B. Myd, OCT)
  naechsterTerminDatum?: string | null  // ISO YYYY-MM-DD eines zukuenftigen Liris-Termins
  naechsterTerminZeit?:  string | null  // HH:MM eines zukuenftigen Liris-Termins
  at:               number              // Timestamp damit Consumer nur frisches sehen
}

/** Anfrage aus dem Liris-Kalender: User hat einen Patienten angeklickt.
 *  RecallPage konsumiert das und oeffnet das passende Edit-Popup. */
export interface RecallPidRequest {
  pid: string
  at:  number
}

/** Anfrage: Patient ist in Liris vorhanden aber nicht im Recall —
 *  RecallPage soll die Neu-Erfassung mit den vorhandenen Daten oeffnen. */
export interface RecallNewRequest {
  pid:  string
  name: string
  geb:  string   // ISO YYYY-MM-DD oder ''
  at:   number
}

interface BrowserContextType {
  isOpen: boolean
  selectedText: string
  defaultUrl: string
  pendingPid: string | null
  lirisExtract: LirisExtract | null
  recallPidRequest: RecallPidRequest | null
  recallNewRequest: RecallNewRequest | null
  staleRecallPids: string[]                  // Normalisierte PIDs (nur Ziffern, ohne Leading-Zeros) die im Recall stehen und seit dem Referenzdatum nicht mehr aktualisiert wurden
  knownRecallPids: string[]                  // Alle PIDs die ueberhaupt im Recall stehen — fuer Detektion "in Liris vorhanden aber nicht im Recall"
  staleReferenceDate: string                 // ISO YYYY-MM-DD — Schwellwert: Patient gilt als OK wenn aktualisiert >= diesem Datum
  toggle: () => void
  open: () => void
  close: () => void
  setSelectedText: (t: string) => void
  setDefaultUrl: (url: string) => void
  openWithPid: (pid: string) => void
  clearPendingPid: () => void
  setLirisExtract: (e: LirisExtract | null) => void
  requestRecallByPid: (pid: string) => void
  clearRecallPidRequest: () => void
  requestRecallNew: (data: { pid: string; name?: string; geb?: string }) => void
  clearRecallNewRequest: () => void
  setStaleRecallPids: (pids: string[]) => void
  setKnownRecallPids: (pids: string[]) => void
  setStaleReferenceDate: (iso: string) => void
}

const BrowserContext = createContext<BrowserContextType>({
  isOpen: false,
  selectedText: '',
  defaultUrl: 'https://vip.liris.ch',
  pendingPid: null,
  lirisExtract: null,
  recallPidRequest: null,
  recallNewRequest: null,
  staleRecallPids: [],
  knownRecallPids: [],
  staleReferenceDate: new Date().toISOString().slice(0, 10),
  toggle: () => {},
  open: () => {},
  close: () => {},
  setSelectedText: () => {},
  setDefaultUrl: () => {},
  openWithPid: () => {},
  clearPendingPid: () => {},
  setLirisExtract: () => {},
  requestRecallByPid: () => {},
  clearRecallPidRequest: () => {},
  requestRecallNew: () => {},
  clearRecallNewRequest: () => {},
  setStaleRecallPids: () => {},
  setKnownRecallPids: () => {},
  setStaleReferenceDate: () => {},
})

export function BrowserProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [defaultUrl, setDefaultUrl] = useState('https://vip.liris.ch')
  const [pendingPid, setPendingPid] = useState<string | null>(null)
  const [lirisExtract, setLirisExtract] = useState<LirisExtract | null>(null)
  const [recallPidRequest, setRecallPidRequest] = useState<RecallPidRequest | null>(null)
  const [recallNewRequest, setRecallNewRequest] = useState<RecallNewRequest | null>(null)
  const [staleRecallPids, setStaleRecallPids] = useState<string[]>([])
  const [knownRecallPids, setKnownRecallPids] = useState<string[]>([])
  const [staleReferenceDate, setStaleReferenceDate] = useState<string>(() => new Date().toISOString().slice(0, 10))

  return (
    <BrowserContext.Provider value={{
      isOpen,
      selectedText,
      defaultUrl,
      pendingPid,
      lirisExtract,
      recallPidRequest,
      recallNewRequest,
      staleRecallPids,
      knownRecallPids,
      staleReferenceDate,
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
      requestRecallByPid: (pid: string) => setRecallPidRequest({ pid, at: Date.now() }),
      clearRecallPidRequest: () => setRecallPidRequest(null),
      requestRecallNew: (data) => setRecallNewRequest({ pid: data.pid, name: data.name || '', geb: data.geb || '', at: Date.now() }),
      clearRecallNewRequest: () => setRecallNewRequest(null),
      setStaleRecallPids,
      setKnownRecallPids,
      setStaleReferenceDate,
    }}>
      {children}
    </BrowserContext.Provider>
  )
}

export const useBrowser = () => useContext(BrowserContext)
