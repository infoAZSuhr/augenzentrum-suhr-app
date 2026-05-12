import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, where, orderBy, onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './firebase'

export interface TaskLabel {
  id: string
  name: string
  color: string
}

export interface TaskColumn {
  id: string
  name: string
  order: number
}

export type BoardVisibility = 'all' | 'mpa' | 'arzt' | 'managers' | 'creator' | 'user' | 'gl'

export interface TaskBoard {
  id: string
  name: string
  description: string
  color: string
  columns: TaskColumn[]
  visibleTo: BoardVisibility
  visibleToUid?: string
  visibleToName?: string
  visibleToUids?: string[]   // multi-person selection
  visibleToNames?: string[]  // display names for all selected users
  createdBy: string
  createdByUid: string
  createdAt: unknown
}

export interface TaskCard {
  id: string
  boardId: string
  columnId: string
  title: string
  description: string
  order: number
  dueDate: string | null
  labels: TaskLabel[]
  assigneeType: 'user' | 'group' | 'self' | 'none'
  assigneeKey: string
  assigneeName: string
  assigneeRole: string
  done: boolean
  attachments: TaskAttachment[]
  checklist: ChecklistItem[]
  members: TaskMember[]
  createdBy: string
  createdByUid: string
  createdAt: unknown
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
  doneBy?: string
  doneByUid?: string
}

export interface PollOption {
  id: string
  text: string
  votes: string[] // UIDs
}

export interface StandalonePoll {
  id: string
  question: string
  options: PollOption[]
  multiSelect: boolean
  dueDate: string | null
  visibleTo: BoardVisibility
  visibleToUid?: string
  visibleToName?: string
  visibleToUids?: string[]
  visibleToNames?: string[]
  createdBy: string
  createdByUid: string
  createdAt: unknown
}

export interface TaskMember {
  uid: string
  name: string
}

export interface TaskAttachment {
  id: string
  name: string
  url: string
  type: string
  size: number
  storagePath: string
  uploadedBy: string
}

export interface TaskComment {
  id: string
  cardId: string
  boardId: string
  text: string
  authorUid: string
  authorName: string
  createdAt: unknown
}

export interface TaskNotification {
  id: string
  type?: 'assignment' | 'comment' | 'board_assignment' | 'poll_assignment'
  recipientUid: string
  cardId: string
  boardId: string
  cardTitle: string
  boardName: string
  assignerName: string
  read: boolean
  createdAt: unknown
}

export const BOARD_COLORS = [
  { id: 'blue',    bg: 'bg-blue-500',    light: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'violet',  bg: 'bg-violet-500',  light: 'bg-violet-50 text-violet-700 border-violet-200' },
  { id: 'emerald', bg: 'bg-emerald-500', light: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'rose',    bg: 'bg-rose-500',    light: 'bg-rose-50 text-rose-700 border-rose-200' },
  { id: 'amber',   bg: 'bg-amber-500',   light: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'slate',   bg: 'bg-slate-600',   light: 'bg-slate-100 text-slate-700 border-slate-200' },
]

