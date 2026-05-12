import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw, Home, Globe } from 'lucide-react'

const HOME_URL = 'https://www.google.com'

export default function BrowserPanel() {
  const [url, setUrl] = useState(HOME_URL)
  const [inputUrl, setInputUrl] = useState(HOME_URL)
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const webviewRef = useRef<HTMLElement>(null)

  const navigate = (target: string) => {
    let finalUrl = target.trim()
    if (!finalUrl) return
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      // Check if it looks like a domain or is a search query
      if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
        finalUrl = 'https://' + finalUrl
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`
      }
    }
    setUrl(finalUrl)
    setInputUrl(finalUrl)
  }

  useEffect(() => {
    const wv = webviewRef.current as any
    if (!wv) return

    const onStart = () => setIsLoading(true)
    const onStop = () => {
      setIsLoading(false)
      setInputUrl(wv.getURL?.() || url)
      setCanGoBack(wv.canGoBack?.() ?? false)
      setCanGoForward(wv.canGoForward?.() ?? false)
    }
    const onDomReady = () => {
      setInputUrl(wv.getURL?.() || url)
      setCanGoBack(wv.canGoBack?.() ?? false)
      setCanGoForward(wv.canGoForward?.() ?? false)
    }

    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('dom-ready', onDomReady)

    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('dom-ready', onDomReady)
    }
  }, [url])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') navigate(inputUrl)
  }

  const goBack = () => (webviewRef.current as any)?.goBack?.()
  const goForward = () => (webviewRef.current as any)?.goForward?.()
  const reload = () => (webviewRef.current as any)?.reload?.()

  return (
    <div className="flex flex-col h-full bg-gray-100">
      {/* Adressleiste */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 flex-shrink-0">
        <button
          onClick={goBack}
          disabled={!canGoBack}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={goForward}
          disabled={!canGoForward}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={reload}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <RotateCcw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={() => navigate(HOME_URL)}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <Home className="w-4 h-4" />
        </button>

        {/* URL-Eingabe */}
        <div className="flex-1 relative">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={e => e.target.select()}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-100 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300 focus:bg-white transition-colors"
            placeholder="URL oder Suchbegriff eingeben…"
          />
        </div>
      </div>

      {/* Hinweis */}
      <div className="px-4 py-1.5 bg-primary-50 border-b border-primary-100 text-xs text-primary-700 flex items-center gap-2 flex-shrink-0">
        <span>💡 Tipp: Text auf der Website markieren und direkt in Eingabefelder der App ziehen</span>
      </div>

      {/* Webview */}
      <div className="flex-1 overflow-hidden">
        {/* @ts-ignore - webview is an Electron element */}
        <webview
          ref={webviewRef}
          src={url}
          style={{ width: '100%', height: '100%', display: 'flex' }}
          allowpopups="true"
        />
      </div>
    </div>
  )
}
