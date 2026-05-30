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
