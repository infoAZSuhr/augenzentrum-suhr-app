import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatDate,
  formatDateTime,
  daysUntil,
  toISODate,
  today,
  addWeeks,
  nextIVIDay,
  nextIVIDays,
  formatSwissDate,
  WEEKDAY_LABELS,
} from './dateUtils'

describe('formatDate', () => {
  it('formats ISO date as dd.MM.yyyy', () => {
    expect(formatDate('2026-05-31')).toBe('31.05.2026')
    expect(formatDate('2026-01-01')).toBe('01.01.2026')
  })

  it('returns "—" for empty/invalid input', () => {
    expect(formatDate()).toBe('—')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('')).toBe('—')
    expect(formatDate('not-a-date')).toBe('—')
  })

  it('handles ISO datetime by stripping time component', () => {
    expect(formatDate('2026-05-31T14:30:00Z')).toBe('31.05.2026')
  })
})

describe('formatDateTime', () => {
  it('formats with date AND time', () => {
    expect(formatDateTime('2026-05-31T14:30:00')).toMatch(/^31\.05\.2026 \d{2}:\d{2}$/)
  })

  it('returns "—" for missing/invalid input', () => {
    expect(formatDateTime()).toBe('—')
    expect(formatDateTime('garbage')).toBe('—')
  })
})

describe('daysUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Mitternacht UTC — sonst rundet date-fns wegen 12h-Offset
    // beim Vergleich mit parseISO('YYYY-MM-DD') (interpretiert als 00:00)
    // einen Tag weniger als gemeint.
    vi.setSystemTime(new Date('2026-05-31T00:00:00'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('liefert positive Zahl für Datum in der Zukunft', () => {
    expect(daysUntil('2026-06-07')).toBe(7)
  })

  it('liefert negative Zahl für Datum in der Vergangenheit', () => {
    expect(daysUntil('2026-05-24')).toBe(-7)
  })

  it('liefert null für ungültige/leere Eingaben', () => {
    expect(daysUntil()).toBeNull()
    expect(daysUntil(null)).toBeNull()
    expect(daysUntil('')).toBeNull()
    expect(daysUntil('not-a-date')).toBeNull()
  })
})

describe('toISODate', () => {
  it('formatiert Date als yyyy-MM-dd', () => {
    expect(toISODate(new Date('2026-05-31T14:30:00'))).toBe('2026-05-31')
  })

  it('padded Monat/Tag mit führender Null', () => {
    expect(toISODate(new Date('2026-01-05T00:00:00'))).toBe('2026-01-05')
  })
})

describe('today', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-31T08:00:00'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('liefert heutiges Datum als yyyy-MM-dd', () => {
    expect(today()).toBe('2026-05-31')
  })
})

describe('addWeeks', () => {
  it('addiert positive Wochen', () => {
    expect(addWeeks('2026-05-31', 1)).toBe('2026-06-07')
    expect(addWeeks('2026-05-31', 4)).toBe('2026-06-28')
  })

  it('subtrahiert bei negativen Wochen', () => {
    expect(addWeeks('2026-05-31', -1)).toBe('2026-05-24')
  })

  it('verarbeitet Jahreswechsel korrekt', () => {
    expect(addWeeks('2025-12-29', 1)).toBe('2026-01-05')
  })

  it('weeks=0 → identisches Datum', () => {
    expect(addWeeks('2026-05-31', 0)).toBe('2026-05-31')
  })
})

describe('nextIVIDay', () => {
  // 2026-05-31 ist ein Sonntag (ISO weekday 7)
  // 2026-06-01 = Mo (1), 02 = Di (2), 03 = Mi (3), 04 = Do (4), 05 = Fr (5)

  it('liefert fromDate selbst wenn er ein IVI-Tag ist', () => {
    expect(nextIVIDay('2026-06-01', [1])).toBe('2026-06-01')      // Mo
    expect(nextIVIDay('2026-06-03', [3, 5])).toBe('2026-06-03')   // Mi
  })

  it('sucht vorwärts bis zum nächsten IVI-Tag', () => {
    // Start So → nächster Mo
    expect(nextIVIDay('2026-05-31', [1])).toBe('2026-06-01')
    // Start Mo → nächster Mi
    expect(nextIVIDay('2026-06-01', [3])).toBe('2026-06-03')
    // Start Mi → nächster Fr
    expect(nextIVIDay('2026-06-03', [5])).toBe('2026-06-05')
  })

  it('rotiert über die Woche hinaus (Sa → Mo nächste Woche)', () => {
    // Sa (2026-06-06) → nächster Mo = 2026-06-08
    expect(nextIVIDay('2026-06-06', [1])).toBe('2026-06-08')
  })

  it('liefert fromDate zurück wenn iviDays leer', () => {
    expect(nextIVIDay('2026-05-31', [])).toBe('2026-05-31')
  })
})

