import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, NotFoundException, DecodeHintType, BarcodeFormat } from '@zxing/library'
import { X, Camera, CameraOff } from 'lucide-react'

export interface ParsedBarcode {
  raw: string       // original scanned text
  format: string    // detected barcode format
  value: string     // best single value (GTIN if GS1, else raw)
  gtin?: string     // GS1-128 AI (01) or EAN-13/8/UPC
  lot?: string      // GS1-128 AI (10)
  expiry?: string   // GS1-128 AI (17) → YYYY-MM-DD
}

/** Parst GS1-128 Application Identifiers aus dem Barcode-Text */
function parseGs1(s: string): Partial<ParsedBarcode> {
  // FNC1 / GS-Zeichen entfernen
  const clean = s.replace(/[\x1d\x1e\x04]/g, '')
  const result: Partial<ParsedBarcode> = {}

  // Format mit Klammern: (01)...(10)...(17)...
  if (clean.includes('(')) {
    const gtin = clean.match(/\(01\)(\d{14})/)
    const lot  = clean.match(/\(10\)([^\(]+)/)
    const exp  = clean.match(/\(17\)(\d{6})/)
    if (gtin) result.gtin = gtin[1]
    if (lot)  result.lot  = lot[1].trim()
    if (exp)  result.expiry = `20${exp[1].slice(0,2)}-${exp[1].slice(2,4)}-${exp[1].slice(4,6)}`
    return result
  }

  // Format ohne Klammern: feste/variable Längen parsen
  let i = 0
  while (i < clean.length) {
    const ai2 = clean.slice(i, i + 2)
    const ai4 = clean.slice(i, i + 4)
    if (ai2 === '01' && clean.length - i >= 16) {
      result.gtin = clean.slice(i + 2, i + 16); i += 16
    } else if (ai2 === '10') {
      // variable Länge bis GS oder Ende
      const end = clean.indexOf('\x1d', i + 2)
      result.lot = end === -1 ? clean.slice(i + 2) : clean.slice(i + 2, end)
      i = end === -1 ? clean.length : end + 1
    } else if (ai2 === '17' && clean.length - i >= 8) {
      const d = clean.slice(i + 2, i + 8)
      result.expiry = `20${d.slice(0,2)}-${d.slice(2,4)}-${d.slice(4,6)}`; i += 8
    } else if (ai4 === '3102' || ai4 === '3103') {
      i += 10 // Nettogewicht — überspringen
    } else {
      i++ // unbekannter AI — vorwärts
    }
  }
  return result
}

function parseBarcode(raw: string, fmt: BarcodeFormat): ParsedBarcode {
  const result: ParsedBarcode = { raw, format: BarcodeFormat[fmt] ?? String(fmt), value: raw }

  if (fmt === BarcodeFormat.CODE_128 || fmt === BarcodeFormat.DATA_MATRIX) {
    const gs1 = parseGs1(raw)
    if (gs1.gtin || gs1.lot || gs1.expiry) {
      Object.assign(result, gs1)
      result.value = gs1.gtin ?? raw
      return result
    }
  }
  // EAN / UPC direkt als GTIN verwenden
  if ([BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E].includes(fmt)) {
    result.gtin = raw
    result.value = raw
  }
  return result
}

interface Props {
  onResult: (result: ParsedBarcode) => void
  onClose: () => void
}

export default function BarcodeScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  useEffect(() => {
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.ITF,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.PDF_417,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ])
    hints.set(DecodeHintType.TRY_HARDER, true)

    const reader = new BrowserMultiFormatReader(hints)
    readerRef.current = reader
    setScanning(true)
    setError(null)

    const constraints: MediaStreamConstraints = {
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    }

    let stream: MediaStream | null = null
    let active = true

    navigator.mediaDevices.getUserMedia(constraints)
      .then(s => {
        if (!active) { s.getTracks().forEach(t => t.stop()); return }
        stream = s
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        video.play().catch(() => {})
        reader.decodeFromStream(stream, video, (result, err) => {
          if (!active) return
          if (result) {
            active = false
            onResultRef.current(parseBarcode(result.getText(), result.getBarcodeFormat()))
          } else if (err && !(err instanceof NotFoundException)) {
            setError('Kamera-Fehler: ' + err.message)
            setScanning(false)
          }
        })
      })
      .catch(() => {
        setError('Kein Kamerazugriff. Bitte GTIN manuell eingeben.')
        setScanning(false)
      })

    return () => {
      active = false
      try { reader.reset() } catch (_) {}
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            {scanning ? <Camera className="w-4 h-4 text-green-600 animate-pulse" /> : <CameraOff className="w-4 h-4 text-gray-400" />}
            <h3 className="font-medium text-gray-900 text-sm">Barcode / QR-Code scannen</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="relative bg-black">
          <video ref={videoRef} className="w-full h-72 object-cover" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative" style={{ width: '82%', height: '38%' }}>
              <span className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-2 border-l-2 border-green-400 rounded-tl" />
              <span className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-2 border-r-2 border-green-400 rounded-tr" />
              <span className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-2 border-l-2 border-green-400 rounded-bl" />
              <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-2 border-r-2 border-green-400 rounded-br" />
              <div className="absolute left-0 right-0 top-1/2 h-px bg-green-400/40" />
              {scanning && (
                <div className="absolute left-0 right-0 h-0.5 bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.6)] animate-[scan_2s_ease-in-out_infinite]" />
              )}
            </div>
          </div>
          <div className="absolute inset-0 pointer-events-none" style={{
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.45) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.45) 75%)'
          }} />
        </div>

        <div className="px-4 py-3">
          {error ? (
            <p className="text-sm text-red-600 text-center">{error}</p>
          ) : (
            <p className="text-xs text-gray-500 text-center">EAN · Code128 · GS1-128 · QR-Code — Barcode vollständig in den Rahmen halten</p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes scan {
          0%, 100% { top: 0; }
          50% { top: calc(100% - 2px); }
        }
      `}</style>
    </div>
  )
}
