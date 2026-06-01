import { describe, it, expect } from 'vitest'
import {
  isApproved, hasRole,
  isAdmin, isArzt, isMpa, isGeschaeftsleitung, isGuest, isSuperAdmin,
  isReadOnly, canEditPlanung, canAccessBenutzerverwaltung, permGranted,
  type PermissionProfile, type UserRole,
} from './permissions'

// ─── Profil-Builder für Tests ────────────────────────────────────────────
function profile(overrides: Partial<PermissionProfile> = {}): PermissionProfile {
  return { role: 'mpa', status: 'approved', ...overrides }
}

// ─── isApproved ──────────────────────────────────────────────────────────
describe('isApproved', () => {
  it('null/undefined → false', () => {
    expect(isApproved(null)).toBe(false)
    expect(isApproved(undefined)).toBe(false)
  })
  it('status === "approved" und !locked → true', () => {
    expect(isApproved(profile({ status: 'approved' }))).toBe(true)
    expect(isApproved(profile({ status: 'approved', locked: false }))).toBe(true)
  })
  it('status !== "approved" → false', () => {
    expect(isApproved(profile({ status: 'pending' }))).toBe(false)
    expect(isApproved(profile({ status: 'rejected' }))).toBe(false)
  })
  it('locked === true blockiert auch bei approved → false', () => {
    expect(isApproved(profile({ status: 'approved', locked: true }))).toBe(false)
  })
  it('locked === undefined gilt nicht als locked', () => {
    expect(isApproved(profile({ status: 'approved', locked: undefined }))).toBe(true)
  })
})

// ─── hasRole ─────────────────────────────────────────────────────────────
describe('hasRole', () => {
  it('null → false', () => {
    expect(hasRole(null, 'admin')).toBe(false)
  })
  it('primäre Rolle matcht', () => {
    expect(hasRole(profile({ role: 'admin' }), 'admin')).toBe(true)
    expect(hasRole(profile({ role: 'arzt'  }), 'arzt' )).toBe(true)
  })
  it('additionalRoles matcht', () => {
    const p = profile({ role: 'mpa', additionalRoles: ['admin', 'arzt'] })
    expect(hasRole(p, 'admin')).toBe(true)
    expect(hasRole(p, 'arzt')).toBe(true)
    expect(hasRole(p, 'mpa')).toBe(true)            // primäre Rolle
    expect(hasRole(p, 'geschaeftsleitung')).toBe(false)
  })
  it('pending Profile → keine Rolle aktiv', () => {
    expect(hasRole(profile({ role: 'admin', status: 'pending' }), 'admin')).toBe(false)
  })
  it('locked Profile → keine Rolle aktiv', () => {
    expect(hasRole(profile({ role: 'admin', locked: true }), 'admin')).toBe(false)
  })
})

// ─── isAdmin / isArzt / isMpa / isGeschaeftsleitung ──────────────────────
describe('Rollen-Shortcuts', () => {
  it('isAdmin nur bei approved admin', () => {
    expect(isAdmin(profile({ role: 'admin' }))).toBe(true)
    expect(isAdmin(profile({ role: 'admin', status: 'pending' }))).toBe(false)
    expect(isAdmin(profile({ role: 'admin', locked: true }))).toBe(false)
    expect(isAdmin(profile({ role: 'mpa', additionalRoles: ['admin'] }))).toBe(true)
  })
  it('isArzt / isMpa über additionalRoles', () => {
    expect(isArzt(profile({ role: 'gast', additionalRoles: ['arzt'] }))).toBe(true)
    expect(isMpa( profile({ role: 'gast', additionalRoles: ['mpa']  }))).toBe(true)
  })
  it('isGeschaeftsleitung über additionalRoles', () => {
    expect(isGeschaeftsleitung(profile({ role: 'mpa', additionalRoles: ['geschaeftsleitung'] }))).toBe(true)
  })
})

// ─── isGuest ─────────────────────────────────────────────────────────────
describe('isGuest', () => {
  it('nur primäre Rolle "gast" + approved', () => {
    expect(isGuest(profile({ role: 'gast' }))).toBe(true)
    expect(isGuest(profile({ role: 'gast', status: 'pending' }))).toBe(false)
  })
  it('additionalRoles=["gast"] zählt NICHT', () => {
    // Bewusste Asymmetrie: gast ist primäre Account-Kategorie
    expect(isGuest(profile({ role: 'admin', additionalRoles: ['gast'] }))).toBe(false)
  })
})

