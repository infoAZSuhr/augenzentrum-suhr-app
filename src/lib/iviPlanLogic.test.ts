import { describe, it, expect } from 'vitest'
import {
  filterIviDoctors,
  extractIviDaysFromPlan,
  extractIviDaysFromPlans,
  pickLatestPerPatientEye,
  IVI_DOCTORS_MATCH,
  IVI_WORKING,
  type PlanLike,
} from './iviPlanLogic'

describe('IVI_DOCTORS_MATCH / IVI_WORKING constants', () => {
  it('IVI_DOCTORS_MATCH enthält die erwarteten Tokens', () => {
    expect(IVI_DOCTORS_MATCH).toEqual(['tschopp', 'trachsler'])
  })

  it('IVI_WORKING enthält genau die Working-Codes', () => {
    expect(IVI_WORKING.has('GT')).toBe(true)
    expect(IVI_WORKING.has('VM')).toBe(true)
    expect(IVI_WORKING.has('NM')).toBe(true)
    expect(IVI_WORKING.has('NFD')).toBe(false)
    expect(IVI_WORKING.has('W')).toBe(false)
    expect(IVI_WORKING.has('Fer')).toBe(false)
  })
})

describe('filterIviDoctors', () => {
  it('matched case-insensitive auf substring', () => {
    const persons = ['Markus Tschopp', 'Stefan Trachsler', 'Maria Muster', 'TSCHOPP Junior']
    expect(filterIviDoctors(persons)).toEqual(['Markus Tschopp', 'Stefan Trachsler', 'TSCHOPP Junior'])
  })

  it('liefert leeres Array wenn niemand matched', () => {
    expect(filterIviDoctors(['Muster Maria', 'Beispiel Beat'])).toEqual([])
  })

  it('verkraftet leere Person-Liste', () => {
    expect(filterIviDoctors([])).toEqual([])
  })

  it('akzeptiert custom doctorPatterns', () => {
    expect(filterIviDoctors(['Dr. Schmid', 'Dr. Meier'], ['meier']))
      .toEqual(['Dr. Meier'])
  })
})

describe('extractIviDaysFromPlan', () => {
  const today = '2026-06-01'
  const plan: PlanLike = {
    sections: [{ persons: ['Tschopp', 'Trachsler', 'MPA Muster'] }],
    schedule: {
      Tschopp: {
        '2026-06-02': 'GT',     // future + working
        '2026-06-03': 'VM',     // future + working
        '2026-06-04': 'W',      // future + non-working
        '2026-05-20': 'GT',     // past — wird ausgeschlossen
      },
      Trachsler: {
        '2026-06-02': 'NM',     // future + working (gleicher Tag wie Tschopp → dedup)
        '2026-06-10': 'GT',
      },
      'MPA Muster': {
        '2026-06-02': 'GT',     // kein IVI-Arzt → ausschliessen
      },
    },
  }

  it('extrahiert alle künftigen IVI-Tage mit Working-Code', () => {
    const days = extractIviDaysFromPlan(plan, today)
    expect([...days].sort()).toEqual(['2026-06-02', '2026-06-03', '2026-06-10'])
  })

  it('exkludiert Tage in der Vergangenheit', () => {
    const days = extractIviDaysFromPlan(plan, today)
    expect(days.has('2026-05-20')).toBe(false)
  })

  it('exkludiert nicht-Working-Codes (W, Fer, NFD …)', () => {
    const days = extractIviDaysFromPlan(plan, today)
    expect(days.has('2026-06-04')).toBe(false)
  })

  it('liefert leere Set wenn plan null', () => {
    expect([...extractIviDaysFromPlan(null, today)]).toEqual([])
    expect([...extractIviDaysFromPlan(undefined, today)]).toEqual([])
  })

  it('inkludiert das heute-Datum (Vergleich ist >=)', () => {
    const planToday: PlanLike = {
      sections: [{ persons: ['Tschopp'] }],
      schedule: { Tschopp: { '2026-06-01': 'GT' } },
    }
    expect([...extractIviDaysFromPlan(planToday, today)]).toEqual(['2026-06-01'])
  })
})

