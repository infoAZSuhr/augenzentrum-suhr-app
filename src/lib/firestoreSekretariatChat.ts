import {
  collection, doc, addDoc, setDoc, updateDoc, getDoc,
  serverTimestamp, query, orderBy, onSnapshot, Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './firebase'

export type ChatStatus = 'open' | 'closed'

export interface SekretariatChat {
  id: string
  visitorUid: string
  visitorName: string
  visitorPhone?: string
  status: ChatStatus
  createdAt: Timestamp | null
  lastMessageAt: Timestamp | null
  lastMessagePreview: string
  unreadByStaff: boolean
  unreadByVisitor: boolean
  /** UID des MPA, der die Konversation übernommen hat. Null = noch in Warteschlange. */
  assignedToUid?: string | null
  assignedToName?: string | null
  assignedAt?: Timestamp | null
}

export interface SekretariatMessage {
  id: string
  sender: 'visitor' | 'staff'
  staffName?: string
  text: string
  createdAt: Timestamp | null
}

const COL = 'sekretariatChats'

export function subscribeAllChats(cb: (chats: SekretariatChat[]) => void): Unsubscribe {
  const q = query(collection(db, COL), orderBy('lastMessageAt', 'desc'))
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<SekretariatChat, 'id'>) })))
  })
}

export function subscribeChat(conversationId: string, cb: (chat: SekretariatChat | null) => void): Unsubscribe {
  return onSnapshot(doc(db, COL, conversationId), snap => {
    cb(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<SekretariatChat, 'id'>) }) : null)
  })
}

export function subscribeMessages(conversationId: string, cb: (msgs: SekretariatMessage[]) => void): Unsubscribe {
  const q = query(collection(db, COL, conversationId, 'messages'), orderBy('createdAt', 'asc'))
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<SekretariatMessage, 'id'>) })))
  })
}

export async function createChat(params: {
  visitorUid: string
  visitorName: string
  visitorPhone?: string
}): Promise<void> {
  await setDoc(doc(db, COL, params.visitorUid), {
    visitorUid: params.visitorUid,
    visitorName: params.visitorName,
    visitorPhone: params.visitorPhone ?? '',
    status: 'open',
    createdAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: '',
    unreadByStaff: false,
    unreadByVisitor: false,
    assignedToUid: null,
    assignedToName: null,
    assignedAt: null,
  })
}

export async function acceptChat(conversationId: string, staffUid: string, staffName: string): Promise<void> {
  await updateDoc(doc(db, COL, conversationId), {
    assignedToUid: staffUid,
    assignedToName: staffName,
    assignedAt: serverTimestamp(),
  })
}

export async function releaseChat(conversationId: string): Promise<void> {
  await updateDoc(doc(db, COL, conversationId), {
    assignedToUid: null,
    assignedToName: null,
    assignedAt: null,
  })
}

export async function sendVisitorMessage(conversationId: string, text: string): Promise<void> {
  await addDoc(collection(db, COL, conversationId, 'messages'), {
    sender: 'visitor',
    text,
    createdAt: serverTimestamp(),
  })
  await updateDoc(doc(db, COL, conversationId), {
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: text.slice(0, 120),
    unreadByStaff: true,
    unreadByVisitor: false,
    status: 'open',
  })
}

export async function sendStaffMessage(conversationId: string, text: string, staffName: string): Promise<void> {
  await addDoc(collection(db, COL, conversationId, 'messages'), {
    sender: 'staff',
    staffName,
    text,
    createdAt: serverTimestamp(),
  })
  await updateDoc(doc(db, COL, conversationId), {
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: text.slice(0, 120),
    unreadByStaff: false,
    unreadByVisitor: true,
  })
}

export async function markReadByStaff(conversationId: string): Promise<void> {
  await updateDoc(doc(db, COL, conversationId), { unreadByStaff: false })
}

export async function markReadByVisitor(conversationId: string): Promise<void> {
  await updateDoc(doc(db, COL, conversationId), { unreadByVisitor: false })
}

export async function closeChat(conversationId: string): Promise<void> {
  await updateDoc(doc(db, COL, conversationId), { status: 'closed' })
}

export async function reopenChat(conversationId: string): Promise<void> {
  await updateDoc(doc(db, COL, conversationId), { status: 'open' })
}

export async function chatExists(conversationId: string): Promise<boolean> {
  const snap = await getDoc(doc(db, COL, conversationId))
  return snap.exists()
}