// ─── isSuperAdmin ────────────────────────────────────────────────────────
describe('isSuperAdmin', () => {
  it('admin + isSuperAdmin=true → true', () => {
    expect(isSuperAdmin(profile({ role: 'admin', isSuperAdmin: true }))).toBe(true)
  })
  it('admin ohne isSuperAdmin → false', () => {
    expect(isSuperAdmin(profile({ role: 'admin' }))).toBe(false)
    expect(isSuperAdmin(profile({ role: 'admin', isSuperAdmin: false }))).toBe(false)
  })
  it('nicht-admin mit isSuperAdmin=true → false (kein Schleichweg)', () => {
    expect(isSuperAdmin(profile({ role: 'mpa', isSuperAdmin: true }))).toBe(false)
  })
})

// ─── isReadOnly ──────────────────────────────────────────────────────────
describe('isReadOnly', () => {
  it('reiner Gast → read-only', () => {
    expect(isReadOnly(profile({ role: 'gast' }))).toBe(true)
  })
  it('reine GL → read-only', () => {
    expect(isReadOnly(profile({ role: 'geschaeftsleitung' }))).toBe(true)
  })
  it('GL + arzt → NICHT read-only', () => {
    expect(isReadOnly(profile({ role: 'geschaeftsleitung', additionalRoles: ['arzt'] }))).toBe(false)
  })
  it('Gast + mpa → NICHT read-only', () => {
    expect(isReadOnly(profile({ role: 'gast', additionalRoles: ['mpa'] }))).toBe(false)
  })
  it('reiner Admin → NICHT read-only', () => {
    expect(isReadOnly(profile({ role: 'admin' }))).toBe(false)
  })
  it('pending → NICHT read-only (gar nicht zugelassen)', () => {
    expect(isReadOnly(profile({ role: 'gast', status: 'pending' }))).toBe(false)
  })
  it('arzt/mpa allein → NICHT read-only', () => {
    expect(isReadOnly(profile({ role: 'arzt' }))).toBe(false)
    expect(isReadOnly(profile({ role: 'mpa' }))).toBe(false)
  })
})

// ─── canEditPlanung / canAccessBenutzerverwaltung ────────────────────────
describe('canEditPlanung', () => {
  it.each<[UserRole, boolean]>([
    ['admin', true],
    ['geschaeftsleitung', true],
    ['arzt', false],
    ['mpa', false],
    ['gast', false],
  ])('%s → %s', (role, expected) => {
    expect(canEditPlanung(profile({ role }))).toBe(expected)
  })
  it('pending Admin → false', () => {
    expect(canEditPlanung(profile({ role: 'admin', status: 'pending' }))).toBe(false)
  })
})

describe('canAccessBenutzerverwaltung', () => {
  it.each<[UserRole, boolean]>([
    ['admin', true],
    ['geschaeftsleitung', true],
    ['arzt', false],
    ['mpa', false],
    ['gast', false],
  ])('%s → %s', (role, expected) => {
    expect(canAccessBenutzerverwaltung(profile({ role }))).toBe(expected)
  })
})

