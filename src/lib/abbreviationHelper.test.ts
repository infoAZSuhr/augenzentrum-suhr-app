import { describe, it, expect } from 'vitest'
import { expandAbbreviations } from './abbreviationHelper'

const GLOSSAR = {
  OCT:       'Optische Kohärenztomographie',
  AMD:       'Altersbedingte Makuladegeneration',
  'ICD-10':  'Internationale Klassifikation der Krankheiten',
  TARDOC:    'Schweizer Einzelleistungstarif',
}

describe('expandAbbreviations', () => {
  it('wraps known abbreviations in <abbr> with title', () => {
    const out = expandAbbreviations('Patient hat OCT', GLOSSAR)
    expect(out).toContain('<abbr title="Optische Kohärenztomographie">OCT</abbr>')
  })

  it('returns input unchanged when no abbreviation matches', () => {
    expect(expandAbbreviations('reiner Text', GLOSSAR)).toBe('reiner Text')
  })

  it('returns input unchanged when glossar is empty', () => {
    expect(expandAbbreviations('mit OCT und AMD', {})).toBe('mit OCT und AMD')
  })

  it('returns empty input unchanged', () => {
    expect(expandAbbreviations('', GLOSSAR)).toBe('')
  })

  it('does NOT match inside word boundaries (e.g. RC inside RC.35.0110)', () => {
    const out = expandAbbreviations('Code RC.35.0110 wird abgerechnet', { RC: 'Recall' })
    // RC ist Teil von RC.35.0110, sollte NICHT als eigene Abkürzung matchen
    expect(out).not.toContain('<abbr')
  })

  it('does NOT replace inside <code>/<pre>/<a>/<abbr>', () => {
    const html = '<p>OCT im Text</p><code>OCT im Code</code>'
    const out  = expandAbbreviations(html, GLOSSAR)
    expect(out).toMatch(/<p><abbr[^>]*>OCT<\/abbr> im Text<\/p>/)
    expect(out).toContain('<code>OCT im Code</code>')
  })

  it('does NOT touch HTML tag attributes', () => {
    // 'OCT' im href-Attribut darf nicht ersetzt werden
    const out = expandAbbreviations('<a href="https://example.com/OCT-info">Mehr</a>', GLOSSAR)
    expect(out).toContain('href="https://example.com/OCT-info"')
    expect(out).not.toContain('href="https://example.com/<abbr')
  })

  it('matches longest term first (ICD-10 vs ICD)', () => {
    const out = expandAbbreviations('Diagnose nach ICD-10 verschlüsselt', GLOSSAR)
    expect(out).toContain('<abbr title="Internationale Klassifikation der Krankheiten">ICD-10</abbr>')
  })

  it('escapes special chars in glossar explanation', () => {
    const out = expandAbbreviations('Begriff: X', { X: '<script>alert("xss")</script>' })
    expect(out).toContain('&lt;script&gt;')
    expect(out).not.toContain('<script>alert')
  })
})
