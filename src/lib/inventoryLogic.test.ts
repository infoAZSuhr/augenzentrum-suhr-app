import { describe, it, expect } from 'vitest'
import {
  sumActiveLotQuantity,
  nextExpiryDate,
  stockStatus,
  matchZurRoseEntry,
  formatZurRoseAlertDetail,
} from './inventoryLogic'
import { vatRate } from '../types/inventory.types'

describe('sumActiveLotQuantity', () => {
  it('summiert nur nicht-aufgebrauchte Lots', () => {
    expect(sumActiveLotQuantity([
      { quantity: 5,  isDepleted: false },
      { quantity: 3,  isDepleted: true  },   // wird ignoriert
      { quantity: 7,  isDepleted: false },
    ])).toBe(12)
  })

  it('liefert 0 bei leerem Array', () => {
    expect(sumActiveLotQuantity([])).toBe(0)
  })

  it('liefert 0 wenn alle Lots aufgebraucht', () => {
    expect(sumActiveLotQuantity([
      { quantity: 5, isDepleted: true },
      { quantity: 3, isDepleted: true },
    ])).toBe(0)
  })

  it('behandelt fehlende quantity als 0', () => {
    expect(sumActiveLotQuantity([
      { quantity: 5 },
      { quantity: undefined as any },
      { quantity: 10 },
    ])).toBe(15)
  })

  it('default isDepleted=undefined wird als nicht-aufgebraucht behandelt', () => {
    expect(sumActiveLotQuantity([{ quantity: 4 }])).toBe(4)
  })
})

describe('nextExpiryDate', () => {
  it('liefert das früheste expiryDate aus aktiven Lots', () => {
    expect(nextExpiryDate([
      { quantity: 5, expiryDate: '2026-12-31' },
      { quantity: 3, expiryDate: '2026-06-15' },   // frühestes
      { quantity: 7, expiryDate: '2026-09-01' },
    ])).toBe('2026-06-15')
  })

  it('ignoriert aufgebrauchte Lots auch wenn deren MHD früher liegt', () => {
    expect(nextExpiryDate([
      { quantity: 0, isDepleted: true, expiryDate: '2026-01-01' },
      { quantity: 5, expiryDate: '2026-06-15' },
    ])).toBe('2026-06-15')
  })

  it('ignoriert Lots ohne expiryDate', () => {
    expect(nextExpiryDate([
      { quantity: 5 },
      { quantity: 3, expiryDate: '2026-06-15' },
    ])).toBe('2026-06-15')
  })

  it('liefert null wenn keine passenden Lots', () => {
    expect(nextExpiryDate([])).toBeNull()
    expect(nextExpiryDate([{ quantity: 5 }])).toBeNull()
    expect(nextExpiryDate([{ quantity: 5, isDepleted: true, expiryDate: '2026-01-01' }])).toBeNull()
  })
})

describe('stockStatus', () => {
  it('"out" bei Bestand 0 (auch wenn minStock 0)', () => {
    expect(stockStatus(0, 10)).toBe('out')
    expect(stockStatus(0, 0)).toBe('out')
    expect(stockStatus(0, undefined)).toBe('out')
  })

  it('"critical" bei ≤ 50% des minStock', () => {
    expect(stockStatus(5,  10)).toBe('critical')   // genau 50%
    expect(stockStatus(3,  10)).toBe('critical')
    expect(stockStatus(1,  10)).toBe('critical')
  })

  it('"low" zwischen 50% und 100% des minStock (exklusiv)', () => {
    expect(stockStatus(6,  10)).toBe('low')
    expect(stockStatus(9,  10)).toBe('low')
  })

  it('"ok" bei Bestand >= minStock', () => {
    expect(stockStatus(10, 10)).toBe('ok')
    expect(stockStatus(20, 10)).toBe('ok')
    expect(stockStatus(100, 0)).toBe('ok')
    expect(stockStatus(100, undefined)).toBe('ok')
  })
})

