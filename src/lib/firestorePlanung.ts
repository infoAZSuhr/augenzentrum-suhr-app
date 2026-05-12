import { doc, getDoc, setDoc, updateDoc, deleteField, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import type { Code } from '../modules/planung/data/schedule2026'

export interface PlanungData {
  sections: { label: string; persons: string[] }[]
  schedule: Record<string, Record<string, Code>>
  comments?: Record<string, Record<string, string>>
  feiertage?: Record<string, string>
  pensum?: Record<string, number>
  inactive?: string[]
}

/** Returns the last name (last word) of each doctor in sections[0] for the given year */
export async function loadPlanungDoctorNames(year: number): Promise<string[]> {
  const data = await loadPlanung(year)
  if (!data?.sections[0]?.persons?.length) return []
  return [
    ...new Set(
      data.sections[0].persons
        .map(p => { const w = p.trim().split(/\s+/); return w[w.length - 1] ?? p })
        .filter(Boolean)
    ),
  ]
}

// ── Planung (per year) ────────────────────────────────────────────────────────

const planungDoc = (year: number) => doc(db, 'planung', String(year))

export async function loadPlanung(year: number): Promise<PlanungData | null> {
  const snap = await getDoc(planungDoc(year))
  if (!snap.exists()) return null
  return snap.data() as PlanungData
}

export async function savePlanung(year: number, data: PlanungData): Promise<void> {
  await setDoc(planungDoc(year), data)
}

export function subscribePlanung(year: number, cb: (data: PlanungData | null) => void): () => void {
  return onSnapshot(planungDoc(year), snap =>
    cb(snap.exists() ? (snap.data() as PlanungData) : null)
  )
}

// ── Working hours (per person, shared across years) ───────────────────────────

export interface PersonHoursFirestore {
  dayStart: string; dayEnd: string
  vmEnd: string; nmStart: string
  lunchStart: string; lunchEnd: string
}

const workHoursDoc = () => doc(db, 'settings', 'workHours')

export async function loadWorkHoursFirestore(): Promise<Record<string, PersonHoursFirestore>> {
  const snap = await getDoc(workHoursDoc())
  if (!snap.exists()) return {}
  return snap.data() as Record<string, PersonHoursFirestore>
}

export async function saveWorkHoursFirestore(wh: Record<string, PersonHoursFirestore>): Promise<void> {
  await setDoc(workHoursDoc(), wh)
}

// ── Year list (shared across all users) ──────────────────────────────────────

const yearListDoc = () => doc(db, 'settings', 'yearList')

export async function loadYearListFirestore(): Promise<number[] | null> {
  const snap = await getDoc(yearListDoc())
  if (!snap.exists()) return null
  return (snap.data().years as number[]) ?? null
}

export async function saveYearListFirestore(years: number[]): Promise<void> {
  await setDoc(yearListDoc(), { years })
}

// ── Request → Plan helpers ────────────────────────────────────────────────────
// Used when creating/approving/rejecting planungRequests to write entries to plan

/** Collect weekdays (Mo–Fr) between two dates, grouped by year (UTC-safe) */
export function buildDatesByYear(fromDate: string, toDate: string): Record<number, string[]> {
  const byYear: Record<number, string[]> = {}
  const cur = new Date(fromDate + 'T00:00:00Z')
  const end = new Date(toDate + 'T00:00:00Z')
  while (cur <= end) {
    const dow = cur.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const key = cur.toISOString().slice(0, 10)
      const y = cur.getUTCFullYear()
      if (!byYear[y]) byYear[y] = []
      byYear[y].push(key)
    }
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return byYear
}

/** Resolve a username to the matching person key in plan sections (case-insensitive fallback) */
export function resolvePersonKey(planData: PlanungData, username: string): string {
  const persons: string[] = (planData as any).sections?.flatMap((s: any) => s.persons as string[]) ?? []
  return persons.find(p => p === username || p.toLowerCase() === username.toLowerCase()) ?? username
}

/**
 * Manage ferien plan entries (Fer code) for a date range.
 * action 'write'          → set Fer in schedule + comment
 * action 'update-comment' → only update/delete comment (keep schedule)
 * action 'remove'         → delete schedule entry + comment
 */
export async function manageFerienPlan(
  username: string,
  fromDate: string,
  toDate: string,
  action: 'write' | 'update-comment' | 'remove',
  comment?: string,
  code = 'Fer',
): Promise<void> {
  const byYear = buildDatesByYear(fromDate, toDate)
  for (const [yearStr, dates] of Object.entries(byYear)) {
    const planRef = doc(db, 'planung', yearStr)
    const planSnap = await getDoc(planRef)
    if (!planSnap.exists()) continue
    const planData = planSnap.data() as PlanungData
    const feiertage: Record<string, string> = (planData as any).feiertage ?? {}
    const personKey = resolvePersonKey(planData, username)

    if (action === 'update-comment') {
      // Atomic dot-notation update — no read-modify-write, no race conditions
      const update: Record<string, unknown> = {}
      dates.forEach(date => {
        if (feiertage[date]) return
        if (comment) update[`comments.${personKey}.${date}`] = comment
        else update[`comments.${personKey}.${date}`] = deleteField()
      })
      if (Object.keys(update).length > 0) await updateDoc(planRef, update)
    } else if (action === 'remove') {
      // Atomic dot-notation removal of both schedule and comment entries
      const update: Record<string, unknown> = {}
      dates.forEach(date => {
        if (feiertage[date]) return
        update[`schedule.${personKey}.${date}`] = deleteField()
        update[`comments.${personKey}.${date}`] = deleteField()
      })
      if (Object.keys(update).length > 0) await updateDoc(planRef, update)
    } else {
      // 'write': set schedule + comment (full object update needed to create nested keys)
      const schedule: Record<string, Record<string, string>> = JSON.parse(JSON.stringify(planData.schedule ?? {}))
      const comments: Record<string, Record<string, string>> = JSON.parse(JSON.stringify((planData as any).comments ?? {}))
      if (!schedule[personKey]) schedule[personKey] = {}
      if (!comments[personKey]) comments[personKey] = {}
      dates.forEach(date => {
        if (feiertage[date]) return
        schedule[personKey][date] = code
        if (comment) comments[personKey][date] = comment
        else delete comments[personKey][date]
      })
      await updateDoc(planRef, { schedule, comments })
    }
  }
}

/** Write schedule entry + comment for a list of dates — atomic dot-notation */
export async function writePlanEntry(
  personName: string, dates: string[], code: string, comment: string, year?: number,
): Promise<void> {
  if (!personName || !dates.length) return
  const y = year ?? parseInt(dates[0].split('-')[0])
  const planRef = doc(db, 'planung', String(y))
  const update: Record<string, unknown> = {}
  dates.forEach(date => {
    update[`schedule.${personName}.${date}`] = code
    update[`comments.${personName}.${date}`] = comment
  })
  await updateDoc(planRef, update)
}

/** Remove schedule entry + comment for a list of dates — atomic dot-notation */
export async function removePlanEntry(
  personName: string, dates: string[], year?: number,
): Promise<void> {
  if (!personName || !dates.length) return
  const y = year ?? parseInt(dates[0].split('-')[0])
  const planRef = doc(db, 'planung', String(y))
  const update: Record<string, unknown> = {}
  dates.forEach(date => {
    update[`schedule.${personName}.${date}`] = deleteField()
    update[`comments.${personName}.${date}`] = deleteField()
  })
  await updateDoc(planRef, update)
}

/** Update (or delete) the comment for a list of dates without touching schedule — atomic dot-notation */
export async function updatePlanComment(
  personName: string, dates: string[], comment: string | null, year?: number,
): Promise<void> {
  if (!personName || !dates.length) return
  const y = year ?? parseInt(dates[0].split('-')[0])
  const planRef = doc(db, 'planung', String(y))
  const update: Record<string, unknown> = {}
  dates.forEach(date => {
    if (comment) update[`comments.${personName}.${date}`] = comment
    else update[`comments.${personName}.${date}`] = deleteField()
  })
  await updateDoc(planRef, update)
}

// ── Settings (z.B. Claude API Key) ────────────────────────────────────────────

const settingsDoc = () => doc(db, 'settings', 'app')

export async function loadSettings(): Promise<Record<string, string>> {
  const snap = await getDoc(settingsDoc())
  if (!snap.exists()) return {}
  return snap.data() as Record<string, string>
}

export async function saveSetting(key: string, value: string): Promise<void> {
  await setDoc(settingsDoc(), { [key]: value }, { merge: true })
}
