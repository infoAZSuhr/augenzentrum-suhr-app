/**
 * Pure Logik für die automatische Eintragung von Arbeitstagen in der
 * Einsatzplanung.
 *
 * Idee: pro Person ein Wochenrhythmus (welche Wochentage mit welchem Code)
 * plus ein Intervall (jede Woche / alle 2 Wochen / …). Daraus wird eine
 * Liste konkreter Tage berechnet, die geschrieben werden sollen.
 *
 * Bewusst KEIN Firestore hier — die Funktion liefert nur den Plan, das
 * Schreiben passiert im Aufrufer. Dadurch kann die UI vorher eine Vorschau
 * anzeigen ("X Tage werden eingetragen, Y übersprungen").
 *
 * Schutzregeln:
 *  - Feiertage werden IMMER übersprungen (day.ftName gesetzt).
 *  - Wochenenden werden nur gefüllt wenn der Wochentag explizit gewählt ist.
 *  - Bestehende Einträge (Ferien, Krank, Abwesend …) bleiben standardmässig
 *    stehen; nur mit `overwrite` werden sie ersetzt.
 */

/** Montag (ISO) der Woche, in der `iso` liegt. */
function weekStartIso(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7          // Mo=0 … So=6
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

/** Anzahl Tage zwischen zwei ISO-Daten (b − a). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
}

/** Minimal-Form eines Tages aus getYearDays(). */
export interface AutoFillDay {
  key: string          // ISO-Datum
  dow: number          // 0=So … 6=Sa
  monthIdx: number     // 0=Januar … 11=Dezember
  ftName?: string      // gesetzt = Feiertag
}

export interface AutoFillOptions {
  /** dow → Code. Nur hier enthaltene Wochentage werden gefüllt. */
  weekdayCodes: Record<number, string>
  /** 1 = jede Woche, 2 = alle 2 Wochen, … */
  intervalWeeks: number
  /** Ankerdatum: ab hier wird gefüllt UND der Wochenrhythmus gezählt. */
  startDate: string
  /** null = ganzes Jahr, sonst nur dieser Monat (0-11). */
  monthIdx: number | null
  /** true = bestehende Einträge ersetzen (sonst bleiben sie stehen). */
  overwrite: boolean
}

export interface AutoFillPlan {
  /** Tage die geschrieben werden */
  toWrite: { key: string; code: string }[]
  /** übersprungen weil schon ein Eintrag existiert */
  skippedExisting: { key: string; code: string }[]
  /** übersprungen weil Feiertag */
  skippedHoliday: { key: string; ftName: string }[]
  /** Teilmenge von toWrite: ersetzt einen bestehenden, abweichenden Eintrag
   *  (nur bei overwrite). Basis für die Bestätigungsabfrage. */
  overwritten: { key: string; oldCode: string; newCode: string }[]
}

/** Zählt Codes für eine lesbare Zusammenfassung, z.B. "2× Fer, 1× K". */
export function summarizeCodes(items: readonly { oldCode: string }[]): string {
  const counts = new Map<string, number>()
  for (const i of items) counts.set(i.oldCode, (counts.get(i.oldCode) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, n]) => `${n}× ${code}`)
    .join(', ')
}

/**
 * Berechnet, welche Tage eingetragen würden. `existing` ist der bestehende
 * Schedule der Person (Datum → Code).
 */
export function planAutoFill(
  days: readonly AutoFillDay[],
  existing: Readonly<Record<string, string>>,
  opts: AutoFillOptions,
): AutoFillPlan {
  const plan: AutoFillPlan = { toWrite: [], skippedExisting: [], skippedHoliday: [], overwritten: [] }
  const interval = Math.max(1, Math.floor(opts.intervalWeeks) || 1)
  const anchorWeek = weekStartIso(opts.startDate)

  for (const day of days) {
    const code = opts.weekdayCodes[day.dow]
    if (!code) continue                                        // Wochentag nicht gewählt
    if (day.key < opts.startDate) continue                     // vor dem Ankerdatum
    if (opts.monthIdx !== null && day.monthIdx !== opts.monthIdx) continue

    // Wochenrhythmus: nur jede n-te Woche ab der Ankerwoche
    const weeksSinceAnchor = Math.floor(dayDiff(anchorWeek, weekStartIso(day.key)) / 7)
    if (weeksSinceAnchor < 0 || weeksSinceAnchor % interval !== 0) continue

    if (day.ftName) { plan.skippedHoliday.push({ key: day.key, ftName: day.ftName }); continue }

    const vorhanden = existing[day.key]
    if (vorhanden && !opts.overwrite) {
      plan.skippedExisting.push({ key: day.key, code: vorhanden })
      continue
    }
    if (vorhanden === code) continue                           // schon korrekt — nichts zu tun

    if (vorhanden) plan.overwritten.push({ key: day.key, oldCode: vorhanden, newCode: code })
    plan.toWrite.push({ key: day.key, code })
  }
  return plan
}

/** Baut die Firestore-Dot-Notation-Updates für einen Plan. */
export function autoFillUpdates(person: string, plan: AutoFillPlan): Record<string, string> {
  const update: Record<string, string> = {}
  for (const { key, code } of plan.toWrite) update[`schedule.${person}.${key}`] = code
  return update
}
