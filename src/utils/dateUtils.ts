import { format, parseISO, differenceInDays, isValid } from 'date-fns'
import { de } from 'date-fns/locale'

export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  try {
    const d = parseISO(dateStr)
    if (!isValid(d)) return '—'
    return format(d, 'dd.MM.yyyy', { locale: de })
  } catch {
    return '—'
  }
}

export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—'
  try {
    const d = parseISO(dateStr)
    if (!isValid(d)) return '—'
    return format(d, 'dd.MM.yyyy HH:mm', { locale: de })
  } catch {
    return '—'
  }
}

export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null
  try {
    const d = parseISO(dateStr)
    if (!isValid(d)) return null
    return differenceInDays(d, new Date())
  } catch {
    return null
  }
}

export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function today(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function addWeeks(dateStr: string, weeks: number): string {
  const d = parseISO(dateStr)
  d.setDate(d.getDate() + weeks * 7)
  return toISODate(d)
}

// ISO-Wochentag: 1=Mo, 2=Di, 3=Mi, 4=Do, 5=Fr, 6=Sa, 7=So
export function nextIVIDay(fromDate: string, iviDays: number[]): string {
  if (!iviDays.length) return fromDate
  const base = parseISO(fromDate)
  for (let i = 0; i <= 7; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    const iso = d.getDay() === 0 ? 7 : d.getDay()
    if (iviDays.includes(iso)) return toISODate(d)
  }
  return fromDate
}

/** Returns the next `count` IVI-day dates on or after fromDate */
export function nextIVIDays(fromDate: string, iviDays: number[], count: number = 3): string[] {
  if (!iviDays.length) return [fromDate]
  const result: string[] = []
  const base = parseISO(fromDate)
  let i = 0
  while (result.length < count && i <= 60) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    const iso = d.getDay() === 0 ? 7 : d.getDay()
    if (iviDays.includes(iso)) result.push(toISODate(d))
    i++
  }
  return result
}

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa', 7: 'So'
}

/**
 * Plattform-stabile Schweizer Datumsformatierung — DD.MM.YYYY.
 *
 * Hintergrund: Node ICU (Linux) und Windows-ICU geben für
 * `new Date('2026-06-15').toLocaleDateString('de-CH')` unterschiedliche
 * Strings ("15.6.2026" vs. "15.06.2026"). Diese Funktion liefert immer
 * gepaddete Tage und Monate — egal auf welcher Plattform.
 *
 * Akzeptiert ISO-Strings (yyyy-MM-dd…), Date-Objekte oder Millisekunden.
 * Liefert "—" bei ungültiger oder leerer Eingabe.
 */
export function formatSwissDate(
  input: string | Date | number | null | undefined,
): string {
  if (input == null || input === '') return '—'

  // ISO-String: regex-basiert für maximale Determinismus (kein Zeitzonen-Drift)
  if (typeof input === 'string') {
    const m = input.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[3]}.${m[2]}.${m[1]}`
  }

  const d = input instanceof Date ? input : new Date(input as any)
  if (isNaN(d.getTime())) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear())
  return `${dd}.${mm}.${yy}`
}
