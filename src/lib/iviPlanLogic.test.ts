import { describe, it, expect } from 'vitest'
import {
  filterIviDoctors,
  extractIviDaysFromPlan,
  extractIviDaysFromPlans,
  pickLatestPerPatientEye,
  IVI_DOCTORS_MATCH,
  IVI_WORKING,
  overlapWindow,
  buildArztVerfuegbarkeit,
  buildIviVorschlaege,
  passenderPartnerCode,
  isoKalenderwoche,
  IVI_INJECTOR_MATCH,
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

// ─── Arzt-Verfügbarkeit ──────────────────────────────────────────────────────

const PLAN = (schedule: Record<string, Record<string, string>>): PlanLike => ({
  sections: [{ persons: ['Dmitri Artemiev', 'Markus Tschopp', 'Stefan Trachsler', 'Svetlana Malinina'] }],
  schedule,
})

describe('IVI_INJECTOR_MATCH', () => {
  it('enthält den injizierenden Arzt', () => {
    expect(IVI_INJECTOR_MATCH).toEqual(['artemiev'])
  })
})

describe('overlapWindow', () => {
  it('GT + GT = ganzer Tag', () => expect(overlapWindow('GT', 'GT')).toBe('ganzer Tag'))
  it('GT + NM = Nachmittag', () => expect(overlapWindow('GT', 'NM')).toBe('Nachmittag'))
  it('GT + VM = Vormittag', () => expect(overlapWindow('GT', 'VM')).toBe('Vormittag'))
  it('VM + NM = keine Überlappung', () => expect(overlapWindow('VM', 'NM')).toBeNull())
  it('NM + VM = keine Überlappung', () => expect(overlapWindow('NM', 'VM')).toBeNull())
  it('VM + VM = Vormittag', () => expect(overlapWindow('VM', 'VM')).toBe('Vormittag'))
})

describe('buildArztVerfuegbarkeit', () => {
  it('markiert Tag als passend wenn Injektor + Partner überlappen', () => {
    const r = buildArztVerfuegbarkeit([PLAN({
      'Dmitri Artemiev': { '2026-08-03': 'GT' },
      'Markus Tschopp':  { '2026-08-03': 'NM' },
    })], '2026-08-01')
    expect(r).toHaveLength(1)
    expect(r[0].passend).toBe(true)
    expect(r[0].fenster).toBe('Nachmittag')
    expect(r[0].anwesend.map(a => a.name)).toEqual(['Dmitri Artemiev', 'Markus Tschopp'])
  })

  it('nicht passend wenn Injektor VM und Partner NM', () => {
    const r = buildArztVerfuegbarkeit([PLAN({
      'Dmitri Artemiev': { '2026-08-03': 'VM' },
      'Markus Tschopp':  { '2026-08-03': 'NM' },
    })], '2026-08-01')
    expect(r[0].passend).toBe(false)
    expect(r[0].fenster).toBeNull()
  })

  it('nicht passend wenn der Injektor fehlt', () => {
    const r = buildArztVerfuegbarkeit([PLAN({
      'Markus Tschopp': { '2026-08-03': 'GT' },
    })], '2026-08-01')
    expect(r[0].passend).toBe(false)
    expect(r[0].anwesend).toHaveLength(1)
  })

  it('nicht passend wenn nur der Injektor da ist', () => {
    const r = buildArztVerfuegbarkeit([PLAN({
      'Dmitri Artemiev': { '2026-08-03': 'GT' },
    })], '2026-08-01')
    expect(r[0].passend).toBe(false)
  })

  it('listet den Injektor zuerst', () => {
    const r = buildArztVerfuegbarkeit([PLAN({
      'Markus Tschopp':  { '2026-08-03': 'GT' },
      'Dmitri Artemiev': { '2026-08-03': 'GT' },
    })], '2026-08-01')
    expect(r[0].anwesend[0].name).toBe('Dmitri Artemiev')
    expect(r[0].anwesend[0].injector).toBe(true)
  })

  it('ignoriert Tage vor today und Nicht-Working-Codes', () => {
    const r = buildArztVerfuegbarkeit([PLAN({
      'Dmitri Artemiev': { '2026-07-01': 'GT', '2026-08-03': 'Fer', '2026-08-10': 'GT' },
      'Markus Tschopp':  { '2026-08-10': 'GT' },
    })], '2026-08-01')
    expect(r.map(x => x.date)).toEqual(['2026-08-10'])
  })

  it('ignoriert nicht-relevante Ärzte komplett', () => {
    const r = buildArztVerfuegbarkeit([PLAN({
      'Svetlana Malinina': { '2026-08-03': 'GT' },
    })], '2026-08-01')
    expect(r).toEqual([])
  })

  it('vereint mehrere Jahres-Pläne und sortiert nach Datum', () => {
    const r = buildArztVerfuegbarkeit([
      PLAN({ 'Dmitri Artemiev': { '2026-12-28': 'GT' }, 'Markus Tschopp': { '2026-12-28': 'GT' } }),
      PLAN({ 'Dmitri Artemiev': { '2027-01-04': 'GT' }, 'Stefan Trachsler': { '2027-01-04': 'GT' } }),
    ], '2026-08-01')
    expect(r.map(x => x.date)).toEqual(['2026-12-28', '2027-01-04'])
    expect(r.every(x => x.passend)).toBe(true)
  })

  it('waehlt das beste Fenster wenn mehrere Partner da sind', () => {
    const r = buildArztVerfuegbarkeit([PLAN({
      'Dmitri Artemiev':  { '2026-08-03': 'GT' },
      'Markus Tschopp':   { '2026-08-03': 'VM' },
      'Stefan Trachsler': { '2026-08-03': 'GT' },
    })], '2026-08-01')
    expect(r[0].fenster).toBe('ganzer Tag')
  })
})

// ─── IVI-Tag-Vorschläge ──────────────────────────────────────────────────────

/** Kurz-Helfer: baut Verfügbarkeit aus einem Schedule-Objekt. */
const verf = (schedule: Record<string, Record<string, string>>, today = '2026-08-01') =>
  buildArztVerfuegbarkeit([PLAN(schedule)], today)

describe('passenderPartnerCode', () => {
  it('GT -> NM (Nachmittag ist das uebliche IVI-Fenster)', () => {
    expect(passenderPartnerCode('GT')).toBe('NM')
  })
  it('VM -> VM, NM -> NM', () => {
    expect(passenderPartnerCode('VM')).toBe('VM')
    expect(passenderPartnerCode('NM')).toBe('NM')
  })
  it('unbekannter Code -> null', () => {
    expect(passenderPartnerCode('Fer')).toBeNull()
  })
})

describe('buildIviVorschlaege — Raster', () => {
  it('schlaegt jeden 2. Montag vor (Rhythmus in ungeraden KW)', () => {
    const v = verf({
      'Dmitri Artemiev': {
        '2026-08-10': 'GT', '2026-08-24': 'GT', '2026-09-07': 'GT', '2026-09-21': 'GT',
      },
    })
    const r = buildIviVorschlaege(v, '2026-08-01', '2026-09-25')
    expect(r.map(x => x.date)).toEqual(['2026-08-10', '2026-08-24', '2026-09-07', '2026-09-21'])
  })

  it('verankert einen NEUEN Rhythmus auf einer ungeraden KW', () => {
    // naechster Montag ab 01.08. waere der 03.08. (KW 32, gerade) → soll auf
    // den 10.08. (KW 33, ungerade) verschoben werden.
    const v = verf({ 'Dmitri Artemiev': { '2026-08-10': 'GT', '2026-08-24': 'GT' } })
    const r = buildIviVorschlaege(v, '2026-08-01', '2026-08-31')
    expect(isoKalenderwoche(r[0].rasterMontag) % 2).toBe(1)
    expect(r[0].rasterMontag).toBe('2026-08-10')
  })

  it('bevorzugt als Start eine ungerade KW mit ZWEI Ärzten', () => {
    // Woche KW 32 (gerade): nur Injektor. Woche KW 33 (ungerade): Injektor +
    // Partner → soll als Startpunkt gewählt werden.
    const v = verf({
      'Dmitri Artemiev': { '2026-08-03': 'GT', '2026-08-10': 'GT' },
      'Markus Tschopp':  { '2026-08-10': 'NM' },
    })
    const r = buildIviVorschlaege(v, '2026-08-01', '2026-08-20')
    expect(r[0].rasterMontag).toBe('2026-08-10')
    expect(r[0].status).toBe('bereit')
  })

  it('verankert am bestehenden IVI-Montag NUR wenn ungerade KW', () => {
    // bestehender IVI-Tag 10.08. (KW 33, ungerade) verankert den Rhythmus.
    const v = verf({ 'Dmitri Artemiev': { '2026-08-10': 'GT', '2026-08-24': 'GT' } })
    const r = buildIviVorschlaege(v, '2026-08-01', '2026-08-31', {}, ['2026-08-10'])
    expect(r.map(x => x.rasterMontag)).toEqual(['2026-08-10', '2026-08-24'])
  })

  it('ignoriert einen bestehenden Anker in gerader KW (gerade = manuelle Ausnahme)', () => {
    // bestehender IVI-Tag 17.08. (KW 34, gerade) darf den Automatik-Rhythmus
    // NICHT auf gerade Wochen ziehen — Start rutscht auf ungerade KW.
    const v = verf({ 'Dmitri Artemiev': { '2026-08-10': 'GT', '2026-08-24': 'GT' } })
    const r = buildIviVorschlaege(v, '2026-08-01', '2026-08-31', {}, ['2026-08-17'])
    expect(r[0].rasterMontag).toBe('2026-08-10')
    expect(isoKalenderwoche(r[0].rasterMontag) % 2).toBe(1)
  })
})

describe('buildIviVorschlaege — Feiertags-Ausweich', () => {
  it('weicht bei Feiertag am Montag auf Donnerstag DERSELBEN Woche aus', () => {
    const v = verf({
      'Dmitri Artemiev': { '2026-08-10': 'GT', '2026-08-13': 'GT' },
      'Markus Tschopp':  { '2026-08-13': 'NM' },
    })
    const r = buildIviVorschlaege(v, '2026-08-08', '2026-08-17', { '2026-08-10': 'Testfeiertag' })
    expect(r[0].date).toBe('2026-08-13')          // Do derselben Woche
    expect(r[0].rasterMontag).toBe('2026-08-10')
    expect(r[0].ausweich).toBe(true)
    expect(r[0].ausweichGrund).toContain('Feiertag')
    expect(r[0].status).toBe('bereit')
  })

  it('nimmt Freitag wenn auch der Donnerstag nicht geht', () => {
    const v = verf({ 'Dmitri Artemiev': { '2026-08-14': 'GT' } })
    const r = buildIviVorschlaege(v, '2026-08-08', '2026-08-17', { '2026-08-10': 'Feiertag' })
    expect(r[0].date).toBe('2026-08-14')          // Fr
    expect(r[0].ausweich).toBe(true)
  })

  it('weicht auch aus wenn der Injektor am Montag abwesend ist', () => {
    const v = verf({ 'Dmitri Artemiev': { '2026-08-13': 'GT' } })  // Mo fehlt
    const r = buildIviVorschlaege(v, '2026-08-08', '2026-08-17')
    expect(r[0].date).toBe('2026-08-13')
    expect(r[0].ausweichGrund).toBe('Artemiev nicht eingeteilt')
  })

  it('springt NIE in eine andere Woche', () => {
    // In der ganzen Woche vom 03.08. ist niemand da -> kein_tag, nicht 10.08.
    // Anker über bestehende[] fixiert (03.08.), damit die Ungerade-KW-Regel
    // hier nicht greift — getestet wird das NICHT-Springen der Raster-Woche.
    const v = verf({ 'Dmitri Artemiev': { '2026-08-24': 'GT' } })  // erst KW35
    const r = buildIviVorschlaege(v, '2026-08-08', '2026-08-14')   // nur KW33 im Bereich
    expect(r[0].status).toBe('kein_tag')
    expect(r[0].date).toBe('2026-08-10')
  })
})

describe('buildIviVorschlaege — Status', () => {
  const range = ['2026-08-08', '2026-08-14'] as const

  it('bereit wenn Injektor + Partner ueberlappen', () => {
    const v = verf({
      'Dmitri Artemiev': { '2026-08-10': 'GT' },
      'Markus Tschopp':  { '2026-08-10': 'NM' },
    })
    const r = buildIviVorschlaege(v, ...range)
    expect(r[0].status).toBe('bereit')
    expect(r[0].fenster).toBe('Nachmittag')
    expect(r[0].empfohlenerPartnerCode).toBeNull()
  })

  it('partner_fehlt wenn nur der Injektor da ist — mit empfohlenem Code', () => {
    const v = verf({ 'Dmitri Artemiev': { '2026-08-10': 'GT' } })
    const r = buildIviVorschlaege(v, ...range)
    expect(r[0].status).toBe('partner_fehlt')
    expect(r[0].empfohlenerPartnerCode).toBe('NM')
  })

  it('halbtag_konflikt wenn beide da sind aber VM gegen NM', () => {
    const v = verf({
      'Dmitri Artemiev': { '2026-08-10': 'VM' },
      'Markus Tschopp':  { '2026-08-10': 'NM' },
    })
    const r = buildIviVorschlaege(v, ...range)
    expect(r[0].status).toBe('halbtag_konflikt')
    expect(r[0].fenster).toBeNull()
    // Kein Auto-Eintrag: fremden Halbtag umhaengen ist Personalentscheidung
    expect(r[0].empfohlenerPartnerCode).toBeNull()
  })

  it('kein_tag wenn der Injektor die ganze Woche fehlt', () => {
    const v = verf({ 'Markus Tschopp': { '2026-08-10': 'GT' } })
    const r = buildIviVorschlaege(v, ...range)
    expect(r[0].status).toBe('kein_tag')
  })

  it('empfiehlt VM wenn der Injektor nur vormittags da ist', () => {
    const v = verf({ 'Dmitri Artemiev': { '2026-08-10': 'VM' } })
    const r = buildIviVorschlaege(v, ...range)
    expect(r[0].status).toBe('partner_fehlt')
    expect(r[0].empfohlenerPartnerCode).toBe('VM')
  })
})

describe('isoKalenderwoche', () => {
  it('rechnet ISO-Wochen korrekt', () => {
    expect(isoKalenderwoche('2026-01-01')).toBe(1)   // Do -> KW 1
    expect(isoKalenderwoche('2026-08-03')).toBe(32)
    expect(isoKalenderwoche('2026-12-28')).toBe(53)
  })
  it('Mo und So derselben ISO-Woche haben dieselbe KW', () => {
    expect(isoKalenderwoche('2026-08-03')).toBe(isoKalenderwoche('2026-08-09'))
  })
})

describe('buildIviVorschlaege — geprueft/KW', () => {
  it('protokolliert Mo, Do UND Fr wenn keiner geht', () => {
    // Woche KW 33 (ungerade) — kein KW-Anker-Shift, testet nur die Protokollierung.
    const v = verf({ 'Markus Tschopp': { '2026-08-10': 'GT' } })
    const r = buildIviVorschlaege(v, '2026-08-08', '2026-08-14', {}, [], {
      '2026-08-10': 'Fer', '2026-08-13': 'W', '2026-08-14': 'W',
    })
    expect(r[0].status).toBe('kein_tag')
    expect(r[0].geprueft).toEqual([
      { date: '2026-08-10', grund: 'Artemiev Fer' },
      { date: '2026-08-13', grund: 'Artemiev W' },
      { date: '2026-08-14', grund: 'Artemiev W' },
    ])
  })

  it('meldet «nicht eingeteilt» wenn gar kein Code hinterlegt ist', () => {
    const v = verf({ 'Markus Tschopp': { '2026-08-10': 'GT' } })
    const r = buildIviVorschlaege(v, '2026-08-08', '2026-08-14')
    expect(r[0].geprueft.every(g => g.grund === 'Artemiev nicht eingeteilt')).toBe(true)
  })

  it('protokolliert nur die verworfenen Tage, nicht den gewaehlten', () => {
    const v = verf({ 'Dmitri Artemiev': { '2026-08-13': 'GT' } })
    const r = buildIviVorschlaege(v, '2026-08-08', '2026-08-14', { '2026-08-10': 'Feiertag' })
    expect(r[0].date).toBe('2026-08-13')
    expect(r[0].geprueft).toHaveLength(1)             // nur der Montag
    expect(r[0].geprueft[0].grund).toContain('Feiertag')
  })

  it('liefert die KW des vorgeschlagenen Tages', () => {
    const v = verf({ 'Dmitri Artemiev': { '2026-08-10': 'GT' } })
    const r = buildIviVorschlaege(v, '2026-08-08', '2026-08-14')
    expect(r[0].kw).toBe(33)
  })
})
