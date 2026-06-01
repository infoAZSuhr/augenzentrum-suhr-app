/**
 * Pure Logik fürs Lagermanagement.
 *
 * Extrahiert aus firestoreLager.ts — diese Functions kennen kein Firestore,
 * sind deterministisch und unit-testbar.
 */

export interface LotLike {
  quantity:   number
  isDepleted?: boolean
  expiryDate?: string
}

/**
 * Summiert die quantity aller nicht-aufgebrauchten Lots.
 * Lots ohne quantity oder mit isDepleted=true werden übersprungen.
 */
export function sumActiveLotQuantity(lots: ReadonlyArray<LotLike>): number {
  return lots.reduce((sum, l) => {
    if (l.isDepleted) return sum
    return sum + (l.quantity || 0)
  }, 0)
}

/**
 * Nächstes MHD aus den nicht-aufgebrauchten Lots — sortiert nach expiryDate
 * aufsteigend, erstes Datum zurück. Lots ohne expiryDate werden ignoriert.
 * Null wenn keine passenden Lots vorhanden sind.
 */
export function nextExpiryDate(lots: ReadonlyArray<LotLike>): string | null {
  const dates = lots
    .filter(l => !l.isDepleted && l.expiryDate)
    .map(l => l.expiryDate!)
    .sort((a, b) => a.localeCompare(b))
  return dates[0] ?? null
}

/**
 * Lagerstatus-Ampel basierend auf Bestand vs. minStock.
 * - 0          → 'out'
 * - ≤ 50% Min  → 'critical'
 * - < Min      → 'low'
 * - sonst      → 'ok'
 *
 * Falls minStock undefined/0, wird er als 0 behandelt — dann ist alles ausser
 * 0 → 'ok' (kein Min-Threshold definiert).
 */
export type StockStatus = 'ok' | 'low' | 'critical' | 'out'

export function stockStatus(currentStock: number, minStock: number | undefined): StockStatus {
  if (currentStock === 0) return 'out'
  const min = minStock || 0
  if (currentStock <= min * 0.5) return 'critical'
  if (currentStock <  min)       return 'low'
  return 'ok'
}

// ── Zur Rose Nota-Liste Matching ────────────────────────────────────────────

export interface ArticleLike {
  id:             string
  name:           string
  articleNumber?: string
  isActive?:      boolean
}

export interface ZurRoseEntryLike {
  pc: number     // Pharmacode
  n:  string     // Name (Original-Case)
  d?: string     // Ausstands-Datum oder 'fehlt …'
  l?: string
}

function safeName(n: string): string {
  try { return decodeURIComponent(n).toLowerCase() } catch { return n.toLowerCase() }
}

/**
 * Sucht für einen Artikel den passenden Zur-Rose-Eintrag — zuerst exakt via
 * Pharmacode (articleNumber), danach Fallback über den ersten Wort-Stamm.
 */
export function matchZurRoseEntry(
  article: ArticleLike,
  entries: ReadonlyArray<ZurRoseEntryLike>,
): ZurRoseEntryLike | undefined {
  // 1. Pharmacode-Abgleich (exakt)
  if (article.articleNumber) {
    const pc = parseInt(article.articleNumber.trim())
    if (!isNaN(pc)) {
      const match = entries.find(e => e.pc === pc)
      if (match) return match
    }
  }
  // 2. Name-Abgleich: erster Wort-Stamm beidseitig (deckt Oxybuprocain vs.
  //    Oxybuprocaine ab). Mindestens 4 Zeichen, damit "Pro" nicht alles matched.
  const artFirst = safeName(article.name).split(/[\s%]/)[0]
  return entries.find(e => {
    const zrFirst = e.n.split(/\s/)[0].toLowerCase()
    return zrFirst.length > 3 && (artFirst.startsWith(zrFirst) || zrFirst.startsWith(artFirst))
  })
}

/**
 * Formatiert ein ISO-Datum als DD.MM.YYYY — explizit gepaddet, damit die
 * Anzeige plattform-unabhängig ist. (Node ICU auf Linux gibt z.B. "15.6.2026"
 * für toLocaleDateString('de-CH'), Windows "15.06.2026" — wir wollen immer
 * die gepaddete Variante.)
 */
function isoToSwissDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1]}`
}

/**
 * Formatiert den Anzeige-Text für einen Zur-Rose-Alarm:
 *   d="2026-06-15"  → "Ausstand bis 15.06.2026"
 *   d="fehlt seit…" → "Auf unbestimmte Zeit"
 *   d fehlt         → "Nicht lieferbar (Zur Rose)"
 */
export function formatZurRoseAlertDetail(entry: ZurRoseEntryLike): string {
  if (!entry.d) return 'Nicht lieferbar (Zur Rose)'
  if (entry.d.startsWith('fehlt')) return 'Auf unbestimmte Zeit'
  return `Ausstand bis ${isoToSwissDate(entry.d)}`
}
