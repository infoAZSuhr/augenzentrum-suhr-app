/**
 * Pure update-Builder für die planungRequests-State-Machine.
 *
 * Hintergrund: AppShell.approveRequest / rejectRequest / withdrawRequest sind
 * historisch inline-Funktionen mit Closure-Zugriff auf React-State und daher
 * schwer testbar. Die deterministische Logik ("welche dot-notation-Updates
 * müssen auf planung/{year} geschrieben werden für Aktion X bei Request Y?")
 * ist hier extrahiert — pure, eingabe-nur, vollständig unit-testbar.
 *
 * `deleteField` wird als Sentinel-Funktion übergeben (statt direkt aus
 * firebase/firestore importiert), damit die Tests einen einfachen String-Marker
 * verwenden können.
 */

export interface PlanungRequestLike {
  type:         'ferien' | 'eintrag' | 'tausch' | 'absage'
  year?:        number
  // tausch / absage
  myPerson?:    string
  myDate?:      string
  myCode?:      string
  theirPerson?: string
  theirDate?:   string
  theirCode?:   string
}

type DeleteFieldFn = () => unknown
type Updates      = Record<string, unknown>

// ── TAUSCH ───────────────────────────────────────────────────────────────────

/**
 * Tausch GENEHMIGEN (Mode 'approved' oder 'provisional').
 * - 'approved'    : alte Einträge werden atomisch gelöscht, Kommentar auf den
 *                   getauschten Daten gesetzt (oder gelöscht wenn newComment null).
 * - 'provisional' : alte Einträge bleiben (Plan unverändert), nur Kommentare
 *                   bekommen den prov.-Marker auf den getauschten Daten.
 */
export function buildTauschApproveUpdates(
  req: PlanungRequestLike,
  mode: 'approved' | 'provisional',
  newComment: string | null,
  deleteField: DeleteFieldFn,
): Updates {
  const update: Updates = {}
  if (!req.myPerson || !req.myDate) return update

  if (mode === 'approved') {
    update[`schedule.${req.myPerson}.${req.myDate}`] = deleteField()
    update[`comments.${req.myPerson}.${req.myDate}`] = deleteField()
  }
  if (req.theirDate) {
    update[`comments.${req.myPerson}.${req.theirDate}`] = newComment ?? deleteField()
  }
  if (req.theirPerson && req.theirDate) {
    if (mode === 'approved') {
      update[`schedule.${req.theirPerson}.${req.theirDate}`] = deleteField()
      update[`comments.${req.theirPerson}.${req.theirDate}`] = deleteField()
    }
    update[`comments.${req.theirPerson}.${req.myDate}`] = newComment ?? deleteField()
  }
  return update
}

/**
 * Tausch ABLEHNEN während er noch PENDING ist.
 * Die neuen Einträge wurden bereits beim Request-Erstellen geschrieben — nur
 * diese müssen wieder entfernt werden. Die alten (ungetauschten) Einträge
 * bleiben unangetastet.
 */
export function buildTauschRejectPendingUpdates(
  req: PlanungRequestLike,
  deleteField: DeleteFieldFn,
): Updates {
  const update: Updates = {}
  if (!req.myPerson || !req.myDate) return update

  if (req.theirDate && req.theirPerson) {
    update[`schedule.${req.myPerson}.${req.theirDate}`]   = deleteField()
    update[`schedule.${req.theirPerson}.${req.myDate}`]   = deleteField()
    update[`comments.${req.myPerson}.${req.theirDate}`]   = deleteField()
    update[`comments.${req.theirPerson}.${req.myDate}`]   = deleteField()
  } else if (req.theirDate) {
    update[`schedule.${req.myPerson}.${req.theirDate}`] = deleteField()
    update[`comments.${req.myPerson}.${req.theirDate}`] = deleteField()
  }
  return update
}

/**
 * Tausch WIDERRUFEN nach Genehmigung (zurück zu PENDING).
 * Die alten Einträge (die beim Genehmigen gelöscht wurden) werden mit den
 * gemerkten Original-Codes wiederhergestellt. Die Kommentare auf den
 * getauschten Daten gehen auf "warten auf Freigabe" zurück.
 */
export function buildTauschRejectRevokeUpdates(
  req: PlanungRequestLike,
): Updates {
  const update: Updates = {}
  if (!req.myPerson || !req.myDate) return update

  if (req.myCode) update[`schedule.${req.myPerson}.${req.myDate}`] = req.myCode
  if (req.theirDate) update[`comments.${req.myPerson}.${req.theirDate}`] = 'warten auf Freigabe'
  if (req.theirPerson && req.theirDate) {
    if (req.theirCode) update[`schedule.${req.theirPerson}.${req.theirDate}`] = req.theirCode
    update[`comments.${req.theirPerson}.${req.myDate}`] = 'warten auf Freigabe'
  }
  return update
}

/**
 * Tausch ZURÜCKZIEHEN durch den User selbst (egal in welchem Status).
 * - Alte Einträge wieder mit Original-Code (oder löschen wenn kein Code bekannt)
 * - Neue Einträge an den getauschten Stellen wieder weg
 * - Alle Kommentare weg
 */
export function buildTauschWithdrawUpdates(
  req: PlanungRequestLike,
  deleteField: DeleteFieldFn,
): Updates {
  const update: Updates = {}
  if (!req.myPerson || !req.myDate) return update

  if (req.theirDate && req.theirPerson) {
    update[`schedule.${req.myPerson}.${req.myDate}`]        = req.myCode    ?? deleteField()
    update[`schedule.${req.theirPerson}.${req.theirDate}`]  = req.theirCode ?? deleteField()
    update[`schedule.${req.myPerson}.${req.theirDate}`]     = deleteField()
    update[`schedule.${req.theirPerson}.${req.myDate}`]     = deleteField()
    update[`comments.${req.myPerson}.${req.theirDate}`]     = deleteField()
    update[`comments.${req.theirPerson}.${req.myDate}`]     = deleteField()
  } else if (req.theirDate) {
    update[`schedule.${req.myPerson}.${req.myDate}`]    = req.myCode ?? deleteField()
    update[`schedule.${req.myPerson}.${req.theirDate}`] = deleteField()
    update[`comments.${req.myPerson}.${req.theirDate}`] = deleteField()
  }
  return update
}

// ── ABSAGE ───────────────────────────────────────────────────────────────────

/**
 * Absage ABLEHNEN während sie PENDING ist ODER ZURÜCKZIEHEN durch User:
 * Original-Code wieder herstellen (oder löschen wenn unbekannt), Kommentar weg.
 */
export function buildAbsageRejectOrWithdrawUpdates(
  req: PlanungRequestLike,
  deleteField: DeleteFieldFn,
): Updates {
  const update: Updates = {}
  if (!req.myPerson || !req.myDate) return update
  update[`schedule.${req.myPerson}.${req.myDate}`] = req.myCode ?? deleteField()
  update[`comments.${req.myPerson}.${req.myDate}`] = deleteField()
  return update
}
