/**
 * Pure Permission-Logik — extrahiert aus AuthContext, damit sie ohne
 * React/Firebase testbar ist. Die in AuthContext berechneten Booleans
 * (isAdmin, canAccessRecall, …) sind alle dünne Wrapper um diese
 * Helpers.
 *
 * Verträge (wichtig, weil sicherheitskritisch):
 *
 *  - Profil null/undefined → KEINE Permission, KEIN Approval.
 *  - status muss exakt 'approved' UND locked darf nicht true sein →
 *    sonst gilt der User als "nicht zugelassen", egal welche Rolle.
 *  - `additionalRoles` zählen genauso wie `role` für hasRole().
 *  - `isGuest` ist absichtlich NUR über profile.role === 'gast'
 *    bestimmt (nicht über additionalRoles) — der gast-Modus ist eine
 *    primäre Account-Kategorie, kein Zusatz-Hut.
 *  - `permGranted` Hierarchie:
 *      1. Nicht-approved → false
 *      2. Admin → true (unabhängig von permissions-Objekt)
 *      3. permissions-Objekt explizit gesetzt → exakt das, was drinsteht
 *      4. Sonst: rollenbasierte Defaults
 *           recall  → GL + arzt + mpa (Sekretariat-Workflow)
 *           akv     → GL + arzt + mpa
 *           rest    → arzt + mpa
 *    Diese Reihenfolge ist deliberat: ein Admin kann nicht
 *    versehentlich permissions={ ivom: false } gesetzt bekommen und
 *    sich dadurch selbst aussperren.
 */

export type UserRole   = 'admin' | 'arzt' | 'mpa' | 'gast' | 'geschaeftsleitung'
export type UserStatus = 'pending' | 'approved' | 'rejected'

export interface UserPermissions {
  ivom?:       boolean
  lager?:      boolean
  planung?:    boolean
  onboarding?: boolean
  aufgaben?:   boolean
  recall?:     boolean
  akv?:        boolean
}

/** Minimal-Shape — Tests können beliebige UserProfile-Subsets bauen. */
export interface PermissionProfile {
  role:             UserRole
  status:           UserStatus
  locked?:          boolean
  additionalRoles?: UserRole[]
  permissions?:     UserPermissions
  isSuperAdmin?:    boolean
  canEditPlanung?:  boolean
}

export function isApproved(profile: PermissionProfile | null | undefined): boolean {
  if (!profile) return false
  return profile.status === 'approved' && profile.locked !== true
}

/** Rolle direkt ODER als Zusatzrolle, gated auf approved. */
export function hasRole(profile: PermissionProfile | null | undefined, role: UserRole): boolean {
  if (!isApproved(profile)) return false
  if (profile!.role === role) return true
  return profile!.additionalRoles?.includes(role) === true
}

export function isAdmin(profile: PermissionProfile | null | undefined): boolean {
  return hasRole(profile, 'admin')
}

export function isArzt(profile: PermissionProfile | null | undefined): boolean {
  return hasRole(profile, 'arzt')
}

export function isMpa(profile: PermissionProfile | null | undefined): boolean {
  return hasRole(profile, 'mpa')
}

export function isGeschaeftsleitung(profile: PermissionProfile | null | undefined): boolean {
  return hasRole(profile, 'geschaeftsleitung')
}

/** Bewusst NUR primäre Rolle, keine additionalRoles. */
export function isGuest(profile: PermissionProfile | null | undefined): boolean {
  if (!isApproved(profile)) return false
  return profile!.role === 'gast'
}

export function isSuperAdmin(profile: PermissionProfile | null | undefined): boolean {
  return isAdmin(profile) && profile!.isSuperAdmin === true
}

/**
 * Read-Only-Modus: User ist Gast oder GL und hat KEINE der
 * "schreibenden" Rollen (admin/arzt/mpa). Wenn jemand sowohl
 * GL als auch arzt ist, ist er nicht read-only.
 */
export function isReadOnly(profile: PermissionProfile | null | undefined): boolean {
  if (!isApproved(profile)) return false
  const guestOrGL = isGuest(profile) || isGeschaeftsleitung(profile)
  if (!guestOrGL) return false
  return !isAdmin(profile) && !isArzt(profile) && !isMpa(profile)
}

export function canEditPlanung(profile: PermissionProfile | null | undefined): boolean {
  if (!isApproved(profile)) return false
  return isAdmin(profile) || isGeschaeftsleitung(profile)
}

export function canAccessBenutzerverwaltung(profile: PermissionProfile | null | undefined): boolean {
  if (!isApproved(profile)) return false
  return isAdmin(profile) || isGeschaeftsleitung(profile)
}

/**
 * Zentrale Modul-Zugriffs-Funktion. Reihenfolge der Checks siehe
 * Modul-Docstring oben — Admin-Shortcut bewusst VOR dem
 * permissions-Objekt, damit ein versehentlich gesetztes
 * permissions: { ivom: false } einen Admin nicht aussperrt.
 */
export function permGranted(
  profile: PermissionProfile | null | undefined,
  key: keyof UserPermissions,
): boolean {
  if (!isApproved(profile)) return false
  if (isAdmin(profile)) return true
  if (profile!.permissions !== undefined) return profile!.permissions?.[key] === true
  if (key === 'recall') return isGeschaeftsleitung(profile) || isArzt(profile) || isMpa(profile)
  if (key === 'akv')    return isGeschaeftsleitung(profile) || isArzt(profile) || isMpa(profile)
  return isArzt(profile) || isMpa(profile)
}
