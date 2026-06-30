/**
 * Firestore-Wrapper für das Glossar (Abkürzungen + Erklärungen).
 *
 * Daten-Modell (Collection: glossar):
 *   {
 *     abbreviation: string   // z.B. "OCT"  (= document id wäre möglich, hier
 *                            //   aber eigene id, damit Umbenennung erlaubt ist)
 *     explanation:  string
 *     updatedAt:    Timestamp
 *     updatedBy?:   string
 *   }
 *
 * Beim ersten App-Start wird die Collection vom GlossarContext aus den
 * Defaults (src/lib/glossar.ts) automatisch befüllt.
 */
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, onSnapshot, serverTimestamp, writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './firebase'

export interface GlossarEntry {
  id:           string
  abbreviation: string
  explanation:  string
  updatedAt?:   unknown
  updatedBy?:   string
}

const COL = 'glossar'

export function subscribeGlossar(cb: (entries: GlossarEntry[]) => void): Unsubscribe {
  return onSnapshot(collection(db, COL), snap => {
    const entries = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as Omit<GlossarEntry, 'id'>) }))
      .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation, 'de'))
    cb(entries)
  })
}

export async function fetchGlossarOnce(): Promise<GlossarEntry[]> {
  const snap = await getDocs(collection(db, COL))
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<GlossarEntry, 'id'>) }))
}

export async function addGlossarEntry(abbreviation: string, explanation: string, by?: string): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    abbreviation: abbreviation.trim(),
    explanation:  explanation.trim(),
    updatedAt:    serverTimestamp(),
    updatedBy:    by ?? null,
  })
  return ref.id
}

export async function updateGlossarEntry(id: string, abbreviation: string, explanation: string, by?: string): Promise<void> {
  await updateDoc(doc(db, COL, id), {
    abbreviation: abbreviation.trim(),
    explanation:  explanation.trim(),
    updatedAt:    serverTimestamp(),
    updatedBy:    by ?? null,
  })
}

export async function deleteGlossarEntry(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}

/** Bulk-Insert für das initiale Seeding aus den Defaults. */
export async function seedGlossarFromDefaults(defaults: Record<string, string>, by?: string): Promise<number> {
  const entries = Object.entries(defaults)
  let written = 0
  // Firestore-Batch erlaubt max. 500 Operationen
  for (let i = 0; i < entries.length; i += 400) {
    const batch  = writeBatch(db)
    const chunk  = entries.slice(i, i + 400)
    for (const [abbreviation, explanation] of chunk) {
      const ref = doc(collection(db, COL))
      batch.set(ref, {
        abbreviation,
        explanation,
        updatedAt: serverTimestamp(),
        updatedBy: by ?? 'auto-seed',
      })
      written += 1
    }
    await batch.commit()
  }
  return written
}

/**
 * Entfernt doppelte Glossar-Einträge (gleiche Abkürzung mehrfach vorhanden,
 * z.B. durch mehrfaches Seeden). Pro Abkürzung bleibt EIN Eintrag erhalten:
 * bevorzugt der zuletzt aktualisierte; bei Gleichstand der mit der längeren
 * Erklärung. Gibt die Anzahl der gelöschten Duplikate zurück.
 */
export async function dedupeGlossar(): Promise<number> {
  const snap = await getDocs(collection(db, COL))
  const byAbbr = new Map<string, GlossarEntry[]>()
  for (const d of snap.docs) {
    const e = { id: d.id, ...(d.data() as Omit<GlossarEntry, 'id'>) }
    const key = (e.abbreviation || '').trim()
    if (!key) continue
    const arr = byAbbr.get(key); if (arr) arr.push(e); else byAbbr.set(key, [e])
  }
  const toDelete: string[] = []
  const ts = (e: GlossarEntry) => {
    const u = e.updatedAt as { seconds?: number } | null | undefined
    return u && typeof u.seconds === 'number' ? u.seconds : 0
  }
  for (const [, group] of byAbbr) {
    if (group.length < 2) continue
    // Behalten: neuester Stamp, dann längere Erklärung.
    group.sort((a, b) => ts(b) - ts(a) || (b.explanation || '').length - (a.explanation || '').length)
    for (let i = 1; i < group.length; i++) toDelete.push(group[i].id)
  }
  for (let i = 0; i < toDelete.length; i += 400) {
    const batch = writeBatch(db)
    for (const id of toDelete.slice(i, i + 400)) batch.delete(doc(db, COL, id))
    await batch.commit()
  }
  return toDelete.length
}

/**
 * Schreibt alle Default-Einträge, die in Firestore noch fehlen, nach.
 * Bereits vorhandene Abkürzungen werden NICHT überschrieben (Admin-Edits
 * bleiben intakt). Gibt die Anzahl der hinzugefügten Einträge zurück.
 */
export async function syncMissingDefaults(
  defaults: Record<string, string>,
  existingAbbreviations: Set<string>,
  by?: string,
): Promise<number> {
  const missing = Object.entries(defaults).filter(([abbr]) => !existingAbbreviations.has(abbr))
  if (missing.length === 0) return 0
  let written = 0
  for (let i = 0; i < missing.length; i += 400) {
    const batch = writeBatch(db)
    const chunk = missing.slice(i, i + 400)
    for (const [abbreviation, explanation] of chunk) {
      const ref = doc(collection(db, COL))
      batch.set(ref, {
        abbreviation,
        explanation,
        updatedAt: serverTimestamp(),
        updatedBy: by ?? 'sync-defaults',
      })
      written += 1
    }
    await batch.commit()
  }
  return written
}
