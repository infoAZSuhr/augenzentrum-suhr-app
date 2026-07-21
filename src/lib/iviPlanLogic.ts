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

// ─── Arzt-Verfügbarkeit für die IVI-Tagesplanung ─────────────────────────────
//
// Frage, die das beantwortet: «An welchen kommenden Tagen könnten wir IVI
// machen — wer wäre da?»
//
// Ein IVI-Tag braucht den injizierenden Arzt UND mindestens einen der
// Partner-Ärzte, und zwar mit ZEITLICHER ÜBERLAPPUNG: ist der eine nur VM
// und der andere nur NM da, nützt das nichts.

/** Injiziert — ohne ihn kein IVI-Tag. */
export const IVI_INJECTOR_MATCH = ['artemiev'] as const

/** Codes die Anwesenheit in der Praxis bedeuten. */
const VM_COVER = new Set(['GT', 'VM'])
const NM_COVER = new Set(['GT', 'NM'])

export interface AnwesenderArzt {
  name: string
  code: string
  /** true = injizierender Arzt, false = Partner */
  injector: boolean
}

export interface ArztTag {
  date: string
  anwesend: AnwesenderArzt[]
  /** Injektor + mind. ein Partner mit zeitlicher Überlappung */
  passend: boolean
  /** Halbtag(e) in denen sich Injektor und Partner überschneiden */
  fenster: 'Vormittag' | 'Nachmittag' | 'ganzer Tag' | null
}

/** Überschneiden sich zwei Codes zeitlich? Liefert das gemeinsame Fenster. */
export function overlapWindow(a: string, b: string): ArztTag['fenster'] {
  const vm = VM_COVER.has(a) && VM_COVER.has(b)
  const nm = NM_COVER.has(a) && NM_COVER.has(b)
  if (vm && nm) return 'ganzer Tag'
  if (vm) return 'Vormittag'
  if (nm) return 'Nachmittag'
  return null
}

/**
 * Listet ab `today` alle Tage, an denen mindestens einer der relevanten
 * Ärzte da ist — mit Codes und der Info, ob eine IVI-Konstellation zustande
 * käme. Sortiert nach Datum.
 */
export function buildArztVerfuegbarkeit(
  plans: ReadonlyArray<PlanLike | null | undefined>,
  today: string,
  injectorPatterns: readonly string[] = IVI_INJECTOR_MATCH,
  partnerPatterns: readonly string[] = IVI_DOCTORS_MATCH,
  workingCodes: ReadonlySet<string> = IVI_WORKING,
): ArztTag[] {
  const byDate = new Map<string, AnwesenderArzt[]>()

  for (const plan of plans) {
    if (!plan) continue
    const persons = plan.sections?.flatMap(s => s.persons) ?? []
    const injectors = filterIviDoctors(persons, injectorPatterns)
    const partners = filterIviDoctors(persons, partnerPatterns)

    for (const [name, injector] of [
      ...injectors.map(n => [n, true] as const),
      ...partners.map(n => [n, false] as const),
    ]) {
      const schedule = plan.schedule?.[name] ?? {}
      for (const [date, code] of Object.entries(schedule)) {
        if (date < today || !workingCodes.has(code)) continue
        const list = byDate.get(date) ?? []
        if (!list.some(a => a.name === name)) list.push({ name, code, injector })
        byDate.set(date, list)
      }
    }
  }

  return [...byDate.entries()]
    .map(([date, anwesend]) => {
      anwesend.sort((a, b) => Number(b.injector) - Number(a.injector) || a.name.localeCompare(b.name, 'de'))
      const inj = anwesend.filter(a => a.injector)
      const par = anwesend.filter(a => !a.injector)
      let fenster: ArztTag['fenster'] = null
      for (const i of inj) {
        for (const p of par) {
          const w = overlapWindow(i.code, p.code)
          if (w === 'ganzer Tag') { fenster = w; break }
          if (w && !fenster) fenster = w
        }
        if (fenster === 'ganzer Tag') break
      }
      return { date, anwesend, passend: fenster !== null, fenster }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}
