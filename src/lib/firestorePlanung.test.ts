import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Firestore-Mock — muss VOR dem Import des Test-Subjekts geladen werden ──
// Wir mocken `firebase/firestore`, so dass updateDoc/getDoc usw. nur Spy-Funktionen
// sind. So lässt sich verifizieren, mit welchen Argumenten der echte Code sie ruft —
// ohne ein laufendes Firestore.
const DELETE_FIELD_MARKER = '__DELETE_FIELD__'

vi.mock('firebase/firestore', () => ({
  doc:         vi.fn((_db, collection, id) => ({ __ref: `${collection}/${id}` })),
  getDoc:      vi.fn(),
  setDoc:      vi.fn(),
  updateDoc:   vi.fn(),
  deleteField: vi.fn(() => DELETE_FIELD_MARKER),
  onSnapshot:  vi.fn(),
}))

vi.mock('./firebase', () => ({ db: { __mockDb: true } }))

// Jetzt darf das Test-Subjekt geladen werden
import {
  buildDatesByYear,
  resolvePersonKey,
  writePlanEntry,
  removePlanEntry,
  updatePlanComment,
  type PlanungData,
} from './firestorePlanung'
import { updateDoc, doc } from 'firebase/firestore'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Pure functions ──────────────────────────────────────────────────────────

describe('buildDatesByYear', () => {
  it('liefert nur Wochentage (Mo–Fr)', () => {
    // 2026-05-25 ist ein Mo, 2026-05-31 ein So
    const byYear = buildDatesByYear('2026-05-25', '2026-05-31')
    expect(byYear[2026]).toEqual([
      '2026-05-25', // Mo
      '2026-05-26', // Di
      '2026-05-27', // Mi
      '2026-05-28', // Do
      '2026-05-29', // Fr
      // 2026-05-30 (Sa) und 2026-05-31 (So) ausgeschlossen
    ])
  })

  it('gruppiert über Jahreswechsel hinweg korrekt', () => {
    // 2025-12-29 (Mo) bis 2026-01-02 (Fr) — Jahreswechsel
    const byYear = buildDatesByYear('2025-12-29', '2026-01-02')
    expect(byYear[2025]).toEqual(['2025-12-29', '2025-12-30', '2025-12-31'])
    expect(byYear[2026]).toEqual(['2026-01-01', '2026-01-02'])
  })

  it('gibt leeres Objekt zurück, wenn Range vollständig im Wochenende liegt', () => {
    // 2026-05-30 (Sa) bis 2026-05-31 (So)
    expect(buildDatesByYear('2026-05-30', '2026-05-31')).toEqual({})
  })

  it('inkludiert den from-Tag selbst, wenn er ein Wochentag ist', () => {
    const byYear = buildDatesByYear('2026-05-25', '2026-05-25')
    expect(byYear[2026]).toEqual(['2026-05-25'])
  })
})

describe('resolvePersonKey', () => {
  const planData: PlanungData = {
    sections: [
      { label: 'Ärzte',  persons: ['Tschopp', 'Trachsler'] },
      { label: 'MPAs',   persons: ['Muster Maria', 'Beispiel Beat'] },
    ],
    schedule: {},
  }

  it('liefert exact match', () => {
    expect(resolvePersonKey(planData, 'Tschopp')).toBe('Tschopp')
  })

  it('matched case-insensitive über alle Sections', () => {
    expect(resolvePersonKey(planData, 'tschopp')).toBe('Tschopp')
    expect(resolvePersonKey(planData, 'BEISPIEL BEAT')).toBe('Beispiel Beat')
  })

  it('gibt den Input unverändert zurück wenn kein Match', () => {
    expect(resolvePersonKey(planData, 'Unbekannt')).toBe('Unbekannt')
  })

  it('verkraftet leere/fehlende sections', () => {
    expect(resolvePersonKey({ sections: [], schedule: {} } as any, 'X')).toBe('X')
    expect(resolvePersonKey({} as any, 'X')).toBe('X')
  })
})

// ── Firestore-Wrapper: atomische dot-notation Updates ──────────────────────

