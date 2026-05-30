/**
 * Wandelt im gerenderten HTML jede aus dem Glossar bekannte Abkürzung in einen
 * <abbr title="…">…</abbr>-Tag um, damit beim Hover der Browser-Tooltip
 * erscheint. Eine zugehörige Styling-Regel (gepunktete Unterstreichung)
 * lebt in src/index.css.
 *
 * Das Glossar wird zur Laufzeit aus Firestore geladen (GlossarContext) und
 * als 2. Parameter übergeben — so kann die Liste im UI erweitert werden,
 * ohne dass die App neu deployed werden muss.
 *
 * Sicherheitsmechanismen:
 * - HTML-Tags und deren Attribute werden NICHT angefasst (nur Text-Nodes
 *   zwischen Tags), damit z.B. href-Werte oder Klassen-Namen heil bleiben.
 * - Bereits vorhandene <abbr>-Tags werden NICHT doppelt verschachtelt.
 * - Wort-Grenzen (\b) verhindern, dass z.B. "RC" innerhalb von
 *   "RC.35.0110" matcht.
 */

// Regex, der HTML in "Tags" und "Text" splittet
const TAG_OR_TEXT = /(<[^>]+>)/g

// Bereiche, in denen wir NICHT ersetzen sollen
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'ABBR', 'A'])

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Baut einen Regex, der alle Glossar-Terme matcht — sortiert nach Länge
 * (längste zuerst) damit z.B. "ICD-10-GM" vor "ICD-10" und "ICD" matcht.
 */
function buildTermsRegex(glossar: Record<string, string>): RegExp | null {
  const terms = Object.keys(glossar).filter(t => t.length > 0)
  if (terms.length === 0) return null
  const sorted = [...terms].sort((a, b) => b.length - a.length)
  return new RegExp(
    // linke Grenze: kein Wort-/Bindestrich-Zeichen davor
    // rechte Grenze: kein Wort-/Bindestrich-Zeichen danach
    `(?<![A-Za-z0-9_äöüÄÖÜß-])(${sorted.map(escapeRegex).join('|')})(?![A-Za-z0-9_äöüÄÖÜß-])`,
    'g'
  )
}

/**
 * Erweitert einen HTML-String mit <abbr>-Tooltips. Glossar wird als
 * Parameter übergeben (Map abbreviation → explanation). Idempotent.
 */
export function expandAbbreviations(html: string, glossar: Record<string, string>): string {
  if (!html) return html
  if (!glossar || Object.keys(glossar).length === 0) return html

  const termsRegex = buildTermsRegex(glossar)
  if (!termsRegex) return html

  // Iteriere über Tag/Text-Segmente, ersetze nur in Text-Segmenten und
  // nicht innerhalb von SKIP_TAGS (geschachtelter Tracker).
  const parts = html.split(TAG_OR_TEXT)
  const skipStack: string[] = []
  const out: string[] = []

  for (const part of parts) {
    if (!part) continue

    // Ist es ein Tag?
    const tagMatch = part.match(/^<\/?([A-Za-z][A-Za-z0-9]*)\b/)
    if (part.startsWith('<') && tagMatch) {
      const tagName = tagMatch[1].toUpperCase()
      // Self-closing oder Standard-Tag?
      if (SKIP_TAGS.has(tagName)) {
        if (part.startsWith('</')) {
          // Schliessender Tag — pop wenn passend
          const idx = skipStack.lastIndexOf(tagName)
          if (idx !== -1) skipStack.splice(idx, 1)
        } else if (!part.endsWith('/>')) {
          // Öffnender Tag (kein self-closing)
          skipStack.push(tagName)
        }
      }
      out.push(part)
      continue
    }

    // Es ist Text. Nur ersetzen wenn wir nicht innerhalb eines Skip-Tags sind.
    if (skipStack.length > 0) {
      out.push(part)
      continue
    }

    out.push(
      part.replace(termsRegex, (_match, term) => {
        const erklaerung = glossar[term]
        if (!erklaerung) return term
        return `<abbr title="${escapeAttr(erklaerung)}">${term}</abbr>`
      })
    )
  }

  return out.join('')
}
