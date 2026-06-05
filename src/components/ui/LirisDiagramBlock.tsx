import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowLeftRight, Trash2 } from 'lucide-react'

// ── Data ─────────────────────────────────────────────────────────────────────

type GroupId = 'konsult' | 'refrak' | 'autoref' | 'iop' | 'spalt' | 'fundus'

const GROUPS: Record<GroupId, { color: string; tarif: string[]; section: string[]; label: string }> = {
  konsult: { color: '#1a6bbf', tarif: ['p1', 'p2'], section: ['r_konsult'], label: 'Konsultation / Anamnese' },
  refrak:  { color: '#2a9645', tarif: ['p4'],        section: ['r_visus'],   label: 'Refraktionsbestimmung → Visus' },
  autoref: { color: '#8b32b5', tarif: ['p3'],        section: ['r_visus'],   label: 'Autoref (MPA) → Visus' },
  iop:     { color: '#d4720a', tarif: ['p5'],        section: ['r_iop'],     label: 'Tensio / IOP' },
  spalt:   { color: '#c42828', tarif: ['p6'],        section: ['r_spalt'],   label: 'Spaltlampe' },
  fundus:  { color: '#0e9e82', tarif: ['p7', 'p8'], section: ['r_fundus'],  label: 'Fundus (Biomikroskopie)' },
}

type ArrowDef = { from: string; to: string; g: GroupId }
const ARROW_DEFS: ArrowDef[] = [
  { from: 'p1', to: 'r_konsult', g: 'konsult' },
  { from: 'p2', to: 'r_konsult', g: 'konsult' },
  { from: 'p3', to: 'r_visus',   g: 'autoref' },
  { from: 'p4', to: 'r_visus',   g: 'refrak'  },
  { from: 'p5', to: 'r_iop',     g: 'iop'     },
  { from: 'p6', to: 'r_spalt',   g: 'spalt'   },
  { from: 'p7', to: 'r_fundus',  g: 'fundus'  },
  { from: 'p8', to: 'r_fundus',  g: 'fundus'  },
]

// Default left-border colors (last-write-wins for multi-group targets like r_visus)
const DEFAULT_COLORS: Record<string, string> = {}
ARROW_DEFS.forEach(a => {
  DEFAULT_COLORS[a.from] = GROUPS[a.g].color
  DEFAULT_COLORS[a.to]   = GROUPS[a.g].color
})

// ── View Component ────────────────────────────────────────────────────────────

type ArrowPath = { d: string; g: GroupId; from: string; dotCx: number; dotCy: number }

