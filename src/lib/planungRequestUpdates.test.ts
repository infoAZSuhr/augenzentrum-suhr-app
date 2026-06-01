import { describe, it, expect } from 'vitest'
import {
  buildTauschApproveUpdates,
  buildTauschRejectPendingUpdates,
  buildTauschRejectRevokeUpdates,
  buildTauschWithdrawUpdates,
  buildAbsageRejectOrWithdrawUpdates,
  type PlanungRequestLike,
} from './planungRequestUpdates'

const DEL = '__DELETE__'
const delF = () => DEL

// Basis-Tausch zwischen Tschopp (myDate 2026-06-01) und Trachsler (theirDate 2026-06-08)
const tauschTwoPersons: PlanungRequestLike = {
  type:        'tausch',
  year:        2026,
  myPerson:    'Tschopp',
  myDate:      '2026-06-01',
  myCode:      'GT',
  theirPerson: 'Trachsler',
  theirDate:   '2026-06-08',
  theirCode:   'VM',
}

// Einseitiger Tausch (Person verschiebt nur ihren eigenen Tag)
const tauschOnePerson: PlanungRequestLike = {
  type:      'tausch',
  year:      2026,
  myPerson:  'Tschopp',
  myDate:    '2026-06-01',
  myCode:    'GT',
  theirDate: '2026-06-08',
}

describe('buildTauschApproveUpdates — mode "approved"', () => {
  it('löscht alte Einträge auf beiden Seiten + setzt Kommentar auf neuen Daten', () => {
    const update = buildTauschApproveUpdates(tauschTwoPersons, 'approved', null, delF)
    expect(update).toEqual({
      'schedule.Tschopp.2026-06-01':   DEL,
      'comments.Tschopp.2026-06-01':   DEL,
      'schedule.Trachsler.2026-06-08': DEL,
      'comments.Trachsler.2026-06-08': DEL,
      'comments.Tschopp.2026-06-08':   DEL,  // newComment null → delete
      'comments.Trachsler.2026-06-01': DEL,
    })
  })

  it('setzt prov.-Kommentar wenn newComment truthy', () => {
    const update = buildTauschApproveUpdates(tauschTwoPersons, 'approved', 'prov.', delF)
    expect(update['comments.Tschopp.2026-06-08']).toBe('prov.')
    expect(update['comments.Trachsler.2026-06-01']).toBe('prov.')
  })

  it('einseitiger Tausch: nur myPerson Einträge', () => {
    const update = buildTauschApproveUpdates(tauschOnePerson, 'approved', null, delF)
    expect(update).toEqual({
      'schedule.Tschopp.2026-06-01': DEL,
      'comments.Tschopp.2026-06-01': DEL,
      'comments.Tschopp.2026-06-08': DEL,
    })
  })
})

describe('buildTauschApproveUpdates — mode "provisional"', () => {
  it('löscht KEINE schedule-Einträge, nur Kommentare', () => {
    const update = buildTauschApproveUpdates(tauschTwoPersons, 'provisional', 'prov. – check', delF)
    // Schedule-Schlüssel dürfen NICHT vorkommen
    expect(Object.keys(update).some(k => k.startsWith('schedule.'))).toBe(false)
    expect(update['comments.Tschopp.2026-06-08']).toBe('prov. – check')
    expect(update['comments.Trachsler.2026-06-01']).toBe('prov. – check')
  })
})

describe('buildTauschRejectPendingUpdates', () => {
  it('entfernt nur die NEUEN getauschten Einträge — alte bleiben', () => {
    const update = buildTauschRejectPendingUpdates(tauschTwoPersons, delF)
    expect(update).toEqual({
      'schedule.Tschopp.2026-06-08':   DEL,
      'schedule.Trachsler.2026-06-01': DEL,
      'comments.Tschopp.2026-06-08':   DEL,
      'comments.Trachsler.2026-06-01': DEL,
    })
    // myDate Originaleinträge bleiben (nicht gelöscht)
    expect(update['schedule.Tschopp.2026-06-01']).toBeUndefined()
    expect(update['schedule.Trachsler.2026-06-08']).toBeUndefined()
  })

  it('einseitiger Fall: nur myPerson auf theirDate', () => {
    const update = buildTauschRejectPendingUpdates(tauschOnePerson, delF)
    expect(update).toEqual({
      'schedule.Tschopp.2026-06-08': DEL,
      'comments.Tschopp.2026-06-08': DEL,
    })
  })
})

