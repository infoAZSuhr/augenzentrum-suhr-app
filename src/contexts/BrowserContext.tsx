import { createContext, useContext, useState, type ReactNode } from 'react'

interface BrowserContextType {
  isOpen: boolean
  selectedText: string
  defaultUrl: string
  pendingPid: string | null
  toggle: () => void
  open: () => void
  close: () => void
  setSelectedText: (t: string) => void
  setDefaultUrl: (url: string) => void
  openWithPid: (pid: string) => void
  clearPendingPid: () => void
}

const BrowserContext = createContext<BrowserContextType>({
  isOpen: false,
  selectedText: '',
  defaultUrl: 'https://vip.liris.ch',
  pendingPid: null,
  toggle: () => {},
  open: () => {},
  close: () => {},
  setSelectedText: () => {},
  setDefaultUrl: () => {},
  openWithPid: () => {},
  clearPendingPid: () => {},
})

export function BrowserProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [defaultUrl, setDefaultUrl] = useState('https://vip.liris.ch')
  const [pendingPid, setPendingPid] = useState<string | null>(null)

  return (
    <BrowserContext.Provider value={{
      isOpen,
      selectedText,
      defaultUrl,
      pendingPid,
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
    }}>
      {children}
    </BrowserContext.Provider>
  )
}

export const useBrowser = () => useContext(BrowserContext)
