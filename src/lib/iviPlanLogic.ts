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

// ─── Intelligente IVI-Tag-Vorschläge ─────────────────────────────────────────
//
// Raster: jeder 2. Montag. Grund (aus der Bedarfsanalyse): die vorkommenden
// Behandlungsintervalle 4/6/8/10 Wochen sind alle Vielfache von zwei Wochen —
// im 14-Tage-Raster fällt jeder Patient exakt auf einen IVI-Tag. Montag ist
// zudem der dominierende Spritztag.
//
// Fällt der Montag aus (Feiertag oder Injektor abwesend), wird auf Do bzw. Fr
// DERSELBEN Woche ausgewichen — nie in eine andere Woche, sonst reisst das
// Intervall.

export type VorschlagStatus =
  | 'bereit'            // Injektor + Partner mit Überlappung — nichts zu tun
  | 'partner_fehlt'     // Injektor da, kein Partner — eintragbar
  | 'halbtag_konflikt'  // beide da, aber VM gegen NM — nur melden
  | 'kein_tag'          // Injektor auch am Ausweichtag weg

/** Ein geprüfter Kandidat (Mo/Do/Fr) samt Grund, warum er ausfiel. */
export interface GeprueferTag {
  date: string
  grund: string
}

export interface IviVorschlag {
  /** Tag des Rasters, auf den sich der Vorschlag bezieht (immer ein Montag) */
  rasterMontag: string
  /** ISO-Kalenderwoche des Vorschlags */
  kw: number
  /** Mo/Do/Fr die geprüft und verworfen wurden — macht den Ausweich sichtbar */
  geprueft: GeprueferTag[]
  /** tatsächlich vorgeschlagener Tag (= Montag oder Do/Fr-Ausweich) */
  date: string
  /** true wenn wegen Feiertag/Abwesenheit ausgewichen wurde */
  ausweich: boolean
  /** Grund des Ausweichens, für die Anzeige */
  ausweichGrund: string | null
  status: VorschlagStatus
  anwesend: AnwesenderArzt[]
  fenster: ArztTag['fenster']
  /** Code den ein neuer Partner bekommen müsste, damit er überlappt */
  empfohlenerPartnerCode: string | null
}

const MS_TAG = 86_400_000
const isoAdd = (iso: string, tage: number) =>
  new Date(Date.parse(iso + 'T00:00:00Z') + tage * MS_TAG).toISOString().slice(0, 10)

