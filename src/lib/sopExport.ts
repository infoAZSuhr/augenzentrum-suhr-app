/**
 * SOP-Export-Helper
 *
 * Zero-Dependency-Implementierung:
 * - PDF  → öffnet neues Fenster mit Print-CSS, ruft window.print() auf;
 *          User wählt im Browser-Dialog "Als PDF speichern".
 * - DOCX → erzeugt einen Word-kompatiblen HTML-Blob (.doc), triggert Download;
 *          Word 2007+ öffnet das anstandslos und konvertiert beim Speichern
 *          in echtes .docx.
 *
 * Beide Funktionen akzeptieren rohes TipTap-HTML aus dem RichTextEditor und
 * reichern es vor dem Render mit Abkürzungs-Tooltips an (expandAbbreviations).
 * Die Aufrufer übergeben dafür die Live-Glossar-Map aus dem GlossarContext.
 */
import { expandAbbreviations } from './abbreviationHelper'
import { formatSwissDate } from '../utils/dateUtils'

export interface ExportPageInput {
  title: string
  content: string              // HTML (TipTap-Output)
  section?: string             // z.B. "I – TARDOC-Abrechnung & Tarife"
  subsection?: string          // z.B. "TARDOC-Abrechnung & Tarife"
  version?: string | number
  zustaendig?: string
  freigabeDurch?: string
  gueltigAb?: string
  status?: string
  glossar?: Record<string, string>  // optional: Map für expandAbbreviations
}

