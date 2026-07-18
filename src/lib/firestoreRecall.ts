import {
  collection, doc, getDocs, getDoc, getDocsFromServer, setDoc, updateDoc, deleteDoc, addDoc,
  writeBatch, query, where, limit, onSnapshot, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { stripUndefined } from './firestoreSanitize'

// ── Activity-Log (immutable historisches Audit fuer die Auswertung) ──────────
// Jede User-Aktion (created, updated, aufgebot) schreibt einen Eintrag, der
// NIE veraendert oder geloescht wird. So bleibt die Auswertungs-Statistik
// auch nach spaeteren Patient-Aenderungen/Reassignments/Loeschungen stabil.

export type RecallActivityType =
  | 'created' | 'updated'
  | 'aufgebot_brief' | 'aufgebot_tel' | 'aufgebot_praxis' | 'reminder'
  | 'telefonanruf' | 'email' | 'noShow'

export interface RecallActivityLog {
  id?: string
  date:      string                  // YYYY-MM-DD
  user:      string                  // displayName / username
  type:      RecallActivityType
  patientId: string
  patientName?: string | null
  doctor?:   string                  // zum Zeitpunkt des Events zugewiesener Arzt
  details?:  string | null           // freie Notiz / Grund
  createdAt: Timestamp               // Server-seitig falls moeglich
}

/** Schreibt eine Aktivitaet ins Log — fire-and-forget (App soll nicht
 *  scheitern wenn das Log scheitert). */
export async function logRecallActivity(entry: Omit<RecallActivityLog, 'id' | 'createdAt'>): Promise<void> {
  try {
    await addDoc(collection(db, 'recall_activity_log'), {
      ...entry,
      createdAt: Timestamp.now(),
    })
  } catch (err) {
    console.warn('[Recall] activity log write failed:', err)
  }
}

/** Liest alle Activity-Log-Eintraege ab einem Stichtag (default: 1 Jahr zurueck). */
export async function loadRecallActivity(sinceIsoDate?: string): Promise<RecallActivityLog[]> {
  const since = sinceIsoDate ?? (() => {
    const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 1)
    return d.toISOString().slice(0, 10)
  })()
  const snap = await getDocs(query(collection(db, 'recall_activity_log'), where('date', '>=', since)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as RecallActivityLog))
}

export interface Zuweisung {
  id?: string           // stabile id innerhalb der Zuweisungs-Liste eines Patienten
  typ: 'intern' | 'extern'
  ziel: string          // arzt (intern) or provider/clinic (extern)
  grund: string
  datum: string         // YYYY-MM-DD – when assigned
  status: 'pendent' | 'erledigt' | 'abgesagt'   // abgesagt = Termin bei der Zielstelle wurde abgesagt (2026-07-18)
  erledigtAm: string    // YYYY-MM-DD or ''
  berichtErhalten: boolean
  berichtAngefragt?: boolean    // true sobald eine Bericht-Nachfrage verschickt wurde
  berichtAngefragtAm?: string   // YYYY-MM-DD – Datum der (letzten) Bericht-Nachfrage
  berichtTyp?: 'zwischen' | 'entlassung' | 'op' | 'befund' | 'abschluss'  // Legacy: einzelner Bericht (durch berichte[] ersetzt)
  berichtDatum?: string         // Legacy: Datum des einzelnen Berichts
  berichte?: { id?: string; typ: 'zwischen' | 'entlassung' | 'op' | 'befund' | 'abschluss'; datum: string; zusammenfassung?: string }[]  // mehrere Berichte moeglich (auch mehrfach vom selben Typ, z.B. 2x OP-Bericht bei beidseitiger Katarakt-OP), je mit eigenem Datum. zusammenfassung: optionale KI-Stichpunkt-Zusammenfassung aus manuell eingefuegtem Text (siehe summarizeBericht in lib/ai.ts)
  geplanterTermin?: string      // YYYY-MM-DD – von der externen Stelle mitgeteilter Behandlungstermin (interner Merker)
  log?: string[]                // Aenderungsverlauf: "DD.MM.YYYY HH:MM – username: was geaendert wurde" (auch nach Erledigt-Markierung nachbearbeitbar)
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
  zuweisung?: Zuweisung | null      // Legacy: einzelne Zuweisung (wird migriert)
  zuweisungen?: Zuweisung[] | null  // Mehrere Zuweisungen pro Patient (an verschiedene Orte)
  zuweisungNoetig?: boolean | null  // true = MPA hat markiert, dass eine Zuweisung noch aussteht (Erinnerung fuer ZW-Management)
  arztSeit?: string | null          // YYYY-MM-DD: seit wann dem aktuellen Arzt zugeteilt (gesetzt bei Umhaengung)
  letzterKonsArzt?: string | null   // Arzt (Tab-Name) der LETZTEN Konsultation — aus dem Liris-Autor beim Oeffnen der Akte
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

export async function getInactiveRecallPatients(): Promise<RecallPatient[]> {
  const q = query(
    collection(db, 'recall_patients'),
    where('patientenStatus', 'in', ['inaktiv', 'verstorben'])
  )
  const snap = await getDocsFromServer(q)
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as RecallPatient))
    .sort((a, b) => String(a.vorname ?? '').localeCompare(String(b.vorname ?? ''), 'de'))
}

