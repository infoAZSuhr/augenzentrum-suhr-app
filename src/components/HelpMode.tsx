import { useEffect, useRef } from 'react'
import { X, BookOpen } from 'lucide-react'
import { HELP_TEXTS, PAGE_HELP, type HelpEntry } from '../lib/helpTexts'
import { Link } from 'react-router-dom'

function getPageHelp(): HelpEntry | null {
  // HashRouter: location is after the #
  const hash = window.location.hash.replace('#', '') || '/'
  // Try exact match, then prefix match (e.g. /ivom/patient/123 → /ivom)
  if (PAGE_HELP[hash]) return PAGE_HELP[hash]
  const prefix = Object.keys(PAGE_HELP)
    .filter(k => k.length > 1 && hash.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return prefix ? PAGE_HELP[prefix] : PAGE_HELP['/'] ?? null
}

interface HelpTooltipProps {
  entry: HelpEntry
  position: { x: number; y: number }
  onClose: () => void
}

export function HelpTooltip({ entry, position, onClose }: HelpTooltipProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Adjust position so tooltip stays within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    top: Math.min(position.y + 12, window.innerHeight - 200),
    left: Math.min(position.x, window.innerWidth - 320),
    maxWidth: 300,
  }

  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  return (
    <div ref={ref} style={style} className="bg-white rounded-xl shadow-xl border border-primary-200 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-gray-900">{entry.title}</p>
        <button onClick={onClose} className="p-0.5 rounded text-gray-400 hover:text-gray-600 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-gray-600 leading-relaxed">{entry.text}</p>
      {entry.section && (
        <Link
          to={`/hilfe#${entry.section}`}
          onClick={onClose}
          className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
        >
          <BookOpen className="w-3 h-3" />
          Benutzerhandbuch →
        </Link>
      )}
    </div>
  )
}

interface HelpModeOverlayProps {
  active: boolean
  tooltip: { entry: HelpEntry; position: { x: number; y: number } } | null
  onTooltipClose: () => void
  onTooltipOpen: (entry: HelpEntry, position: { x: number; y: number }) => void
}

export function HelpModeOverlay({ active, tooltip, onTooltipClose, onTooltipOpen }: HelpModeOverlayProps) {
  useEffect(() => {
    if (!active) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // Never intercept the help-toggle button itself
      if (target.closest('[data-help-toggle]')) return

      const helpEl = target.closest('[data-help]') as HTMLElement | null

      if (helpEl) {
        const key = helpEl.getAttribute('data-help')!
        const entry = HELP_TEXTS[key]
        if (entry) {
          e.stopPropagation()
          onTooltipOpen(entry, { x: e.clientX, y: e.clientY })
          return
        }
      }

      // Fallback: try to describe the element itself
      const el = e.target as HTMLElement
      const tag = el.tagName.toLowerCase()
      const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 60)
      const role = el.getAttribute('role') || (tag === 'button' ? 'button' : tag === 'a' ? 'link' : '')

      let fallbackEntry: HelpEntry | null = null

      if (role === 'button' || tag === 'button') {
        fallbackEntry = {
          title: text || 'Schaltfläche',
          text: text ? `Schaltfläche: "${text}"` : 'Eine Schaltfläche zum Ausführen einer Aktion.',
        }
      } else if (role === 'link' || tag === 'a') {
        fallbackEntry = {
          title: text || 'Link',
          text: text ? `Link: "${text}"` : 'Ein Link zur Navigation.',
        }
      } else if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        const label = el.closest('label')?.innerText?.trim() || el.getAttribute('placeholder') || ''
        fallbackEntry = {
          title: label || 'Eingabefeld',
          text: label ? `Eingabefeld für: "${label}"` : 'Ein Eingabefeld.',
        }
      } else {
        // Use page-level fallback
        fallbackEntry = getPageHelp()
      }

      if (fallbackEntry) {
        onTooltipOpen(fallbackEntry, { x: e.clientX, y: e.clientY })
      } else {
        onTooltipClose()
      }
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [active, onTooltipOpen, onTooltipClose])

  if (!active) return null

  return (
    <>
      {/* Banner */}
      <div className="fixed top-14 left-0 right-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="bg-primary-600 text-white text-xs font-semibold px-4 py-1.5 rounded-b-xl shadow-lg pointer-events-auto">
          Hilfe-Modus aktiv — klicken Sie auf ein Element für eine Erklärung
        </div>
      </div>

      {/* Help cursor overlay (transparent, captures no clicks itself) */}
      <style>{`* { cursor: help !important; }`}</style>

      {/* Highlight elements with data-help on hover */}
      <style>{`[data-help]:hover { outline: 2px solid #6366f1 !important; outline-offset: 2px !important; border-radius: 6px; }`}</style>

      {tooltip && (
        <HelpTooltip
          entry={tooltip.entry}
          position={tooltip.position}
          onClose={onTooltipClose}
        />
      )}
    </>
  )
}