describe('nextIVIDays', () => {
  it('liefert die nächsten N IVI-Tage', () => {
    // Mo + Mi an einer Woche die mit Mo (2026-06-01) startet
    const result = nextIVIDays('2026-06-01', [1, 3], 3)
    expect(result).toEqual(['2026-06-01', '2026-06-03', '2026-06-08'])
  })

  it('default count=3', () => {
    const result = nextIVIDays('2026-06-01', [1])
    expect(result).toHaveLength(3)
    expect(result).toEqual(['2026-06-01', '2026-06-08', '2026-06-15'])
  })

  it('liefert [fromDate] wenn iviDays leer', () => {
    expect(nextIVIDays('2026-05-31', [])).toEqual(['2026-05-31'])
  })

  it('stoppt nach 60 Tagen Suche (keine Endlosschleife)', () => {
    // iviDays mit einem nicht-existenten ISO-Wochentag (z.B. 99) → max 60 iterations
    const result = nextIVIDays('2026-06-01', [99], 5)
    expect(result).toEqual([])
  })
})

describe('formatSwissDate', () => {
  it('formatiert ISO-Strings deterministisch mit Zero-Padding', () => {
    expect(formatSwissDate('2026-06-15')).toBe('15.06.2026')
    expect(formatSwissDate('2026-01-05')).toBe('05.01.2026')
    expect(formatSwissDate('2026-12-31')).toBe('31.12.2026')
  })

  it('akzeptiert ISO-Datetime und ignoriert die Zeitkomponente', () => {
    expect(formatSwissDate('2026-06-15T14:30:00Z')).toBe('15.06.2026')
  })

  it('formatiert Date-Objekte plattform-stabil', () => {
    // explizit gepaddet, auch wenn ICU es nicht wäre
    expect(formatSwissDate(new Date(2026, 5, 15))).toBe('15.06.2026')   // Juni
    expect(formatSwissDate(new Date(2026, 0, 5))).toBe('05.01.2026')    // Januar 5.
  })

  it('akzeptiert Millisekunden-Timestamps', () => {
    const ms = new Date(2026, 5, 15).getTime()
    expect(formatSwissDate(ms)).toBe('15.06.2026')
  })

  it('liefert "—" bei leerer/null/undefined/ungültiger Eingabe', () => {
    expect(formatSwissDate(null)).toBe('—')
    expect(formatSwissDate(undefined)).toBe('—')
    expect(formatSwissDate('')).toBe('—')
    expect(formatSwissDate('not a date')).toBe('—')
  })

  it('akzeptiert bereits DD.MM.YYYY (mit oder ohne Padding)', () => {
    // Idempotent: gepaddete Form bleibt unverändert
    expect(formatSwissDate('15.06.2026')).toBe('15.06.2026')
    expect(formatSwissDate('31.12.2026')).toBe('31.12.2026')
    // Ungepaddet wird gepaddet
    expect(formatSwissDate('5.1.2026')).toBe('05.01.2026')
    expect(formatSwissDate('5.6.2026')).toBe('05.06.2026')
  })

  it('konvertiert Excel-Serial-Numbers als String', () => {
    // Anker: 25569 entspricht 1970-01-01 (Unix-Epoche) — direkt im Code
    expect(formatSwissDate('25569')).toBe('01.01.1970')
    // +365 Tage = 1971-01-01
    expect(formatSwissDate(String(25569 + 365))).toBe('01.01.1971')
    // Realistischer Wert aus dem Cron-Output: 45123 → 16.07.2023
    expect(formatSwissDate('45123')).toBe('16.07.2023')
  })
})

describe('WEEKDAY_LABELS', () => {
  it('mappt 1–7 auf Mo–So', () => {
    expect(WEEKDAY_LABELS[1]).toBe('Mo')
    expect(WEEKDAY_LABELS[3]).toBe('Mi')
    expect(WEEKDAY_LABELS[7]).toBe('So')
  })
})
