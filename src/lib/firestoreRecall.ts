import {
  collection, doc, getDocs, getDocsFromServer, setDoc, updateDoc, deleteDoc,
  writeBatch, query, where, limit, onSnapshot,
} from 'firebase/firestore'
import { db } from './firebase'

export interface Zuweisung {
  typ: 'intern' | 'extern'
  ziel: string          // arzt (intern) or provider/clinic (extern)
  grund: string
  datum: string         // YYYY-MM-DD – when decided
  status: 'ausstehend' | 'erledigt'
  erledigtAm: string    // YYYY-MM-DD or ''
  notiz: string
  von: string           // username who created it
}

export interface RecallPatient {
  id: string
  doctor: string
  pid: string | null
  name?: string | null        // kept for backward compat with existing Firestore docs; not displayed
  vorname: string | null
  gebDatum: string | null
  letzteKons: string | null
  naechsteKons: string | null
  storniert: string | null
  grundStornierung: string | null
  aufgebotFuer: string | null
  aufgebotErstellt: string | null   // date when the Aufgebot was actually created/sent
  aufgebotArt: string | null        // 'Brief' | 'Tel' | 'Reminder' | 'Praxis' | null
  aufgebotVersand: string | null    // 'Post' | 'Email' | null – how it was sent
  aufgebotNotiz: string | null      // Grundvermerk for Tel calls
  terminFixiert: string | null      // date when the appointment was confirmed/booked (YYYY-MM-DD)
  nachfassAdresse: string | null   // 'korrekt' | 'veraltet' | null
  nachfassTel: string | null       // 'erreicht' | 'nicht_erreicht' | null
  nachfassTelDatum: string | null  // YYYY-MM-DD
  verlauf: VerlaufEntry[] | null   // chronological log of contact attempts
  patientenStatus: string | null    // 'inaktiv' | 'verstorben' | 'Reminder' | 'kein Aufgebot' | null
  neupatient: boolean | null        // true = Neupatient, false/null = bestehender Patient
  erstellt: string | null
  aktualisiert: string | null
  zuweisung?: Zuweisung | null
}

export interface VerlaufEntry {
  datum: string     // YYYY-MM-DD
  aktion: string    // what was tried
  ergebnis: string  // result / note
  von: string       // username
  grund?: string    // optional reason / remark
}

