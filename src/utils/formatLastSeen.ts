/**
 * Formatiert einen Firestore-Timestamp als relativer Zeitabstand zu jetzt:
 *   { seconds: 1234567890 } → "vor 5 Min" / "vor 2 Std" / "vor 3 Tagen"
 * Bei sehr altem Datum (> 7 Tage) → Schweizer Datum.
 * Ohne Timestamp → "noch nie".
 *
 * `now` ist optional injizierbar — wichtig für Tests, sonst Date.now().
 */
export function formatLastSeen(lastSeen: unknown, now: number = Date.now()): string {
  const ts = (lastSeen as { seconds?: number })?.seconds
  if (!ts) return 'noch nie'
  const diffSec = now / 1000 - ts
  if (diffSec < 60) return 'gerade eben'
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60)
    return `vor ${m} Min`
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600)
    return `vor ${h} Std`
  }
  if (diffSec < 86400 * 7) {
    const d = Math.floor(diffSec / 86400)
    return `vor ${d} Tag${d !== 1 ? 'en' : ''}`
  }
  return new Date(ts * 1000).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
