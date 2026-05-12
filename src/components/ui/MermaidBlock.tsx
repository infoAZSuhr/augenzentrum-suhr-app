import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import mermaid from 'mermaid'
import { GitBranch, Pencil, Check, X, Trash2 } from 'lucide-react'

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
})

export const DEFAULT_MERMAID_CODE = `flowchart TD
    A[Start] --> B{Entscheidung?}
    B -- Ja --> C[Schritt A]
    B -- Nein --> D[Schritt B]
    C --> E[Ende]
    D --> E`

let uid = 0

function MermaidView({ node, updateAttributes, editor, deleteNode }: NodeViewProps) {
  const code: string = node.attrs.code ?? DEFAULT_MERMAID_CODE
  const editable = editor.isEditable

  const [editing,  setEditing]  = useState(false)
  const [draft,    setDraft]    = useState(code)
  const [svg,      setSvg]      = useState('')
  const [err,      setErr]      = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const render = useCallback(async (src: string) => {
    if (!src.trim()) return
    const id = `mm-${++uid}`
    try {
      const { svg: s } = await mermaid.render(id, src)
      document.getElementById(id)?.remove()
      setSvg(s)
      setErr('')
    } catch (e: any) {
      setErr(e?.str ?? e?.message ?? 'Syntaxfehler im Diagramm')
      setSvg('')
    }
  }, [])

  // Render when saved code changes
  useEffect(() => { render(code) }, [code, render])

  // Debounced live-preview while editing
  useEffect(() => {
    if (!editing) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => render(draft), 600)
    return () => clearTimeout(timerRef.current)
  }, [draft, editing, render])

  const save   = () => { updateAttributes({ code: draft }); setEditing(false) }
  const cancel = () => { setDraft(code); setEditing(false) }

  return (
    <NodeViewWrapper>
      <div
        className="my-4 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm"
        contentEditable={false}
      >
        {/* Header */}
        {editable && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-xs select-none">
            <span className="flex items-center gap-1.5 font-semibold text-gray-500">
              <GitBranch className="w-3.5 h-3.5" />
              Flussdiagramm
            </span>
            <div className="flex items-center gap-1">
              {editing ? (
                <>
                  <button type="button" onClick={save}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-green-700 hover:bg-green-50 transition-colors font-medium">
                    <Check className="w-3 h-3" /> Übernehmen
                  </button>
                  <button type="button" onClick={cancel}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-gray-400 hover:bg-gray-100 transition-colors">
                    <X className="w-3 h-3" /> Abbrechen
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => { setDraft(code); setEditing(true) }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors">
                  <Pencil className="w-3 h-3" /> Bearbeiten
                </button>
              )}
              <button type="button" onClick={deleteNode} title="Diagramm löschen"
                className="p-1 ml-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Code-Editor */}
        {editing && (
          <div className="p-3 border-b border-gray-100 bg-gray-50/50">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={9}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="w-full font-mono text-xs bg-white border border-gray-200 rounded-lg p-3 resize-y
                         focus:outline-none focus:ring-2 focus:ring-primary-400 leading-relaxed"
            />
            <p className="mt-1.5 text-[10px] text-gray-400">
              Mermaid-Syntax ·{' '}
              <a
                href="https://mermaid.js.org/syntax/flowchart.html"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-600"
              >
                Dokumentation öffnen
              </a>
            </p>
          </div>
        )}

        {/* Vorschau */}
        <div className="flex justify-center items-center p-6 overflow-x-auto min-h-[80px]">
          {err ? (
            <p className="text-xs text-red-500 font-mono bg-red-50 border border-red-100 px-3 py-2 rounded-lg whitespace-pre-wrap max-w-full">
              {err}
            </p>
          ) : svg ? (
            <div
              dangerouslySetInnerHTML={{ __html: svg }}
              className="max-w-full [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:mx-auto"
            />
          ) : (
            <p className="text-xs text-gray-300 animate-pulse">Diagramm wird gerendert…</p>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      code: { default: DEFAULT_MERMAID_CODE },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-mermaid-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-mermaid-block': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView)
  },

  addCommands() {
    return {
      insertMermaidBlock:
        () =>
        ({ commands }: any) =>
          commands.insertContent({
            type: this.name,
            attrs: { code: DEFAULT_MERMAID_CODE },
          }),
    } as any
  },
})
