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

// ─── Terminprognose ──────────────────────────────────────────────────────────

/** Montag (ISO) der Woche, in der `iso` liegt. Wochenbeginn = Montag. */
export function weekStart(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7          // Mo=0 … So=6
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

/** `iso` plus n Wochen (ISO-Datum zurück). */
export function addWeeks(iso: string, weeks: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + weeks * 7)
  return d.toISOString().slice(0, 10)
}

/** Differenz in Tagen (b − a); negativ wenn b vor a liegt. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
}

/** exakt = Soll-Datum ist selbst IVI-Tag · ausweich = anderer Tag DERSELBEN
 *  Woche (z.B. Do/Fr weil Montag Feiertag) · kein-tag = in dieser Woche gibt
 *  es keinen IVI-Tag → muss manuell geklärt werden. */
export type ForecastStatus = 'exakt' | 'ausweich' | 'kein-tag'

export interface ForecastSlot {
  vorschlag: string | null
  status: ForecastStatus
  abweichungTage: number
}

/**
 * Sucht den IVI-Tag für ein Soll-Datum — bewusst NUR innerhalb DERSELBEN
 * Kalenderwoche.
 *
 * Hintergrund: IVI-Tage werden aus der Einsatzplanung abgeleitet. An einem
 * Feiertag ist kein Arzt eingeteilt, der Montag ist dann also gar kein
 * IVI-Tag — die Prognose weicht dadurch automatisch auf Do/Fr derselben
 * Woche aus. Das Intervall darf dabei NICHT um ganze Wochen verschoben
 * werden: gibt es in der Woche überhaupt keinen IVI-Tag, wird das als
 * 'kein-tag' gemeldet statt still auf eine andere Woche zu rutschen.
 */
export function forecastSlot(sollDatum: string, iviDays: readonly string[]): ForecastSlot {
  const ws = weekStart(sollDatum)
  const inWeek = iviDays.filter(d => weekStart(d) === ws)
  if (inWeek.length === 0) return { vorschlag: null, status: 'kein-tag', abweichungTage: 0 }
  if (inWeek.includes(sollDatum)) return { vorschlag: sollDatum, status: 'exakt', abweichungTage: 0 }
  // nächstliegender Tag derselben Woche; bei Gleichstand der spätere
  let best = inWeek[0]
  for (const d of inWeek) {
    const cur = Math.abs(daysBetween(sollDatum, d))
    const bst = Math.abs(daysBetween(sollDatum, best))
    if (cur < bst || (cur === bst && d > best)) best = d
  }
  return { vorschlag: best, status: 'ausweich', abweichungTage: daysBetween(sollDatum, best) }
}

export interface ForecastCandidate {
  patientId: string
  eyeSide: string
  lastTreatmentDate: string
  intervalWeeks: number
}

export interface ForecastEntry extends ForecastCandidate, ForecastSlot {
  sollDatum: string
}

/** Baut die Terminprognose: Soll-Datum = letzte Behandlung + Intervall,
 *  danach passenden IVI-Tag derselben Woche suchen. Sortiert nach Soll-Datum. */
export function buildForecast(
  candidates: readonly ForecastCandidate[],
  iviDays: readonly string[],
): ForecastEntry[] {
  return candidates
    .filter(c => !!c.lastTreatmentDate && c.intervalWeeks > 0)
    .map(c => {
      const sollDatum = addWeeks(c.lastTreatmentDate, c.intervalWeeks)
      return { ...c, sollDatum, ...forecastSlot(sollDatum, iviDays) }
    })
    .sort((a, b) => a.sollDatum.localeCompare(b.sollDatum))
}
