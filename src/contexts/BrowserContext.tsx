import { createContext, useContext, useState, type ReactNode } from 'react'

interface BrowserContextType {
  isOpen: boolean
  selectedText: string
  defaultUrl: string
  toggle: () => void
  open: () => void
  close: () => void
  setSelectedText: (t: string) => void
  setDefaultUrl: (url: string) => void
}

const BrowserContext = createContext<BrowserContextType>({
  isOpen: false,
  selectedText: '',
  defaultUrl: 'https://vip.liris.ch',
  toggle: () => {},
  open: () => {},
  close: () => {},
  setSelectedText: () => {},
  setDefaultUrl: () => {},
})

export function BrowserProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [defaultUrl, setDefaultUrl] = useState('https://vip.liris.ch')

  return (
    <BrowserContext.Provider value={{
      isOpen,
      selectedText,
      defaultUrl,
      toggle: () => setIsOpen(o => !o),
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      setSelectedText,
      setDefaultUrl,
    }}>
      {children}
    </BrowserContext.Provider>
  )
}

export const useBrowser = () => useContext(BrowserContext)
