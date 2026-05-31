/**
 * <Glossarized>: Wrapper-Komponente, die ihren Text-Inhalt durch
 * expandAbbreviations() schickt und mit Tooltip-Markup rendert.
 *
 * Verwendung (überall in der App, wo Abkürzungen Tooltips bekommen sollen):
 *
 *   <Glossarized>Aufgebotsart</Glossarized>
 *   <Glossarized as="th" className="px-3 py-2">MHD</Glossarized>
 *
 * Funktioniert sowohl mit Plaintext als auch wenn die Children HTML enthalten
 * (z.B. aus Markdown-Konversion). XSS-Schutz: nur expandAbbreviations sieht
 * den Text — escapeHtml wird auf Plain-String-Children angewendet.
 */
import type { ElementType, ReactNode } from 'react'
import { useGlossar } from '../../lib/GlossarContext'
import { expandAbbreviations } from '../../lib/abbreviationHelper'

interface Props {
  children: ReactNode
  /** HTML-Tag für den Wrapper. Default 'span'. */
  as?: ElementType
  className?: string
  /** Falls true: Children werden als HTML behandelt (kein Escape). Default false. */
  html?: boolean
  title?: string
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c =>
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;'  :
    c === '>' ? '&gt;'  :
                '&quot;'
  )
}

function nodeToString(node: ReactNode): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeToString).join('')
  // Für komplexe ReactNodes (Elements) Fallback: nichts ersetzen.
  // Wer hier Glossar-Tooltips will, muss html={true} + String übergeben.
  return ''
}

export function Glossarized({
  children,
  as: Component = 'span',
  className,
  html = false,
  title,
}: Props) {
  const { map } = useGlossar()
  const raw  = nodeToString(children)

  // Wenn Children komplexe Elements enthalten → unverändert rendern
  if (!raw) {
    return <Component className={className} title={title}>{children}</Component>
  }

  const safe = html ? raw : escapeHtml(raw)
  const expanded = expandAbbreviations(safe, map)
  return (
    <Component
      className={className}
      title={title}
      dangerouslySetInnerHTML={{ __html: expanded }}
    />
  )
}
