/** Entfernt `undefined`-Werte rekursiv aus Objekten und Arrays, bevor sie an
 *  Firestore gehen. Hintergrund: Firestore wirft bei `undefined` in
 *  Array-Elementen einen Fehler — und weil viele Write-Aufrufe in einem
 *  stillen try/catch stecken, ging so schon ein Speichern unbemerkt verloren
 *  (Berichte-Auswahl im ZW-Management). `null` bleibt erhalten (= Feld
 *  loeschen/leeren), nur `undefined` wird entfernt bzw. in Arrays zu `null`.
 */
export function stripUndefined<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    // In Arrays ist Auslassen nicht moeglich (Index-Verschiebung) → null.
    return value.map(v => (v === undefined ? null : stripUndefined(v))) as unknown as T
  }
  // Firestore-Sentinels (Timestamp, FieldValue, …) nicht anfassen — nur
  // plain objects rekursiv bereinigen.
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue
    out[k] = stripUndefined(v)
  }
  return out as T
}