export async function touchRecallPatient(id: string, username: string): Promise<void> {
  await updateDoc(doc(db, 'recall_patients', id), {
    aktualisiert: recallTimestamp(username),
  })
}

export async function updateRecallPatient(
  id: string,
  data: Partial<Omit<RecallPatient, 'id' | 'doctor' | 'aktualisiert'>>,
  username: string
): Promise<void> {
  await updateDoc(doc(db, 'recall_patients', id), stripUndefined({
    ...data,
    aktualisiert: recallTimestamp(username),
  }))
  // Immutables Activity-Log-Entry — bleibt erhalten auch wenn der Patient
  // spaeter durch andere User editiert / geloescht / reassigned wird.
  const todayIso = new Date().toISOString().slice(0, 10)
  await logRecallActivity({
    date: todayIso, user: username, type: 'updated',
    patientId: id, patientName: (data as any).vorname ?? null,
  })
}

export async function createRecallPatient(
  doctor: string,
  data: Omit<RecallPatient, 'id' | 'doctor' | 'erstellt' | 'aktualisiert'>,
  username: string
): Promise<string> {
  const stamp = recallTimestamp(username)
  const ref = doc(collection(db, 'recall_patients'))
  await setDoc(ref, stripUndefined({ ...data, doctor, erstellt: stamp, aktualisiert: null }))
  const todayIso = new Date().toISOString().slice(0, 10)
  await logRecallActivity({
    date: todayIso, user: username, type: 'created',
    patientId: ref.id, patientName: (data as any).vorname ?? null,
    doctor,
  })
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
    // Zuteilungsdatum merken: erlaubt den Filter «Noch nie beim Arzt»
    // (arztSeit > letzteKons = seit der Umhaengung keine Konsultation).
    arztSeit: new Date().toISOString().slice(0, 10),
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
        .filter(p => p.zuweisung != null || (p.zuweisungen != null && p.zuweisungen.length > 0) || p.zuweisungNoetig === true)
      callback(all)
    }
  )
}