export function recallTimestamp(username: string): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(now.getDate())}.${p(now.getMonth() + 1)}.${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())} – ${username}`
}

function cleanDate(val: string | null | undefined): string | null {
  if (!val || val === 'nan' || val === 'None' || val === 'NaT') return null
  const m = val.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : (val === 'kein Termin' ? 'kein Termin' : val)
}

export async function hasRecallData(): Promise<boolean> {
  const snap = await getDocs(query(collection(db, 'recall_patients'), limit(1)))
  return !snap.empty
}

export async function getRecallPatients(doctor: string): Promise<RecallPatient[]> {
  const q = query(collection(db, 'recall_patients'), where('doctor', '==', doctor))
  // Always read from server (not SDK cache) to get fresh data after writes
  const snap = await getDocsFromServer(q)
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as RecallPatient))
    .sort((a, b) => String(a.vorname ?? '').localeCompare(String(b.vorname ?? ''), 'de'))
}

export async function updateRecallPatient(
  id: string,
  data: Partial<Omit<RecallPatient, 'id' | 'doctor' | 'aktualisiert'>>,
  username: string
): Promise<void> {
  await updateDoc(doc(db, 'recall_patients', id), {
    ...data,
    aktualisiert: recallTimestamp(username),
  })
}

export async function createRecallPatient(
  doctor: string,
  data: Omit<RecallPatient, 'id' | 'doctor' | 'erstellt' | 'aktualisiert'>,
  username: string
): Promise<string> {
  const stamp = recallTimestamp(username)
  const ref = doc(collection(db, 'recall_patients'))
  await setDoc(ref, { ...data, doctor, erstellt: stamp, aktualisiert: null })
  return ref.id
}

export async function deleteRecallPatient(id: string): Promise<void> {
  await deleteDoc(doc(db, 'recall_patients', id))
}

/** Remove duplicate "Zu bearbeiten" documents.
 *  Groups by pid (fallback: vorname+gebDatum), keeps the zm_-prefixed doc
 *  (or the first one if no stable ID exists), deletes the rest.
 *  Returns the number of deleted documents. */
export async function deduplicateZuBearbeiten(): Promise<number> {
  const col  = collection(db, 'recall_patients')
  const snap = await getDocsFromServer(
    query(col, where('doctor', '==', 'Zu bearbeiten'))
  )

  // Group docs by dedup key
  const groups = new Map<string, typeof snap.docs>()
  for (const d of snap.docs) {
    const data = d.data()
    const pid  = data.pid ? String(data.pid).trim() : null
    const key  = pid
      ? `pid:${pid}`
      : `nv:${String(data.vorname ?? '')}|${String(data.gebDatum ?? '')}`
    const existing = groups.get(key) ?? []
    existing.push(d)
    groups.set(key, existing)
  }

  // Collect IDs to delete (keep preferred doc per group)
  const toDelete: string[] = []
  for (const docs of groups.values()) {
    if (docs.length <= 1) continue
    // Prefer the stable zm_-prefixed document
    const preferred =
      docs.find(d => d.id.startsWith('zm_')) ?? docs[0]
    for (const d of docs) {
      if (d.id !== preferred.id) toDelete.push(d.id)
    }
  }

  // Delete in batches of 499
  for (let i = 0; i < toDelete.length; i += 499) {
    const batch = writeBatch(db)
    for (const id of toDelete.slice(i, i + 499)) {
      batch.delete(doc(col, id))
    }
    await batch.commit()
  }

  return toDelete.length
}

export async function assignRecallPatient(
  id: string,
  doctor: string,
  username: string
): Promise<void> {
  await updateDoc(doc(db, 'recall_patients', id), {
    doctor,
    aktualisiert: recallTimestamp(username),
  })
}

/** Live-subscription: alle recall_patients die eine Zuweisung haben */
export function subscribeZuweisungPatients(
  callback: (patients: RecallPatient[]) => void
): () => void {
  return onSnapshot(
    collection(db, 'recall_patients'),
    snap => {
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as RecallPatient))
        .filter(p => p.zuweisung != null)
        .sort((a, b) => {
          // ausstehend first, then by datum desc
          if (a.zuweisung!.status !== b.zuweisung!.status) {
            return a.zuweisung!.status === 'ausstehend' ? -1 : 1
          }
          return (b.zuweisung!.datum ?? '').localeCompare(a.zuweisung!.datum ?? '')
        })
      callback(all)
    }
  )
}

export interface PidMatch {
  pid: string
  doctor: string
  name: string | null
  vorname: string | null
  gebDatum: string | null
}

/** Update pid field on matched recall docs (client-side lookup via allData) */
export async function applyPidSync(
  matches: PidMatch[],
  allData: Map<string, RecallPatient[]>,
): Promise<number> {
  const col = collection(db, 'recall_patients')

  // Build deduped map: docId → pid
  const updates = new Map<string, string>()
  for (const m of matches) {
    const candidates = allData.get(m.doctor) ?? []
    const patient = candidates.find(
      p => p.vorname === m.vorname && p.gebDatum === m.gebDatum
    )
    if (patient && !patient.pid) {
      updates.set(patient.id, m.pid)
    }
  }

  const entries = Array.from(updates.entries())
  for (let i = 0; i < entries.length; i += 499) {
    const batch = writeBatch(db)
    for (const [id, pid] of entries.slice(i, i + 499)) {
      batch.update(doc(col, id), { pid })
    }
    await batch.commit()
  }
  return entries.length
}

/** Derive a stable Firestore document ID for a Zu-bearbeiten patient.
 *  Same function used both when writing and when constructing local state. */
export function zuBearbStableId(p: Omit<RecallPatient, 'id' | 'doctor'>): string {
  const pid  = String(p.pid ?? '').replace(/[^a-zA-Z0-9]/g, '_')
  const geb  = String(p.gebDatum ?? '').replace(/[^0-9]/g, '')
  const base = pid ? `zm_${pid}` : `zm_${geb}_${String(p.vorname ?? '').slice(0, 8)}`
  return base.slice(0, 80)
}

/** Import unmatched Excel patients as doctor='Zu bearbeiten'.
 *  Uses a stable document ID derived from pid to prevent duplicates on repeated sync. */
export async function importUnmatched(
  patients: Omit<RecallPatient, 'id' | 'doctor'>[],
  username: string,
): Promise<number> {
  const col   = collection(db, 'recall_patients')
  const stamp = recallTimestamp(username)

  for (let i = 0; i < patients.length; i += 499) {
    const batch = writeBatch(db)
    for (const p of patients.slice(i, i + 499)) {
      batch.set(doc(col, zuBearbStableId(p)), { ...p, doctor: 'Zu bearbeiten', importedAt: stamp })
    }
    try {
      await batch.commit()
    } catch (err: any) {
      // Re-throw with batch index and Firestore error code so UI can display it
      const code = err?.code ?? 'unknown'
      throw new Error(`Batch ${Math.floor(i / 499) + 1} fehlgeschlagen (${code}): ${err?.message ?? err}`)
    }
  }
  return patients.length
}

export interface RecallSummary {
  total: number           // all assigned patients (excluding Zu bearbeiten)
  zuBearbeiten: number    // patients in "Zu bearbeiten"
  overdueRC: number       // active patients with aufgebotFuer in the past and no aufgebotErstellt
  keinTermin: number      // active patients with naechsteKons === 'kein Termin'
  reminderFaellig: number // active patients with a past-due Reminder entry
}

export async function getRecallSummary(): Promise<RecallSummary> {
  const col  = collection(db, 'recall_patients')
  const snap = await getDocs(col)   // uses SDK cache after first RecallPage visit
  const oneMonthAgo = new Date()
  oneMonthAgo.setUTCMonth(oneMonthAgo.getUTCMonth() - 1)
  const today = new Date().toISOString().slice(0, 10)
  let total = 0, zuBearbeiten = 0, overdueRC = 0, keinTermin = 0, reminderFaellig = 0
  for (const d of snap.docs) {
    const p = d.data()
    if (p.doctor === 'Zu bearbeiten') { zuBearbeiten++; continue }
    total++
    if (p.storniert === 'ja' || p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben') continue
    if (!p.aufgebotErstellt && p.aufgebotFuer && p.aufgebotFuer !== 'kein Termin') {
      const dt = new Date(String(p.aufgebotFuer) + 'T00:00:00Z')
      if (!isNaN(dt.getTime()) && dt <= oneMonthAgo) overdueRC++
    }
    if (p.naechsteKons === 'kein Termin') keinTermin++
    // Check for past-due Reminder entries
    if (Array.isArray(p.verlauf)) {
      let latestReminder: string | null = null
      for (const v of p.verlauf) {
        if (v.aktion !== 'Reminder') continue
        const m = String(v.ergebnis ?? '').match(/^Geplant:\s*(\d{4}-\d{2}-\d{2})/)
        if (!m) continue
        if (!latestReminder || m[1] > latestReminder) latestReminder = m[1]
      }
      if (latestReminder && latestReminder <= today) reminderFaellig++
    }
  }
  return { total, zuBearbeiten, overdueRC, keinTermin, reminderFaellig }
}

export async function importRecallData(
  jsonData: Record<string, Record<string, string | null>[]>,
  username: string
): Promise<void> {
  const col = collection(db, 'recall_patients')
  const stamp = recallTimestamp(username)
  const allDocs: Record<string, any>[] = []

  for (const [doctor, rows] of Object.entries(jsonData)) {
    for (const row of rows) {
      allDocs.push({
        doctor,
        name:              null,
        vorname:           row.vorname ?? null,
        gebDatum:          cleanDate(row.gebDatum),
        letzteKons:        cleanDate(row.letzteKons),
        naechsteKons:      row.naechsteKons === 'kein Termin' ? 'kein Termin' : cleanDate(row.naechsteKons),
        storniert:         row.storniert ?? null,
        grundStornierung:  row.grundStornierung ?? null,
        aufgebotFuer:      row.aufgebotFuer ?? null,
        erstellt:          row.erstellt ?? null,
        aktualisiert:      row.aktualisiert ?? null,
        importedAt:        stamp,
      })
    }
  }

  for (let i = 0; i < allDocs.length; i += 499) {
    const batch = writeBatch(db)
    for (const item of allDocs.slice(i, i + 499)) {
      batch.set(doc(col), item)
    }
    await batch.commit()
  }
}
