/**
 * Diff zwischen zwei SOP-Versionen (HTML-Content).
 *
 * Strategie: HTML wird zu Plain-Text gestrippt, dann word-basierter Diff
 * via klassischem LCS-Backtracking. Resultat ist eine Liste von
 * {kind, text}-Parts die das UI als farbige Spans rendern kann:
 *   added   → grün hinterlegt (im neuen Text neu)
 *   removed → rot, durchgestrichen (im alten Text vorhanden, jetzt weg)
 *   same    → normaler Text
 *
 * Bewusst KEINE externe Diff-Library — der LCS-Algorithmus passt in
 * ~40 Zeilen und vermeidet eine neue npm-Dependency + package-lock-Drama.
 * Komplexität O(m·n) Zeit + Memory — bei typischen SOPs (200–2000
 * Wörter) im Sub-Sekunden-Bereich. Sehr lange Texte (>5000 Wörter beider
 * Seiten) fallen auf einen vereinfachten "alles geändert"-Output zurück.
 */

export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string }

/** Strip HTML-Tags + dekodiere häufige Entities. Block-Tags werden zu
 *  Zeilenumbruch — Absatz-Grenzen bleiben für den Diff erkennbar. */
export function htmlToPlainText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<\s*br\s*\/?>/gi,               '\n')
    .replace(/<\/\s*(p|div|h[1-6]|li)\s*>/gi, '\n')
    .replace(/<[^>]+>/g,                      '')
    .replace(/&nbsp;/g,                       ' ')
    .replace(/&amp;/g,                        '&')
    .replace(/&lt;/g,                         '<')
    .replace(/&gt;/g,                         '>')
    .replace(/&quot;/g,                       '"')
    .replace(/&#39;/g,                        "'")
    .replace(/\n{3,}/g,                       '\n\n')
    .trim()
}

/** Word-Tokenizer: splittet bei Whitespace, behält die Separator-Tokens
 *  damit der Rekonstruktions-Diff sauber Whitespace + Wörter mixt. */
function tokenize(text: string): string[] {
  if (!text) return []
  return text.split(/(\s+)/).filter(Boolean)
}

const MAX_TOKENS = 5000   // m × n ≤ 25M cells = ~100MB int32 — Hard-Cap

function diffTokens(oldTokens: string[], newTokens: string[]): DiffPart[] {
  const m = oldTokens.length
  const n = newTokens.length

  // Hard-Cap: extrem lange Texte → kein LCS, sondern simpler Ersatz-Diff
  if (m > MAX_TOKENS || n > MAX_TOKENS) {
    const result: DiffPart[] = []
    if (m > 0) result.push({ kind: 'removed', text: oldTokens.join('') })
    if (n > 0) result.push({ kind: 'added',   text: newTokens.join('') })
    return result
  }

  // LCS-Matrix (Int32Array für minimalen Speicher)
  const lcs: Int32Array[] = []
  for (let i = 0; i <= m; i++) lcs.push(new Int32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1
      } else {
        lcs[i][j] = lcs[i - 1][j] >= lcs[i][j - 1] ? lcs[i - 1][j] : lcs[i][j - 1]
      }
    }
  }

  // Backtracking
  const parts: DiffPart[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (oldTokens[i - 1] === newTokens[j - 1]) {
      parts.push({ kind: 'same', text: oldTokens[i - 1] })
      i--; j--
    } else if (lcs[i - 1][j] >= lcs[i][j - 1]) {
      parts.push({ kind: 'removed', text: oldTokens[i - 1] })
      i--
    } else {
      parts.push({ kind: 'added', text: newTokens[j - 1] })
      j--
    }
  }
  while (i > 0) { parts.push({ kind: 'removed', text: oldTokens[i - 1] }); i-- }
  while (j > 0) { parts.push({ kind: 'added',   text: newTokens[j - 1] }); j-- }
  parts.reverse()

  // Aufeinanderfolgende same-Kind Parts mergen → kompaktere UI
  const merged: DiffPart[] = []
  for (const p of parts) {
    const last = merged[merged.length - 1]
    if (last && last.kind === p.kind) {
      last.text += p.text
    } else {
      merged.push({ ...p })
    }
  }
  return merged
}

export function diffSopContent(oldHtml: string, newHtml: string): DiffPart[] {
  return diffTokens(tokenize(htmlToPlainText(oldHtml)), tokenize(htmlToPlainText(newHtml)))
}

/** Schnell-Stats für UI-Anzeige im Versionen-Header: "+12 / -5 Wörter". */
export function diffSummary(parts: DiffPart[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const p of parts) {
    const wordCount = p.text.trim().split(/\s+/).filter(Boolean).length
    if (p.kind === 'added')   added   += wordCount
    if (p.kind === 'removed') removed += wordCount
  }
  return { added, removed }
}
