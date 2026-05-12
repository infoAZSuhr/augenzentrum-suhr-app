import { createContext, useContext, useEffect, useState, useRef, useMemo, ReactNode } from 'react'
import { X } from 'lucide-react'
import {
  Notice, NoticeRead, NoticeType, NoticeBoard, NoticeAttachment,
  BOARD_LABEL,
  subscribeNotices, subscribeUserReads,
  addNotice as fsAddNotice, deleteNotice as fsDeleteNotice,
  setNoticeRead, setNoticePin, setNoticeUnread, getNoticeReaders,
} from './firestoreNotices'
import { useAuth } from './AuthContext'
import type { UserProfile } from './AuthContext'

// ── Board visibility rules ────────────────────────────────────────────────────

/** Which boards a user can see (read) */
function getVisibleBoards(profile: UserProfile | null): NoticeBoard[] {
  if (!profile || profile.status !== 'approved') return []
  const roles = [profile.role, ...(profile.additionalRoles ?? [])]
  if (roles.includes('admin')) return ['alle', 'mpa', 'arzt', 'gl', 'admin']
  const boards: NoticeBoard[] = ['alle']
  if (roles.includes('mpa'))               boards.push('mpa')
  if (roles.includes('arzt'))              boards.push('arzt')
  if (roles.includes('geschaeftsleitung')) boards.push('gl')
  return boards
}

/** Which boards a user can post to */
export function getPostableBoards(profile: UserProfile | null): NoticeBoard[] {
  if (!profile || profile.status !== 'approved') return []
  const roles = [profile.role, ...(profile.additionalRoles ?? [])]
  if (roles.includes('admin')) return ['alle', 'mpa', 'arzt', 'gl', 'admin']
  if (roles.includes('geschaeftsleitung')) return ['alle', 'gl']
  return []
}

// ── Context types ─────────────────────────────────────────────────────────────

interface NoticesContextType {
  notices:        Notice[]
  reads:          Record<string, NoticeRead>
  unreadCount:    number
  visibleBoards:  NoticeBoard[]
  postableBoards: NoticeBoard[]
  addNotice:    (data: { title: string; text: string; type: NoticeType; board: NoticeBoard; createdByName: string; attachment?: NoticeAttachment }) => Promise<string>
  deleteNotice: (id: string, attachment?: NoticeAttachment) => Promise<void>
  markRead:     (id: string) => Promise<void>
  togglePin:    (id: string, pinned: boolean) => Promise<void>
  markUnread:   (id: string) => Promise<void>
  getReaders:   (id: string) => Promise<{ username: string; readAt: any }[]>
}

const NoticesContext = createContext<NoticesContextType | null>(null)

const TYPE_COLOR: Record<string, string> = {
  info:    'bg-blue-500',
  warnung: 'bg-amber-500',
  wichtig: 'bg-red-500',
}
const TYPE_LABEL: Record<string, string> = {
  info: 'Info', warnung: 'Warnung', wichtig: 'Wichtig',
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function NoticesProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [allNotices, setAllNotices] = useState<Notice[]>([])
  const [reads,      setReads]      = useState<Record<string, NoticeRead>>({})
  const [toasts,     setToasts]     = useState<Notice[]>([])
  const knownIds    = useRef<Set<string>>(new Set())
  const initialized = useRef(false)
  const username    = profile?.username ?? ''

  const visibleBoards  = useMemo(() => getVisibleBoards(profile),  [profile])
  const postableBoards = useMemo(() => getPostableBoards(profile), [profile])

  // Ref so the subscription closure always has the latest visible boards
  const visibleBoardsRef = useRef<NoticeBoard[]>(visibleBoards)
  useEffect(() => { visibleBoardsRef.current = visibleBoards }, [visibleBoards])

  // Subscribe to all notices — filter toasts by visible boards
  useEffect(() => {
    if (!profile) return
    const unsub = subscribeNotices(incoming => {
      if (initialized.current) {
        const fresh = incoming.filter(n =>
          !knownIds.current.has(n.id) &&
          visibleBoardsRef.current.includes(n.board)
        )
        if (fresh.length > 0) {
          setToasts(prev => [...prev, ...fresh])
          fresh.forEach(n => setTimeout(() => setToasts(p => p.filter(t => t.id !== n.id)), 7000))
        }
      }
      incoming.forEach(n => knownIds.current.add(n.id))
      setAllNotices(incoming)
      initialized.current = true
    })
    return unsub
  }, [profile?.uid])

  // Subscribe to user's read states
  useEffect(() => {
    if (!username) return
    return subscribeUserReads(username, setReads)
  }, [username])

  // Only show notices on boards the user can see
  const notices = useMemo(
    () => allNotices.filter(n => visibleBoards.includes(n.board)),
    [allNotices, visibleBoards]
  )

  // Unread = never acknowledged OR explicitly re-marked
  const unreadCount = notices.filter(n => {
    const r = reads[n.id]
    if (!r || !r.readAt) return true
    return r.markedUnread
  }).length

  const ctx: NoticesContextType = {
    notices, reads, unreadCount, visibleBoards, postableBoards,
    addNotice:    (data) => fsAddNotice(data),
    deleteNotice: (id, attachment) => fsDeleteNotice(id, attachment),
    markRead:     (id) => setNoticeRead(id, username),
    togglePin:    (id, pinned) => setNoticePin(id, username, pinned),
    markUnread:   (id) => setNoticeUnread(id, username),
    getReaders:   (id) => getNoticeReaders(id),
  }

  return (
    <NoticesContext.Provider value={ctx}>
      {children}

      {/* Toast stack — bottom-right */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[9998] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
          {toasts.map(t => (
            <div key={t.id}
              className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 flex items-start gap-3 pointer-events-auto
                         animate-[slideInRight_0.3s_ease-out]">
              <span className={`w-2.5 h-2.5 rounded-full mt-0.5 shrink-0 ${TYPE_COLOR[t.type]}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">
                  Neue Mitteilung · {TYPE_LABEL[t.type]}
                  {t.board !== 'alle' && (
                    <span className="ml-1.5 text-gray-300">· {BOARD_LABEL[t.board]}</span>
                  )}
                </p>
                <p className="text-sm font-semibold text-gray-900 truncate">{t.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{t.text}</p>
              </div>
              <button onClick={() => setToasts(p => p.filter(x => x.id !== t.id))}
                className="p-0.5 text-gray-300 hover:text-gray-500 transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </NoticesContext.Provider>
  )
}

export function useNotices() {
  const ctx = useContext(NoticesContext)
  if (!ctx) throw new Error('useNotices must be used within NoticesProvider')
  return ctx
}