/** ISO-Kalenderwoche (Woche mit dem ersten Donnerstag des Jahres = KW 1). */
export function isoKalenderwoche(iso: string): number {
  const d = new Date(Date.parse(iso + 'T00:00:00Z'))
  // auf den Donnerstag derselben ISO-Woche schieben
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7))
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const tage = (d.getTime() - jan4.getTime()) / MS_TAG
  return 1 + Math.round((tage - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
}

/** Montag der Woche von `iso`. */
function montagVon(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return isoAdd(iso, -((d.getUTCDay() + 6) % 7))
}

/** Nächster Montag ab `iso` (inkl. `iso` selbst wenn Montag). */
function naechsterMontag(iso: string): string {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay()
  return dow === 1 ? iso : isoAdd(montagVon(iso), 7)
}

/** Partner-Code der mit dem Injektor-Code überlappt. GT → NM (Nachmittag ist
 *  in der Praxis das übliche IVI-Fenster), VM → VM, NM → NM. */
export function passenderPartnerCode(injektorCode: string): string | null {
  if (injektorCode === 'GT') return 'NM'
  if (injektorCode === 'VM') return 'VM'
  if (injektorCode === 'NM') return 'NM'
  return null
}

/**
 * Baut die Vorschlagsliste.
 *
 * @param verfuegbar  Ergebnis von buildArztVerfuegbarkeit()
 * @param today       ISO-Datum ab dem vorgeschlagen wird
 * @param bisDatum    ISO-Datum bis zu dem vorgeschlagen wird
 * @param feiertage   Datum → Name
 * @param bestehende  bereits geplante IVI-Tage (zum Verankern des Rhythmus)
 */
export function buildIviVorschlaege(
  verfuegbar: readonly ArztTag[],
  today: string,
  bisDatum: string,
  feiertage: Readonly<Record<string, string>> = {},
  bestehende: readonly string[] = [],
  /** Roh-Schedule des Injektors (Datum → Code) — nur für die Begründung,
   *  damit «Fer»/«W» statt nur «abwesend» angezeigt werden kann. */
  injektorSchedule: Readonly<Record<string, string>> = {},
): IviVorschlag[] {
  const byDate = new Map(verfuegbar.map(t => [t.date, t]))

  // Anker: erster bestehender IVI-Montag ab heute (bereits fixierter Rhythmus
  // bleibt so), sonst der nächste Montag.
  const ankerKandidat = bestehende
    .filter(d => d >= today && new Date(d + 'T00:00:00Z').getUTCDay() === 1)
    .sort()[0]
  let anker = ankerKandidat ?? naechsterMontag(today)
  // Nutzerwunsch 2026-07-21: neuen Rhythmus möglichst in UNGERADEN KW verankern.
  // ABER nur, wenn der Injektor in der ungeraden-KW-Woche auch verfügbar ist —
  // ist er nur in der geraden KW da (durch Abwesenheiten unausweichlich), bleibt
  // es bei der geraden KW. Prüft dieselben Kandidaten (Mo/Do/Fr) wie unten.
  if (!ankerKandidat && isoKalenderwoche(anker) % 2 === 0) {
    const ungeradeWoche = isoAdd(anker, 7)
    const injektorDaIn = (mo: string) =>
      [mo, isoAdd(mo, 3), isoAdd(mo, 4)].some(k => !feiertage[k] && byDate.get(k)?.anwesend.some(a => a.injector))
    // Nur verschieben, wenn die ungerade Woche nutzbar ist. Ist die gerade
    // Woche gar nicht nutzbar, ebenfalls verschieben (dann ist die gerade KW
    // ohnehin ein Leer-Tag).
    if (injektorDaIn(ungeradeWoche) || !injektorDaIn(anker)) {
      anker = ungeradeWoche
    }
  }

  const out: IviVorschlag[] = []
  for (let mo = anker; mo <= bisDatum; mo = isoAdd(mo, 14)) {
    // Kandidaten in DERSELBEN Woche: Montag, sonst Do, sonst Fr.
    const kandidaten = [mo, isoAdd(mo, 3), isoAdd(mo, 4)]
    let gewaehlt: string | null = null
    const geprueft: GeprueferTag[] = []

    for (const k of kandidaten) {
      const ft = feiertage[k]
      if (ft) { geprueft.push({ date: k, grund: `Feiertag (${ft})` }); continue }
      const injektorDa = !!byDate.get(k)?.anwesend.some(a => a.injector)
      if (!injektorDa) {
        const code = injektorSchedule[k]
        geprueft.push({ date: k, grund: code ? `Artemiev ${code}` : 'Artemiev nicht eingeteilt' })
        continue
      }
      gewaehlt = k
      break
    }

    if (!gewaehlt) {
      out.push({
        rasterMontag: mo, kw: isoKalenderwoche(mo), geprueft,
        date: mo, ausweich: false,
        ausweichGrund: geprueft[0]?.grund ?? null, status: 'kein_tag',
        anwesend: byDate.get(mo)?.anwesend ?? [], fenster: null,
        empfohlenerPartnerCode: null,
      })
      continue
    }

    const tag = byDate.get(gewaehlt)!
    const injektor = tag.anwesend.find(a => a.injector)!
    const hatPartner = tag.anwesend.some(a => !a.injector)

    const status: VorschlagStatus =
      tag.passend ? 'bereit' : hatPartner ? 'halbtag_konflikt' : 'partner_fehlt'

    out.push({
      rasterMontag: mo,
      kw: isoKalenderwoche(gewaehlt),
      geprueft,
      date: gewaehlt,
      ausweich: gewaehlt !== mo,
      ausweichGrund: gewaehlt !== mo ? (geprueft[0]?.grund ?? null) : null,
      status,
      anwesend: tag.anwesend,
      fenster: tag.fenster,
      empfohlenerPartnerCode: status === 'partner_fehlt' ? passenderPartnerCode(injektor.code) : null,
    })
  }
  return out
}