describe('vatRate', () => {
  it('Medikamente: 2.6 %', () => {
    expect(vatRate('Medikament')).toBe(2.6)
    expect(vatRate('Augentropfen')).toBe(2.6)
  })

  it('alle anderen Kategorien: 8.1 %', () => {
    expect(vatRate('Verbrauchsmaterial')).toBe(8.1)
    expect(vatRate('Instrument')).toBe(8.1)
    expect(vatRate('Sonstiges')).toBe(8.1)
    expect(vatRate('Desinfektion')).toBe(8.1)
  })

  it('unbekannte Kategorie: 8.1 %', () => {
    expect(vatRate('Unbekannt')).toBe(8.1)
    expect(vatRate('')).toBe(8.1)
  })
})

describe('matchZurRoseEntry', () => {
  const entries = [
    { pc: 1234, n: 'Oxybuprocain 0.4%' },
    { pc: 5678, n: 'Eylea 2 mg' },
    { pc: 9999, n: 'Lucentis 0.5 mg', d: '2026-06-15' },
  ]

  it('matched exakt über Pharmacode (articleNumber)', () => {
    const article = { id: 'A1', name: 'Egal-Name', articleNumber: '5678' }
    expect(matchZurRoseEntry(article, entries)?.pc).toBe(5678)
  })

  it('Pharmacode hat Vorrang vor Name-Match', () => {
    const article = { id: 'A1', name: 'Oxybuprocain', articleNumber: '5678' }
    expect(matchZurRoseEntry(article, entries)?.pc).toBe(5678)  // pc, nicht 1234
  })

  it('matched über ersten Wort-Stamm wenn kein Pharmacode', () => {
    const article = { id: 'A1', name: 'Oxybuprocaine 0.4%' }  // mit "e" am Ende
    expect(matchZurRoseEntry(article, entries)?.pc).toBe(1234)
  })

  it('matched startsWith in beide Richtungen', () => {
    // Article-Name kürzer als ZR-Name
    expect(matchZurRoseEntry({ id: 'A1', name: 'Eyl' }, entries)?.pc).toBe(5678)
    // ZR-Name kürzer als Article-Name
    expect(matchZurRoseEntry({ id: 'A1', name: 'Eylea Plus 4 mg' }, entries)?.pc).toBe(5678)
  })

  it('matched NICHT bei zu kurzen Tokens (< 4 Zeichen)', () => {
    const shortEntries = [{ pc: 1, n: 'Pro 5 mg' }]
    expect(matchZurRoseEntry({ id: 'A1', name: 'ProBlock' }, shortEntries)).toBeUndefined()
  })

  it('liefert undefined wenn nichts matched', () => {
    expect(matchZurRoseEntry({ id: 'A1', name: 'Aspirin' }, entries)).toBeUndefined()
  })

  it('verkraftet leere entries', () => {
    expect(matchZurRoseEntry({ id: 'A1', name: 'X' }, [])).toBeUndefined()
  })

  it('ungültiger Pharmacode-String fällt durch zum Name-Match', () => {
    const article = { id: 'A1', name: 'Eylea 2 mg', articleNumber: 'abc' }
    expect(matchZurRoseEntry(article, entries)?.pc).toBe(5678)
  })
})

describe('formatZurRoseAlertDetail', () => {
  it('formatiert Datum als "Ausstand bis DD.MM.YYYY"', () => {
    const result = formatZurRoseAlertDetail({ pc: 1, n: 'X', d: '2026-06-15' })
    expect(result).toBe('Ausstand bis 15.06.2026')
  })

  it('"fehlt …" → "Auf unbestimmte Zeit"', () => {
    expect(formatZurRoseAlertDetail({ pc: 1, n: 'X', d: 'fehlt seit Juni' }))
      .toBe('Auf unbestimmte Zeit')
  })

  it('kein Datum → "Nicht lieferbar (Zur Rose)"', () => {
    expect(formatZurRoseAlertDetail({ pc: 1, n: 'X' }))
      .toBe('Nicht lieferbar (Zur Rose)')
  })
})
