import { useState, useRef, useCallback } from 'react'

const savedPositions = new Map<string, { x: number; y: number }>()

// Position zusätzlich in localStorage, damit sie auch nach App-Neustart
// erhalten bleibt (Nutzerwunsch 2026-08-01: Fenster behält seine Position).
function loadPos(key: string): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(`drag-pos:${key}`)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p?.x !== 'number' || typeof p?.y !== 'number') return null
    // Sicherheitsnetz: gespeicherte Position könnte (z.B. nach Monitorwechsel)
    // ausserhalb des sichtbaren Bereichs liegen — dann zurücksetzen.
    if (Math.abs(p.x) > window.innerWidth || Math.abs(p.y) > window.innerHeight) return null
    return p
  } catch { return null }
}

export function useDraggable(key?: string) {
  const initial = key ? savedPositions.get(key) ?? loadPos(key) ?? { x: 0, y: 0 } : { x: 0, y: 0 }
  const [pos, setPos] = useState(initial)
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return
    e.preventDefault()
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }

    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const next = {
        x: dragRef.current.ox + ev.clientX - dragRef.current.sx,
        y: dragRef.current.oy + ev.clientY - dragRef.current.sy,
      }
      setPos(next)
      if (key) {
        savedPositions.set(key, next)
        try { localStorage.setItem(`drag-pos:${key}`, JSON.stringify(next)) } catch { /* ignore */ }
      }
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [pos, key])

  const style: React.CSSProperties = {
    transform: `translate(${pos.x}px, ${pos.y}px)`,
  }

  return { style, onHeaderMouseDown }
}
