import { useRef, useState } from 'react'
import { X, Upload, Camera, Link } from 'lucide-react'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../lib/firebase'

interface Props {
  articleId: string
  onImage: (url: string) => void
  onClose: () => void
}

type Tab = 'upload' | 'camera' | 'url'

export default function ImagePicker({ articleId, onImage, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('upload')
  const [preview, setPreview] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  const handleTabChange = (tab: Tab) => {
    if (tab !== 'camera') stopCamera()
    setPreview(null)
    setError(null)
    setActiveTab(tab)
    if (tab === 'camera') startCamera()
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
    } catch {
      setError('Kamera konnte nicht gestartet werden.')
    }
  }

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg')
    setPreview(dataUrl)
    stopCamera()
  }

  const uploadBlob = async (blob: Blob) => {
    setUploading(true)
    setError(null)
    try {
      const timestamp = Date.now()
      const storageRef = ref(storage, `articles/${articleId}/${timestamp}.jpg`)
      await uploadBytes(storageRef, blob)
      const url = await getDownloadURL(storageRef)
      onImage(url)
      onClose()
    } catch {
      setError('Fehler beim Hochladen. Bitte erneut versuchen.')
      setUploading(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const confirmUpload = async () => {
    if (activeTab === 'upload') {
      const file = fileInputRef.current?.files?.[0]
      if (!file) return
      await uploadBlob(file)
    } else if (activeTab === 'camera') {
      if (!canvasRef.current) return
      canvasRef.current.toBlob(async (blob) => {
        if (blob) await uploadBlob(blob)
      }, 'image/jpeg', 0.9)
    } else if (activeTab === 'url') {
      if (!urlInput.trim()) return
      onImage(urlInput.trim())
      onClose()
    }
  }

  const handleClose = () => {
    stopCamera()
    onClose()
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'upload', label: 'Hochladen', icon: <Upload className="w-4 h-4" /> },
    { id: 'camera', label: 'Foto aufnehmen', icon: <Camera className="w-4 h-4" /> },
    { id: 'url', label: 'URL eingeben', icon: <Link className="w-4 h-4" /> },
  ]

  const canConfirm =
    (activeTab === 'upload' && preview !== null) ||
    (activeTab === 'camera' && preview !== null) ||
    (activeTab === 'url' && urlInput.trim() !== '')

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Bild hinzufügen</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-700 bg-primary-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="p-6 space-y-4">
          {/* Upload tab */}
          {activeTab === 'upload' && (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 rounded-xl py-8 flex flex-col items-center gap-2 text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors"
              >
                <Upload className="w-8 h-8" />
                <span className="text-sm font-medium">Datei auswählen</span>
                <span className="text-xs text-gray-400">JPG, PNG, WebP, GIF</span>
              </button>
              {preview && (
                <img src={preview} alt="Vorschau" className="w-full max-h-48 object-contain rounded-xl border border-gray-200" />
              )}
            </div>
          )}

          {/* Camera tab */}
          {activeTab === 'camera' && (
            <div className="space-y-3">
              {!preview ? (
                <>
                  <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '4/3' }}>
                    <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                  </div>
                  <canvas ref={canvasRef} className="hidden" />
                  <button
                    type="button"
                    onClick={captureFrame}
                    className="w-full btn-primary flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4" /> Foto aufnehmen
                  </button>
                </>
              ) : (
                <>
                  <img src={preview} alt="Vorschau" className="w-full max-h-48 object-contain rounded-xl border border-gray-200" />
                  <canvas ref={canvasRef} className="hidden" />
                  <button
                    type="button"
                    onClick={() => { setPreview(null); startCamera() }}
                    className="w-full btn-secondary"
                  >
                    Erneut aufnehmen
                  </button>
                </>
              )}
            </div>
          )}

          {/* URL tab */}
          {activeTab === 'url' && (
            <div className="space-y-3">
              <div>
                <label className="label">Bild-URL</label>
                <input
                  type="url"
                  className="input"
                  placeholder="https://example.com/bild.jpg"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                />
              </div>
              {urlInput && (
                <img
                  src={urlInput}
                  alt="Vorschau"
                  className="w-full max-h-48 object-contain rounded-xl border border-gray-200"
                  onError={() => setError('Bild konnte nicht geladen werden.')}
                  onLoad={() => setError(null)}
                />
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={handleClose}>
              Abbrechen
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!canConfirm || uploading}
              onClick={confirmUpload}
            >
              {uploading ? 'Hochladen…' : 'Bild verwenden'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
