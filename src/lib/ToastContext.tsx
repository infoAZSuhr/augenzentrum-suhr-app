import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '../utils/cn'

/**
 * Globales Toast-Notifications-System.
 *
 * Nutzung:
 *   const toast = useToast()
 *   toast.success('Patient gespeichert')
 *   toast.error('Speichern fehlgeschlagen')
 *   toast.info('5 Datensätze importiert')
 *   toast.warning('Bestand kritisch')
 *
 * Toasts werden unten rechts gestapelt, schließen sich automatisch nach
 * ~3 Sek (Fehler bleiben 6 Sek), klickbar zum Schließen.
 *
 * Provider muss um die App liegen — siehe App.tsx.
 */

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id:       number
  kind:     ToastKind
  message:  string
  duration: number   // ms, 0 = nicht auto-dismissen
}

interface ToastApi {
  show:    (message: string, kind?: ToastKind, durationMs?: number) => number
  success: (message: string, durationMs?: number) => number
  error:   (message: string, durationMs?: number) => number
  warning: (message: string, durationMs?: number) => number
  info:    (message: string, durationMs?: number) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const DEFAULT_DURATIONS: Record<ToastKind, number> = {
  success: 3000,
  info:    3000,
  warning: 5000,
  error:   6000,
}

let idCounter = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts(ts => ts.filter(t => t.id !== id))
    const handle = timers.current.get(id)
    if (handle) {
      clearTimeout(handle)
      timers.current.delete(id)
    }
  }, [])

  const show = useCallback((message: string, kind: ToastKind = 'info', durationMs?: number) => {
    const id = idCounter++
    const duration = durationMs ?? DEFAULT_DURATIONS[kind]
    setToasts(ts => [...ts, { id, kind, message, duration }])
    if (duration > 0) {
      const handle = setTimeout(() => dismiss(id), duration)
      timers.current.set(id, handle)
    }
    return id
  }, [dismiss])

  // Cleanup beim Unmount
  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout)
      timers.current.clear()
    }
  }, [])

  const api: ToastApi = {
    show,
    success: (m, d) => show(m, 'success', d),
    error:   (m, d) => show(m, 'error',   d),
    warning: (m, d) => show(m, 'warning', d),
    info:    (m, d) => show(m, 'info',    d),
    dismiss,
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Falls Provider fehlt: gib einen no-op Stub zurück. Verhindert Crashes
    // in Tests / Storybook / Komponenten ohne Provider, statt zu werfen.
    const noop = () => 0
    return {
      show:    noop, success: noop, error: noop, warning: noop, info: noop,
      dismiss: () => {},
    }
  }
  return ctx
}

// ── UI ──────────────────────────────────────────────────────────────────────

const KIND_STYLES: Record<ToastKind, { bg: string; border: string; text: string; iconColor: string; Icon: typeof CheckCircle2 }> = {
  success: { bg: 'bg-green-50',  border: 'border-green-300',  text: 'text-green-800',  iconColor: 'text-green-600',  Icon: CheckCircle2 },
  error:   { bg: 'bg-red-50',    border: 'border-red-300',    text: 'text-red-800',    iconColor: 'text-red-600',    Icon: AlertCircle },
  warning: { bg: 'bg-amber-50',  border: 'border-amber-300',  text: 'text-amber-900',  iconColor: 'text-amber-600',  Icon: AlertTriangle },
  info:    { bg: 'bg-blue-50',   border: 'border-blue-300',   text: 'text-blue-800',   iconColor: 'text-blue-600',   Icon: Info },
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map(t => {
        const s = KIND_STYLES[t.kind]
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg',
              'animate-in slide-in-from-right-4 fade-in duration-200',
              s.bg, s.border, s.text
            )}
          >
            <s.Icon className={cn('w-5 h-5 shrink-0 mt-0.5', s.iconColor)} />
            <p className="text-sm leading-snug flex-1 break-words">{t.message}</p>
            <button
              onClick={() => onDismiss(t.id)}
              className="shrink-0 p-1 -m-1 rounded hover:bg-black/5 transition-colors"
              aria-label="Schliessen"
            >
              <X className="w-3.5 h-3.5 opacity-60" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