describe('buildTauschRejectRevokeUpdates', () => {
  it('stellt ORIGINAL-Codes wieder her + setzt "warten auf Freigabe" Kommentar', () => {
    const update = buildTauschRejectRevokeUpdates(tauschTwoPersons)
    expect(update).toEqual({
      'schedule.Tschopp.2026-06-01':   'GT',                  // myCode
      'schedule.Trachsler.2026-06-08': 'VM',                  // theirCode
      'comments.Tschopp.2026-06-08':   'warten auf Freigabe',
      'comments.Trachsler.2026-06-01': 'warten auf Freigabe',
    })
  })

  it('lässt schedule-Werte weg wenn Original-Code unbekannt ist', () => {
    const req = { ...tauschTwoPersons, myCode: undefined, theirCode: undefined }
    const update = buildTauschRejectRevokeUpdates(req)
    expect(Object.keys(update).some(k => k.startsWith('schedule.'))).toBe(false)
    expect(update['comments.Tschopp.2026-06-08']).toBe('warten auf Freigabe')
  })
})

describe('buildTauschWithdrawUpdates', () => {
  it('stellt Original-Codes wieder her + löscht neu-getauschte Einträge + alle Kommentare', () => {
    const update = buildTauschWithdrawUpdates(tauschTwoPersons, delF)
    expect(update).toEqual({
      'schedule.Tschopp.2026-06-01':   'GT',
      'schedule.Trachsler.2026-06-08': 'VM',
      'schedule.Tschopp.2026-06-08':   DEL,
      'schedule.Trachsler.2026-06-01': DEL,
      'comments.Tschopp.2026-06-08':   DEL,
      'comments.Trachsler.2026-06-01': DEL,
    })
  })

  it('löscht (statt restore) wenn kein Original-Code bekannt', () => {
    const req = { ...tauschTwoPersons, myCode: undefined, theirCode: undefined }
    const update = buildTauschWithdrawUpdates(req, delF)
    expect(update['schedule.Tschopp.2026-06-01']).toBe(DEL)
    expect(update['schedule.Trachsler.2026-06-08']).toBe(DEL)
  })

  it('einseitiger Fall: nur myPerson-Updates', () => {
    const update = buildTauschWithdrawUpdates(tauschOnePerson, delF)
    expect(update).toEqual({
      'schedule.Tschopp.2026-06-01': 'GT',
      'schedule.Tschopp.2026-06-08': DEL,
      'comments.Tschopp.2026-06-08': DEL,
    })
  })
})

describe('buildAbsageRejectOrWithdrawUpdates', () => {
  const absage: PlanungRequestLike = {
    type:     'absage',
    year:     2026,
    myPerson: 'Tschopp',
    myDate:   '2026-06-01',
    myCode:   'GT',
  }

  it('stellt myCode wieder her + löscht Kommentar', () => {
    const update = buildAbsageRejectOrWithdrawUpdates(absage, delF)
    expect(update).toEqual({
      'schedule.Tschopp.2026-06-01': 'GT',
      'comments.Tschopp.2026-06-01': DEL,
    })
  })

  it('löscht schedule wenn myCode nicht bekannt', () => {
    const update = buildAbsageRejectOrWithdrawUpdates({ ...absage, myCode: undefined }, delF)
    expect(update).toEqual({
      'schedule.Tschopp.2026-06-01': DEL,
      'comments.Tschopp.2026-06-01': DEL,
    })
  })
})

describe('Guards: leere/unvollständige Requests', () => {
  it('alle Builder geben leeres Update wenn myPerson oder myDate fehlt', () => {
    const broken = { type: 'tausch' } as PlanungRequestLike
    expect(buildTauschApproveUpdates(broken, 'approved', null, delF)).toEqual({})
    expect(buildTauschRejectPendingUpdates(broken, delF)).toEqual({})
    expect(buildTauschRejectRevokeUpdates(broken)).toEqual({})
    expect(buildTauschWithdrawUpdates(broken, delF)).toEqual({})
    expect(buildAbsageRejectOrWithdrawUpdates(broken, delF)).toEqual({})
  })
})
