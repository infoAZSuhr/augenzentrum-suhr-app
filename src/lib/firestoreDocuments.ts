import {
  collection, doc, addDoc, getDocs, deleteDoc,
  query, where, serverTimestamp,
} from 'firebase/firestore'
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from 'firebase/storage'
import { db, storage } from './firebase'

export interface AppDocument {
  id: string
  name: string
  originalName: string
  size: number
  mimeType: string
  module: string
  storagePath: string
  downloadUrl: string
  uploadedAt: any
  uploadedBy?: string
}

const col = () => collection(db, 'documents')

export async function getDocuments(module: string): Promise<AppDocument[]> {
  const snap = await getDocs(query(col(), where('module', '==', module)))
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as AppDocument))
  return docs.sort((a, b) => {
    const tsA = (a as any).uploadedAt ?? (a as any).addedAt
    const tsB = (b as any).uploadedAt ?? (b as any).addedAt
    const ta = tsA?.toDate?.() ?? new Date(tsA ?? 0)
    const tb = tsB?.toDate?.() ?? new Date(tsB ?? 0)
    return tb.getTime() - ta.getTime()
  })
}

export function uploadDocument(
  file: File,
  module: string,
  uploadedBy: string | undefined,
  onProgress: (pct: number) => void,
): { promise: Promise<AppDocument>; cancel: () => void } {
  const storagePath = `documents/${module}/${Date.now()}_${file.name}`
  const storageRef = ref(storage, storagePath)
  const task = uploadBytesResumable(storageRef, file)

  task.on('state_changed', snap => {
    onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100))
  })

  const promise = new Promise<AppDocument>((resolve, reject) => {
    task.then(async () => {
      const downloadUrl = await getDownloadURL(storageRef)
      const docData = {
        name: file.name,
        originalName: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        module,
        storagePath,
        downloadUrl,
        uploadedAt: serverTimestamp(),
        ...(uploadedBy ? { uploadedBy } : {}),
      }
      const docRef = await addDoc(col(), docData)
      resolve({ id: docRef.id, ...docData, uploadedAt: new Date() } as AppDocument)
    }).catch(reject)
  })

  return { promise, cancel: () => task.cancel() }
}

export async function deleteDocument(doc_: AppDocument): Promise<void> {
  if (doc_.storagePath) {
    try {
      await deleteObject(ref(storage, doc_.storagePath))
    } catch {
      // ignore if already deleted
    }
  }
  await deleteDoc(doc(db, 'documents', doc_.id))
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fileIcon(mimeType: string, name?: string): string {
  const n = (name ?? '').toLowerCase()
  if (mimeType === 'application/pdf' || n.endsWith('.pdf')) return '📄'
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.includes('word') || n.endsWith('.docx') || n.endsWith('.doc')) return '📝'
  if (mimeType.includes('excel') || n.endsWith('.xlsx') || n.endsWith('.xls')) return '📊'
  if (mimeType.includes('powerpoint') || n.endsWith('.pptx') || n.endsWith('.ppt')) return '📊'
  return '📎'
}