export const LABEL_PRESETS: TaskLabel[] = [
  { id: 'urgent',   name: 'Dringend', color: 'bg-red-100 text-red-700 border-red-200' },
  { id: 'high',     name: 'Wichtig',  color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { id: 'info',     name: 'Info',     color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { id: 'normal',   name: 'Normal',   color: 'bg-gray-100 text-gray-600 border-gray-200' },
  { id: 'done',     name: 'Erledigt', color: 'bg-green-100 text-green-700 border-green-200' },
]

export const VISIBILITY_LABELS: Record<BoardVisibility, string> = {
  all:      'Alle',
  mpa:      'MPA',
  arzt:     'Ärzte',
  gl:       'Nur GL',
  managers: 'Nur Admin',
  creator:  'Nur ich',
  user:     'Bestimmte Person',
}

function mapBoard(id: string, data: Record<string, unknown>): TaskBoard {
  return {
    id, name: (data.name as string) || '', description: (data.description as string) || '',
    color: (data.color as string) || 'blue',
    columns: (data.columns as TaskColumn[]) || [],
    visibleTo: (data.visibleTo as BoardVisibility) || 'all',
    visibleToUid: (data.visibleToUid as string) || undefined,
    visibleToName: (data.visibleToName as string) || undefined,
    visibleToUids: (data.visibleToUids as string[]) || undefined,
    visibleToNames: (data.visibleToNames as string[]) || undefined,
    createdBy: (data.createdBy as string) || '',
    createdByUid: (data.createdByUid as string) || '',
    createdAt: data.createdAt,
  }
}

function mapCard(id: string, data: Record<string, unknown>): TaskCard {
  return {
    id, boardId: (data.boardId as string) || '',
    columnId: (data.columnId as string) || '',
    title: (data.title as string) || '', description: (data.description as string) || '',
    order: (data.order as number) ?? 0,
    dueDate: (data.dueDate as string | null) ?? null,
    labels: (data.labels as TaskLabel[]) || [],
    assigneeType: (data.assigneeType as TaskCard['assigneeType']) || 'none',
    assigneeKey: (data.assigneeKey as string) || '',
    assigneeName: (data.assigneeName as string) || '',
    assigneeRole: (data.assigneeRole as string) || '',
    done: (data.done as boolean) || false,
    attachments: (data.attachments as TaskAttachment[]) || [],
    checklist: (data.checklist as ChecklistItem[]) || [],
    members: (data.members as TaskMember[]) || [],
    createdBy: (data.createdBy as string) || '',
    createdByUid: (data.createdByUid as string) || '',
    createdAt: data.createdAt,
  }
}

// Boards
export function subscribeBoards(cb: (boards: TaskBoard[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'taskBoards'), orderBy('createdAt', 'asc')),
    snap => cb(snap.docs.map(d => mapBoard(d.id, d.data() as Record<string, unknown>)))
  )
}

export async function createBoard(data: Omit<TaskBoard, 'id' | 'createdAt'>): Promise<string> {
  const ref = await addDoc(collection(db, 'taskBoards'), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export async function updateBoard(id: string, data: Partial<Omit<TaskBoard, 'id'>>): Promise<void> {
  await updateDoc(doc(db, 'taskBoards', id), data as Record<string, unknown>)
}

export async function deleteBoard(id: string): Promise<void> {
  await deleteDoc(doc(db, 'taskBoards', id))
}

// Cards
export function subscribeBoardCards(boardId: string, cb: (cards: TaskCard[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'taskCards'), where('boardId', '==', boardId), orderBy('order', 'asc')),
    snap => cb(snap.docs.map(d => mapCard(d.id, d.data() as Record<string, unknown>)))
  )
}

export async function createCard(data: Omit<TaskCard, 'id' | 'createdAt'>): Promise<string> {
  const ref = await addDoc(collection(db, 'taskCards'), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export async function updateCard(id: string, data: Partial<Omit<TaskCard, 'id'>>): Promise<void> {
  await updateDoc(doc(db, 'taskCards', id), data as Record<string, unknown>)
}

export async function deleteCard(id: string): Promise<void> {
  await deleteDoc(doc(db, 'taskCards', id))
}

// Comments
export function subscribeCardComments(cardId: string, cb: (comments: TaskComment[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'taskComments'), where('cardId', '==', cardId), orderBy('createdAt', 'asc')),
    snap => cb(snap.docs.map(d => {
      const data = d.data()
      return { id: d.id, cardId: data.cardId, boardId: data.boardId, text: data.text,
        authorUid: data.authorUid, authorName: data.authorName, createdAt: data.createdAt }
    }))
  )
}

export async function addComment(data: Omit<TaskComment, 'id' | 'createdAt'>): Promise<void> {
  await addDoc(collection(db, 'taskComments'), { ...data, createdAt: serverTimestamp() })
}

// Notifications
export function subscribeTaskNotifications(uid: string, cb: (n: TaskNotification[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'taskNotifications'), where('recipientUid', '==', uid), orderBy('createdAt', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as TaskNotification)))
  )
}

export async function createTaskNotification(data: Omit<TaskNotification, 'id' | 'read' | 'createdAt'>): Promise<void> {
  await addDoc(collection(db, 'taskNotifications'), { ...data, read: false, createdAt: serverTimestamp() })
}

export async function markTaskNotifRead(id: string): Promise<void> {
  await updateDoc(doc(db, 'taskNotifications', id), { read: true })
}

// Standalone Polls
function mapPoll(id: string, data: Record<string, unknown>): StandalonePoll {
  return {
    id,
    question: (data.question as string) || '',
    options: (data.options as PollOption[]) || [],
    multiSelect: (data.multiSelect as boolean) || false,
    dueDate: (data.dueDate as string | null) ?? null,
    visibleTo: (data.visibleTo as BoardVisibility) || 'all',
    visibleToUid: (data.visibleToUid as string) || undefined,
    visibleToName: (data.visibleToName as string) || undefined,
    createdBy: (data.createdBy as string) || '',
    createdByUid: (data.createdByUid as string) || '',
    createdAt: data.createdAt,
  }
}

export function subscribePolls(cb: (polls: StandalonePoll[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'taskPolls'), orderBy('createdAt', 'asc')),
    snap => cb(snap.docs.map(d => mapPoll(d.id, d.data() as Record<string, unknown>)))
  )
}

export async function createStandalonePoll(data: Omit<StandalonePoll, 'id' | 'createdAt'>): Promise<string> {
  const ref = await addDoc(collection(db, 'taskPolls'), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export async function updateStandalonePoll(id: string, data: Partial<Omit<StandalonePoll, 'id'>>): Promise<void> {
  await updateDoc(doc(db, 'taskPolls', id), data as Record<string, unknown>)
}

export async function deleteStandalonePoll(id: string): Promise<void> {
  await deleteDoc(doc(db, 'taskPolls', id))
}
