import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, UserProfile } from '../lib/AuthContext'
import {
  TaskBoard, TaskCard, TaskComment, TaskLabel, TaskAttachment, ChecklistItem, TaskMember,
  LABEL_PRESETS, BOARD_COLORS,
  subscribeBoards, subscribeBoardCards, subscribeCardComments,
  createCard, updateCard, deleteCard, updateBoard, addComment,
  createTaskNotification,
} from '../lib/firestoreTasks'
import { getDocs, query, collection, where } from 'firebase/firestore'
import { db, storage } from '../lib/firebase'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import {
  Plus, X, Loader2, Clock, Trash2, CheckCircle2,
  Circle, MessageSquare, Settings, GripVertical, Paperclip, Square, CheckSquare, Users, User,
  Search, SortAsc, UserCheck, ArrowRightLeft,
} from 'lucide-react'
import BackButton from '../components/ui/BackButton'

const LABEL_COLOR_MAP: Record<string, string> = Object.fromEntries(LABEL_PRESETS.map(l => [l.id, l.color]))

function formatDue(due: string) {
  return new Date(due).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function dueStyle(due: string | null, done: boolean) {
  if (done) return 'text-green-600 bg-green-50 border-green-200'
  if (!due) return ''
  const diff = (new Date(due).getTime() - Date.now()) / 86400000
  if (diff < 0) return 'text-red-600 bg-red-50 border-red-200'
  if (diff < 2) return 'text-amber-600 bg-amber-50 border-amber-200'
  return 'text-gray-500 bg-gray-50 border-gray-200'
}

// ── Card detail modal ──────────────────────────────────────────────────────────
function CardDetail({ card, board, onClose, isManager, profile, approvedUsers, allBoards }: {
  card: TaskCard
  board: TaskBoard
  onClose: () => void
  isManager: boolean
  profile: UserProfile | null
  approvedUsers: UserProfile[]
  allBoards: TaskBoard[]
}) {
  const [title, setTitle]   = useState(card.title)
  const [desc, setDesc]     = useState(card.description)
  const [due, setDue]       = useState(card.dueDate?.slice(0, 10) ?? '')
  const [labels, setLabels] = useState<TaskLabel[]>(card.labels)
  const [assigneeKey, setAssigneeKey]   = useState(card.assigneeKey)
  const [assigneeType, setAssigneeType] = useState(card.assigneeType)
  const [assigneeName, setAssigneeName] = useState(card.assigneeName)
  const [assigneeRole, setAssigneeRole] = useState(card.assigneeRole)
  const [done, setDone]     = useState(card.done)
  const [attachments, setAttachments] = useState<TaskAttachment[]>(card.attachments ?? [])
  const [checklist, setChecklist] = useState<ChecklistItem[]>(card.checklist ?? [])
  const [newCheckItem, setNewCheckItem] = useState('')
  const [newCheckAssigneeUid, setNewCheckAssigneeUid] = useState('')
  const [newCheckAssigneeName, setNewCheckAssigneeName] = useState('')
  const [assigneePickerItemId, setAssigneePickerItemId] = useState<string | null>(null)
  const [draggingCheckId, setDraggingCheckId] = useState<string | null>(null)
  const [dragOverCheckId, setDragOverCheckId] = useState<string | null>(null)
  const [editingCheckId, setEditingCheckId] = useState<string | null>(null)
  const [editingCheckText, setEditingCheckText] = useState('')
  const [members, setMembers] = useState<TaskMember[]>(card.members ?? [])
  const [lightboxAtt, setLightboxAtt] = useState<TaskAttachment | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showMoveCard, setShowMoveCard] = useState(false)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)
  const commentEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const prevAssigneeKey = useRef(card.assigneeKey)
  const prevMembersRef = useRef<TaskMember[]>(card.members ?? [])
  const isFirstRender = useRef(true)

  useEffect(() => subscribeCardComments(card.id, setComments), [card.id])
  useEffect(() => { commentEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [comments])

  function toggleLabel(label: TaskLabel) {
    setLabels(prev => prev.some(l => l.id === label.id) ? [] : [label])
  }

  function selectAssignee(user: UserProfile) {
    setAssigneeKey(user.uid)
    setAssigneeType('user')
    setAssigneeName(user.displayName || user.username)
    setAssigneeRole(user.role)
  }

  function selectGroup(role: 'mpa' | 'arzt') {
    setAssigneeKey(`group_${role}`)
    setAssigneeType('group')
    setAssigneeName(role === 'mpa' ? 'Alle MPA' : 'Alle Ärzte')
    setAssigneeRole(role)
  }

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const path = `task-attachments/${card.boardId}/${card.id}/${Date.now()}_${file.name}`
        const sRef = storageRef(storage, path)
        await uploadBytes(sRef, file)
        const url = await getDownloadURL(sRef)
        const att: TaskAttachment = {
          id: `att_${Date.now()}`,
          name: file.name, url, type: file.type,
          size: file.size, storagePath: path,
          uploadedBy: profile?.displayName || profile?.username || '',
        }
        setAttachments(prev => {
          const updated = [...prev, att]
          updateCard(card.id, { attachments: updated })
          return updated
        })
      }
    } catch (e) { console.error('Upload error:', e) }
    finally { setUploading(false) }
  }

  async function handleDeleteAttachment(att: TaskAttachment) {
    try { await deleteObject(storageRef(storage, att.storagePath)) } catch { /* already gone */ }
    setAttachments(prev => {
      const updated = prev.filter(a => a.id !== att.id)
      updateCard(card.id, { attachments: updated })
      return updated
    })
  }

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    if (!canEdit) return
    const t = setTimeout(async () => {
      await updateCard(card.id, {
        title: title.trim() || card.title, description: desc.trim(),
        dueDate: due || null, labels, assigneeKey, assigneeType, assigneeName, assigneeRole, done,
        checklist, members,
      })
      const base = {
        cardId: card.id, boardId: card.boardId,
        cardTitle: title.trim() || card.title, boardName: board.name,
        assignerName: profile?.displayName || profile?.username || '',
      }
      // Notify assignee only when it actually changed
      if (assigneeType !== 'none' && assigneeKey && assigneeKey !== prevAssigneeKey.current) {
        prevAssigneeKey.current = assigneeKey
        if (assigneeType === 'user') {
          await createTaskNotification({ ...base, recipientUid: assigneeKey })
        } else if (assigneeType === 'group') {
          const role = assigneeKey === 'group_mpa' ? 'mpa' : 'arzt'
          await Promise.all(
            approvedUsers.filter(u => u.role === role).map(u =>
              createTaskNotification({ ...base, recipientUid: u.uid })
            )
          )
        }
      }
      // Notify newly added members
      const prevMemberUids = new Set(prevMembersRef.current.map(m => m.uid))
      const newMembers = members.filter(m => !prevMemberUids.has(m.uid) && m.uid !== profile?.uid)
      prevMembersRef.current = [...members]
      await Promise.all(newMembers.map(m => createTaskNotification({ ...base, recipientUid: m.uid })))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }, 700)
    return () => clearTimeout(t)
  }, [title, desc, due, labels, assigneeKey, assigneeType, assigneeName, assigneeRole, done, checklist, members])

  async function handleToggleDone() {
    const newDone = !done
    setDone(newDone)
    await updateCard(card.id, { done: newDone })
  }

  async function handleDelete() {
    if (!confirm('Karte löschen?')) return
    await deleteCard(card.id)
    onClose()
  }

  async function handleComment() {
    if (!newComment.trim()) return
    setPostingComment(true)
    const commenterName = profile?.displayName || profile?.username || ''
    const commenterUid = profile?.uid ?? ''
    await addComment({
      cardId: card.id, boardId: card.boardId, text: newComment.trim(),
      authorUid: commenterUid, authorName: commenterName,
    })

    // Collect unique recipients: creator + specific assignee + members — excluding the commenter
    const recipients = new Set<string>()
    if (card.createdByUid) recipients.add(card.createdByUid)
    if (card.assigneeType === 'user' && card.assigneeKey) recipients.add(card.assigneeKey)
    members.forEach(m => recipients.add(m.uid))
    recipients.delete(commenterUid)

    const base = {
      type: 'comment' as const,
      cardId: card.id, boardId: card.boardId,
      cardTitle: card.title, boardName: board.name,
      assignerName: commenterName,
    }
    await Promise.all([...recipients].map(uid => createTaskNotification({ ...base, recipientUid: uid })))

    setNewComment('')
    setPostingComment(false)
  }

  const canEdit   = isManager || card.createdByUid === profile?.uid
  const canDelete = canEdit
  const canCheckChecklist = canEdit ||
    members.some(m => m.uid === profile?.uid) ||
    (assigneeType === 'user' && assigneeKey === profile?.uid)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-3 px-4 sm:px-5 py-4 border-b border-gray-100">
          <button onClick={canEdit ? handleToggleDone : undefined} disabled={!canEdit} className={`shrink-0 mt-0.5 transition-colors ${canEdit ? 'text-gray-300 hover:text-green-500' : 'text-gray-200 cursor-default'}`}>
            {done ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Circle className="w-5 h-5" />}
          </button>
          <input value={title} onChange={e => canEdit && setTitle(e.target.value)} readOnly={!canEdit}
            className={`flex-1 font-bold text-gray-900 text-base bg-transparent focus:outline-none ${canEdit ? 'focus:bg-gray-50' : 'cursor-default'} rounded px-1 -ml-1 ${done ? 'line-through text-gray-400' : ''}`} />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-5">
          {/* People: creator, assignee, members */}
          {(card.createdBy || assigneeName || members.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {card.createdBy && (
                <span title={`Ersteller: ${card.createdBy}`}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-600 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">
                  <span className="w-3.5 h-3.5 rounded-full bg-gray-400 text-white flex items-center justify-center text-[8px] font-bold shrink-0">
                    {card.createdBy.split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0].toUpperCase()).join('')}
                  </span>
                  {card.createdBy}
                </span>
              )}
              {board.visibleTo === 'all' && assigneeName && assigneeType !== 'none' && (
                <span title={`Zugewiesen: ${assigneeName}`}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-primary-700 bg-primary-50 border border-primary-200 px-1.5 py-0.5 rounded-full">
                  <span className="w-3.5 h-3.5 rounded-full bg-primary-400 text-white flex items-center justify-center text-[8px] font-bold shrink-0">
                    {assigneeName.split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0].toUpperCase()).join('')}
                  </span>
                  {assigneeName}
                </span>
              )}
              {members.map(m => (
                <span key={m.uid} title={`Eingeladen: ${m.name}`}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">
                  <span className="w-3.5 h-3.5 rounded-full bg-violet-400 text-white flex items-center justify-center text-[8px] font-bold shrink-0">
                    {m.name.split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0].toUpperCase()).join('')}
                  </span>
                  {m.name}
                </span>
              ))}
            </div>
          )}

          {/* Description */}
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Beschreibung</span>
            <textarea value={desc} onChange={e => canEdit && setDesc(e.target.value)} readOnly={!canEdit} rows={3} placeholder={canEdit ? 'Details hinzufügen…' : ''}
              className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none ${canEdit ? 'focus:ring-2 focus:ring-primary-400' : 'cursor-default bg-gray-50'}`} />
          </div>

          {/* Due + Labels row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Fälligkeit</span>
              <input type="date" value={due} onChange={e => canEdit && setDue(e.target.value)} readOnly={!canEdit} disabled={!canEdit}
                className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none ${canEdit ? 'focus:ring-2 focus:ring-primary-400' : 'bg-gray-50 cursor-default'}`} />
              {card.dueDate && (
                <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border mt-1 ${dueStyle(card.dueDate, done)}`}>
                  <Clock className="w-3 h-3" />{done ? 'Erledigt' : formatDue(card.dueDate)}
                </span>
              )}
            </div>
            <div>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Labels</span>
              <div className="flex flex-wrap gap-1">
                {LABEL_PRESETS.map(l => {
                  const active = labels.some(x => x.id === l.id)
                  return (
                    <button key={l.id} onClick={() => canEdit && toggleLabel(l)} disabled={!canEdit}
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded border transition-all ${active ? l.color + ' opacity-100' : 'bg-gray-50 text-gray-400 border-gray-200'} ${canEdit ? 'hover:opacity-80' : 'cursor-default'}`}>
                      {l.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Attachments */}
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Anhänge</span>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {attachments.map(att => {
                  const isImg = att.type.startsWith('image/')
                  return (
                    <div key={att.id} className="relative group">
                      <button onClick={() => setLightboxAtt(att)}
                        className="block focus:outline-none">
                        {isImg ? (
                          <img src={att.url} alt={att.name} className="w-16 h-16 object-cover rounded-lg border border-gray-200 hover:opacity-80 transition-opacity" />
                        ) : (
                          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-100 transition-colors max-w-[160px]">
                            <Paperclip className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span className="text-xs text-gray-700 truncate">{att.name}</span>
                          </div>
                        )}
                      </button>
                      <button onClick={() => handleDeleteAttachment(att)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            {canEdit && (
              <>
                <input ref={fileInputRef} type="file" multiple className="hidden"
                  onChange={e => handleFileUpload(e.target.files)} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-100 disabled:opacity-40 transition-colors">
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                  {uploading ? 'Wird hochgeladen…' : 'Anhang hinzufügen'}
                </button>
              </>
            )}
          </div>

          {/* Attachment popup mit Inline-Vorschau für unterstützte Typen.
              Browser-native: image, pdf, video, audio, text.
              Office-Docs (.docx/.xlsx/.pptx) via Google Docs Viewer.
              Fallback: Datei-Icon mit Hinweis + Öffnen/Herunterladen-Button. */}
          {lightboxAtt && (() => {
            const t       = lightboxAtt.type
            const url     = lightboxAtt.url
            const nameL   = lightboxAtt.name.toLowerCase()
            const isImg   = t.startsWith('image/')
            const isPdf   = t === 'application/pdf' || nameL.endsWith('.pdf')
            const isVideo = t.startsWith('video/')
            const isAudio = t.startsWith('audio/')
            const isText  = t.startsWith('text/') || /\.(txt|csv|log|md|json|xml|yaml|yml)$/i.test(nameL)
            const isOffice = /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(nameL)
            const hasInlinePreview = isImg || isPdf || isVideo || isAudio || isText || isOffice
            // Schmal für Bilder, breit für Dokumente/Video
            const widthCls = isImg || isAudio ? 'max-w-2xl' : 'max-w-5xl'
            return (
              <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
                onClick={() => setLightboxAtt(null)}>
                <div className={`bg-white rounded-2xl shadow-2xl ${widthCls} w-full max-h-[90vh] flex flex-col overflow-hidden`}
                  onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
                    <span className="text-sm font-medium text-gray-800 truncate max-w-[420px]">{lightboxAtt.name}</span>
                    <button onClick={() => setLightboxAtt(null)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 bg-gray-50 overflow-auto">
                    {isImg && (
                      <img src={url} alt={lightboxAtt.name} className="w-full max-h-[75vh] object-contain" />
                    )}
                    {isPdf && (
                      <iframe src={url} title={lightboxAtt.name} className="w-full h-[75vh] border-0 bg-white" />
                    )}
                    {isVideo && (
                      <video src={url} controls className="w-full max-h-[75vh] bg-black" />
                    )}
                    {isAudio && (
                      <div className="p-6"><audio src={url} controls className="w-full" /></div>
                    )}
                    {isText && (
                      <iframe src={url} title={lightboxAtt.name} className="w-full h-[75vh] border-0 bg-white" />
                    )}
                    {isOffice && (
                      // Google Docs Viewer rendert Office-Dokumente — funktioniert nur mit
                      // öffentlich zugänglichen URLs (Firebase-Storage-Download-URLs sind das).
                      <iframe
                        src={`https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`}
                        title={lightboxAtt.name}
                        className="w-full h-[75vh] border-0 bg-white"
                      />
                    )}
                    {!hasInlinePreview && (
                      <div className="flex flex-col items-center gap-3 py-12 px-6">
                        <Paperclip className="w-10 h-10 text-gray-300" />
                        <p className="text-sm text-gray-500 text-center break-all">{lightboxAtt.name}</p>
                        <p className="text-xs text-gray-400 text-center">Keine Inline-Vorschau verfügbar — bitte herunterladen.</p>
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-gray-600 hover:bg-gray-100 text-sm font-medium rounded-xl transition-colors">
                      In neuem Tab öffnen
                    </a>
                    <a href={url} target="_blank" rel="noopener noreferrer" download={lightboxAtt.name}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors">
                      Herunterladen
                    </a>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Checklist */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckSquare className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Checkliste</span>
              {checklist.length > 0 && (
                <span className="text-xs text-gray-400 ml-auto">
                  {checklist.filter(i => i.done).length}/{checklist.length}
                </span>
              )}
            </div>
            {checklist.length > 0 && (
              <div className="w-full h-1.5 bg-gray-100 rounded-full mb-2 overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${Math.round(checklist.filter(i => i.done).length / checklist.length * 100)}%` }} />
              </div>
            )}
            {/* overlay to close any open assignee picker */}
            {assigneePickerItemId && (
              <div className="fixed inset-0 z-40" onClick={() => setAssigneePickerItemId(null)} />
            )}
            <div className="space-y-1 mb-2">
              {checklist.map(item => {
                const initials = item.assigneeName
                  ? item.assigneeName.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                  : ''
                const isDraggingThis = draggingCheckId === item.id
                const isOverThis    = dragOverCheckId === item.id && !isDraggingThis
                return (
                  <div key={item.id}
                    draggable={canEdit}
                    onDragStart={() => { setDraggingCheckId(item.id) }}
                    onDragEnd={() => { setDraggingCheckId(null); setDragOverCheckId(null) }}
                    onDragOver={e => { e.preventDefault(); if (draggingCheckId && draggingCheckId !== item.id) setDragOverCheckId(item.id) }}
                    onDrop={e => {
                      e.preventDefault()
                      if (!draggingCheckId || draggingCheckId === item.id) return
                      setChecklist(prev => {
                        const from = prev.findIndex(i => i.id === draggingCheckId)
                        const to   = prev.findIndex(i => i.id === item.id)
                        if (from === -1 || to === -1) return prev
                        const a = [...prev]; const [moved] = a.splice(from, 1); a.splice(to, 0, moved); return a
                      })
                      setDraggingCheckId(null); setDragOverCheckId(null)
                    }}
                    className={`flex items-start gap-2 group select-none transition-all
                      ${isDraggingThis ? 'opacity-30' : ''}
                      ${isOverThis ? 'ring-1 ring-primary-400 rounded-lg bg-primary-50/40' : ''}`}>
                    <button onClick={() => canCheckChecklist && setChecklist(prev => prev.map(i => {
                      if (i.id !== item.id) return i
                      const nowDone = !i.done
                      return {
                        ...i, done: nowDone,
                        doneBy: nowDone ? (profile?.displayName || profile?.username || '') : undefined,
                        doneByUid: nowDone ? (profile?.uid ?? undefined) : undefined,
                      }
                    }))}
                      disabled={!canCheckChecklist} className={`shrink-0 mt-0.5 transition-colors ${canCheckChecklist ? 'text-gray-400 hover:text-green-500' : 'cursor-default text-gray-300'}`}>
                      {item.done ? <CheckSquare className="w-4 h-4 text-green-500" /> : <Square className="w-4 h-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      {canEdit && editingCheckId === item.id ? (
                        <input
                          autoFocus
                          value={editingCheckText}
                          onChange={e => setEditingCheckText(e.target.value)}
                          onBlur={() => {
                            const trimmed = editingCheckText.trim()
                            if (trimmed) setChecklist(prev => prev.map(i => i.id === item.id ? { ...i, text: trimmed } : i))
                            setEditingCheckId(null)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.currentTarget.blur() }
                            if (e.key === 'Escape') { setEditingCheckId(null) }
                          }}
                          className="w-full text-sm text-gray-700 bg-transparent border-b border-primary-400 focus:outline-none py-0"
                        />
                      ) : (
                        <span
                          onClick={() => { if (canEdit && !item.done) { setEditingCheckId(item.id); setEditingCheckText(item.text) } }}
                          className={`text-sm ${item.done ? 'line-through text-gray-400' : 'text-gray-700'} ${canEdit && !item.done ? 'cursor-text hover:text-primary-700' : ''}`}>
                          {item.text}
                        </span>
                      )}
                      {item.done && item.doneBy && (
                        <span className="block text-[10px] text-gray-400">✓ {item.doneBy}</span>
                      )}
                      {!item.done && item.assigneeName && (
                        <span className="block text-[10px] text-blue-500">→ {item.assigneeName}</span>
                      )}
                    </div>
                    {canEdit && (
                      <GripVertical className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-all cursor-grab active:cursor-grabbing" />
                    )}
                    {canEdit && (
                      <div className="relative z-50">
                        <button
                          onClick={() => setAssigneePickerItemId(prev => prev === item.id ? null : item.id)}
                          title={item.assigneeName || 'Verantwortliche/n zuweisen'}
                          className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors mt-0.5
                            ${item.assigneeName
                              ? 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                              : 'bg-gray-100 text-gray-400 hover:bg-gray-200 opacity-0 group-hover:opacity-100'}`}>
                          {initials || <User className="w-3 h-3" />}
                        </button>
                        {assigneePickerItemId === item.id && (
                          <div className="absolute right-0 top-6 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-44 max-h-52 overflow-y-auto">
                            <button
                              onClick={() => {
                                setChecklist(prev => prev.map(i => i.id === item.id
                                  ? { ...i, assigneeUid: undefined, assigneeName: undefined }
                                  : i))
                                setAssigneePickerItemId(null)
                              }}
                              className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-50 italic">
                              Niemand
                            </button>
                            {approvedUsers.map(u => (
                              <button key={u.uid}
                                onClick={() => {
                                  setChecklist(prev => prev.map(i => i.id === item.id
                                    ? { ...i, assigneeUid: u.uid, assigneeName: u.displayName || u.username }
                                    : i))
                                  setAssigneePickerItemId(null)
                                }}
                                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2
                                  ${item.assigneeUid === u.uid ? 'text-primary-700 font-semibold' : 'text-gray-700'}`}>
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0
                                  ${item.assigneeUid === u.uid ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                                  {(u.displayName || u.username).split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')}
                                </span>
                                <span className="truncate">{u.displayName || u.username}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {canEdit && (
                      <button onClick={() => setChecklist(prev => prev.filter(i => i.id !== item.id))}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all mt-0.5">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {canEdit && (
              <div className="flex gap-2 items-center">
                <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newCheckItem.trim()) {
                      setChecklist(prev => [...prev, {
                        id: `ci_${Date.now()}`, text: newCheckItem.trim(), done: false,
                        assigneeUid: newCheckAssigneeUid || undefined,
                        assigneeName: newCheckAssigneeName || undefined,
                      }])
                      setNewCheckItem('')
                      setNewCheckAssigneeUid('')
                      setNewCheckAssigneeName('')
                    }
                  }}
                  placeholder="Punkt hinzufügen…"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
                {/* assignee picker for new item */}
                <div className="relative z-50">
                  <button
                    type="button"
                    onClick={() => setAssigneePickerItemId(prev => prev === '__new' ? null : '__new')}
                    title={newCheckAssigneeName || 'Verantwortliche/n zuweisen'}
                    className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold border transition-colors
                      ${newCheckAssigneeName
                        ? 'bg-primary-100 text-primary-700 border-primary-300 hover:bg-primary-200'
                        : 'bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200'}`}>
                    {newCheckAssigneeName
                      ? newCheckAssigneeName.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                      : <User className="w-3.5 h-3.5" />}
                  </button>
                  {assigneePickerItemId === '__new' && (
                    <div className="absolute right-0 bottom-9 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-44 max-h-52 overflow-y-auto">
                      <button
                        onClick={() => { setNewCheckAssigneeUid(''); setNewCheckAssigneeName(''); setAssigneePickerItemId(null) }}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-50 italic">
                        Niemand
                      </button>
                      {approvedUsers.map(u => (
                        <button key={u.uid}
                          onClick={() => {
                            setNewCheckAssigneeUid(u.uid)
                            setNewCheckAssigneeName(u.displayName || u.username)
                            setAssigneePickerItemId(null)
                          }}
                          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2
                            ${newCheckAssigneeUid === u.uid ? 'text-primary-700 font-semibold' : 'text-gray-700'}`}>
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0
                            ${newCheckAssigneeUid === u.uid ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                            {(u.displayName || u.username).split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')}
                          </span>
                          <span className="truncate">{u.displayName || u.username}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  disabled={!newCheckItem.trim()}
                  onClick={() => {
                    if (!newCheckItem.trim()) return
                    setChecklist(prev => [...prev, {
                      id: `ci_${Date.now()}`, text: newCheckItem.trim(), done: false,
                      assigneeUid: newCheckAssigneeUid || undefined,
                      assigneeName: newCheckAssigneeName || undefined,
                    }])
                    setNewCheckItem('')
                    setNewCheckAssigneeUid('')
                    setNewCheckAssigneeName('')
                  }}
                  className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-40 transition-colors">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Members */}
          {(canEdit || members.length > 0) && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Mitglieder</span>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap gap-1.5">
                  {approvedUsers.map(u => {
                    const active = members.some(m => m.uid === u.uid)
                    const initials = (u.displayName || u.username).split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                    return (
                      <button key={u.uid}
                        onClick={() => setMembers(prev => active ? prev.filter(m => m.uid !== u.uid) : [...prev, { uid: u.uid, name: u.displayName || u.username }])}
                        title={u.displayName || u.username}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${active ? 'bg-primary-100 text-primary-700 border-primary-300 hover:bg-primary-200' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${active ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                          {initials}
                        </span>
                        {u.displayName || u.username}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {members.map(m => {
                    const initials = m.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                    return (
                      <span key={m.uid} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium bg-primary-50 text-primary-700 border-primary-200">
                        <span className="w-5 h-5 rounded-full bg-primary-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">{initials}</span>
                        {m.name}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Assignee — only when board targets everyone */}
          {board.visibleTo === 'all' && isManager && (
            <div>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Zugewiesen an</span>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <button onClick={() => { setAssigneeKey(''); setAssigneeType('none'); setAssigneeName(''); setAssigneeRole('') }}
                  className={`text-xs px-2 py-1 rounded-lg border font-medium transition-colors ${assigneeType === 'none' ? 'bg-gray-200 text-gray-700 border-gray-300' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}>
                  Niemand
                </button>
                <button onClick={() => selectGroup('mpa')}
                  className={`text-xs px-2 py-1 rounded-lg border font-medium transition-colors ${assigneeKey === 'group_mpa' ? 'bg-violet-100 text-violet-700 border-violet-200' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}>
                  Alle MPA
                </button>
                <button onClick={() => selectGroup('arzt')}
                  className={`text-xs px-2 py-1 rounded-lg border font-medium transition-colors ${assigneeKey === 'group_arzt' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}>
                  Alle Ärzte
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-32 overflow-y-auto">
                {approvedUsers.filter(u => u.role === 'mpa' || u.role === 'arzt').map(u => (
                  <button key={u.uid} onClick={() => selectAssignee(u)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${assigneeKey === u.uid ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>
                    <span className="flex-1">{u.displayName || u.username}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${u.role === 'arzt' ? 'bg-blue-50 text-blue-600' : 'bg-violet-50 text-violet-600'}`}>
                      {u.role === 'arzt' ? 'Arzt' : 'MPA'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {board.visibleTo === 'all' && !isManager && assigneeName && (
            <div>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Zugewiesen an</span>
              <span className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 inline-block">{assigneeName}</span>
            </div>
          )}

          {/* Comments */}
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1 mb-2">
              <MessageSquare className="w-3.5 h-3.5" /> Kommentare ({comments.length})
            </span>
            <div className="space-y-2 max-h-48 overflow-y-auto mb-2">
              {comments.length === 0 && <p className="text-xs text-gray-400 italic">Noch keine Kommentare.</p>}
              {comments.map(c => {
                const ts = (c.createdAt as { seconds?: number })?.seconds
                return (
                  <div key={c.id} className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-gray-700">{c.authorName}</span>
                      {ts && <span className="text-[10px] text-gray-400">{new Date(ts * 1000).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.text}</p>
                  </div>
                )
              })}
              <div ref={commentEndRef} />
            </div>
            <div className="flex gap-2">
              <input value={newComment} onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComment() } }}
                placeholder="Kommentar schreiben…"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
              <button onClick={handleComment} disabled={!newComment.trim() || postingComment}
                className="px-3 py-2 text-sm font-semibold bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors">
                {postingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Senden'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-t border-gray-100 pb-safe">
          <span className={`text-xs text-green-600 transition-opacity duration-500 ${saved ? 'opacity-100' : 'opacity-0'}`}>
            Gespeichert ✓
          </span>
          <div className="flex-1" />
          {canEdit && allBoards.filter(b => b.id !== board.id).length > 0 && (
            <button onClick={() => setShowMoveCard(true)}
              title="In anderes Board verschieben"
              className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 border border-gray-200 rounded-xl transition-colors">
              <ArrowRightLeft className="w-4 h-4" />
            </button>
          )}
          {canDelete && (
            <button onClick={handleDelete}
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 border border-gray-200 rounded-xl transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Move card modal */}
      {showMoveCard && (
        <MoveCardModal
          card={card}
          allBoards={allBoards.filter(b => b.id !== board.id)}
          onClose={() => setShowMoveCard(false)}
          onMoved={onClose}
        />
      )}
    </div>
  )
}

// ── Move card to another board ─────────────────────────────────────────────────
function MoveCardModal({ card, allBoards, onClose, onMoved }: {
  card: TaskCard
  allBoards: TaskBoard[]
  onClose: () => void
  onMoved: () => void
}) {
  const [targetBoardId, setTargetBoardId] = useState(allBoards[0]?.id ?? '')
  const [moving, setMoving] = useState(false)
  const targetBoard = allBoards.find(b => b.id === targetBoardId)
  const cols = targetBoard ? targetBoard.columns.slice().sort((a, b) => a.order - b.order) : []
  const [targetColId, setTargetColId] = useState(cols[0]?.id ?? '')

  // sync column when board changes
  useEffect(() => {
    const b = allBoards.find(b => b.id === targetBoardId)
    const firstCol = b?.columns.slice().sort((a, b) => a.order - b.order)[0]
    setTargetColId(firstCol?.id ?? '')
  }, [targetBoardId])

  async function doMove() {
    if (!targetBoardId || !targetColId) return
    setMoving(true)
    await updateCard(card.id, { boardId: targetBoardId, columnId: targetColId, order: Date.now() })
    onMoved()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-primary-600" /> Karte verschieben
          </h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Ziel-Board</label>
            <select value={targetBoardId} onChange={e => setTargetBoardId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400">
              {allBoards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Spalte</label>
            <select value={targetColId} onChange={e => setTargetColId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400">
              {cols.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Abbrechen</button>
          <button onClick={doMove} disabled={moving || !targetColId}
            className="px-4 py-2 text-sm font-semibold bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors flex items-center gap-1.5">
            {moving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
            Verschieben
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Column settings ────────────────────────────────────────────────────────────
function ColumnSettings({ board, onClose }: { board: TaskBoard; onClose: () => void }) {
  const [columns, setColumns] = useState(board.columns.slice().sort((a, b) => a.order - b.order))
  const [newName, setNewName] = useState('')

  function applyAndSave(newCols: typeof columns) {
    setColumns(newCols)
    updateBoard(board.id, { columns: newCols.map((c, i) => ({ ...c, order: i })) })
  }

  function addCol() {
    if (!newName.trim()) return
    applyAndSave([...columns, { id: `col_${Date.now()}`, name: newName.trim(), order: columns.length }])
    setNewName('')
  }

  function moveUp(i: number) {
    if (i === 0) return
    const a = [...columns]; [a[i-1], a[i]] = [a[i], a[i-1]]; applyAndSave(a)
  }
  function moveDown(i: number) {
    if (i >= columns.length - 1) return
    const a = [...columns]; [a[i], a[i+1]] = [a[i+1], a[i]]; applyAndSave(a)
  }
  function removeCol(i: number) {
    applyAndSave(columns.filter((_, j) => j !== i))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Spalten verwalten</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="space-y-1.5">
          {columns.map((col, i) => (
            <div key={col.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <GripVertical className="w-3.5 h-3.5 text-gray-300" />
              <span className="flex-1 text-sm text-gray-700">{col.name}</span>
              <button onClick={() => moveUp(i)} disabled={i === 0} className="text-gray-300 hover:text-gray-500 disabled:opacity-20 text-xs">▲</button>
              <button onClick={() => moveDown(i)} disabled={i === columns.length - 1} className="text-gray-300 hover:text-gray-500 disabled:opacity-20 text-xs">▼</button>
              <button onClick={() => removeCol(i)} className="text-gray-300 hover:text-red-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCol()}
            placeholder="Neue Spalte…"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
          <button onClick={addCol} disabled={!newName.trim()} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-40">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main board page ────────────────────────────────────────────────────────────
export default function TaskBoardPage() {
  const { boardId } = useParams<{ boardId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { profile, isAdmin, isGeschaeftsleitung, isReadOnly } = useAuth()
  const isManager = isAdmin || isGeschaeftsleitung

  const [board, setBoard]   = useState<TaskBoard | null>(null)
  const [allBoards, setAllBoards] = useState<TaskBoard[]>([])
  const [cards, setCards]   = useState<TaskCard[]>([])
  const [selectedCard, setSelectedCard] = useState<TaskCard | null>(null)
  const [showColSettings, setShowColSettings] = useState(false)
  const [approvedUsers, setApprovedUsers] = useState<UserProfile[]>([])
  const [addingInCol, setAddingInCol] = useState<string | null>(null)
  const [newCardTitle, setNewCardTitle] = useState('')
  // Board toolbar
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [onlyMine, setOnlyMine] = useState(false)
  const [sortByDue, setSortByDue] = useState(false)

  // Drag state
  const [draggingId, setDraggingId]   = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [dragOverCard, setDragOverCard] = useState<string | null>(null)
  const canAddCard = isManager || board?.createdByUid === profile?.uid || !isReadOnly

  // Touch drag refs (avoid stale-closure issues)
  const isTouchDraggingRef  = useRef(false)
  const touchTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartRef       = useRef<{x:number;y:number}|null>(null)
  const touchDragColRef     = useRef<string|null>(null)
  const touchDragCardRef    = useRef<string|null>(null)

  useEffect(() => {
    if (!boardId) return
    const unsub = subscribeBoards(boards => {
      const b = boards.find(x => x.id === boardId)
      setBoard(b ?? null)
      setAllBoards(boards)
    })
    return unsub
  }, [boardId])

  useEffect(() => {
    if (!boardId) return
    return subscribeBoardCards(boardId, setCards)
  }, [boardId])

  useEffect(() => {
    const cardId = searchParams.get('card')
    if (!cardId || cards.length === 0) return
    const target = cards.find(c => c.id === cardId)
    if (target) {
      setSelectedCard(target)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, cards])

  useEffect(() => {
    getDocs(query(collection(db, 'users'), where('status', '==', 'approved'))).then(snap => {
      setApprovedUsers(snap.docs.map(d => d.data() as UserProfile)
        .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username)))
    })
  }, [])

  if (!board) return (
    <div className="flex items-center justify-center py-20 text-sm text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Wird geladen…
    </div>
  )

  const col = BOARD_COLORS.find(c => c.id === board.color) ?? BOARD_COLORS[0]
  const sortedCols = board.columns.slice().sort((a, b) => a.order - b.order)

  function filterCard(card: TaskCard): boolean {
    // Visibility
    const visible = isManager ||
      card.members.some(m => m.uid === profile?.uid) ||
      card.assigneeType === 'none' ||
      (card.assigneeType === 'group' && card.assigneeKey === `group_${profile?.role}`) ||
      (card.assigneeType === 'user' && card.assigneeKey === profile?.uid)
    if (!visible) return false
    // Only-mine filter
    if (onlyMine) {
      const mine = card.createdByUid === profile?.uid ||
        card.members.some(m => m.uid === profile?.uid) ||
        (card.assigneeType === 'user' && card.assigneeKey === profile?.uid)
      if (!mine) return false
    }
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      if (!card.title.toLowerCase().includes(q) && !card.description.toLowerCase().includes(q)) return false
    }
    return true
  }

  function colCards(colId: string) {
    const filtered = cards.filter(c => c.columnId === colId && filterCard(c))
    if (sortByDue) {
      return filtered.slice().sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return a.order - b.order
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return a.dueDate.localeCompare(b.dueDate)
      })
    }
    return filtered.slice().sort((a, b) => a.order - b.order)
  }

  async function handleAddCard(colId: string) {
    if (!newCardTitle.trim() || !board) return
    const existing = colCards(colId)
    const maxOrder = existing.length > 0 ? Math.max(...existing.map(c => c.order)) : 0
    await createCard({
      boardId: board.id, columnId: colId,
      title: newCardTitle.trim(), description: '', order: maxOrder + 1000,
      dueDate: null, labels: [], done: false, attachments: [], checklist: [], members: [],
      assigneeType: 'none', assigneeKey: '', assigneeName: '', assigneeRole: '',
      createdBy: profile?.displayName || profile?.username || '',
      createdByUid: profile?.uid || '',
    })
    setNewCardTitle('')
    setAddingInCol(null)
  }

  async function handleDrop(targetColId: string, targetCardId?: string) {
    if (!draggingId) return
    const card = cards.find(c => c.id === draggingId)
    if (!card) return

    const targetColCards = colCards(targetColId).filter(c => c.id !== draggingId)

    let newOrder: number
    if (!targetCardId) {
      // Dropped on column (not on card) — place at end
      newOrder = targetColCards.length > 0 ? Math.max(...targetColCards.map(c => c.order)) + 1000 : 1000
    } else {
      const idx = targetColCards.findIndex(c => c.id === targetCardId)
      const prev = targetColCards[idx - 1]?.order ?? 0
      const curr = targetColCards[idx]?.order ?? prev + 2000
      newOrder = (prev + curr) / 2
    }

    setDraggingId(null); setDragOverCol(null); setDragOverCard(null)
    await updateCard(card.id, { columnId: targetColId, order: newOrder })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Board header */}
      <div className={`${col.bg} px-4 py-3 flex items-center gap-3`}>
        <BackButton
          fallback="/aufgaben"
          label=""
          className="text-white/80 hover:text-white transition-colors flex items-center"
        />
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-white text-base truncate">{board.name}</h1>
          {board.description && <p className="text-white/70 text-xs truncate">{board.description}</p>}
          {board.visibleTo === 'user' && (() => {
            const uids = board.visibleToUids?.length ? board.visibleToUids : board.visibleToUid ? [board.visibleToUid] : []
            const names = uids.map(uid => approvedUsers.find(u => u.uid === uid)).filter(Boolean) as typeof approvedUsers
            if (!names.length) return null
            return (
              <div className="flex flex-wrap gap-1 mt-1">
                {names.map(u => (
                  <span key={u.uid} className="inline-flex items-center gap-1 text-[10px] font-semibold bg-white/20 text-white px-1.5 py-0.5 rounded-full">
                    <span className="w-3 h-3 rounded-full bg-white/40 flex items-center justify-center text-[8px] font-bold shrink-0">
                      {(u.displayName || u.username).split(' ').filter(Boolean).slice(0,2).map((w:string) => w[0].toUpperCase()).join('')}
                    </span>
                    {u.displayName || u.username}
                  </span>
                ))}
              </div>
            )
          })()}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery('') }}
            title="Suchen"
            className={`flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors ${showSearch ? 'bg-white/30 text-white' : 'text-white/70 hover:text-white bg-white/10 hover:bg-white/20'}`}>
            <Search className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setSortByDue(s => !s)}
            title="Nach Fälligkeit sortieren"
            className={`flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors ${sortByDue ? 'bg-white/30 text-white' : 'text-white/70 hover:text-white bg-white/10 hover:bg-white/20'}`}>
            <SortAsc className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setOnlyMine(s => !s)}
            title="Nur meine Aufgaben"
            className={`flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors ${onlyMine ? 'bg-white/30 text-white' : 'text-white/70 hover:text-white bg-white/10 hover:bg-white/20'}`}>
            <UserCheck className="w-3.5 h-3.5" />
          </button>
          {isManager && (
            <button onClick={() => setShowColSettings(true)}
              title="Spalten verwalten"
              className="flex items-center gap-1.5 text-xs font-semibold text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-2.5 py-1.5 rounded-lg transition-colors">
              <Settings className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Spalten</span>
            </button>
          )}
        </div>
      </div>
      {showSearch && (
        <div className={`${col.bg} px-4 pb-2`}>
          <input
            autoFocus
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Karten suchen…"
            className="w-full bg-white/20 placeholder-white/60 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:bg-white/30 border border-white/20"
          />
        </div>
      )}


      {/* Kanban columns */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 p-4 h-full min-h-0" style={{ minWidth: `${sortedCols.length * 280}px` }}>
          {sortedCols.map(column => {
            const columnCards = colCards(column.id)
            const openCount = columnCards.filter(c => !c.done).length
            const isOver = dragOverCol === column.id && !dragOverCard

            return (
              <div key={column.id}
                data-col-id={column.id}
                className={`flex flex-col rounded-xl border-2 transition-colors w-[272px] shrink-0 ${isOver ? 'border-primary-300 bg-primary-50/30' : 'border-gray-200 bg-gray-50/80'}`}
                onDragOver={e => { e.preventDefault(); setDragOverCol(column.id) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragOverCol(null) } }}
                onDrop={e => { e.preventDefault(); handleDrop(column.id) }}>

                {/* Column header */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200">
                  <span className="text-xs font-bold text-gray-700 flex-1">{column.name}</span>
                  <span className="text-xs font-semibold text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 py-0.5">{openCount}</span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {columnCards.map(card => {
                    const isDragging = draggingId === card.id
                    const isOverThis = dragOverCard === card.id
                    return (
                      <div key={card.id}
                        data-card-id={card.id}
                        draggable
                        onDragStart={() => setDraggingId(card.id)}
                        onDragEnd={() => { setDraggingId(null); setDragOverCol(null); setDragOverCard(null) }}
                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverCol(column.id); setDragOverCard(card.id) }}
                        onDrop={e => { e.preventDefault(); e.stopPropagation(); handleDrop(column.id, card.id) }}
                        onClick={() => { if (!isTouchDraggingRef.current) setSelectedCard(card) }}
                        onTouchStart={e => {
                          touchStartRef.current = {x: e.touches[0].clientX, y: e.touches[0].clientY}
                          touchDragColRef.current = column.id
                          touchDragCardRef.current = null
                          touchTimerRef.current = setTimeout(() => {
                            isTouchDraggingRef.current = true
                            setDraggingId(card.id)
                          }, 400)
                        }}
                        onTouchMove={e => {
                          if (!isTouchDraggingRef.current) {
                            const dx = e.touches[0].clientX - (touchStartRef.current?.x ?? 0)
                            const dy = e.touches[0].clientY - (touchStartRef.current?.y ?? 0)
                            if (Math.hypot(dx, dy) > 10 && touchTimerRef.current) {
                              clearTimeout(touchTimerRef.current); touchTimerRef.current = null
                            }
                            return
                          }
                          const touch = e.touches[0]
                          const el = document.elementFromPoint(touch.clientX, touch.clientY)
                          const cardEl = el?.closest('[data-card-id]') as HTMLElement | null
                          const colEl = el?.closest('[data-col-id]') as HTMLElement | null
                          const overId = cardEl?.dataset.cardId
                          const overColId = colEl?.dataset.colId
                          if (overId && overId !== card.id) {
                            touchDragCardRef.current = overId
                            touchDragColRef.current = overColId ?? column.id
                            setDragOverCard(overId)
                            if (overColId) setDragOverCol(overColId)
                          } else if (overColId) {
                            touchDragCardRef.current = null
                            touchDragColRef.current = overColId
                            setDragOverCard(null)
                            setDragOverCol(overColId)
                          }
                        }}
                        onTouchEnd={async () => {
                          if (touchTimerRef.current) { clearTimeout(touchTimerRef.current); touchTimerRef.current = null }
                          if (!isTouchDraggingRef.current) return
                          isTouchDraggingRef.current = false
                          const targetColId = touchDragColRef.current ?? column.id
                          const targetCardId = touchDragCardRef.current ?? undefined
                          const targetColCards = colCards(targetColId).filter(c => c.id !== card.id)
                          let newOrder: number
                          if (!targetCardId) {
                            newOrder = targetColCards.length > 0 ? Math.max(...targetColCards.map(c => c.order)) + 1000 : 1000
                          } else {
                            const idx = targetColCards.findIndex(c => c.id === targetCardId)
                            const prev = targetColCards[idx - 1]?.order ?? 0
                            const curr = targetColCards[idx]?.order ?? prev + 2000
                            newOrder = (prev + curr) / 2
                          }
                          setDraggingId(null); setDragOverCol(null); setDragOverCard(null)
                          touchDragColRef.current = null; touchDragCardRef.current = null
                          await updateCard(card.id, { columnId: targetColId, order: newOrder })
                        }}
                        className={`bg-white border rounded-xl p-3 cursor-pointer hover:shadow-md transition-all select-none ${isDragging ? 'opacity-30' : ''} ${isOverThis ? 'ring-2 ring-primary-400 border-primary-300' : 'border-gray-200'} ${card.done ? 'opacity-60' : ''}`}>

                        {/* Labels */}
                        {card.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            {card.labels.map(l => (
                              <span key={l.id} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${LABEL_COLOR_MAP[l.id] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                {l.name}
                              </span>
                            ))}
                          </div>
                        )}

                        <p className={`text-sm font-medium leading-snug ${card.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                          {card.title}
                        </p>

                        {card.description && (
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{card.description}</p>
                        )}

                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {card.dueDate && (
                            <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${dueStyle(card.dueDate, card.done)}`}>
                              <Clock className="w-3 h-3" />{formatDue(card.dueDate)}
                            </span>
                          )}
                          {card.checklist.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
                              <CheckSquare className="w-3 h-3" />
                              {card.checklist.filter(i => i.done).length}/{card.checklist.length}
                            </span>
                          )}
                          {card.members.length > 0 && (
                            <div className="flex -space-x-1 ml-auto">
                              {card.members.slice(0, 4).map(m => (
                                <span key={m.uid} title={m.name}
                                  className="w-5 h-5 rounded-full bg-primary-200 text-primary-800 text-[9px] font-bold flex items-center justify-center border border-white">
                                  {m.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')}
                                </span>
                              ))}
                            </div>
                          )}
                          {!card.members.length && card.assigneeName && (
                            <span className="text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5 ml-auto">
                              {card.assigneeName}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Drop zone at bottom of column */}
                  {draggingId && (
                    <div className={`h-10 rounded-xl border-2 border-dashed transition-colors ${isOver ? 'border-primary-300 bg-primary-50' : 'border-gray-200'}`}
                      onDragOver={e => { e.preventDefault(); setDragOverCol(column.id); setDragOverCard(null) }}
                      onDrop={e => { e.preventDefault(); handleDrop(column.id) }} />
                  )}
                </div>

                {/* Add card */}
                {canAddCard && (
                  <div className="p-2 border-t border-gray-200">
                    {addingInCol === column.id ? (
                      <div className="space-y-1.5">
                        <input autoFocus value={newCardTitle} onChange={e => setNewCardTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddCard(column.id); if (e.key === 'Escape') setAddingInCol(null) }}
                          placeholder="Kartentitel…"
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
                        <div className="flex gap-1">
                          <button onClick={() => handleAddCard(column.id)} disabled={!newCardTitle.trim()}
                            className="flex-1 text-xs font-semibold py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors">
                            Hinzufügen
                          </button>
                          <button onClick={() => { setAddingInCol(null); setNewCardTitle('') }}
                            className="px-2 text-gray-400 hover:text-gray-600">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setAddingInCol(column.id); setNewCardTitle('') }}
                        className="w-full flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-white rounded-lg px-2 py-1.5 transition-colors">
                        <Plus className="w-3.5 h-3.5" /> Karte hinzufügen
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {selectedCard && (
        <CardDetail
          card={selectedCard}
          board={board}
          onClose={() => setSelectedCard(null)}
          isManager={isManager}
          profile={profile}
          approvedUsers={approvedUsers}
          allBoards={allBoards}
        />
      )}

      {showColSettings && (
        <ColumnSettings board={board} onClose={() => setShowColSettings(false)} />
      )}
    </div>
  )
}
