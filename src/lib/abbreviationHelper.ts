/**
 * Wandelt im gerenderten HTML jede aus GLOSSAR bekannte Abkürzung in einen
 * <abbr title="…">…</abbr>-Tag um, damit beim Hover der Browser-Tooltip
 * erscheint. Eine zugehörige Styling-Regel (gepunktete Unterstreichung)
 * lebt in src/index.css.
 *
 * Sicherheitsmechanismen:
 * - HTML-Tags und deren Attribute werden NICHT angefasst (nur Text-Nodes
 *   zwischen Tags), damit z.B. href-Werte oder Klassen-Namen heil bleiben.
 * - Bereits vorhandene <abbr>-Tags werden NICHT doppelt verschachtelt.
 * - Wort-Grenzen (\b) verhindern, dass z.B. "RC" innerhalb von
 *   "RC.35.0110" matcht.
 */
import { GLOSSAR } from './glossar'

// Regex, der HTML in "Tags" und "Text" splittet
const TAG_OR_TEXT = /(<[^>]+>)/g

// Bereiche, in denen wir NICHT ersetzen sollen
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'ABBR', 'A'])

// Vorbereitung: aus dem Glossar einen einzelnen Regex bauen, sortiert nach
// Länge (längste zuerst) — damit z.B. "ICD-10-GM" vor "ICD-10" und "ICD"
// matcht. Special chars werden escaped.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const SORTED_TERMS = Object.keys(GLOSSAR)
  .sort((a, b) => b.length - a.length)

const TERMS_REGEX = new RegExp(
  // Wort-Grenze davor — danach: Term — gefolgt von Wort-Grenze oder String-Ende.
  // Für Begriffe mit Bindestrich (z.B. "Anti-VEGF") nutzt \b nicht zuverlässig;
  // wir akzeptieren als rechte Grenze auch Satzzeichen / Whitespace / EOL.
  `(?<![A-Za-z0-9_äöüÄÖÜß-])(${SORTED_TERMS.map(escapeRegex).join('|')})(?![A-Za-z0-9_äöüÄÖÜß-])`,
  'g'
)

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Erweitert einen HTML-String mit <abbr>-Tooltips für alle bekannten
 * Abkürzungen. Idempotent (mehrfacher Aufruf erzeugt keine Verschachtelung).
 */
export function expandAbbreviations(html: string): string {
  if (!html) return html

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
      part.replace(TERMS_REGEX, (_match, term) => {
        const erklaerung = GLOSSAR[term]
        if (!erklaerung) return term
        return `<abbr title="${escapeAttr(erklaerung)}">${term}</abbr>`
      })
    )
  }

  return out.join('')
}