function LirisDiagramView({ deleteNode, editor }: NodeViewProps) {
  const editable   = editor.isEditable
  const wrapperRef = useRef<HTMLDivElement>(null)
  const elemRefs   = useRef<Map<string, HTMLElement | null>>(new Map())
  const instId     = useRef(`liris${Math.random().toString(36).slice(2, 7)}`)

  const [activeGroups, setActiveGroups] = useState<GroupId[]>([])
  const [arrowPaths,   setArrowPaths]   = useState<ArrowPath[]>([])
  const [svgDims,      setSvgDims]      = useState({ w: 0, h: 0 })

  // Callback ref helper
  const setRef = useCallback((id: string) => (el: HTMLElement | null) => {
    elemRefs.current.set(id, el)
  }, [])

  // Recalculate SVG arrow positions
  const calcArrows = useCallback(() => {
    const wr = wrapperRef.current
    if (!wr) return
    const wrRect = wr.getBoundingClientRect()
    setSvgDims({ w: wr.offsetWidth, h: wr.offsetHeight })

    const paths: ArrowPath[] = []
    const drawn = new Set<string>()

    ARROW_DEFS.forEach(arr => {
      const fromEl = elemRefs.current.get(arr.from)
      const toEl   = elemRefs.current.get(arr.to)
      if (!fromEl || !toEl) return
      const fr = fromEl.getBoundingClientRect()
      const tr = toEl.getBoundingClientRect()
      const ax = fr.right  - wrRect.left
      const ay = (fr.top + fr.bottom) / 2 - wrRect.top
      const bx = tr.left   - wrRect.left
      const by = (tr.top + tr.bottom) / 2 - wrRect.top
      const mx = (ax + bx) / 2
      const d  = `M${ax},${ay} C${ax + (mx - ax) * 0.72},${ay} ${bx - (bx - mx) * 0.72},${by} ${bx},${by}`
      paths.push({ d, g: arr.g, from: arr.from, dotCx: ax, dotCy: ay })
      drawn.add(arr.from)
    })
    setArrowPaths(paths)
  }, [])

  useEffect(() => {
    const t  = setTimeout(calcArrows, 80)
    const ro = new ResizeObserver(calcArrows)
    if (wrapperRef.current) ro.observe(wrapperRef.current)
    return () => { clearTimeout(t); ro.disconnect() }
  }, [calcArrows])

  // Hover helpers
  const hoverGroups = (groups: GroupId[]) => setActiveGroups(groups)
  const leaveGroups = () => setActiveGroups([])
  const parseG      = (g: string): GroupId[] => (g ? g.split(/\s+/) as GroupId[] : [])

  const isLit = (groups: GroupId[]) => activeGroups.length > 0 && groups.some(g => activeGroups.includes(g))
  const isDim = (groups: GroupId[]) => activeGroups.length > 0 && !groups.some(g => activeGroups.includes(g))

  // One dot per source element
  const dots = useMemo(() => {
    const seen = new Set<string>()
    return arrowPaths.filter(p => { if (seen.has(p.from)) return false; seen.add(p.from); return true })
  }, [arrowPaths])

  const filterId = `${instId.current}-glow`

  // Style helpers
  const tarifStyle = (id: string, groups: GroupId[]): React.CSSProperties => ({
    display: 'flex', alignItems: 'flex-start', gap: 5,
    padding: '4px 4px 4px 8px', borderRadius: 3, marginBottom: 2,
    borderLeft: `3px solid ${isLit(groups) ? GROUPS[groups[0]]?.color : isDim(groups) ? 'transparent' : (DEFAULT_COLORS[id] || 'transparent')}`,
    background: isLit(groups) ? '#fff7d0' : 'transparent',
    boxShadow: isLit(groups) ? '0 0 0 2px #f5c518, 0 0 12px rgba(245,197,24,0.45)' : undefined,
    opacity: isDim(groups) ? 0.2 : 1,
    transition: 'background 0.15s, box-shadow 0.2s, opacity 0.15s',
    cursor: 'default',
  })

  const secBarStyle = (id: string, groups: GroupId[]): React.CSSProperties => ({
    background: '#b8d49a',
    textAlign: 'center', fontWeight: 'bold', fontSize: 12,
    padding: '4px 0', margin: '6px 0 3px', borderRadius: 3,
    borderLeft: `4px solid ${isLit(groups) ? '#f5c518' : (DEFAULT_COLORS[id] || 'transparent')}`,
    boxShadow: isLit(groups) ? '0 0 0 2px #f5c518, 0 0 14px rgba(245,197,24,0.5)' : undefined,
    filter: isLit(groups) ? 'brightness(1.08)' : undefined,
    opacity: isDim(groups) ? 0.2 : 1,
    transition: 'box-shadow 0.2s, opacity 0.15s, filter 0.15s',
    cursor: 'default',
  })

  const konsultBoxStyle = (id: string, groups: GroupId[]): React.CSSProperties => ({
    fontSize: 11, color: '#333', lineHeight: 1.5, marginBottom: 5,
    padding: '4px 6px', borderRadius: 3,
    borderLeft: `3px solid ${isLit(groups) ? '#f5c518' : (DEFAULT_COLORS[id] || 'transparent')}`,
    boxShadow: isLit(groups) ? '0 0 0 2px #f5c518, 0 0 14px rgba(245,197,24,0.5)' : undefined,
    filter: isLit(groups) ? 'brightness(1.08)' : undefined,
    opacity: isDim(groups) ? 0.2 : 1,
    transition: 'box-shadow 0.2s, opacity 0.15s',
    cursor: 'default',
  })

  const ovItemStyle = (groups: GroupId[]): React.CSSProperties => ({
    fontSize: 11, color: '#333', lineHeight: 1.9,
    padding: '1px 4px', borderRadius: 3, cursor: 'default', display: 'block',
    background: isLit(groups) ? '#fff7d0' : undefined,
    boxShadow: isLit(groups) ? '0 0 0 2px #f5c518, 0 0 10px rgba(245,197,24,0.5)' : undefined,
    opacity: isDim(groups) ? 0.3 : 1,
    transition: 'background 0.15s, box-shadow 0.15s',
  })

  return (
    <NodeViewWrapper>
      <div className="my-4 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm" contentEditable={false}>

        {/* Header */}
        {editable && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-xs select-none">
            <span className="flex items-center gap-1.5 font-semibold text-gray-500">
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Liris TARMED-Zuordnung
            </span>
            <button type="button" onClick={deleteNode} title="Diagramm löschen"
              className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Hint */}
        <div style={{ fontSize: 11, color: '#667', fontStyle: 'italic', padding: '6px 12px 0', background: '#f8f9fc' }}>
          💡 Über Übersicht, Tarifposition oder Untersuchungsfeld fahren um die Zuordnung aufzuleuchten.
        </div>

        {/* Main diagram */}
        <div ref={wrapperRef} style={{ display: 'flex', position: 'relative', fontFamily: 'Arial, sans-serif', fontSize: 12 }}>

          {/* ── LEFT PANEL ── */}
          <div style={{ width: 340, flexShrink: 0, background: '#fff', padding: 12, borderRight: '1px solid #ddd' }}>
            <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 13, borderBottom: '1px solid #ccc', paddingBottom: 5, marginBottom: 8 }}>
              Leistung
            </div>

            {/* Overview */}
            <div style={{ fontStyle: 'italic', fontSize: 10, color: '#555', margin: '9px 0 3px' }}>Übersicht</div>
            {([
              ['konsult', 'Grundkonsultation, 10 min.'],
              ['refrak',  'Refraktionsbestimmung'],
              ['autoref', 'Autoref, 5 min.'],
              ['iop',     'Tensio'],
              ['spalt',   'Spaltlampe'],
              ['fundus',  'Biomikroskopie des zentralen Fundus'],
            ] as [GroupId, string][]).map(([g, label]) => (
              <span key={g}
                style={ovItemStyle([g])}
                onMouseEnter={() => hoverGroups([g])}
                onMouseLeave={leaveGroups}
              >{label}</span>
            ))}
            <span
              style={{ ...ovItemStyle(['fundus']), paddingLeft: 18, fontStyle: 'italic' }}
              onMouseEnter={() => hoverGroups(['fundus'])}
              onMouseLeave={leaveGroups}
            >&nbsp;&nbsp;mit Mydriase OD</span>

            <hr style={{ border: 'none', borderTop: '1px solid #e4e4e4', margin: '9px 0' }} />
            <div style={{ fontStyle: 'italic', fontSize: 10, color: '#555', margin: '9px 0 3px' }}>Tarifpositionen</div>

            {/* Tarif rows */}
            {[
              { id: 'p1', g: 'konsult' as GroupId, code: 'AA.00.0010', desc: 'Ärztliche Konsultation, erste 5 Min.',                               amt: '17.67' },
              { id: 'p2', g: 'konsult' as GroupId, code: 'AA.00.0020', desc: '+ Ärztliche Konsultation, jede weitere 1 Min.',                       amt: '5× 3.72' },
              { id: 'p3', g: 'autoref' as GroupId, code: 'AK.00.0100', desc: 'Nichtärztliche ophthalmologische Leistungen, pro 1 Min.',             amt: '5× 11.87' },
              { id: 'p4', g: 'refrak'  as GroupId, code: 'RC.00.0010', desc: 'Refraktionsbestimmung, subjektiv, beidseitig',                        amt: '51.85' },
              { id: 'p5', g: 'iop'     as GroupId, code: 'RC.05.0010', desc: 'Applanationstonometrie u. stereoskop. Papillenbeurteilung, beids.',   amt: '34.57' },
              { id: 'p6', g: 'spalt'   as GroupId, code: 'RC.40.0020', desc: 'Spaltlampenuntersuchung der vorderen Augenabschnitte, beidseitig',    amt: '17.28' },
              { id: 'p7', g: 'fundus'  as GroupId, code: 'RC.70.0010', desc: 'Biomikroskopie des zentralen Fundus, ein- oder beidseitig',           amt: '21.61' },
              { id: 'p8', g: 'fundus'  as GroupId, code: 'RC.70.0020', desc: '+ Zuschlag für eingehende Untersuchung der Fundusperipherie, pro Seite', amt: 'OD 12.96' },
            ].map(({ id, g, code, desc, amt }) => (
              <div key={id}
                ref={setRef(id) as any}
                style={tarifStyle(id, [g])}
                onMouseEnter={() => hoverGroups([g])}
                onMouseLeave={leaveGroups}
              >
                <span style={{ fontSize: 10.5, color: '#336', minWidth: 82, fontFamily: 'Courier New, monospace', fontWeight: 'bold', paddingTop: 1 }}>{code}</span>
                <span style={{ flex: 1, fontSize: 11, color: '#222', lineHeight: 1.35 }}>{desc}</span>
                <span style={{ fontSize: 11, color: '#444', minWidth: 42, textAlign: 'right', whiteSpace: 'nowrap' }}>{amt}</span>
              </div>
            ))}

            <hr style={{ border: 'none', borderTop: '1px solid #e4e4e4', margin: '9px 0' }} />
            <div style={{ fontStyle: 'italic', fontSize: 10, color: '#555', margin: '9px 0 3px' }}>Administration</div>
            <div style={{ fontSize: 11, color: '#444', margin: '3px 0' }}>Gesamtbetrag Leistung: <b style={{ color: '#111' }}>CHF 185.48</b></div>
            <div style={{ fontSize: 11, color: '#444', margin: '3px 0' }}>Versicherung: Krankheit (KVG)</div>
            <div style={{ fontSize: 11, color: '#444', margin: '3px 0' }}>Art der Rückzahlung: Tiers payant</div>
          </div>

          {/* ── MIDDLE GAP ── */}
          <div style={{ width: 72, flexShrink: 0, background: '#f0f2f6', borderLeft: '1px solid #ddd', borderRight: '1px solid #ddd' }} />

          {/* ── SVG ARROWS (absolute overlay) ── */}
          <svg
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
            width={svgDims.w}
            height={svgDims.h}
          >
            <defs>
              <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {(Object.entries(GROUPS) as [GroupId, typeof GROUPS[GroupId]][]).map(([gid, grp]) => (
                <marker key={gid} id={`${instId.current}-mk-${gid}`}
                  markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill={grp.color} />
                </marker>
              ))}
            </defs>

            {arrowPaths.map((p, i) => {
              const active = activeGroups.includes(p.g)
              const hasSomething = activeGroups.length > 0
              return (
                <path key={i}
                  d={p.d}
                  fill="none"
                  stroke={GROUPS[p.g].color}
                  strokeWidth={hasSomething ? (active ? 3.5 : 1.5) : 2}
                  opacity={hasSomething ? (active ? 1 : 0.1) : 0.75}
                  filter={active ? `url(#${filterId})` : undefined}
                  markerEnd={`url(#${instId.current}-mk-${p.g})`}
                />
              )
            })}
            {dots.map((p, i) => {
              const active = activeGroups.includes(p.g)
              const hasSomething = activeGroups.length > 0
              return (
                <circle key={i}
                  cx={p.dotCx} cy={p.dotCy}
                  r={hasSomething ? (active ? 5.5 : 3) : 4}
                  fill={GROUPS[p.g].color}
                  opacity={hasSomething ? (active ? 1 : 0.1) : 0.75}
                />
              )
            })}
          </svg>

          {/* ── RIGHT PANEL ── */}
          <div style={{ flex: 1, background: '#fff', padding: 12 }}>
            <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 13, marginBottom: 2 }}>Untersuchung</div>
            <div style={{ textAlign: 'right', fontSize: 10, color: '#aaa', marginBottom: 6 }}>Standardkonsultation</div>

            {/* Konsultationsgrund */}
            <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Konsultationsgrund und Anamnese</div>
            <div
              ref={setRef('r_konsult') as any}
              style={konsultBoxStyle('r_konsult', ['konsult'])}
              onMouseEnter={() => hoverGroups(['konsult'])}
              onMouseLeave={leaveGroups}
            >
              Ko bei OD Hauptgrund<br />
              S: Keine Photopsien.
            </div>

            {/* Visus */}
            <div
              ref={setRef('r_visus') as any}
              style={secBarStyle('r_visus', ['refrak', 'autoref'])}
              onMouseEnter={() => hoverGroups(['refrak', 'autoref'])}
              onMouseLeave={leaveGroups}
            >Visus</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <div style={{ flex: 1, fontSize: 11, color: '#333', lineHeight: 1.55 }}>
                +4.25; −1.00/172 &nbsp;<em>eig. Brille</em><br />
                +4.50; −0.75/172 &nbsp;<b>0.7p</b> <span style={{ color: '#888', fontSize: 10 }}>Autoref</span><br />
                +4.50; −0.50/172 &nbsp;<b>0.7p</b> <span style={{ color: '#888', fontSize: 10 }}>subj. Refr.</span>
              </div>
              <div style={{ flex: 1, fontSize: 11, color: '#333', lineHeight: 1.55 }}>
                +4.50; −0.50/157<br />
                0.7 &nbsp;+4.75; −0.25/133<br />
                <b>0.7</b> &nbsp;+4.75; −0.25/16
              </div>
            </div>

            {/* IOP */}
            <div
              ref={setRef('r_iop') as any}
              style={secBarStyle('r_iop', ['iop'])}
              onMouseEnter={() => hoverGroups(['iop'])}
              onMouseLeave={leaveGroups}
            >IOP</div>
            <div style={{ display: 'flex', gap: 8, margin: '3px 0 5px' }}>
              <div style={{ flex: 1, fontSize: 11, color: '#7a5c00' }}>16 &nbsp;<span style={{ fontSize: 10, color: '#aaa' }}>vorh. 10:45</span>&nbsp; 12</div>
              <div style={{ flex: 1, fontSize: 11, color: '#333' }}>11 &nbsp;<span style={{ fontSize: 10, color: '#aaa' }}>GAT 10:00</span>&nbsp; 13</div>
            </div>

            {/* Spaltlampe */}
            <div
              ref={setRef('r_spalt') as any}
              style={secBarStyle('r_spalt', ['spalt'])}
              onMouseEnter={() => hoverGroups(['spalt'])}
              onMouseLeave={leaveGroups}
            >Spaltlampe</div>
            <div style={{ display: 'flex', gap: 8, margin: '3px 0 5px' }}>
              <div style={{ flex: 1, fontSize: 11, color: '#333', lineHeight: 1.55 }}>HH klar, VK normaltief, keine Zellen, Cat. incipiens, Iris regelrecht</div>
              <div style={{ flex: 1, fontSize: 11, color: '#333', lineHeight: 1.55 }}>HH klar, VK normaltief, keine Zellen, Cat. incipiens, Iris regelrecht</div>
            </div>

            {/* Fundus */}
            <div
              ref={setRef('r_fundus') as any}
              style={secBarStyle('r_fundus', ['fundus'])}
              onMouseEnter={() => hoverGroups(['fundus'])}
              onMouseLeave={leaveGroups}
            >Fundus</div>
            <div style={{ background: '#d4ecbc', textAlign: 'center', fontSize: 11, fontStyle: 'italic', padding: '2px 0', margin: '2px 0 3px', borderRadius: 2 }}>
              in Mydriase
            </div>
            <div style={{ display: 'flex', gap: 8, margin: '3px 0 5px' }}>
              <div style={{ flex: 1, fontSize: 11, color: '#333', lineHeight: 1.55 }}>Papille randscharf, Makula regelrecht, NH anliegend, keine Foramen</div>
              <div style={{ flex: 1, fontSize: 11, color: '#333', lineHeight: 1.55 }}>Papille randscharf, Makula regelrecht, NH anliegend, keine Foramen</div>
            </div>
          </div>
        </div>

        {/* ── Legend ── */}
        <div style={{ padding: '8px 12px 10px', background: '#f8f9fc', borderTop: '1px solid #e8e8e8', display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
          {(Object.entries(GROUPS) as [GroupId, typeof GROUPS[GroupId]][]).map(([gid, grp]) => (
            <div key={gid}
              style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: '#333', cursor: 'pointer' }}
              onMouseEnter={() => hoverGroups([gid])}
              onMouseLeave={leaveGroups}
            >
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: grp.color, flexShrink: 0, display: 'inline-block' }} />
              <span>{grp.label}</span>
            </div>
          ))}
        </div>

      </div>
    </NodeViewWrapper>
  )
}

// ── TipTap Node ───────────────────────────────────────────────────────────────

export const LirisDiagramBlock = Node.create({
  name: 'lirisDiagramBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {}
  },

  parseHTML() {
    return [{ tag: 'div[data-liris-diagram]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-liris-diagram': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(LirisDiagramView)
  },

  addCommands() {
    return {
      insertLirisDiagram:
        () =>
        ({ commands }: any) =>
          commands.insertContent({ type: this.name }),
    } as any
  },
})
