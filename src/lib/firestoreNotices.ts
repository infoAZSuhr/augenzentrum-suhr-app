import {
  collection, doc, addDoc, setDoc, getDocs,
  query, orderBy, onSnapshot, serverTimestamp, where, writeBatch,
} from 'firebase/firestore'
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from './firebase'

export type NoticeType  = 'info' | 'warnung' | 'wichtig'
export type NoticeBoard = 'alle' | 'mpa' | 'arzt' | 'gl' | 'admin'

export const ALL_BOARDS: NoticeBoard[] = ['alle', 'mpa', 'arzt', 'gl', 'admin']

export const BOARD_LABEL: Record<NoticeBoard, string> = {
  alle:  'Alle',
  mpa:   'MPA',
  arzt:  'Arzt',
  gl:    'GL',
  admin: 'Admin',
}

export interface NoticeAttachment {
  name: string
  url: string
  storagePath: string
  size: number  // bytes
}

export interface Notice {
  id: string
  title: string
  text: string
  type: NoticeType
  board: NoticeBoard       // defaults to 'alle' for legacy notices
  createdAt: any
  createdByName: string
  attachment?: NoticeAttachment
}

export interface NoticeRead {
  noticeId: string
  username: string
  readAt: any
  pinned: boolean
  markedUnread: boolean
}

const N_COL  = 'notices'
const NR_COL = 'notice_reads'

function safeUser(u: string) { return u.replace(/[^a-zA-Z0-9]/g, '_') }
function readDocId(noticeId: string, username: string) { return `${noticeId}_${safeUser(username)}` }

/** Upload a PDF to Storage and return attachment metadata. onProgress(0–100). */
export function uploadNoticeAttachment(
  file: File,
  onProgress: (pct: number) => void
): { promise: Promise<NoticeAttachment>; cancel: () => void } {
  const storagePath = `notices/${Date.now()}_${file.name}`
  const storageRef  = ref(storage, storagePath)
  const task        = uploadBytesResumable(storageRef, file)

  task.on('state_changed', snap =>
    onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100))
  )

  const promise = new Promise<NoticeAttachment>((resolve, reject) => {
    task.then(async () => {
      const url = await getDownloadURL(storageRef)
      resolve({ name: file.name, url, storagePath, size: file.size })
    }).catch(reject)
  })

  return { promise, cancel: () => task.cancel() }
}

export async function addNotice(data: {
  title: string; text: string; type: NoticeType; board: NoticeBoard; createdByName: string
  attachment?: NoticeAttachment
}): Promise<string> {
  const ref = await addDoc(collection(db, N_COL), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export async function deleteNotice(id: string, attachment?: NoticeAttachment): Promise<void> {
  // Delete storage file if present
  if (attachment?.storagePath) {
    try { await deleteObject(ref(storage, attachment.storagePath)) } catch { /* ignore */ }
  }
  const reads = await getDocs(query(collection(db, NR_COL), where('noticeId', '==', id)))
  const batch = writeBatch(db)
  reads.docs.forEach(d => batch.delete(d.ref))
  batch.delete(doc(db, N_COL, id))
  await batch.commit()
}

export function subscribeNotices(cb: (notices: Notice[]) => void): () => void {
  return onSnapshot(
    query(collection(db, N_COL), orderBy('createdAt', 'desc')),
    snap => cb(snap.docs.map(d => {
      const data = d.data()
      return { id: d.id, board: 'alle', ...data } as Notice  // 'alle' default for legacy
    }))

  )
}

export function subscribeUserReads(
  username: string,
  cb: (reads: Record<string, NoticeRead>) => void
): () => void {
  return onSnapshot(
    query(collection(db, NR_COL), where('username', '==', username)),
    snap => {
      const map: Record<string, NoticeRead> = {}
      snap.docs.forEach(d => { const r = d.data() as NoticeRead; map[r.noticeId] = r })
      cb(map)
    }
  )
}

export async function getNoticeReaders(noticeId: string): Promise<{ username: string; readAt: any }[]> {
  const snap = await getDocs(query(collection(db, NR_COL), where('noticeId', '==', noticeId)))
  return snap.docs
    .map(d => d.data() as NoticeRead)
    .filter(r => r.readAt && !r.markedUnread)
    .sort((a, b) => (a.readAt?.toMillis?.() ?? 0) - (b.readAt?.toMillis?.() ?? 0))
    .map(r => ({ username: r.username, readAt: r.readAt }))
}

export async function setNoticeRead(noticeId: string, username: string): Promise<void> {
  await setDoc(doc(db, NR_COL, readDocId(noticeId, username)), {
    noticeId, username, readAt: serverTimestamp(), pinned: false, markedUnread: false,
  }, { merge: true })
}

export async function setNoticePin(noticeId: string, username: string, pinned: boolean): Promise<void> {
  await setDoc(doc(db, NR_COL, readDocId(noticeId, username)), {
    noticeId, username, pinned,
    ...(pinned ? { readAt: serverTimestamp(), markedUnread: false } : {}),
  }, { merge: true })
}

export async function setNoticeUnread(noticeId: string, username: string): Promise<void> {
  await setDoc(doc(db, NR_COL, readDocId(noticeId, username)), {
    noticeId, username, markedUnread: true,
  }, { merge: true })
}
