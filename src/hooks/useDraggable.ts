import { useState, useRef, useCallback } from 'react'

const savedPositions = new Map<string, { x: number; y: number }>()

export function useDraggable(key?: string) {
  const initial = key ? savedPositions.get(key) ?? { x: 0, y: 0 } : { x: 0, y: 0 }
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
      if (key) savedPositions.set(key, next)
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