// ─── permGranted — die zentrale Sicherheitslogik ─────────────────────────
describe('permGranted', () => {
  describe('Negativ-Fälle', () => {
    it('null Profile → alles false', () => {
      expect(permGranted(null, 'ivom')).toBe(false)
      expect(permGranted(null, 'recall')).toBe(false)
    })
    it('pending → alles false, auch wenn admin', () => {
      const p = profile({ role: 'admin', status: 'pending' })
      expect(permGranted(p, 'ivom')).toBe(false)
      expect(permGranted(p, 'recall')).toBe(false)
    })
    it('locked → alles false, auch wenn admin', () => {
      const p = profile({ role: 'admin', locked: true })
      expect(permGranted(p, 'ivom')).toBe(false)
    })
  })

  describe('Admin-Shortcut hat Vorrang vor permissions-Objekt', () => {
    // Wichtig: ein versehentlich gesetztes permissions:{ivom:false}
    // darf einen Admin nicht aussperren.
    it('admin mit permissions:{ivom:false} → ivom trotzdem true', () => {
      const p = profile({ role: 'admin', permissions: { ivom: false } })
      expect(permGranted(p, 'ivom')).toBe(true)
    })
    it('admin mit leerem permissions:{} → alles true', () => {
      const p = profile({ role: 'admin', permissions: {} })
      expect(permGranted(p, 'lager')).toBe(true)
      expect(permGranted(p, 'recall')).toBe(true)
    })
  })

  describe('permissions-Objekt überschreibt Defaults (für Nicht-Admins)', () => {
    it('arzt mit permissions:{recall:true} → recall true', () => {
      const p = profile({ role: 'arzt', permissions: { recall: true } })
      expect(permGranted(p, 'recall')).toBe(true)
    })
    it('arzt mit permissions:{ivom:false} → ivom false (override)', () => {
      const p = profile({ role: 'arzt', permissions: { ivom: false } })
      expect(permGranted(p, 'ivom')).toBe(false)
    })
    it('arzt mit permissions:{} → alles false (explizit leer = explizit nichts)', () => {
      const p = profile({ role: 'arzt', permissions: {} })
      expect(permGranted(p, 'ivom')).toBe(false)
      expect(permGranted(p, 'lager')).toBe(false)
    })
    it('GL mit permissions:{ivom:true} → ivom true', () => {
      const p = profile({ role: 'geschaeftsleitung', permissions: { ivom: true } })
      expect(permGranted(p, 'ivom')).toBe(true)
    })
  })

  describe('Default-Hierarchie (kein permissions-Objekt)', () => {
    describe('recall — nur GL', () => {
      it('GL → true', () => {
        expect(permGranted(profile({ role: 'geschaeftsleitung' }), 'recall')).toBe(true)
      })
      it('arzt → false', () => {
        expect(permGranted(profile({ role: 'arzt' }), 'recall')).toBe(false)
      })
      it('mpa → false', () => {
        expect(permGranted(profile({ role: 'mpa' }), 'recall')).toBe(false)
      })
      it('gast → false', () => {
        expect(permGranted(profile({ role: 'gast' }), 'recall')).toBe(false)
      })
    })

    describe('akv — GL + arzt + mpa', () => {
      it('GL → true', () => {
        expect(permGranted(profile({ role: 'geschaeftsleitung' }), 'akv')).toBe(true)
      })
      it('arzt → true', () => {
        expect(permGranted(profile({ role: 'arzt' }), 'akv')).toBe(true)
      })
      it('mpa → true', () => {
        expect(permGranted(profile({ role: 'mpa' }), 'akv')).toBe(true)
      })
      it('gast → false', () => {
        expect(permGranted(profile({ role: 'gast' }), 'akv')).toBe(false)
      })
    })

    describe('rest (ivom/lager/planung/onboarding/aufgaben) — arzt + mpa', () => {
      const keys = ['ivom', 'lager', 'planung', 'onboarding', 'aufgaben'] as const
      it.each(keys)('arzt darf %s', (k) => {
        expect(permGranted(profile({ role: 'arzt' }), k)).toBe(true)
      })
      it.each(keys)('mpa darf %s', (k) => {
        expect(permGranted(profile({ role: 'mpa' }), k)).toBe(true)
      })
      it.each(keys)('GL darf %s NICHT (ohne explizite Permission)', (k) => {
        expect(permGranted(profile({ role: 'geschaeftsleitung' }), k)).toBe(false)
      })
      it.each(keys)('gast darf %s NICHT', (k) => {
        expect(permGranted(profile({ role: 'gast' }), k)).toBe(false)
      })
    })
  })

  describe('additionalRoles-Verhalten', () => {
    it('gast mit additionalRoles:[arzt] hat arzt-Defaults', () => {
      const p = profile({ role: 'gast', additionalRoles: ['arzt'] })
      expect(permGranted(p, 'ivom')).toBe(true)
      expect(permGranted(p, 'akv')).toBe(true)
      expect(permGranted(p, 'recall')).toBe(false)  // arzt allein gibt keinen recall
    })
    it('mpa mit additionalRoles:[geschaeftsleitung] bekommt recall', () => {
      const p = profile({ role: 'mpa', additionalRoles: ['geschaeftsleitung'] })
      expect(permGranted(p, 'recall')).toBe(true)
    })
    it('mpa mit additionalRoles:[admin] hat Admin-Shortcut auf alles', () => {
      const p = profile({ role: 'mpa', additionalRoles: ['admin'] })
      expect(permGranted(p, 'recall')).toBe(true)
      expect(permGranted(p, 'ivom')).toBe(true)
      expect(permGranted(p, 'akv')).toBe(true)
    })
  })
})
