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
    vi.setSystemTime(new Date('2026-05-31T00:00:00Z'))
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

describe('WEEKDAY_LABELS', () => {
  it('mappt 1–7 auf Mo–So', () => {
    expect(WEEKDAY_LABELS[1]).toBe('Mo')
    expect(WEEKDAY_LABELS[3]).toBe('Mi')
    expect(WEEKDAY_LABELS[7]).toBe('So')
  })
})
