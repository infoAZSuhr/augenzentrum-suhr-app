import { describe, it, expect } from 'vitest'
import { stripUndefined } from './firestoreSanitize'

describe('stripUndefined', () => {
  it('entfernt undefined-Properties', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' })
  })
  it('behaelt null (= Feld leeren)', () => {
    expect(stripUndefined({ a: null })).toEqual({ a: null })
  })
  it('ersetzt undefined in Arrays durch null (Index-Stabilitaet)', () => {
    expect(stripUndefined([1, undefined, 3])).toEqual([1, null, 3])
  })
  it('bereinigt verschachtelte Objekte in Arrays (der Berichte-Bug)', () => {
    const zuweisung = {
      berichte: [{ typ: 'op', datum: '2026-01-01' }],
      berichtTyp: undefined,   // Legacy-Aufraeumen — hatte Firestore-Write still brechen lassen
      status: 'pendent',
    }
    expect(stripUndefined([zuweisung])).toEqual([{
      berichte: [{ typ: 'op', datum: '2026-01-01' }],
      status: 'pendent',
    }])
  })
  it('laesst Primitives unveraendert', () => {
    expect(stripUndefined('x')).toBe('x')
    expect(stripUndefined(42)).toBe(42)
    expect(stripUndefined(null)).toBeNull()
  })
  it('fasst Klassen-Instanzen (z.B. Firestore Timestamp) nicht an', () => {
    class Fake { toDate() { return new Date() } }
    const inst = new Fake()
    expect(stripUndefined(inst)).toBe(inst)
  })
})