function genZwId(): string {
  try { const u = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID?.(); if (u) return u } catch { /* */ }
  return 'zw_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** Alle Zuweisungen eines Patienten als normalisierte Liste (jede mit id).
 *  Migriert die alte Einzel-Zuweisung (`zuweisung`) transparent mit. */
export function patientZuweisungen(p: RecallPatient): (Zuweisung & { id: string })[] {
  const arr = (p.zuweisungen ?? []).filter(Boolean).map(z => ({ ...z, id: z.id || genZwId() }))
  if (arr.length > 0) return arr
  if (p.zuweisung) return [{ ...p.zuweisung, id: p.zuweisung.id || 'legacy' }]
  return []
}

/** Schreibt die komplette Zuweisungs-Liste eines Patienten und räumt die
 *  Legacy-Einzel-Zuweisung auf (Migration). */
export async function saveZuweisungen(patientId: string, list: Zuweisung[], by: string): Promise<void> {
  // Sicherstellen dass jede Zuweisung einen Status und eine ID hat (Migration)
  const normalized = list.map(z => stripUndefined({
    ...z,
    id: z.id || genZwId(),
    status: z.status || 'pendent',
  }))
  await updateRecallPatient(patientId, { zuweisungen: normalized, zuweisung: null } as Partial<RecallPatient>, by)
}

/** Neue, leere Zuweisung mit Default-Werten (für «weitere Zuweisung hinzufügen»). */
export function newZuweisung(typ: 'intern' | 'extern', ziel: string, grund: string, von: string): Zuweisung {
  return {
    id: genZwId(), typ, ziel, grund,
    datum: new Date().toISOString().slice(0, 10),
    status: 'pendent', erledigtAm: '', berichtErhalten: false,
    notiz: '', von,
  }
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

  const todayIso = new Date().toISOString().slice(0, 10)
  for (let i = 0; i < patients.length; i += 499) {
    const batch = writeBatch(db)
    for (const p of patients.slice(i, i + 499)) {
      // erstellt: stamp -> damit der Patient in der Aktivitaets-Auswertung
      // als "Neu erfasst" beim importierenden User auftaucht. Ohne dies waren
      // Excel-Imports in der Auswertung komplett unsichtbar (Bug, gefixt 06-2026).
      batch.set(doc(col, zuBearbStableId(p)), { ...p, doctor: 'Zu bearbeiten', erstellt: stamp, importedAt: stamp })
    }
    try {
      await batch.commit()
    } catch (err: any) {
      // Re-throw with batch index and Firestore error code so UI can display it
      const code = err?.code ?? 'unknown'
      throw new Error(`Batch ${Math.floor(i / 499) + 1} fehlgeschlagen (${code}): ${err?.message ?? err}`)
    }
  }
  // Immutables Activity-Log pro importierten Patienten — fire-and-forget,
  // parallelisiert.
  await Promise.all(patients.map(p => logRecallActivity({
    date: todayIso, user: username, type: 'created',
    patientId: zuBearbStableId(p),
    patientName: p.vorname ?? null,
    doctor: 'Zu bearbeiten',
  })))
  return patients.length
}

export interface RecallSummary {
  total: number           // all assigned patients (excluding Zu bearbeiten)
  zuBearbeiten: number    // patients in "Zu bearbeiten"
  overdueRC: number       // active patients with aufgebotFuer in the past and no aufgebotErstellt
  keinTermin: number      // active patients with naechsteKons === 'kein Termin'
  reminderFaellig: number // active patients with a past-due Reminder entry
  telefonOffen: number    // active patients with an open phone call ("noch zu erledigen")
  aufgebotWoche: number        // Aufgebote mit aufgebotFuer in der aktuellen Woche (Mo–So), noch nicht erstellt
  aufgebotUeberfaellig: number // Aufgebote mit aufgebotFuer VOR der aktuellen Woche, noch nicht erstellt
  // ── Zuweisungen (ZW-Management) ─────────────────────────────────────────
  zwPendent: number         // pendente Zuweisungen total
  zwUeberfaellig: number    // pendent seit >8 Wochen
  zwAnfrageFaellig: number  // pendent >8 Wochen und noch KEINE Berichtsanfrage verschickt
  zwNochZuzuweisen: number  // Patienten mit «Muss noch zugewiesen werden»-Merker
}

export async function getRecallSummary(): Promise<RecallSummary> {
  const col  = collection(db, 'recall_patients')
  const snap = await getDocs(col)   // uses SDK cache after first RecallPage visit
  return computeRecallSummary(snap.docs.map(d => d.data()))
}

/** Live-Version: Summary bei jeder Aenderung an recall_patients neu berechnen
 *  (Dashboard aktualisiert sich sofort, wenn irgendwo Recall bearbeitet wird). */
export function subscribeRecallSummary(callback: (s: RecallSummary) => void): () => void {
  return onSnapshot(collection(db, 'recall_patients'), snap => {
    callback(computeRecallSummary(snap.docs.map(d => d.data())))
  })
}

function computeRecallSummary(patients: Record<string, any>[]): RecallSummary {
  const oneMonthAgo = new Date()
  oneMonthAgo.setUTCMonth(oneMonthAgo.getUTCMonth() - 1)
  const today = new Date().toISOString().slice(0, 10)
  const eightWeeksAgo = (() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 56)
    return d.toISOString().slice(0, 10)
  })()
  let total = 0, zuBearbeiten = 0, overdueRC = 0, keinTermin = 0, reminderFaellig = 0
  let telefonOffen = 0, zwPendent = 0, zwUeberfaellig = 0, zwAnfrageFaellig = 0, zwNochZuzuweisen = 0
  let aufgebotWoche = 0, aufgebotUeberfaellig = 0
  // Aktuelle Woche (Mo–So) — gleiche Grenzen wie der Aufgebotsplan (Wochenplan).
  const { weekStart, weekEnd } = (() => {
    const now = new Date()
    const day = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { weekStart: iso(monday), weekEnd: iso(sunday) }
  })()
  for (const p of patients) {
    if (p.doctor === 'Zu bearbeiten') { zuBearbeiten++; continue }
    total++
    if (p.storniert === 'ja' || p.patientenStatus === 'inaktiv' || p.patientenStatus === 'verstorben') continue
    if (!p.aufgebotErstellt && p.aufgebotFuer && p.aufgebotFuer !== 'kein Termin') {
      const dt = new Date(String(p.aufgebotFuer) + 'T00:00:00Z')
      if (!isNaN(dt.getTime()) && dt <= oneMonthAgo) overdueRC++
      // Aufgebotsplan-Zahlen (gleiche Logik wie der Wochenplan)
      const af = String(p.aufgebotFuer)
      if (af >= weekStart && af <= weekEnd) aufgebotWoche++
      else if (af < weekStart) aufgebotUeberfaellig++
    }
    if (p.naechsteKons === 'kein Termin') keinTermin++
    if (p.zuweisungNoetig === true) zwNochZuzuweisen++
    // Zuweisungen (inkl. Legacy-Einzelfeld) — pendente + Ueberfaellige zaehlen
    const zws: any[] = Array.isArray(p.zuweisungen) ? p.zuweisungen : (p.zuweisung ? [p.zuweisung] : [])
    for (const z of zws) {
      const st = (!z?.status || z.status === 'ausstehend') ? 'pendent' : z.status
      if (st !== 'pendent') continue
      zwPendent++
      if (z.datum && z.datum <= eightWeeksAgo) {
        zwUeberfaellig++
        if (!z.berichtAngefragt) zwAnfrageFaellig++
      }
    }
    // Check for past-due Reminder entries + open phone calls
    if (Array.isArray(p.verlauf)) {
      let latestReminder: string | null = null
      let hatOffenenAnruf = false
      for (const v of p.verlauf) {
        if (v.aktion === 'Telefonanruf' && v.ergebnis === 'noch zu erledigen') hatOffenenAnruf = true
        if (v.aktion !== 'Reminder') continue
        const m = String(v.ergebnis ?? '').match(/^Geplant:\s*(\d{4}-\d{2}-\d{2})/)
        if (!m) continue
        if (!latestReminder || m[1] > latestReminder) latestReminder = m[1]
      }
      if (latestReminder && latestReminder <= today) reminderFaellig++
      if (hatOffenenAnruf) telefonOffen++
    }
  }
  return { total, zuBearbeiten, overdueRC, keinTermin, reminderFaellig, telefonOffen, zwPendent, zwUeberfaellig, zwAnfrageFaellig, zwNochZuzuweisen, aufgebotWoche, aufgebotUeberfaellig }
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

