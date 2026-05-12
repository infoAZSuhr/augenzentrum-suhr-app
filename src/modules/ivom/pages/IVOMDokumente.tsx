import { useState, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, Trash2, ExternalLink, X, Eye, AlertCircle, Printer } from 'lucide-react'
import { ref, getBlob } from 'firebase/storage'
import { storage } from '../../../lib/firebase'
import {
  getDocuments, uploadDocument, deleteDocument,
  formatFileSize, fileIcon, type AppDocument,
} from '../../../lib/firestoreDocuments'
import { useAuth } from '../../../lib/AuthContext'
import PageHeader from '../../../components/ui/PageHeader'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'

const MODULE = 'ivom'

interface UploadEntry {
  id: string
  name: string
  progress: number
  done: boolean
  error?: string
  cancel?: () => void
}

function PreviewModal({ doc, onClose }: { doc: AppDocument; onClose: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [printing, setPrinting] = useState(false)

  const handlePrint = async () => {
    setPrinting(true)
    try {
      const blob = await getBlob(ref(storage, doc.storagePath))
      const blobUrl = URL.createObjectURL(blob)
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0'
      document.body.appendChild(iframe)
      iframe.src = blobUrl
      iframe.onload = () => {
        iframe.contentWindow?.print()
        setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(blobUrl) }, 60000)
        setPrinting(false)
      }
    } catch (e) {
      console.error('Print failed:', e)
      setPrinting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60" onClick={onClose}>
      <div
        className="flex flex-col flex-1 m-4 bg-white rounded-xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
          <span className="text-lg">{fileIcon(doc.mimeType, doc.name)}</span>
          <span className="font-medium text-gray-800 flex-1 truncate">{doc.name}</span>

          <a
            href={doc.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Öffnen
          </a>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <iframe
          ref={iframeRef}
          src={doc.downloadUrl}
          className="flex-1 w-full border-0"
          title={doc.name}
        />
      </div>
    </div>
  )
}

export default function IVOMDokumente() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploads, setUploads] = useState<UploadEntry[]>([])
  const [deleteTarget, setDeleteTarget] = useState<AppDocument | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [preview, setPreview] = useState<AppDocument | null>(null)

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', MODULE],
    queryFn: () => getDocuments(MODULE),
  })

  const uploadedBy = profile?.displayName ?? profile?.username

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(file => {
      const id = `${Date.now()}-${Math.random()}`
      setUploads(prev => [...prev, { id, name: file.name, progress: 0, done: false }])

      const { promise, cancel } = uploadDocument(file, MODULE, uploadedBy, progress =>
        setUploads(u => u.map(e => e.id === id ? { ...e, progress } : e))
      )
      setUploads(u => u.map(e => e.id === id ? { ...e, cancel } : e))

      promise
        .then(() => {
          setUploads(u => u.map(e => e.id === id ? { ...e, done: true, progress: 100, cancel: undefined } : e))
          qc.invalidateQueries({ queryKey: ['documents', MODULE] })
        })
        .catch((err: Error) => {
          if (err.message?.includes('cancel')) {
            setUploads(u => u.filter(e => e.id !== id))
          } else {
            setUploads(u => u.map(e => e.id === id ? { ...e, error: err.message, cancel: undefined } : e))
          }
        })
    })
  }, [uploadedBy, qc])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteDocument(deleteTarget)
      qc.invalidateQueries({ queryKey: ['documents', MODULE] })
    } catch (e: any) {
      alert('Fehler beim Löschen: ' + e.message)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const printDoc = async (doc: AppDocument) => {
    try {
      const blob = await getBlob(ref(storage, doc.storagePath))
      const blobUrl = URL.createObjectURL(blob)
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0'
      document.body.appendChild(iframe)
      iframe.src = blobUrl
      iframe.onload = () => {
        iframe.contentWindow?.print()
        setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(blobUrl) }, 60000)
      }
    } catch (e) {
      console.error('Print failed:', e)
    }
  }

  const formatDate = (ts: any) => {
    if (!ts) return '—'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  return (
    <div>
      <PageHeader
        title="Dokumente"
        subtitle={`${documents.length} Dokument${documents.length !== 1 ? 'e' : ''}`}
      />

      <div className="p-3 sm:p-6 space-y-4 max-w-4xl">

        {/* Drop zone */}
        <div
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
            ${dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'}`}
        >
          <Upload className={`w-8 h-8 mx-auto mb-2 ${dragging ? 'text-primary-500' : 'text-gray-300'}`} />
          <p className="text-sm font-medium text-gray-600">Dateien hier ablegen oder klicken</p>
          <p className="text-xs text-gray-400 mt-1">PDF, Word, Bilder, Excel – beliebige Dateien</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => { if (e.target.files) { handleFiles(e.target.files); e.target.value = '' } }}
          />
        </div>

        {/* Upload progress */}
        {uploads.length > 0 && (
          <div className="space-y-2">
            {uploads.map(u => (
              <div key={u.id} className="card p-3 flex items-center gap-3">
                <span className="text-lg shrink-0">{u.done ? '✅' : u.error ? '❌' : '⬆️'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{u.name}</p>
                  {!u.done && !u.error && (
                    <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 transition-all duration-200 rounded-full"
                        style={{ width: `${u.progress}%` }}
                      />
                    </div>
                  )}
                  {u.error && (
                    <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0" /> {u.error}
                    </p>
                  )}
                  {u.done && <p className="text-xs text-green-600 mt-0.5">Hochgeladen</p>}
                </div>
                {u.cancel && (
                  <button onClick={() => u.cancel!()} className="p-1 text-gray-400 hover:text-red-500 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                )}
                {(u.done || u.error) && (
                  <button onClick={() => setUploads(us => us.filter(e => e.id !== u.id))} className="p-1 text-gray-400 hover:text-gray-600 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Document list */}
        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">Laden…</div>
          ) : documents.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Upload className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm text-gray-400">Noch keine Dokumente hochgeladen.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Grösse</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Datum</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Von</th>
                  <th className="w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {documents.map(doc => (
                  <tr key={doc.id} className="hover:bg-gray-50 group">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setPreview(doc)}
                        className="flex items-center gap-2 font-medium text-gray-800 hover:text-primary-700 text-left w-full"
                      >
                        <span className="text-lg leading-none shrink-0">{fileIcon(doc.mimeType, doc.name)}</span>
                        <span className="truncate">{doc.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                      {formatFileSize(doc.size)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                      {formatDate(doc.uploadedAt)}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">
                      {doc.uploadedBy || '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setPreview(doc)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                          title="Vorschau"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => printDoc(doc)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                          title="Drucken"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <a
                          href={doc.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                          title="Öffnen"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                        <button
                          onClick={() => setDeleteTarget(doc)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Löschen"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}

      {deleteTarget && (
        <ConfirmDialog
          title="Dokument löschen?"
          message={`«${deleteTarget.name}» wird dauerhaft gelöscht.`}
          confirmLabel="Löschen"
          isLoading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
