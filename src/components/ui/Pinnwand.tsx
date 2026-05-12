import { useState, useRef } from 'react'
import { Pin, PinOff, Mail, Trash2, Plus, ChevronDown, ChevronUp, Check, Users, X, FileText, Upload, ExternalLink, Loader2 } from 'lucide-react'
import { useNotices } from '../../lib/NoticesContext'
import { useAuth } from '../../lib/AuthContext'
import { uploadNoticeAttachment } from '../../lib/firestoreNotices'
import type { NoticeType, NoticeBoard, NoticeAttachment } from '../../lib/firestoreNotices'
import { BOARD_LABEL } from '../../lib/firestoreNotices'

const TYPE_CONFIG = {
  info:    { border: 'border-l-blue-500',  bg: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-700',   label: 'Info',    dot: 'bg-blue-500'   },
  warnung: { border: 'border-l-amber-500', bg: 'bg-amber-50',  badge: 'bg-amber-100 text-amber-700', label: 'Warnung', dot: 'bg-amber-500'  },
  wichtig: { border: 'border-l-red-500',   bg: 'bg-red-50',    badge: 'bg-red-100 text-red-700',     label: 'Wichtig', dot: 'bg-red-500'    },
}

const BOARD_COLOR: Record<NoticeBoard, string> = {
  alle:  'bg-gray-100 text-gray-600',
  mpa:   'bg-sky-100 text-sky-700',
  arzt:  'bg-green-100 text-green-700',
  gl:    'bg-purple-100 text-purple-700',
  admin: 'bg-red-100 text-red-700',
}

function formatDate(ts: any): string {
  if (!ts) return ''
  const d: Date = ts.toDate?.() ?? new Date(ts)
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── Readers list ──────────────────────────────────────────────────────────────
function ReadersList({ noticeId }: { noticeId: string }) {
  const { getReaders } = useNotices()
  const [readers, setReaders] = useState<{ username: string; readAt: any }[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  async function toggle() {
    if (!open && readers === null) {
      setLoading(true)
      setReaders(await getReaders(noticeId))
      setLoading(false)
    }
    setOpen(v => !v)
  }

  return (
    <div>
      <button onClick={toggle} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
        <Users className="w-3.5 h-3.5" />
        {loading ? 'Lädt…' : open ? 'Ausblenden' : 'Wer hat gelesen?'}
        {!loading && (open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
      {open && readers !== null && (
        <div className="mt-2 pl-5 space-y-1">
          {readers.length === 0
            ? <p className="text-xs text-gray-400 italic">Noch niemand zur Kenntnis genommen</p>
            : readers.map(r => (
              <div key={r.username} className="flex items-center gap-2 text-xs text-gray-600">
                <Check className="w-3 h-3 text-green-500 shrink-0" />
                <span className="font-medium">{r.username}</span>
                <span className="text-gray-400">{formatDate(r.readAt)}</span>
              </div>
            ))
          }
        </div>
      )}
    </div>
  )
}

// ── New notice form ───────────────────────────────────────────────────────────
interface NewNoticeFormProps { onClose: () => void; defaultBoard: NoticeBoard }
function NewNoticeForm({ onClose, defaultBoard }: NewNoticeFormProps) {
  const { addNotice, postableBoards } = useNotices()
  const { profile } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [title,    setTitle]    = useState('')
  const [text,     setText]     = useState('')
  const [type,     setType]     = useState<NoticeType>('info')
  const [board,    setBoard]    = useState<NoticeBoard>(
    postableBoards.includes(defaultBoard) ? defaultBoard : (postableBoards[0] ?? 'alle')
  )
  const [saving,   setSaving]   = useState(false)
  const [file,     setFile]     = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const cancelUpload = useRef<(() => void) | null>(null)

  function handleFile(f: File) {
    if (f.type !== 'application/pdf') { alert('Nur PDF-Dateien erlaubt.'); return }
    if (f.size > 20 * 1024 * 1024)   { alert('Maximale Dateigrösse: 20 MB'); return }
    setFile(f)
  }

  function removeFile() {
    setFile(null); setProgress(null)
    if (cancelUpload.current) { cancelUpload.current(); cancelUpload.current = null }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    try {
      let attachment: NoticeAttachment | undefined
      if (file) {
        const { promise, cancel } = uploadNoticeAttachment(file, setProgress)
        cancelUpload.current = cancel
        attachment = await promise
        cancelUpload.current = null
      }
      await addNotice({
        title: title.trim(), text: text.trim(), type, board,
        createdByName: profile?.displayName ?? profile?.username ?? '?',
        attachment,
      })
      onClose()
    } catch (e) {
      console.error(e)
      alert('Fehler beim Speichern.')
    } finally { setSaving(false); setProgress(null) }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Neue Mitteilung</p>
        <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>

      {/* Board selector (only show if more than one postable board) */}
      {postableBoards.length > 1 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">Pinnwand</p>
          <div className="flex flex-wrap gap-1.5">
            {postableBoards.map(b => (
              <button key={b} type="button" onClick={() => setBoard(b)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border-2 transition-all ${
                  board === b
                    ? `${BOARD_COLOR[b]} border-current`
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>
                {BOARD_LABEL[b]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Type selector */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(TYPE_CONFIG) as NoticeType[]).map(t => (
          <button key={t} type="button" onClick={() => setType(t)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all ${
              type === t ? `${TYPE_CONFIG[t].badge} border-current` : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
            }`}>
            <span className={`w-2 h-2 rounded-full ${TYPE_CONFIG[t].dot}`} />
            {TYPE_CONFIG[t].label}
          </button>
        ))}
      </div>

      <input className="input" placeholder="Titel *" value={title} onChange={e => setTitle(e.target.value)} />
      <textarea className="input resize-none" rows={3} placeholder="Inhalt der Mitteilung…"
        value={text} onChange={e => setText(e.target.value)} />

      {/* PDF attachment */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1.5">PDF-Anhang (optional)</p>
        {!file ? (
          <div
            onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-3 flex items-center justify-center gap-2 cursor-pointer transition-colors text-sm
              ${dragging ? 'border-primary-400 bg-primary-50 text-primary-600' : 'border-gray-200 text-gray-400 hover:border-primary-300 hover:bg-gray-50'}`}>
            <Upload className="w-4 h-4 shrink-0" />
            <span>PDF ablegen oder <span className="font-medium">klicken</span> (max. 20 MB)</span>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-200 bg-white">
            <FileText className="w-5 h-5 text-red-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
              <p className="text-xs text-gray-400">{formatBytes(file.size)}</p>
              {progress !== null && (
                <div className="mt-1.5 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <div className="h-full bg-primary-500 transition-all rounded-full" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
            <button onClick={removeFile} className="p-1 text-gray-400 hover:text-red-500 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary text-sm">Abbrechen</button>
        <button onClick={handleSave} disabled={!title.trim() || saving}
          className="btn-primary text-sm disabled:opacity-50 flex items-center gap-1.5">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {saving ? (progress !== null ? `Hochladen… ${progress}%` : 'Speichern…') : 'Veröffentlichen'}
        </button>
      </div>
    </div>
  )
}

// ── Attachment chip ───────────────────────────────────────────────────────────
function AttachmentChip({ attachment }: { attachment: NoticeAttachment }) {
  return (
    <a href={attachment.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors group max-w-full">
      <FileText className="w-4 h-4 text-red-500 shrink-0" />
      <span className="text-sm font-medium text-gray-700 truncate">{attachment.name}</span>
      <span className="text-xs text-gray-400 shrink-0">{formatBytes(attachment.size)}</span>
      <ExternalLink className="w-3.5 h-3.5 text-gray-300 group-hover:text-primary-500 shrink-0 transition-colors" />
    </a>
  )
}

// ── Main Pinnwand ─────────────────────────────────────────────────────────────
export default function Pinnwand() {
  const { notices, reads, unreadCount, visibleBoards, postableBoards, markRead, togglePin, markUnread, deleteNotice } = useNotices()
  const { isAdmin, isGeschaeftsleitung } = useAuth()
  const canManage = isAdmin || isGeschaeftsleitung
  const [activeBoard, setActiveBoard] = useState<NoticeBoard>('alle')
  const [showForm, setShowForm]       = useState(false)
  const [expanded, setExpanded]       = useState<Set<string>>(new Set())

  // Don't render if user can't see any boards and can't manage
  if (visibleBoards.length === 0 && !canManage) return null

  // Board notices + per-board unread counts
  const boardNotices = notices.filter(n => n.board === activeBoard)
  const unreadPerBoard = (board: NoticeBoard) =>
    notices.filter(n => n.board === board && (() => {
      const r = reads[n.id]
      return !r || !r.readAt || r.markedUnread
    })()).length

  const sorted = [...boardNotices].sort((a, b) => {
    const aPinned = reads[a.id]?.pinned ?? false
    const bPinned = reads[b.id]?.pinned ?? false
    if (aPinned !== bPinned) return bPinned ? 1 : -1
    return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
  })

  function isUnread(id: string): boolean {
    const r = reads[id]
    if (!r || !r.readAt) return true
    return r.markedUnread
  }

  function toggleExpand(id: string) {
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  // When switching boards, close the form
  function switchBoard(b: NoticeBoard) {
    setActiveBoard(b)
    setShowForm(false)
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Pinnwand</h2>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
              {unreadCount} neu
            </span>
          )}
        </div>
        {postableBoards.length > 0 && !showForm && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Mitteilung
          </button>
        )}
      </div>

      {/* Board tabs — only shown if user has access to more than one board */}
      {visibleBoards.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-0.5 -mb-0.5 scrollbar-none">
          {visibleBoards.map(board => {
            const u = unreadPerBoard(board)
            const isActive = activeBoard === board
            return (
              <button
                key={board}
                onClick={() => switchBoard(board)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all shrink-0 ${
                  isActive
                    ? `${BOARD_COLOR[board]} shadow-sm ring-1 ring-inset ring-current/20`
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {BOARD_LABEL[board]}
                {u > 0 && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-white/60 text-current' : 'bg-red-100 text-red-600'
                  }`}>
                    {u}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {showForm && (
        <NewNoticeForm
          onClose={() => setShowForm(false)}
          defaultBoard={activeBoard}
        />
      )}

      {sorted.length === 0 && !showForm && (
        <p className="text-sm text-gray-400 italic py-2">
          Keine Mitteilungen auf der {BOARD_LABEL[activeBoard]}-Pinnwand.
        </p>
      )}

      {sorted.map(notice => {
        const cfg        = TYPE_CONFIG[notice.type]
        const unread     = isUnread(notice.id)
        const pinned     = reads[notice.id]?.pinned ?? false
        const isLong     = notice.text.length > 160
        const isExpanded = expanded.has(notice.id)

        return (
          <div key={notice.id}
            className={`rounded-xl border-l-4 border border-gray-200 ${cfg.border} ${unread ? cfg.bg : 'bg-white'} transition-colors`}>

            <div className="px-4 pt-3 pb-2 space-y-2">
              {/* Badges row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                {pinned && (
                  <span className="text-[10px] font-semibold text-gray-400 flex items-center gap-0.5">
                    <Pin className="w-3 h-3" /> Gepinnt
                  </span>
                )}
                {unread && (
                  <span className="text-[10px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">Neu</span>
                )}
              </div>

              <p className="text-sm font-semibold text-gray-900">{notice.title}</p>

              {notice.text && (
                <div>
                  <p className={`text-sm text-gray-600 whitespace-pre-wrap ${isLong && !isExpanded ? 'line-clamp-3' : ''}`}>
                    {notice.text}
                  </p>
                  {isLong && (
                    <button onClick={() => toggleExpand(notice.id)} className="text-xs text-primary-600 hover:underline mt-0.5">
                      {isExpanded ? 'Weniger anzeigen' : 'Mehr anzeigen'}
                    </button>
                  )}
                </div>
              )}

              {notice.attachment && <AttachmentChip attachment={notice.attachment} />}

              <p className="text-[10px] text-gray-400">
                {notice.createdByName} · {formatDate(notice.createdAt)}
              </p>
            </div>

            {/* Action bar */}
            <div className="px-4 pb-2 pt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-gray-100">
              {unread ? (
                <button onClick={() => markRead(notice.id)}
                  className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 px-2.5 py-1 rounded-lg border border-green-200 transition-colors">
                  <Check className="w-3.5 h-3.5" /> Zur Kenntnis genommen
                </button>
              ) : (
                <button onClick={() => markUnread(notice.id)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                  <Mail className="w-3.5 h-3.5" /> Als ungelesen markieren
                </button>
              )}

              <button onClick={() => togglePin(notice.id, !pinned)}
                className={`flex items-center gap-1.5 text-xs transition-colors ${
                  pinned ? 'text-primary-600 hover:text-primary-800' : 'text-gray-400 hover:text-gray-600'
                }`}>
                {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                {pinned ? 'Entpinnen' : 'Pinnen'}
              </button>

              {canManage && (
                <button onClick={() => { if (confirm('Mitteilung löschen?')) deleteNotice(notice.id, notice.attachment) }}
                  className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors ml-auto">
                  <Trash2 className="w-3.5 h-3.5" /> Löschen
                </button>
              )}
            </div>

            {/* Readers (admin/GL only) */}
            {canManage && (
              <div className="px-4 pb-3">
                <ReadersList noticeId={notice.id} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
