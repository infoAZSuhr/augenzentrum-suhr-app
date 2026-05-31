import { describe, it, expect } from 'vitest'
import { buildFullHtml } from './sopExport'

describe('buildFullHtml', () => {
  it('produces a valid HTML5 document', () => {
    const out = buildFullHtml({ title: 'Test', content: '<p>Inhalt</p>' })
    expect(out).toMatch(/^<!DOCTYPE html>/)
    expect(out).toContain('<html lang="de">')
    expect(out).toContain('</html>')
    expect(out).toContain('<meta charset="utf-8"/>')
  })

  it('includes the title in both <title> and the header h1', () => {
    const out = buildFullHtml({ title: 'H.4 Zykloplegie', content: '' })
    expect(out).toContain('<title>H.4 Zykloplegie</title>')
    expect(out).toContain('<h1>H.4 Zykloplegie</h1>')
  })

  it('renders the breadcrumb when section + subsection are set', () => {
    const out = buildFullHtml({
      title: 'X',
      content: '',
      section: 'I – TARDOC',
      subsection: 'Abrechnung',
    })
    expect(out).toMatch(/I.+TARDOC.+Abrechnung/)
    expect(out).toContain('class="breadcrumb"')
  })

  it('escapes HTML in the title to prevent injection', () => {
    const out = buildFullHtml({ title: '<script>x</script>', content: '' })
    expect(out).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(out).not.toContain('<script>x</script>')
  })

  it('includes meta block with version + status when provided', () => {
    const out = buildFullHtml({
      title: 'X',
      content: '',
      version: '1.2',
      status: 'final',
      zustaendig: 'Max Muster',
    })
    expect(out).toContain('Version:')
    expect(out).toContain('1.2')
    expect(out).toContain('Status:')
    expect(out).toContain('final')
    expect(out).toContain('Max Muster')
  })

  it('passes content HTML through unchanged when no glossar given', () => {
    const out = buildFullHtml({ title: 'X', content: '<table><tr><td>Zelle</td></tr></table>' })
    expect(out).toContain('<table><tr><td>Zelle</td></tr></table>')
  })

  it('expands abbreviations when glossar is provided', () => {
    const out = buildFullHtml({
      title: 'X',
      content: '<p>Patient mit OCT</p>',
      glossar: { OCT: 'Optische Kohärenztomographie' },
    })
    expect(out).toContain('<abbr title="Optische Kohärenztomographie">OCT</abbr>')
  })

  it('always includes the AZS footer', () => {
    const out = buildFullHtml({ title: 'X', content: '' })
    expect(out).toContain('Augenzentrum Suhr')
    expect(out).toContain('SOP-Export')
  })
})