// ── Zuweisung-Konfiguration (Praxen & Gründe) ────────────────────────────────

export const ZUWEISUNG_DEFAULT_PRAXEN  = ['Augenklinik KSA']
export const ZUWEISUNG_DEFAULT_GRUENDE = ['YAG', 'KAT', 'Neuro', 'OP', 'Netzhaut', 'Glaukom', 'Kinderophthalmologie', 'Notfall', 'Abklärung']

export interface ZuweisungConfig {
  praxen:  string[]
  gruende: string[]
}

const ZUWEISUNG_CONFIG_REF = () => doc(db, 'recall_config', 'zuweisung')

export async function getZuweisungConfig(): Promise<ZuweisungConfig> {
  const snap = await getDoc(ZUWEISUNG_CONFIG_REF())
  if (!snap.exists()) return { praxen: ZUWEISUNG_DEFAULT_PRAXEN, gruende: ZUWEISUNG_DEFAULT_GRUENDE }
  const d = snap.data()
  const storedGruende = Array.isArray(d.gruende) ? d.gruende : ZUWEISUNG_DEFAULT_GRUENDE
  // Neu hinzugekommene Standard-Gruende in bestehende (bereits gespeicherte)
  // Konfiguration einmischen, ohne Duplikate oder von Nutzern entfernte
  // Eintraege wieder herzustellen — nur fehlende Defaults ergaenzen.
  const gruende = [...storedGruende, ...ZUWEISUNG_DEFAULT_GRUENDE.filter(g => !storedGruende.includes(g))]
  return {
    praxen:  Array.isArray(d.praxen)  ? d.praxen  : ZUWEISUNG_DEFAULT_PRAXEN,
    gruende,
  }
}

export async function saveZuweisungConfig(config: Partial<ZuweisungConfig>): Promise<void> {
  await setDoc(ZUWEISUNG_CONFIG_REF(), config, { merge: true })
}

/** Live-subscription: alle recall_patients in der Collection.
 *  Callback bekommt eine Map<doctor, RecallPatient[]> mit den gleichen
 *  Sortier-/Filter-Regeln wie getRecallPatients (alphabetisch nach vorname).
 *  Updates kommen automatisch wenn IRGENDJEMAND irgendwo ein Patientendoc
 *  aendert -> echte Realtime-Coop. */
export function subscribeAllRecallPatients(
  callback: (byDoctor: Map<string, RecallPatient[]>) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'recall_patients'),
    snap => {
      const byDoctor = new Map<string, RecallPatient[]>()
      for (const d of snap.docs) {
        const p = { id: d.id, ...d.data() } as RecallPatient
        const key = p.doctor || 'Zu bearbeiten'
        if (!byDoctor.has(key)) byDoctor.set(key, [])
        byDoctor.get(key)!.push(p)
      }
      for (const arr of byDoctor.values()) {
        arr.sort((a, b) => String(a.vorname ?? '').localeCompare(String(b.vorname ?? ''), 'de'))
      }
      callback(byDoctor)
    },
    err => { onError?.(err) },
  )
}