// ── gemeinsame CSS-Vorlage (drucktauglich + Word-tauglich) ───────────────────
const STYLES = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
    font-size: 11pt;
    color: #111;
    line-height: 1.45;
    margin: 0;
    padding: 0;
  }
  .header {
    border-bottom: 2px solid #0c4a6e;
    padding-bottom: 10px;
    margin-bottom: 18px;
  }
  .header h1 {
    margin: 0 0 4px 0;
    font-size: 18pt;
    color: #0c4a6e;
  }
  .header .breadcrumb {
    font-size: 9pt;
    color: #6b7280;
    margin: 0;
  }
  .meta {
    background: #f3f4f6;
    border-left: 3px solid #06b6d4;
    padding: 8px 12px;
    margin: 0 0 16px 0;
    font-size: 9pt;
    color: #4b5563;
  }
  .meta-row { display: flex; gap: 18px; flex-wrap: wrap; }
  .meta-row > span > strong { color: #111; }
  h2 { font-size: 14pt; color: #0c4a6e; margin: 18px 0 8px 0; }
  h3 { font-size: 12pt; color: #1f2937; margin: 14px 0 6px 0; }
  p  { margin: 4px 0 8px 0; }
  ul, ol { margin: 4px 0 10px 22px; padding: 0; }
  li { margin: 2px 0; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 8px 0 14px 0;
    font-size: 10pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #d1d5db;
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #e5e7eb; font-weight: 600; }
  code {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 10pt;
    background: #f3f4f6;
    padding: 1px 4px;
    border-radius: 2px;
  }
  pre {
    background: #f3f4f6;
    padding: 8px 10px;
    border-left: 3px solid #cbd5e1;
    overflow-x: auto;
    font-size: 9.5pt;
  }
  blockquote {
    border-left: 3px solid #fbbf24;
    background: #fffbeb;
    margin: 8px 0;
    padding: 6px 12px;
    color: #78350f;
  }
  a { color: #0369a1; text-decoration: underline; }
  abbr[title] {
    text-decoration: underline dotted;
    text-decoration-color: #06b6d4;
    text-underline-offset: 2px;
    cursor: help;
  }
  .footer {
    margin-top: 28px;
    padding-top: 8px;
    border-top: 1px solid #e5e7eb;
    font-size: 8pt;
    color: #9ca3af;
    text-align: center;
  }
  @media print {
    .no-print { display: none !important; }
    body { font-size: 10.5pt; }
  }
`

function buildMetaBlock(p: ExportPageInput): string {
  const today = formatSwissDate(new Date())
  const items: string[] = []
  if (p.version)       items.push(`<span><strong>Version:</strong> ${escapeHtml(String(p.version))}</span>`)
  if (p.gueltigAb)     items.push(`<span><strong>Gültig ab:</strong> ${escapeHtml(p.gueltigAb)}</span>`)
  if (p.zustaendig)    items.push(`<span><strong>Zuständig:</strong> ${escapeHtml(p.zustaendig)}</span>`)
  if (p.freigabeDurch) items.push(`<span><strong>Freigabe:</strong> ${escapeHtml(p.freigabeDurch)}</span>`)
  if (p.status)        items.push(`<span><strong>Status:</strong> ${escapeHtml(p.status)}</span>`)
  items.push(`<span><strong>Exportiert:</strong> ${today}</span>`)
  return `<div class="meta"><div class="meta-row">${items.join('')}</div></div>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;'  :
    c === '>' ? '&gt;'  :
    c === '"' ? '&quot;': '&#39;'
  )
}

export function buildFullHtml(p: ExportPageInput): string {
  const breadcrumb = [p.section, p.subsection]
    .filter((s): s is string => !!s)
    .map(escapeHtml)
    .join(' &rsaquo; ')
  // Abkürzungen mit Tooltips anreichern — funktioniert im Browser-Print
  // (Hover im Preview-Iframe) und in Word (title-Attribut bleibt erhalten).
  const expandedContent = expandAbbreviations(p.content, p.glossar ?? {})
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(p.title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(p.title)}</h1>
    ${breadcrumb ? `<p class="breadcrumb">${breadcrumb}</p>` : ''}
  </div>
  ${buildMetaBlock(p)}
  <div class="content">
    ${expandedContent}
  </div>
  <div class="footer">
    Augenzentrum Suhr · SOP-Export · ${formatSwissDate(new Date())}
  </div>
</body>
</html>`
}

// ── PDF-Export via Browser-Print ─────────────────────────────────────────────
export function exportPagePDF(p: ExportPageInput): void {
  const html = buildFullHtml(p)
  const w = window.open('', '_blank', 'width=900,height=1100')
  if (!w) {
    alert('Popup blockiert – bitte Popups für diese Seite erlauben und erneut versuchen.')
    return
  }
  w.document.write(html)
  w.document.close()
  w.focus()
  // Etwas Zeit lassen, damit Bilder/Tabellen rendern
  setTimeout(() => {
    try { w.print() } catch { /* ignore */ }
  }, 400)
}

// ── Multi-Page-Export (ganze Subsection / Section) ──────────────────────────

export interface MultiExportInput {
  /** Sammlung von Pages in Reihenfolge */
  pages:       ExportPageInput[]
  /** Übergeordneter Titel — z.B. "Section A – Allgemeines" oder
   *  "Sprechstunde (Subsection)". Erscheint als Deckblatt + im
   *  Datei-/Browser-Titel. */
  title:       string
  /** Optionaler Untertitel im Deckblatt (z.B. "5 SOPs") */
  subtitle?:   string
  /** Falls true: ein Inhaltsverzeichnis vor den Pages */
  withToc?:    boolean
  /** Optionale Glossar-Map die an alle Pages durchgereicht wird (überschreibt
   *  einzelne Page-Werte falls dort nicht gesetzt). */
  glossar?:    Record<string, string>
}

/** Baut eine Multi-Page-HTML mit Page-Breaks zwischen den Pages, optionalem
 *  Deckblatt und Inhaltsverzeichnis. Jede Page kriegt einen <h1>-Trenner
 *  und einen kleinen Breadcrumb. */
export function buildMultiHtml(input: MultiExportInput): string {
  const today = formatSwissDate(new Date())
  const pageCount = input.pages.length

  // Cover-Page
  const cover = `
    <div class="cover">
      <h1 class="cover-title">${escapeHtml(input.title)}</h1>
      ${input.subtitle ? `<p class="cover-sub">${escapeHtml(input.subtitle)}</p>` : ''}
      <p class="cover-count">${pageCount} SOP${pageCount === 1 ? '' : 's'}</p>
      <p class="cover-date">Exportiert: ${today}</p>
    </div>
  `

  // Optionales Inhaltsverzeichnis
  const toc = input.withToc && pageCount > 1 ? `
    <div class="toc">
      <h2>Inhaltsverzeichnis</h2>
      <ol class="toc-list">
        ${input.pages.map((p, i) => `
          <li>
            <span class="toc-num">${i + 1}.</span>
            <span class="toc-title">${escapeHtml(p.title)}</span>
            ${p.version ? `<span class="toc-ver">v${escapeHtml(String(p.version))}</span>` : ''}
          </li>
        `).join('')}
      </ol>
    </div>
  ` : ''

  // Pages mit Page-Breaks dazwischen
  const pagesHtml = input.pages.map((p, i) => {
    const expandedContent = expandAbbreviations(p.content, p.glossar ?? input.glossar ?? {})
    const breadcrumb = [p.section, p.subsection].filter((s): s is string => !!s).map(escapeHtml).join(' &rsaquo; ')
    return `
      <section class="page ${i > 0 ? 'page-break' : ''}">
        <div class="header">
          <h1>${escapeHtml(p.title)}</h1>
          ${breadcrumb ? `<p class="breadcrumb">${breadcrumb}</p>` : ''}
        </div>
        ${buildMetaBlock(p)}
        <div class="content">${expandedContent}</div>
      </section>
    `
  }).join('')

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(input.title)}</title>
  <style>
    ${STYLES}
    .cover { text-align: center; padding: 50mm 0 0 0; page-break-after: always; }
    .cover-title { font-size: 28pt; color: #0c4a6e; margin: 0 0 8px 0; border: none; padding: 0; }
    .cover-sub { font-size: 14pt; color: #4b5563; margin: 0 0 24px 0; }
    .cover-count { font-size: 12pt; color: #6b7280; margin: 0 0 4px 0; font-weight: 600; }
    .cover-date { font-size: 10pt; color: #9ca3af; margin: 4px 0 0 0; }
    .toc { page-break-after: always; }
    .toc h2 { font-size: 16pt; color: #0c4a6e; margin: 0 0 16px 0; }
    .toc-list { list-style: none; padding: 0; margin: 0; }
    .toc-list li { display: flex; gap: 8px; padding: 6px 0; border-bottom: 1px dotted #e5e7eb; align-items: baseline; font-size: 11pt; }
    .toc-num { font-weight: 600; color: #6b7280; min-width: 28px; }
    .toc-title { flex: 1; }
    .toc-ver { font-size: 9pt; color: #9ca3af; }
    .page-break { page-break-before: always; }
    .page section.header { border-bottom: 2px solid #0c4a6e; padding-bottom: 10px; margin-bottom: 18px; }
  </style>
</head>
<body>
  ${cover}
  ${toc}
  ${pagesHtml}
  <div class="footer">
    Augenzentrum Suhr · SOP-Export · ${today}
  </div>
</body>
</html>`
}

/** PDF-Export für mehrere Pages — öffnet Print-Dialog mit allen Pages
 *  hintereinander, Page-Breaks dazwischen, optionalem TOC. */
export function exportMultiplePDF(input: MultiExportInput): void {
  const html = buildMultiHtml(input)
  const w = window.open('', '_blank', 'width=900,height=1100')
  if (!w) {
    alert('Popup blockiert – bitte Popups für diese Seite erlauben und erneut versuchen.')
    return
  }
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch {} }, 600)
}

/** Word-Export für mehrere Pages — als .doc downloadbar. */
export function exportMultipleDocx(input: MultiExportInput): void {
  const html = buildMultiHtml(input)
  const wordHtml = `MIME-Version: 1.0
Content-Type: multipart/related; boundary="----=_NextPart_SOP"

------=_NextPart_SOP
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: quoted-printable
Content-Location: file:///C:/sop.htm

${html}

------=_NextPart_SOP--`
  const blob = new Blob([wordHtml], { type: 'application/msword' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const safeTitle = input.title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80)
  a.href     = url
  a.download = `SOP_${safeTitle}.doc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Word-Export (Word-kompatibles HTML mit .doc-Endung) ──────────────────────
// Word 2007+ öffnet HTML-Dateien problemlos und konvertiert sie beim Speichern
// in echtes .docx. Vorteil: keine Library nötig, alle Formatierungen (Tabellen,
// Listen, fett, Links) bleiben erhalten.
export function exportPageDocx(p: ExportPageInput): void {
  const html = buildFullHtml(p)
  // Word braucht spezielles MIME-Wrapping mit MHTML-Header, damit
  // Tabellen-/Stil-Formatierung erhalten bleibt
  const wordHtml = `MIME-Version: 1.0
Content-Type: multipart/related; boundary="----=_NextPart_SOP"

------=_NextPart_SOP
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: quoted-printable
Content-Location: file:///C:/sop.htm

${html}

------=_NextPart_SOP--`

  const blob = new Blob([wordHtml], { type: 'application/msword' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const safeTitle = p.title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80)
  a.href     = url
  a.download = `SOP_${safeTitle}.doc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Cleanup nach kurzem Delay, damit der Download startet
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
