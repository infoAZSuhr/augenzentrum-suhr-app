import { describe, it, expect } from 'vitest'
import { planAutoFill, autoFillUpdates, type AutoFillDay, type AutoFillOptions } from './planungAutoFill'

/** Baut Tage für einen Zeitraum (ISO von..bis inkl.). */
function days(von: string, bis: string, feiertage: Record<string, string> = {}): AutoFillDay[] {
  const out: AutoFillDay[] = []
  const d = new Date(von + 'T00:00:00Z')
  const end = Date.parse(bis + 'T00:00:00Z')
  while (d.getTime() <= end) {
    const key = d.toISOString().slice(0, 10)
    out.push({ key, dow: d.getUTCDay(), monthIdx: d.getUTCMonth(), ftName: feiertage[key] })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

const base: AutoFillOptions = {
  weekdayCodes: { 1: 'GT' },     // Montag ganztags
  intervalWeeks: 1,
  startDate: '2026-08-01',
  monthIdx: null,
  overwrite: false,
}

describe('planAutoFill – Wochentage & Codes', () => {
  it('füllt nur die gewählten Wochentage', () => {
    const p = planAutoFill(days('2026-08-01', '2026-08-31'), {}, base)
    expect(p.toWrite.map(x => x.key)).toEqual(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'])
    expect(p.toWrite.every(x => x.code === 'GT')).toBe(true)
  })

  it('unterstützt pro Wochentag einen eigenen Code', () => {
    const p = planAutoFill(days('2026-08-01', '2026-08-14'), {}, {
      ...base, weekdayCodes: { 1: 'GT', 3: 'NM' },
    })
    expect(p.toWrite).toEqual([
      { key: '2026-08-03', code: 'GT' }, { key: '2026-08-05', code: 'NM' },
      { key: '2026-08-10', code: 'GT' }, { key: '2026-08-12', code: 'NM' },
    ])
  })

  it('ohne gewählte Wochentage passiert nichts', () => {
    const p = planAutoFill(days('2026-08-01', '2026-08-31'), {}, { ...base, weekdayCodes: {} })
    expect(p.toWrite).toEqual([])
  })
})

describe('planAutoFill – Intervall', () => {
  it('alle 2 Wochen ab der Ankerwoche', () => {
    const p = planAutoFill(days('2026-08-01', '2026-09-30'), {}, { ...base, intervalWeeks: 2, startDate: '2026-08-03' })
    expect(p.toWrite.map(x => x.key)).toEqual(['2026-08-03', '2026-08-17', '2026-08-31', '2026-09-14', '2026-09-28'])
  })

  it('alle 4 Wochen', () => {
    const p = planAutoFill(days('2026-08-01', '2026-10-31'), {}, { ...base, intervalWeeks: 4, startDate: '2026-08-03' })
    expect(p.toWrite.map(x => x.key)).toEqual(['2026-08-03', '2026-08-31', '2026-09-28', '2026-10-26'])
  })

  it('Intervall 0 oder negativ wird als jede Woche behandelt', () => {
    const p = planAutoFill(days('2026-08-01', '2026-08-31'), {}, { ...base, intervalWeeks: 0 })
    expect(p.toWrite).toHaveLength(5)
  })
})

describe('planAutoFill – Zeitraum', () => {
  it('nichts vor dem Ankerdatum', () => {
    const p = planAutoFill(days('2026-08-01', '2026-08-31'), {}, { ...base, startDate: '2026-08-15' })
    expect(p.toWrite.map(x => x.key)).toEqual(['2026-08-17', '2026-08-24', '2026-08-31'])
  })

  it('monthIdx begrenzt auf einen Monat', () => {
    const p = planAutoFill(days('2026-08-01', '2026-09-30'), {}, { ...base, monthIdx: 7 }) // August
    expect(p.toWrite.every(x => x.key.startsWith('2026-08'))).toBe(true)
  })

  it('monthIdx null = ganzes Jahr', () => {
    const p = planAutoFill(days('2026-08-01', '2026-09-30'), {}, base)
    expect(p.toWrite.some(x => x.key.startsWith('2026-09'))).toBe(true)
  })
})

describe('planAutoFill – Schutzregeln', () => {
  it('überspringt Feiertage IMMER, auch mit overwrite', () => {
    const ft = { '2026-08-10': 'Testfeiertag' }
    const p = planAutoFill(days('2026-08-01', '2026-08-31', ft), {}, { ...base, overwrite: true })
    expect(p.toWrite.map(x => x.key)).not.toContain('2026-08-10')
    expect(p.skippedHoliday).toEqual([{ key: '2026-08-10', ftName: 'Testfeiertag' }])
  })

  it('lässt bestehende Einträge (Ferien) stehen', () => {
    const existing = { '2026-08-10': 'Fer', '2026-08-17': 'K' }
    const p = planAutoFill(days('2026-08-01', '2026-08-31'), existing, base)
    expect(p.toWrite.map(x => x.key)).toEqual(['2026-08-03', '2026-08-24', '2026-08-31'])
    expect(p.skippedExisting).toEqual([
      { key: '2026-08-10', code: 'Fer' }, { key: '2026-08-17', code: 'K' },
    ])
  })

  it('overwrite ersetzt bestehende Einträge', () => {
    const existing = { '2026-08-10': 'Fer' }
    const p = planAutoFill(days('2026-08-01', '2026-08-31'), existing, { ...base, overwrite: true })
    expect(p.toWrite.map(x => x.key)).toContain('2026-08-10')
    expect(p.skippedExisting).toEqual([])
  })

  it('schreibt nicht wenn der Code bereits stimmt', () => {
    const existing = { '2026-08-03': 'GT' }
    const p = planAutoFill(days('2026-08-01', '2026-08-31'), existing, { ...base, overwrite: true })
    expect(p.toWrite.map(x => x.key)).not.toContain('2026-08-03')
  })

  it('Wochenende nur wenn explizit gewählt', () => {
    const ohne = planAutoFill(days('2026-08-01', '2026-08-31'), {}, base)
    expect(ohne.toWrite.some(x => ['2026-08-01', '2026-08-02'].includes(x.key))).toBe(false)
    const mit = planAutoFill(days('2026-08-01', '2026-08-31'), {}, { ...base, weekdayCodes: { 6: 'VM' } })
    expect(mit.toWrite.map(x => x.key)).toContain('2026-08-01') // Sa
  })
})

describe('autoFillUpdates', () => {
  it('baut Dot-Notation-Pfade', () => {
    const plan = { toWrite: [{ key: '2026-08-03', code: 'GT' }], skippedExisting: [], skippedHoliday: [] }
    expect(autoFillUpdates('Dmitri Artemiev', plan)).toEqual({
      'schedule.Dmitri Artemiev.2026-08-03': 'GT',
    })
  })

  it('leerer Plan -> leeres Update', () => {
    expect(autoFillUpdates('X', { toWrite: [], skippedExisting: [], skippedHoliday: [] })).toEqual({})
  })
})
