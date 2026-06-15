import { useState, useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { Printer, X, ExternalLink, Check, Upload, FileText, Loader2 } from 'lucide-react'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

interface Props {
  eyeSide: 'OD' | 'OS'
  subtitle?: string
  withLiris?: boolean
  onClose: () => void
}

type Rect = { x: number; y: number; w: number; h: number }

interface TmplCfg {
  label: string
  url: string
  orientation: 'portrait' | 'landscape'
  pageW: string
  pageH: string
  odFade: Rect
  osFade: Rect
  timePositions: { x: number; y: number }[]
  textAngle: number
  timeFontPt: number
}

const TEMPLATES: Record<string, TmplCfg> = {
  hoch: {
    label: 'Vorlage 1',
    url: '/overlays/overlay-hoch.pdf',
    orientation: 'portrait',
    pageW: '21cm', pageH: '29.7cm',
    odFade: { x: 0.325, y: 0.024, w: 0.155, h: 0.063 },
    osFade: { x: 0.507, y: 0.024, w: 0.102, h: 0.063 },
    timePositions: [
      { x: 0.742, y: 0.031 },
      { x: 0.742, y: 0.045 },
      { x: 0.742, y: 0.059 },
      { x: 0.742, y: 0.073 },
      { x: 0.742, y: 0.087 },
    ],
    textAngle: 0,
    timeFontPt: 11,
  },
  quer: {
    label: 'Vorlage 2',
    url: '/overlays/overlay-quer.pdf',
    orientation: 'portrait',
    pageW: '21cm', pageH: '29.7cm',
    odFade: { x: 0.346, y: 0.047, w: 0.073, h: 0.092 },
    osFade: { x: 0.456, y: 0.047, w: 0.073, h: 0.092 },
    timePositions: [
      { x: 0.693, y: 0.042 },
      { x: 0.693, y: 0.062 },
      { x: 0.693, y: 0.082 },
      { x: 0.693, y: 0.102 },
      { x: 0.693, y: 0.122 },
    ],
    textAngle: 0,
    timeFontPt: 11,
  },
}

type TemplateKey = keyof typeof TEMPLATES

const PREVIEW_SCALE = 0.9
const PRINT_SCALE = 200 / 72

async function detectODOSFades(url: string): Promise<{ odFade: Rect; osFade: Rect } | null> {
  try {
    const resp = await fetch(url)
    const buf = await resp.arrayBuffer()
    const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise
    const page = await pdfDoc.getPage(1)
    const vp = page.getViewport({ scale: 1 })
    const W = vp.width, H = vp.height
    const tc = await page.getTextContent()

    const odBoxes: Rect[] = []
    const osBoxes: Rect[] = []

    for (const raw of tc.items) {
      if (!('str' in raw)) continue
      const item = raw as { str: string; transform: number[]; width: number; height: number }
      const { str, transform, width, height } = item
      if (!str.includes('OD') && !str.includes('OS')) continue

      const px = transform[4], py = transform[5]
      const pw = Math.abs(width), ph = Math.abs(height)
      const cx = px / W, cy = 1 - (py + ph) / H
      const cw = pw / W, ch = ph / H

      const hasOD = str.includes('OD'), hasOS = str.includes('OS')
      if (hasOD && hasOS) {
        const splitIdx = str.indexOf('|') >= 0 ? str.indexOf('|') : str.indexOf('OS')
        const ratio = splitIdx / str.length
        odBoxes.push({ x: cx,              y: cy, w: cw * ratio,       h: ch })
        osBoxes.push({ x: cx + cw * ratio, y: cy, w: cw * (1 - ratio), h: ch })
      } else if (hasOD) {
        odBoxes.push({ x: cx, y: cy, w: cw, h: ch })
      } else {
        osBoxes.push({ x: cx, y: cy, w: cw, h: ch })
      }
    }

    if (!odBoxes.length || !osBoxes.length) return null

    const PAD = 0.012
    const union = (boxes: Rect[]): Rect => {
      const x1 = Math.min(...boxes.map(b => b.x))
      const y1 = Math.min(...boxes.map(b => b.y))
      const x2 = Math.max(...boxes.map(b => b.x + b.w))
      const y2 = Math.max(...boxes.map(b => b.y + b.h))
      return { x: Math.max(0, x1 - PAD), y: Math.max(0, y1 - PAD), w: x2 - x1 + PAD * 2, h: y2 - y1 + PAD * 2 }
    }
    return { odFade: union(odBoxes), osFade: union(osBoxes) }
  } catch { return null }
}

async function renderPdfToCanvas(url: string, scale: number): Promise<HTMLCanvasElement> {
  const resp = await fetch(url)
  const buf = await resp.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const page = await pdf.getPage(1)
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = vp.width
  canvas.height = vp.height
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
  return canvas
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

async function buildCombinedCanvas(
  cfg: TmplCfg,
  eyeSide: 'OD' | 'OS',
  drops: string[],
  lirisDataUrl: string | null,
  scale = PRINT_SCALE
): Promise<string> {
  const tmplCanvas = await renderPdfToCanvas(cfg.url, scale)
  const W = tmplCanvas.width, H = tmplCanvas.height

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  if (lirisDataUrl) {
    const lirisImg = await loadImage(lirisDataUrl)
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(lirisImg, 0, 0, W, H)
    ctx.globalCompositeOperation = 'source-over'
  }

  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(tmplCanvas, 0, 0)
  ctx.globalCompositeOperation = 'source-over'

  const fontPx = cfg.timeFontPt * scale
  ctx.fillStyle = '#000000'
  ctx.font = `bold ${fontPx}px Arial, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  drops.forEach((t, i) => {
    if (!t) return
    const pos = cfg.timePositions[i]
    ctx.save()
    ctx.translate(pos.x * W, pos.y * H)
    if (cfg.textAngle !== 0) ctx.rotate(cfg.textAngle)
    ctx.fillText(t, 0, 0)
    ctx.restore()
  })

  return canvas.toDataURL('image/jpeg', 0.92)
}

export default function IVIOverlayModal({ eyeSide: initialEye, subtitle, withLiris, onClose }: Props) {
  const eyeSide = initialEye
  const [lirisOpened, setLirisOpened]   = useState(false)
  const [lirisDataUrl, setLirisDataUrl] = useState<string | null>(null)
  const [lirisFileName, setLirisFileName] = useState<string | null>(null)
  const [lirisLoading, setLirisLoading] = useState(false)
  const [dragging, setDragging]         = useState(false)
  const [selectedTmpl, setSelectedTmpl] = useState<TemplateKey>('hoch')
  const [thumbnails, setThumbnails]     = useState<Partial<Record<TemplateKey, string>>>({})
  const [detectedFades, setDetectedFades] = useState<Partial<Record<TemplateKey, { odFade: Rect; osFade: Rect }>>>({})
  const [printing, setPrinting]         = useState(false)
  const [previewUrl, setPreviewUrl]     = useState<string | null>(null)
  const [previewBuilding, setPreviewBuilding] = useState(false)
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const buildCountRef = useRef(0)

  function getActiveCfg(key: TemplateKey): TmplCfg {
    const base = TEMPLATES[key]
    const detected = detectedFades[key]
    return detected ? { ...base, ...detected } : base
  }

  useEffect(() => {
    ;(async () => {
      const thumbs: Partial<Record<TemplateKey, string>> = {}
      const fades: Partial<Record<TemplateKey, { odFade: Rect; osFade: Rect }>> = {}
      for (const key of Object.keys(TEMPLATES) as TemplateKey[]) {
        try {
          const [c, detected] = await Promise.all([
            renderPdfToCanvas(TEMPLATES[key].url, 0.28),
            detectODOSFades(TEMPLATES[key].url),
          ])
          thumbs[key] = c.toDataURL('image/jpeg', 0.80)
          if (detected) fades[key] = detected
        } catch { /* ignore */ }
      }
      setThumbnails(thumbs)
      setDetectedFades(fades)
    })()
  }, [])

  function triggerPreview(key: TemplateKey, liris: string | null) {
    setPreviewBuilding(true)
    const id = ++buildCountRef.current
    const cfg = getActiveCfg(key)
    ;(async () => {
      try {
        const url = await buildCombinedCanvas(cfg, eyeSide, [], liris, PREVIEW_SCALE)
        if (buildCountRef.current === id) { setPreviewUrl(url); setPreviewBuilding(false) }
      } catch {
        if (buildCountRef.current === id) setPreviewBuilding(false)
      }
    })()
  }

  useEffect(() => {
    triggerPreview(selectedTmpl, lirisDataUrl)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTmpl, lirisDataUrl, detectedFades])

  function openLiris() {
    window.open('https://vip.liris.ch', 'liris_ivom', 'width=1400,height=900')
    setLirisOpened(true)
  }

  function removeLiris() {
    setLirisDataUrl(null); setLirisFileName(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleLirisFile(file: File) {
    if (file.type !== 'application/pdf') return
    setLirisLoading(true); setLirisFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise
      const page = await pdf.getPage(1)
      const vp = page.getViewport({ scale: PRINT_SCALE })
      const c = document.createElement('canvas')
      c.width = vp.width; c.height = vp.height
      await page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp }).promise
      setLirisDataUrl(c.toDataURL('image/jpeg', 0.92))
    } catch (e) { console.error(e) }
    setLirisLoading(false)
  }

  async function handlePrint() {
    setPrinting(true)
    try {
      const cfg = getActiveCfg(selectedTmpl)
      const dataUrl = await buildCombinedCanvas(cfg, eyeSide, [], lirisDataUrl, PRINT_SCALE)
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        @page { size: A4 ${cfg.orientation}; margin: 0; }
        * { margin: 0; padding: 0; }
        body { width: ${cfg.pageW}; height: ${cfg.pageH}; }
        img { display: block; width: ${cfg.pageW}; height: ${cfg.pageH}; }
      </style></head><body><img src="${dataUrl}" /></body></html>`
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;border:none;'
      document.body.appendChild(iframe)
      iframe.contentDocument!.open()
      iframe.contentDocument!.write(html)
      iframe.contentDocument!.close()
      iframe.onload = () => {
        iframe.contentWindow!.focus()
        iframe.contentWindow!.print()
        setTimeout(() => iframe.remove(), 1000)
      }
    } finally { setPrinting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl flex flex-col overflow-hidden" style={{ maxHeight: '95vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Tropf-Overlay drucken</h3>
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Left: Controls */}
          <div className="w-72 flex-shrink-0 overflow-y-auto p-5 space-y-5 border-r border-gray-100">

            {withLiris && (
              <div className="flex items-center gap-3 px-3 py-3 rounded-xl border border-blue-100 bg-blue-50">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${lirisOpened ? 'bg-green-500 text-white' : 'bg-blue-500 text-white'}`}>
                  {lirisOpened ? <Check className="w-3.5 h-3.5" /> : '1'}
                </div>
                <p className="text-xs text-gray-700 flex-1">
                  Liris → Patient → <span className="font-semibold">PDF speichern</span>
                </p>
                <button onClick={openLiris}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${lirisOpened ? 'text-green-700 bg-green-100 hover:bg-green-200' : 'text-white bg-blue-600 hover:bg-blue-700'}`}>
                  <ExternalLink className="w-3 h-3" />
                  {lirisOpened ? 'Nochmals' : 'Öffnen'}
                </button>
              </div>
            )}

            {/* Template selection */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {withLiris ? '2 · ' : ''}Vorlage
              </p>
              <div className="flex gap-2">
                {(Object.keys(TEMPLATES) as TemplateKey[]).map(key => {
                  const t = TEMPLATES[key]
                  const isSelected = selectedTmpl === key
                  return (
                    <button key={key} onClick={() => setSelectedTmpl(key)}
                      className={`flex-1 flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all ${isSelected ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <div className="rounded overflow-hidden border shadow-sm bg-gray-50 flex items-center justify-center w-11 h-16">
                        {thumbnails[key]
                          ? <img src={thumbnails[key]} alt={t.label} className="w-full h-full object-contain" />
                          : <Loader2 className="w-3 h-3 animate-spin text-gray-300" />
                        }
                      </div>
                      <span className={`text-xs font-semibold ${isSelected ? 'text-primary-700' : 'text-gray-500'}`}>
                        {t.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Liris PDF upload */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {withLiris ? '3 · ' : ''}Liris-Dokument (optional)
              </p>
              {!lirisDataUrl ? (
                <div
                  onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleLirisFile(f) }}
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-colors ${dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'}`}>
                  {lirisLoading
                    ? <div className="flex items-center justify-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-xs">Wird geladen…</span></div>
                    : <div className="flex items-center justify-center gap-2 text-gray-400"><Upload className="w-3.5 h-3.5" /><span className="text-xs">PDF ablegen oder klicken</span></div>
                  }
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-green-200 bg-green-50">
                  <FileText className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <p className="text-xs text-gray-700 font-medium flex-1 truncate">{lirisFileName}</p>
                  <button onClick={removeLiris} className="text-xs text-red-500 hover:text-red-600 font-medium flex-shrink-0">✕</button>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleLirisFile(f) }} />
            </div>

          </div>

          {/* Right: Live preview */}
          <div className="flex-1 overflow-auto bg-gray-100 flex items-start justify-center p-5">
            {previewUrl ? (
              <div className="relative">
                <img src={previewUrl} alt="Vorschau"
                  className={`shadow-xl rounded block transition-opacity ${previewBuilding ? 'opacity-40' : 'opacity-100'}`}
                  style={{ width: '100%', maxWidth: '380px' }} />
                {previewBuilding && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-400 mt-16">
                <Loader2 className="w-6 h-6 animate-spin" />
                <p className="text-sm">Vorschau wird erstellt…</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={handlePrint} disabled={printing}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            {printing ? 'Wird aufbereitet…' : 'Drucken'}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  )
}
