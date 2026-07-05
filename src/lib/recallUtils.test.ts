import { describe, it, expect } from 'vitest'
import {
  formatDate, ageFromGeb, normalizePid, titleCaseName, parseStamp,
  computeNextKons, parseKonsInterval, toInputDate, toInputDatetime,
  parseDroppedDate, normalizeLirisAddress, isFutureDate, formatErgebnis,
  pendingVorgehenLabel, isKeinTermin,
} from './recallUtils'

describe('formatDate', () => {
  it('formatiert ISO zu Schweizer Format', () => {
    expect(formatDate('2026-07-05')).toBe('05.07.2026')
  })
  it('formatiert Datetime mit Uhrzeit', () => {
    expect(formatDate('2026-07-05T10:30')).toBe('05.07.2026 10:30')
  })
  it('zeigt "Im Recall" fuer kein Termin', () => {
    expect(formatDate('kein Termin')).toBe('Im Recall')
  })
  it('zeigt — fuer leere/ungueltige Werte', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('NaT')).toBe('—')
    expect(formatDate('nan')).toBe('—')
  })
})

describe('ageFromGeb', () => {
  it('berechnet Alter korrekt (Geburtstag schon gewesen)', () => {
    const y = new Date().getFullYear()
    expect(ageFromGeb(`${y - 10}-01-01`)).toBe(10)
  })
  it('beruecksichtigt noch nicht erreichten Geburtstag', () => {
    const y = new Date().getFullYear()
    expect(ageFromGeb(`${y - 10}-12-31`)).toBe(9)
  })
  it('null bei ungueltigem Datum', () => {
    expect(ageFromGeb('kein Datum')).toBeNull()
    expect(ageFromGeb(null)).toBeNull()
  })
})

describe('normalizePid', () => {
  it('entfernt # und fuehrende Nullen', () => {
    expect(normalizePid('#0042')).toBe('42')
    expect(normalizePid('01722')).toBe('1722')
    expect(normalizePid('007')).toBe('7')
  })
  it('laesst normale PIDs unveraendert', () => {
    expect(normalizePid('1234')).toBe('1234')
  })
  it('leere Eingaben → leerer String', () => {
    expect(normalizePid(null)).toBe('')
    expect(normalizePid(undefined)).toBe('')
  })
})

describe('titleCaseName', () => {
  it('wandelt GROSSSCHREIBUNG um', () => {
    expect(titleCaseName('PUMA TORIERI')).toBe('Puma Torieri')
  })
  it('laesst gemischte Schreibweise unveraendert', () => {
    expect(titleCaseName('McDonald')).toBe('McDonald')
  })
  it('behandelt Bindestrich-Namen je Teil', () => {
    expect(titleCaseName('MUELLER-MEIER Anna')).toBe('Mueller-Meier Anna')
  })
})

describe('parseStamp', () => {
  it('parst recallTimestamp korrekt', () => {
    expect(parseStamp('26.04.2026 14:30 – Vera')).toEqual({
      dateStr: '26.04.2026', isoDate: '2026-04-26', user: 'Vera',
    })
  })
  it('null bei fremdem Format', () => {
    expect(parseStamp('2026-04-26')).toBeNull()
    expect(parseStamp(null)).toBeNull()
  })
})

describe('parseKonsInterval / computeNextKons', () => {
  it('parst 1j/6m/2w/10t', () => {
    expect(parseKonsInterval('1j')).toEqual({ n: 1, unit: 'year' })
    expect(parseKonsInterval('6M')).toEqual({ n: 6, unit: 'month' })
    expect(parseKonsInterval('2w')).toEqual({ n: 2, unit: 'week' })
    expect(parseKonsInterval('10t')).toEqual({ n: 10, unit: 'day' })
  })
  it('lehnt Unsinn ab', () => {
    expect(parseKonsInterval('abc')).toBeNull()
    expect(parseKonsInterval('0j')).toBeNull()
    expect(parseKonsInterval('999j')).toBeNull()
  })
  it('berechnet naechste Konsultation', () => {
    expect(computeNextKons('2026-01-15', '1j')).toBe('2027-01-15')
    expect(computeNextKons('2026-01-15', '6m')).toBe('2026-07-15')
    expect(computeNextKons('2026-01-15', '2w')).toBe('2026-01-29')
  })
  it('Monats-Ueberlauf (31.01. + 1m)', () => {
    expect(computeNextKons('2026-01-31', '1m')).toBe('2026-03-03')
  })
})

describe('toInputDate / toInputDatetime', () => {
  it('extrahiert ISO-Datum', () => {
    expect(toInputDate('2026-07-05T10:30')).toBe('2026-07-05')
    expect(toInputDate('kein Termin')).toBe('')
  })
  it('datetime-local Wert', () => {
    expect(toInputDatetime('2026-07-05 10:30')).toBe('2026-07-05T10:30')
    expect(toInputDatetime('2026-07-05')).toBe('2026-07-05T00:00')
  })
})

describe('parseDroppedDate', () => {
  it('erkennt Schweizer + ISO-Formate', () => {
    expect(parseDroppedDate('05.07.2026')).toBe('2026-07-05')
    expect(parseDroppedDate('5.7.2026')).toBe('2026-07-05')
    expect(parseDroppedDate('2026-07-05')).toBe('2026-07-05')
    expect(parseDroppedDate('05.07.26')).toBe('2026-07-05')
  })
  it('leer bei nicht erkennbarem Datum', () => {
    expect(parseDroppedDate('hallo')).toBe('')
  })
})

describe('normalizeLirisAddress', () => {
  it('sortiert Liris-Reihenfolge (Name/PLZ/Strasse/Ort) um', () => {
    expect(normalizeLirisAddress('Muster Hans\n5034\nBahnhofstrasse 12\nSuhr'))
      .toBe('Muster Hans\nBahnhofstrasse 12\n5034 Suhr')
  })
  it('laesst Standard-Format unveraendert', () => {
    const std = 'Muster Hans\nBahnhofstrasse 12\n5034 Suhr'
    expect(normalizeLirisAddress(std)).toBe(std)
  })
})

describe('isFutureDate / isKeinTermin / formatErgebnis / pendingVorgehenLabel', () => {
  it('isFutureDate', () => {
    expect(isFutureDate('2099-01-01')).toBe(true)
    expect(isFutureDate('2000-01-01')).toBe(false)
    expect(isFutureDate(null)).toBe(false)
  })
  it('isKeinTermin', () => {
    expect(isKeinTermin('kein Termin')).toBe(true)
    expect(isKeinTermin('2026-01-01')).toBe(false)
  })
  it('formatErgebnis wandelt eingebettete ISO-Daten um', () => {
    expect(formatErgebnis('Geplant: 2026-07-05')).toBe('Geplant: 05.07.2026')
  })
  it('pendingVorgehenLabel kombiniert Aufgaben', () => {
    expect(pendingVorgehenLabel({ verlauf: [
      { aktion: 'Telefonanruf', ergebnis: 'noch zu erledigen' },
      { aktion: 'E-Mail', ergebnis: 'noch zu erledigen' },
    ] })).toBe('Patient anrufen & E-Mail senden')
    expect(pendingVorgehenLabel({ verlauf: [] })).toBe('Noch zu erledigen')
  })
})
