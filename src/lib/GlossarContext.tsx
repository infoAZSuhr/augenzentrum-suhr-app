import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { subscribeGlossar, fetchGlossarOnce, seedGlossarFromDefaults, type GlossarEntry } from './firestoreGlossar'
import { GLOSSAR as DEFAULT_GLOSSAR } from './glossar'
import { useAuth } from './AuthContext'

interface GlossarContextType {
  entries:  GlossarEntry[]
  map:      Record<string, string>   // abbreviation → explanation (für expandAbbreviations)
  loading:  boolean
  seeded:   boolean                  // true, sobald die Collection nicht mehr leer ist
}

const GlossarContext = createContext<GlossarContextType>({
  entries: [],
  map:     {},
  loading: true,
  seeded:  false,
})

export function GlossarProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<GlossarEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [seeded,  setSeeded]  = useState(false)
  const { profile, isAdmin, isGeschaeftsleitung } = useAuth()

  // Live-Subscription
  useEffect(() => {
    const unsub = subscribeGlossar(es => {
      setEntries(es)
      setLoading(false)
      if (es.length > 0) setSeeded(true)
    })
    return unsub
  }, [])

  // Auto-Seed: wenn Collection leer und User ist Admin/GL → Defaults schreiben.
  // Nutzt einen Einmalcheck statt Subscription-State, um Race-Conditions zu vermeiden.
  useEffect(() => {
    if (loading) return
    if (seeded)  return
    if (!isAdmin && !isGeschaeftsleitung) return
    let cancelled = false
    ;(async () => {
      // Doppelt prüfen, ob wirklich noch leer
      const fresh = await fetchGlossarOnce()
      if (cancelled) return
      if (fresh.length > 0) {
        setSeeded(true)
        return
      }
      const by = profile?.displayName || profile?.username || 'system'
      const count = await seedGlossarFromDefaults(DEFAULT_GLOSSAR, by)
      console.log(`[Glossar] ${count} Default-Einträge angelegt`)
    })()
    return () => { cancelled = true }
  }, [loading, seeded, isAdmin, isGeschaeftsleitung, profile?.displayName, profile?.username])

  const map = useMemo(() => {
    const m: Record<string, string> = {}
    for (const e of entries) {
      if (e.abbreviation && e.explanation) m[e.abbreviation] = e.explanation
    }
    return m
  }, [entries])

  return (
    <GlossarContext.Provider value={{ entries, map, loading, seeded }}>
      {children}
    </GlossarContext.Provider>
  )
}

export function useGlossar() {
  return useContext(GlossarContext)
}
