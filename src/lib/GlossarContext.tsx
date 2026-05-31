import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { subscribeGlossar, fetchGlossarOnce, seedGlossarFromDefaults, type GlossarEntry } from './firestoreGlossar'
import { GLOSSAR as DEFAULT_GLOSSAR } from './glossar'
import { useAuth } from './AuthContext'

interface GlossarContextType {
  entries:  GlossarEntry[]            // echte Firestore-Einträge (leer bis seeded)
  map:      Record<string, string>    // abbreviation → explanation (immer befüllt:
                                      // Firestore wenn vorhanden, sonst Defaults)
  loading:  boolean
  seeded:   boolean                   // true, sobald Firestore-Collection befüllt ist
}

const GlossarContext = createContext<GlossarContextType>({
  entries: [],
  map:     DEFAULT_GLOSSAR,
  loading: true,
  seeded:  false,
})

export function GlossarProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<GlossarEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [seeded,  setSeeded]  = useState(false)
  const { profile } = useAuth()
  const isApproved = profile?.status === 'approved' && !profile?.locked

  // Live-Subscription
  useEffect(() => {
    const unsub = subscribeGlossar(es => {
      setEntries(es)
      setLoading(false)
      if (es.length > 0) setSeeded(true)
    })
    return unsub
  }, [])

  // Auto-Seed: wenn Collection leer und User ist *irgendein* approved Staff
  // (nicht nur Admin/GL) → Defaults schreiben. So sehen auch MPAs / Ärzte
  // den Glossar sofort, wenn sie die ersten sind, die die App öffnen.
  // Race-Condition-Schutz: vor dem Schreiben nochmals via fetchGlossarOnce()
  // prüfen, ob inzwischen jemand anderes geseedet hat.
  useEffect(() => {
    if (loading) return
    if (seeded)  return
    if (!isApproved) return
    let cancelled = false
    ;(async () => {
      const fresh = await fetchGlossarOnce()
      if (cancelled) return
      if (fresh.length > 0) {
        setSeeded(true)
        return
      }
      const by = profile?.displayName || profile?.username || 'system'
      try {
        const count = await seedGlossarFromDefaults(DEFAULT_GLOSSAR, by)
        console.log(`[Glossar] ${count} Default-Einträge angelegt`)
      } catch (err) {
        // Ein anderer User war schneller, oder Permissions: Defaults bleiben
        // als Fallback aktiv (siehe map unten), daher kein UI-Schaden.
        console.warn('[Glossar] Auto-Seed übersprungen:', err)
      }
    })()
    return () => { cancelled = true }
  }, [loading, seeded, isApproved, profile?.displayName, profile?.username])

  // Map: Firestore-Einträge wenn vorhanden, sonst Defaults als Fallback.
  // Damit sehen Nutzer *immer* die Tooltips — auch in der kurzen Phase
  // zwischen App-Start und Auto-Seed, und auch wenn der Seed (z.B. wegen
  // Permission-Edge-Case) nicht durchgelaufen ist.
  const map = useMemo(() => {
    if (entries.length === 0) return DEFAULT_GLOSSAR
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
