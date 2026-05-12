import { useState, useRef, useCallback } from 'react'

export function useDraggable() {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return
    e.preventDefault()
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }

    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setPos({
        x: dragRef.current.ox + ev.clientX - dragRef.current.sx,
        y: dragRef.current.oy + ev.clientY - dragRef.current.sy,
      })
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [pos])

  const style: React.CSSProperties = {
    transform: `translate(${pos.x}px, ${pos.y}px)`,
  }

  return { style, onHeaderMouseDown }
}