describe('extractIviDaysFromPlans', () => {
  const today = '2025-12-29'
  const plan2025: PlanLike = {
    sections: [{ persons: ['Tschopp'] }],
    schedule: { Tschopp: { '2025-12-30': 'GT', '2025-12-31': 'VM' } },
  }
  const plan2026: PlanLike = {
    sections: [{ persons: ['Trachsler'] }],
    schedule: { Trachsler: { '2026-01-05': 'NM', '2026-01-06': 'GT' } },
  }

  it('vereint mehrere Pläne und liefert sortierte Liste', () => {
    expect(extractIviDaysFromPlans([plan2025, plan2026], today))
      .toEqual(['2025-12-30', '2025-12-31', '2026-01-05', '2026-01-06'])
  })

  it('verkraftet null-Pläne in der Liste', () => {
    expect(extractIviDaysFromPlans([null, plan2026, undefined], today))
      .toEqual(['2026-01-05', '2026-01-06'])
  })

  it('liefert leeres Array wenn alle Pläne null', () => {
    expect(extractIviDaysFromPlans([null, undefined], today)).toEqual([])
  })

  it('dedupliziert Tage die in mehreren Plänen vorkommen', () => {
    // Theoretisch passiert das nicht (Pläne sind nach Jahr getrennt), aber
    // die Function soll robust sein.
    const dup: PlanLike = {
      sections: [{ persons: ['Tschopp'] }],
      schedule: { Tschopp: { '2025-12-30': 'GT' } },
    }
    expect(extractIviDaysFromPlans([plan2025, dup], today))
      .toEqual(['2025-12-30', '2025-12-31'])
  })
})

describe('pickLatestPerPatientEye', () => {
  it('behält pro patientId+eyeSide nur den neuesten Eintrag', () => {
    const treatments = [
      { patientId: 'P1', eyeSide: 'OD', treatmentDate: '2026-01-15' },
      { patientId: 'P1', eyeSide: 'OD', treatmentDate: '2026-03-10' },   // neuer
      { patientId: 'P1', eyeSide: 'OD', treatmentDate: '2026-02-20' },   // dazwischen
      { patientId: 'P1', eyeSide: 'OS', treatmentDate: '2026-01-15' },   // anderes Auge
      { patientId: 'P2', eyeSide: 'OD', treatmentDate: '2026-04-01' },   // anderer Patient
    ]
    const result = pickLatestPerPatientEye(treatments)
    expect(result.size).toBe(3)
    expect(result.get('P1:OD')?.treatmentDate).toBe('2026-03-10')
    expect(result.get('P1:OS')?.treatmentDate).toBe('2026-01-15')
    expect(result.get('P2:OD')?.treatmentDate).toBe('2026-04-01')
  })

  it('liefert leere Map für leere Eingabe', () => {
    expect(pickLatestPerPatientEye([]).size).toBe(0)
  })

  it('verkraftet einen einzigen Eintrag', () => {
    const result = pickLatestPerPatientEye([{ patientId: 'X', eyeSide: 'OD', treatmentDate: '2026-01-01' }])
    expect(result.size).toBe(1)
    expect(result.get('X:OD')?.treatmentDate).toBe('2026-01-01')
  })

  it('behält zusätzliche Felder bei (generisch über T)', () => {
    const result = pickLatestPerPatientEye([
      { patientId: 'P1', eyeSide: 'OD', treatmentDate: '2026-01-01', extra: 'alt' },
      { patientId: 'P1', eyeSide: 'OD', treatmentDate: '2026-02-01', extra: 'neu' },
    ])
    expect(result.get('P1:OD')?.extra).toBe('neu')
  })
})