describe('writePlanEntry', () => {
  it('schreibt schedule + comment in dot-notation für jedes Datum', async () => {
    await writePlanEntry('Tschopp', ['2026-06-01', '2026-06-02'], 'GT', 'Kommentar')
    expect(doc).toHaveBeenCalledWith(expect.anything(), 'planung', '2026')
    expect(updateDoc).toHaveBeenCalledTimes(1)
    expect(updateDoc).toHaveBeenCalledWith(expect.anything(), {
      'schedule.Tschopp.2026-06-01': 'GT',
      'comments.Tschopp.2026-06-01': 'Kommentar',
      'schedule.Tschopp.2026-06-02': 'GT',
      'comments.Tschopp.2026-06-02': 'Kommentar',
    })
  })

  it('löscht den Kommentar wenn leer (deleteField marker)', async () => {
    await writePlanEntry('Muster', ['2026-06-01'], 'VM', '')
    expect(updateDoc).toHaveBeenCalledWith(expect.anything(), {
      'schedule.Muster.2026-06-01': 'VM',
      'comments.Muster.2026-06-01': DELETE_FIELD_MARKER,
    })
  })

  it('verwendet das explizit übergebene Jahr', async () => {
    await writePlanEntry('Tschopp', ['2027-01-15'], 'GT', '', 2027)
    expect(doc).toHaveBeenCalledWith(expect.anything(), 'planung', '2027')
  })

  it('macht NICHTS wenn personName oder dates leer ist', async () => {
    await writePlanEntry('', ['2026-06-01'], 'GT', '')
    await writePlanEntry('X', [], 'GT', '')
    expect(updateDoc).not.toHaveBeenCalled()
  })
})

describe('removePlanEntry', () => {
  it('löscht schedule + comment für alle Daten in dot-notation', async () => {
    await removePlanEntry('Tschopp', ['2026-06-01', '2026-06-02'])
    expect(updateDoc).toHaveBeenCalledTimes(1)
    expect(updateDoc).toHaveBeenCalledWith(expect.anything(), {
      'schedule.Tschopp.2026-06-01': DELETE_FIELD_MARKER,
      'comments.Tschopp.2026-06-01': DELETE_FIELD_MARKER,
      'schedule.Tschopp.2026-06-02': DELETE_FIELD_MARKER,
      'comments.Tschopp.2026-06-02': DELETE_FIELD_MARKER,
    })
  })

  it('macht NICHTS bei leeren Inputs', async () => {
    await removePlanEntry('', ['2026-06-01'])
    await removePlanEntry('X', [])
    expect(updateDoc).not.toHaveBeenCalled()
  })
})

describe('updatePlanComment', () => {
  it('setzt Kommentar wenn truthy', async () => {
    await updatePlanComment('Tschopp', ['2026-06-01'], 'prov. – Bitte prüfen')
    expect(updateDoc).toHaveBeenCalledWith(expect.anything(), {
      'comments.Tschopp.2026-06-01': 'prov. – Bitte prüfen',
    })
  })

  it('löscht Kommentar (deleteField) wenn null oder leer', async () => {
    await updatePlanComment('Tschopp', ['2026-06-01'], null)
    expect(updateDoc).toHaveBeenCalledWith(expect.anything(), {
      'comments.Tschopp.2026-06-01': DELETE_FIELD_MARKER,
    })
  })

  it('touched schedule NICHT — nur comments', async () => {
    await updatePlanComment('Tschopp', ['2026-06-01'], 'X')
    const call = (updateDoc as any).mock.calls[0]
    const update = call[1]
    expect(Object.keys(update)).toEqual(['comments.Tschopp.2026-06-01'])
    expect(Object.keys(update).every(k => k.startsWith('comments.'))).toBe(true)
  })

  it('extrahiert das Jahr aus dem ersten Datum wenn keines übergeben', async () => {
    await updatePlanComment('Tschopp', ['2027-03-15'], 'X')
    expect(doc).toHaveBeenCalledWith(expect.anything(), 'planung', '2027')
  })
})
