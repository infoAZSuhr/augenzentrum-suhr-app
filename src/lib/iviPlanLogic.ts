/**
 * Pure Logik für die IVI-Tagesplanung.
 *
 * Extrahiert aus firestorePatients.ts — die Funktionen hier sind frei von
 * Firestore-Calls und damit unit-testbar. firestorePatients ruft sie auf
 * nachdem es die rohen Daten geladen hat.
 */

/** Praxis-Konvention: Ärzte deren Nachname (case-insensitive) eines dieser
 *  Tokens enthält, gelten als IVI-Ärzte. */
export const IVI_DOCTORS_MATCH = ['tschopp', 'trachsler'] as const

/** Schedule-Codes die als "im Dienst" gelten — diese Tage werden als IVI-Tage
 *  in der Tagesplanung berücksichtigt. */
export const IVI_WORKING = new Set<string>(['GT', 'VM', 'NM'])

export interface PlanLike {
  sections: { persons: string[] }[]
  schedule: Record<string, Record<string, string>>
}

/**
 * Filtert die Personen-Namen eines Plans auf jene, die als IVI-Ärzte zählen.
 * `doctorPatterns` ist optional injizierbar für Tests/spätere Erweiterung.
 */
export function filterIviDoctors(
  persons: string[],
  doctorPatterns: readonly string[] = IVI_DOCTORS_MATCH,
): string[] {
  const lcPatterns = doctorPatterns.map(p => p.toLowerCase())
  return persons.filter(p => {
    const lc = p.toLowerCase()
    return lcPatterns.some(d => lc.includes(d))
  })
}

/**
 * Extrahiert alle IVI-Tage aus EINEM Plan: alle Daten ab heute (inkl.) an
 * denen mindestens ein IVI-Arzt einen Working-Code (GT/VM/NM) eingetragen hat.
 */
export function extractIviDaysFromPlan(
  plan: PlanLike | null | undefined,
  today: string,
  workingCodes: ReadonlySet<string> = IVI_WORKING,
  doctorPatterns: readonly string[] = IVI_DOCTORS_MATCH,
): Set<string> {
  const days = new Set<string>()
  if (!plan) return days
  const persons    = plan.sections?.flatMap(s => s.persons) ?? []
  const iviPersons = filterIviDoctors(persons, doctorPatterns)
  for (const person of iviPersons) {
    const schedule = plan.schedule?.[person] ?? {}
    for (const [date, code] of Object.entries(schedule)) {
      if (date >= today && workingCodes.has(code)) days.add(date)
    }
  }
  return days
}

/** Vereint mehrere Pläne (z.B. aktuelles + nächstes Jahr) und gibt sortierte
 *  Liste der IVI-Tage zurück. */
export function extractIviDaysFromPlans(
  plans: ReadonlyArray<PlanLike | null | undefined>,
  today: string,
  workingCodes?: ReadonlySet<string>,
  doctorPatterns?: readonly string[],
): string[] {
  const all = new Set<string>()
  for (const plan of plans) {
    for (const d of extractIviDaysFromPlan(plan, today, workingCodes, doctorPatterns)) {
      all.add(d)
    }
  }
  return [...all].sort()
}

/** Pro Patient+Auge nur den NEUESTEN Eintrag behalten (höchstes treatmentDate). */
export interface TreatmentLike {
  patientId:     string
  eyeSide:       string
  treatmentDate: string
}

export function pickLatestPerPatientEye<T extends TreatmentLike>(treatments: T[]): Map<string, T> {
  const out = new Map<string, T>()
  for (const t of treatments) {
    const key = `${t.patientId}:${t.eyeSide}`
    const existing = out.get(key)
    if (!existing || t.treatmentDate > existing.treatmentDate) {
      out.set(key, t)
    }
  }
  return out
}
