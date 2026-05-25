import { useEffect, useRef } from 'react'

export function useAutoFocus<T extends HTMLElement>(enabled: boolean = true) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (!enabled) return
    const id = requestAnimationFrame(() => ref.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [enabled])
  return ref
}
