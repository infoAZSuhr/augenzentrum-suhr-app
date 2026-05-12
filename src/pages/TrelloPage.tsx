import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, collection, addDoc, updateDoc, serverTimestamp, getDocs, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth, UserProfile } from '../lib/AuthContext'
import { Plus, Settings, Clock, Loader2, AlertCircle, ExternalLink, X, LayoutList, CheckCircle2, Circle, User, Users, Pencil, Kanban } from 'lucide-react'

interface TrelloConfig {
  apiKey: string
  token: string
  boardId: string
  lists: { id: string; name: string }[]
  listMpa: string
  listArzt: string
}

interface TrelloCard {
  id: string
  name: string
  desc: string
  due: string | null
  dueComplete: boolean
  shortUrl: string
  closed: boolean
  labels: { id: string; name: string; color: string }[]
}

type TaskStatus = 'open' | 'in_progress' | 'done'

interface MyTask {
  id: string
  title: string
  description: string
  dueDate: string | null
  status: TaskStatus
  assigneeType: 'user' | 'group' | 'self'
  assigneeKey: string
  assigneeName: string
  assigneeRole: string
  trelloCardId: string
  trelloCardUrl: string
  createdBy: string
  card?: TrelloCard
}

type AssignMode = 'user' | 'group' | 'self'
type GroupTarget = 'mpa' | 'arzt' | 'both'
type ViewMode = 'list' | 'board'

const COLUMNS: { id: TaskStatus; label: string; color: string; dot: string }[] = [
  { id: 'open',        label: 'Offen',          color: 'border-gray-200 bg-gray-50',    dot: 'bg-gray-400' },
  { id: 'in_progress', label: 'In Bearbeitung',  color: 'border-amber-200 bg-amber-50',  dot: 'bg-amber-400' },
  { id: 'done',        label: 'Erledigt',        color: 'border-green-200 bg-green-50',  dot: 'bg-green-500' },
]

const TRELLO_API = 'https://api.trello.com/1'

function dueStyle(due: string | null, complete: boolean): string {
  if (complete) return 'text-green-600 bg-green-50 border-green-200'
  if (!due) return 'text-gray-400'
  const diff = (new Date(due).getTime() - Date.now()) / 86400000
  if (diff < 0) return 'text-red-600 bg-red-50 border-red-200'
  if (diff < 2) return 'text-amber-600 bg-amber-50 border-amber-200'
  return 'text-gray-500 bg-gray-50 border-gray-200'
}

function formatDue(due: string): string {
  return new Date(due).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function CardItem({
  card, apiKey, token, onToggle, onEdit,
}: {
  card: TrelloCard; apiKey: string; token: string
  onToggle: (id: string, val: boolean) => void
  onEdit: () => void
}) {
  const [toggling, setToggling] = useState(false)

  async function handleToggle() {
    setToggling(true)
    try {
      const newVal = !card.dueComplete
      await fetch(`${TRELLO_API}/cards/${card.id}?key=${apiKey}&token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueComplete: newVal }),
      })
      onToggle(card.id, newVal)
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className={`bg-white border rounded-xl px-4 py-3 flex items-start gap-3 transition-opacity ${card.dueComplete ? 'opacity-60 border-gray-100' : 'border-gray-200'}`}>
      <button onClick={handleToggle} disabled={toggling}
        className="shrink-0 mt-0.5 text-gray-300 hover:text-green-500 transition-colors disabled:opacity-40">
        {toggling
          ? <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
          : card.dueComplete
            ? <CheckCircle2 className="w-5 h-5 text-green-500" />
            : <Circle className="w-5 h-5" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`font-medium text-sm leading-snug ${card.dueComplete ? 'line-through text-gray-400' : 'text-gray-800'}`}>
          {card.name}
        </p>
        {card.desc && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{card.desc}</p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {card.due && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${dueStyle(card.due, card.dueComplete)}`}>
              <Clock className="w-3 h-3" />
              {card.dueComplete ? 'Erledigt' : formatDue(card.due)}
            </span>
          )}
          {card.labels.map(l => (
            <span key={l.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
              {l.name || l.color}
            </span>
          ))}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-1">
        <button onClick={onEdit}
          className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 bg-gray-50 border border-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">
          <Pencil className="w-3 h-3" />
        </button>
        {card.shortUrl && (
          <a href={card.shortUrl} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded-lg hover:bg-blue-100 transition-colors">
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  )
}

// Offline card fallback (no Trello config)
function SimpleTaskItem({ task, onEdit }: { task: MyTask; onEdit: () => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-3">
      <Circle className="w-5 h-5 text-gray-300 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-gray-800">{task.title}</p>
        {task.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{task.description}</p>}
        {task.dueDate && (
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border mt-1 ${dueStyle(task.dueDate, false)}`}>
            <Clock className="w-3 h-3" />{formatDue(task.dueDate)}
          </span>
        )}
      </div>
      <button onClick={onEdit}
        className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-gray-500 bg-gray-50 border border-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  )
}

function EditModal({ task, config, onSave, onClose }: {
  task: MyTask
  config: TrelloConfig | null
  onSave: (updated: Partial<MyTask>) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc] = useState(task.description)
  const [due, setDue] = useState(task.dueDate ? task.dueDate.slice(0, 10) : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true); setErr('')
    try {
      const dueIso = due ? new Date(due).toISOString() : null

      // Update Trello card if available
      if (task.trelloCardId && config?.apiKey) {
        const res = await fetch(`${TRELLO_API}/cards/${task.trelloCardId}?key=${config.apiKey}&token=${config.token}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: title.trim(), desc: desc.trim(), due: dueIso }),
        })
        if (!res.ok) throw new Error(`Trello Fehler (${res.status})`)
      }

      // Update Firestore
      await updateDoc(doc(db, 'trelloTasks', task.id), {
        title: title.trim(),
        description: desc.trim(),
        dueDate: due || null,
      })

      onSave({ title: title.trim(), description: desc.trim(), dueDate: due || null })
      onClose()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md space-y-4 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary-600" />
            Aufgabe bearbeiten
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Titel *</span>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Beschreibung</span>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-400" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fälligkeit</span>
          <input type="date" value={due} onChange={e => setDue(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
        </label>

        {err && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />{err}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} disabled={!title.trim() || saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  )
}

function BoardView({ tasks, config, onEdit, onStatusChange }: {
  tasks: MyTask[]
  config: TrelloConfig | null
  onEdit: (task: MyTask) => void
  onStatusChange: (taskId: string, newStatus: TaskStatus) => void
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null)

  function taskStatus(t: MyTask): TaskStatus {
    if (t.status) return t.status
    return t.card?.dueComplete ? 'done' : 'open'
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {COLUMNS.map(col => {
        const colTasks = tasks.filter(t => taskStatus(t) === col.id)
        return (
          <div key={col.id}
            className={`flex-1 min-w-[220px] rounded-xl border-2 transition-colors ${dragOver === col.id ? col.color + ' scale-[1.01]' : 'border-gray-200 bg-gray-50/50'}`}
            onDragOver={e => { e.preventDefault(); setDragOver(col.id) }}
            onDragLeave={() => setDragOver(null)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(null)
              if (dragging && dragging !== col.id + '_header') onStatusChange(dragging, col.id)
              setDragging(null)
            }}>

            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200">
              <span className={`w-2 h-2 rounded-full ${col.dot}`} />
              <span className="text-xs font-bold text-gray-700">{col.label}</span>
              <span className="ml-auto text-xs font-semibold text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 py-0.5">
                {colTasks.length}
              </span>
            </div>

            {/* Cards */}
            <div className="p-2 space-y-2 min-h-[80px]">
              {colTasks.map(task => {
                const due = task.card?.due ?? task.dueDate
                const done = taskStatus(task) === 'done'
                return (
                  <div key={task.id}
                    draggable
                    onDragStart={() => setDragging(task.id)}
                    onDragEnd={() => { setDragging(null); setDragOver(null) }}
                    className={`bg-white border rounded-xl p-3 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-all select-none ${dragging === task.id ? 'opacity-40' : ''} ${done ? 'opacity-60' : 'border-gray-200'}`}>

                    <div className="flex items-start justify-between gap-1 mb-1">
                      <p className={`text-sm font-medium leading-snug flex-1 ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                        {task.title}
                      </p>
                      <button onClick={() => onEdit(task)}
                        className="shrink-0 text-gray-300 hover:text-gray-500 transition-colors p-0.5 rounded">
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>

                    {task.description && (
                      <p className="text-xs text-gray-400 line-clamp-2 mb-1.5">{task.description}</p>
                    )}

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {task.assigneeName && (
                        <span className="text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">
                          {task.assigneeName}
                        </span>
                      )}
                      {task.assigneeType === 'group' && (
                        <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${task.assigneeRole === 'mpa' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`}>
                          {task.assigneeRole === 'mpa' ? 'Alle MPA' : 'Alle Ärzte'}
                        </span>
                      )}
                      {due && (
                        <span className={`text-[10px] font-medium inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border ${dueStyle(due, done)}`}>
                          <Clock className="w-2.5 h-2.5" />{formatDue(due)}
                        </span>
                      )}
                      {task.trelloCardUrl && config?.apiKey && (
                        <a href={task.trelloCardUrl} target="_blank" rel="noreferrer"
                          className="text-[10px] font-semibold text-blue-500 hover:text-blue-700 transition-colors ml-auto">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

async function enrichTasksWithTrello(tasks: MyTask[], cfg: TrelloConfig | null): Promise<MyTask[]> {
  if (!cfg?.apiKey || tasks.length === 0) return tasks
  const fields = 'name,desc,due,dueComplete,shortUrl,closed,labels'
  const results = await Promise.all(
    tasks.map(t =>
      t.trelloCardId
        ? fetch(`${TRELLO_API}/cards/${t.trelloCardId}?fields=${fields}&key=${cfg.apiKey}&token=${cfg.token}`)
            .then(r => r.ok ? r.json() as Promise<TrelloCard> : null)
            .catch(() => null)
        : Promise.resolve(null)
    )
  )
  return tasks.map((t, i) => ({ ...t, card: results[i] ?? undefined }))
}

export default function TrelloPage() {
  const { profile, isAdmin, isGeschaeftsleitung } = useAuth()
  const canCreate = isAdmin || isGeschaeftsleitung
  const isEmployee = profile?.role === 'mpa' || profile?.role === 'arzt'
  const isManager = isAdmin || isGeschaeftsleitung

  // Config state
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState<TrelloConfig | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [token, setToken] = useState('')
  const [boardId, setBoardId] = useState('')
  const [lists, setLists] = useState<{ id: string; name: string }[]>([])
  const [listMpa, setListMpa] = useState('')
  const [listArzt, setListArzt] = useState('')
  const [configSaved, setConfigSaved] = useState(false)
  const [loadingLists, setLoadingLists] = useState(false)
  const [listsError, setListsError] = useState('')

  // All tasks (GL/Admin) — sourced from Firestore + live Trello status
  const [allTasks, setAllTasks] = useState<MyTask[]>([])
  const [loadingAllTasks, setLoadingAllTasks] = useState(false)

  // Edit modal
  const [editingTask, setEditingTask] = useState<MyTask | null>(null)

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('list')

  // Personal + group tasks (MPA/Arzt)
  const [myTasks, setMyTasks] = useState<MyTask[]>([])
  const [loadingMyTasks, setLoadingMyTasks] = useState(false)
  const [myTasksError, setMyTasksError] = useState('')

  // Users for assignment
  const [approvedUsers, setApprovedUsers] = useState<UserProfile[]>([])

  // Task form
  const [assignMode, setAssignMode] = useState<AssignMode>('user')
  const [groupTarget, setGroupTarget] = useState<GroupTarget>('mpa')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskDue, setTaskDue] = useState('')
  const [taskAssignees, setTaskAssignees] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [createSuccess, setCreateSuccess] = useState(false)

  function toggleAssignee(uid: string) {
    setTaskAssignees(prev => prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid])
  }
  function selectAllRole(role: 'mpa' | 'arzt') {
    const uids = approvedUsers.filter(u => u.role === role).map(u => u.uid)
    const allSelected = uids.every(uid => taskAssignees.includes(uid))
    setTaskAssignees(prev => allSelected ? prev.filter(u => !uids.includes(u)) : [...new Set([...prev, ...uids])])
  }

  useEffect(() => {
    getDocs(query(collection(db, 'users'), where('status', '==', 'approved'))).then(snap => {
      const users = snap.docs.map(d => d.data() as UserProfile)
        .filter(u => u.role === 'mpa' || u.role === 'arzt')
        .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username))
      setApprovedUsers(users)
    })
  }, [])

  useEffect(() => {
    getDoc(doc(db, 'settings', 'trello')).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as TrelloConfig
        setConfig(d)
        setApiKey(d.apiKey || '')
        setToken(d.token || '')
        setBoardId(d.boardId || '')
        setLists(d.lists || [])
        setListMpa(d.listMpa || '')
        setListArzt(d.listArzt || '')
      }
    })
  }, [])

  // All tasks listener (GL/Admin) — Firestore is source of truth
  useEffect(() => {
    if (!isManager || !profile?.uid) return
    setLoadingAllTasks(true)
    const q = query(collection(db, 'trelloTasks'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, async snap => {
      const uid = profile.uid
      const tasks: MyTask[] = snap.docs
        .map(d => {
          const data = d.data()
          return {
            id: d.id, title: data.title || '', description: data.description || '',
            dueDate: data.dueDate || null, status: (data.status || 'open') as TaskStatus,
            assigneeType: data.assigneeType || 'user',
            assigneeKey: data.assigneeKey || '', assigneeName: data.assigneeName || '',
            assigneeRole: data.assigneeRole || '',
            trelloCardId: data.trelloCardId || '', trelloCardUrl: data.trelloCardUrl || '',
            createdBy: data.createdBy || '',
          }
        })
        // Hide other managers' self-tasks
        .filter(t => t.assigneeType !== 'self' || t.assigneeKey === `self_${uid}`)
      const cfg = await getDoc(doc(db, 'settings', 'trello')).then(s => s.exists() ? s.data() as TrelloConfig : null)
      setAllTasks(await enrichTasksWithTrello(tasks, cfg))
      setLoadingAllTasks(false)
    })
  }, [isManager, profile?.uid])

  // Personal + group tasks listener (MPA/Arzt)
  useEffect(() => {
    if (!isEmployee || !profile?.uid || !profile?.role) return
    setLoadingMyTasks(true)
    setMyTasksError('')
    const roleKey = `group_${profile.role}`
    const q = query(
      collection(db, 'trelloTasks'),
      where('assigneeKey', 'in', [profile.uid, roleKey]),
      orderBy('createdAt', 'desc'),
    )
    const unsub = onSnapshot(q, async snap => {
      const tasks: MyTask[] = snap.docs.map(d => {
        const data = d.data()
        return { id: d.id, title: data.title || '', description: data.description || '',
          dueDate: data.dueDate || null, status: (data.status || 'open') as TaskStatus,
          assigneeType: data.assigneeType || 'user',
          assigneeKey: data.assigneeKey || '', assigneeName: data.assigneeName || '',
          assigneeRole: data.assigneeRole || '', trelloCardId: data.trelloCardId || '',
          trelloCardUrl: data.trelloCardUrl || '', createdBy: data.createdBy || '' }
      })
      const cfg = await getDoc(doc(db, 'settings', 'trello')).then(s => s.exists() ? s.data() as TrelloConfig : null)
      setMyTasks(await enrichTasksWithTrello(tasks, cfg))
      setLoadingMyTasks(false)
    }, () => {
      setMyTasksError('Fehler beim Laden der Aufgaben.')
      setLoadingMyTasks(false)
    })
    return () => unsub()
  }, [isEmployee, profile?.uid, profile?.role])

  async function fetchListsFromTrello() {
    if (!apiKey || !token || !boardId) return
    setLoadingLists(true)
    setListsError('')
    const cleanBoardId = boardId.trim().replace(/^.*\/b\/([^/]+).*$/, '$1')
    if (cleanBoardId !== boardId) setBoardId(cleanBoardId)
    try {
      const res = await fetch(`${TRELLO_API}/boards/${cleanBoardId}/lists?key=${apiKey.trim()}&token=${token.trim()}`)
      if (res.status === 401) throw new Error('401 – Ungültiger API-Key oder Token.')
      if (res.status === 404) throw new Error('404 – Board nicht gefunden.')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) throw new Error('Keine Listen gefunden.')
      setLists(data.map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })))
    } catch (e: unknown) {
      setListsError(`Fehler: ${e instanceof Error ? e.message : 'Unbekannt'}`)
    } finally {
      setLoadingLists(false)
    }
  }

  async function saveConfig() {
    const cfg: TrelloConfig = { apiKey, token, boardId, lists, listMpa, listArzt }
    await setDoc(doc(db, 'settings', 'trello'), cfg)
    setConfig(cfg)
    setConfigSaved(true)
    setTimeout(() => setConfigSaved(false), 2500)
  }

  async function createTask() {
    if (!taskTitle.trim()) return
    if (assignMode === 'user' && taskAssignees.length === 0) return
    setCreating(true); setCreateErr(''); setCreateSuccess(false)
    try {
      const createdBy = profile?.displayName || profile?.username || ''

      if (assignMode === 'self') {
        // Firestore only — personal note, no Trello card
        await addDoc(collection(db, 'trelloTasks'), {
          title: taskTitle.trim(), description: taskDesc.trim(),
          dueDate: taskDue || null,
          assigneeUid: profile?.uid, assigneeName: createdBy,
          assigneeRole: profile?.role, assigneeKey: `self_${profile?.uid}`,
          assigneeType: 'self',
          trelloCardId: '', trelloCardUrl: '',
          createdBy, createdByUid: profile?.uid,
          createdAt: serverTimestamp(),
        })

      } else if (assignMode === 'group') {
        if (!config?.apiKey) throw new Error('Trello nicht konfiguriert.')
        const targets: Array<'mpa' | 'arzt'> = groupTarget === 'both' ? ['mpa', 'arzt'] : [groupTarget]
        await Promise.all(targets.map(async role => {
          const listId = role === 'mpa' ? config.listMpa : config.listArzt
          if (!listId) return
          const body = new URLSearchParams({ name: taskTitle.trim(), desc: taskDesc.trim(), idList: listId })
          if (taskDue) body.set('due', new Date(taskDue).toISOString())
          const res = await fetch(`${TRELLO_API}/cards?key=${config.apiKey}&token=${config.token}`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
          })
          if (!res.ok) throw new Error(`Trello Fehler (${res.status})`)
          const card = await res.json()
          await addDoc(collection(db, 'trelloTasks'), {
            title: taskTitle.trim(), description: taskDesc.trim(),
            dueDate: taskDue || null,
            assigneeRole: role, assigneeKey: `group_${role}`,
            assigneeType: 'group',
            trelloCardId: card.id, trelloCardUrl: card.shortUrl,
            createdBy, createdByUid: profile?.uid,
            createdAt: serverTimestamp(),
          })
        }))

      } else {
        // Individual users
        if (!config?.apiKey) throw new Error('Trello nicht konfiguriert.')
        const selectedUsers = approvedUsers.filter(u => taskAssignees.includes(u.uid))
        if (selectedUsers.length === 0) throw new Error('Keine Benutzer ausgewählt.')
        await Promise.all(selectedUsers.map(async user => {
          const listId = (user.role === 'mpa' ? config.listMpa : config.listArzt) || config.listMpa || config.listArzt
          if (!listId) return
          const name = user.displayName || user.username
          const desc = `Für: ${name}${taskDesc.trim() ? '\n\n' + taskDesc.trim() : ''}`
          const body = new URLSearchParams({ name: taskTitle.trim(), desc, idList: listId })
          if (taskDue) body.set('due', new Date(taskDue).toISOString())
          const res = await fetch(`${TRELLO_API}/cards?key=${config.apiKey}&token=${config.token}`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
          })
          if (!res.ok) throw new Error(`Trello Fehler (${res.status}) für ${name}`)
          const card = await res.json()
          await addDoc(collection(db, 'trelloTasks'), {
            title: taskTitle.trim(), description: taskDesc.trim(),
            dueDate: taskDue || null,
            assigneeUid: user.uid, assigneeName: name, assigneeRole: user.role,
            assigneeKey: user.uid, assigneeType: 'user',
            trelloCardId: card.id, trelloCardUrl: card.shortUrl,
            createdBy, createdByUid: profile?.uid,
            createdAt: serverTimestamp(),
          })
        }))
      }

      setTaskTitle(''); setTaskDesc(''); setTaskDue(''); setTaskAssignees([])
      setCreateSuccess(true)
      setTimeout(() => setCreateSuccess(false), 2500)
      // allTasks auto-updates via onSnapshot
    } catch (e: unknown) {
      setCreateErr(e instanceof Error ? e.message : 'Unbekannter Fehler')
    } finally {
      setCreating(false)
    }
  }

  const visibleTasks = isManager ? allTasks : myTasks
  const openCount = visibleTasks.filter(t => !t.card?.dueComplete).length
  const doneCount = visibleTasks.filter(t => t.card?.dueComplete).length

  function updateTaskInList(
    setter: React.Dispatch<React.SetStateAction<MyTask[]>>,
    id: string,
    changes: Partial<MyTask>,
  ) {
    setter(prev => prev.map(t => t.id === id ? { ...t, ...changes, card: t.card ? { ...t.card, name: changes.title ?? t.card.name, desc: changes.description ?? t.card.desc, due: changes.dueDate !== undefined ? changes.dueDate : t.card.due } : t.card } : t))
  }

  async function handleStatusChange(taskId: string, newStatus: TaskStatus) {
    const task = [...allTasks, ...myTasks].find(t => t.id === taskId)
    if (!task) return
    const done = newStatus === 'done'
    updateTaskInList(setAllTasks, taskId, { status: newStatus, card: task.card ? { ...task.card, dueComplete: done } : undefined })
    updateTaskInList(setMyTasks,  taskId, { status: newStatus, card: task.card ? { ...task.card, dueComplete: done } : undefined })
    await updateDoc(doc(db, 'trelloTasks', taskId), { status: newStatus })
    if (task.trelloCardId && config?.apiKey) {
      fetch(`${TRELLO_API}/cards/${task.trelloCardId}?key=${config.apiKey}&token=${config.token}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueComplete: done }),
      }).catch(() => {})
    }
  }

  function renderTaskList(
    tasks: MyTask[],
    setter: React.Dispatch<React.SetStateAction<MyTask[]>>,
  ) {
    return tasks.map(task => {
      const card: TrelloCard = task.card ?? {
        id: task.trelloCardId, name: task.title, desc: task.description,
        due: task.dueDate, dueComplete: false, shortUrl: task.trelloCardUrl, closed: false, labels: [],
      }
      const onToggle = (id: string, val: boolean) =>
        setter(prev => prev.map(t => t.trelloCardId === id ? { ...t, card: { ...(t.card ?? card), dueComplete: val } } : t))
      const onEdit = () => setEditingTask(task)

      if (config?.apiKey && task.trelloCardId) {
        return <CardItem key={task.id} card={card} apiKey={config.apiKey} token={config.token}
          onToggle={onToggle} onEdit={onEdit} />
      }
      return <SimpleTaskItem key={task.id} task={task} onEdit={onEdit} />
    })
  }

  return (
    <div className={`p-4 sm:p-6 space-y-5 ${viewMode === 'board' ? 'max-w-full' : 'max-w-3xl mx-auto'}`}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <LayoutList className="w-5 h-5 text-blue-600" />
            Aufgaben
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {config?.apiKey || isManager
              ? <>{openCount} offen · {doneCount} erledigt</>
              : 'Trello-Integration'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setViewMode('list')}
              className={`px-2.5 py-1.5 transition-colors ${viewMode === 'list' ? 'bg-primary-600 text-white' : 'text-gray-400 hover:bg-gray-50'}`}>
              <LayoutList className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('board')}
              className={`px-2.5 py-1.5 transition-colors ${viewMode === 'board' ? 'bg-primary-600 text-white' : 'text-gray-400 hover:bg-gray-50'}`}>
              <Kanban className="w-4 h-4" />
            </button>
          </div>
          {isAdmin && (
            <button onClick={() => setShowSettings(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${showSettings ? 'bg-primary-50 border-primary-200 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {showSettings ? <X className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
              <span className="hidden sm:inline">{showSettings ? 'Schliessen' : 'Einstellungen'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Settings panel */}
      {isAdmin && showSettings && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <span className="w-5 h-5 bg-blue-500 rounded text-white text-[10px] font-bold flex items-center justify-center">T</span>
            Trello-Konfiguration
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">API Key</span>
              <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Trello API Key"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Token</span>
              <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Trello Token"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
            </label>
          </div>
          <div className="flex gap-2">
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Board ID</span>
              <input type="text" value={boardId} onChange={e => setBoardId(e.target.value)} placeholder="z.B. abc123XY"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
            </label>
            <button onClick={fetchListsFromTrello} disabled={!apiKey || !token || !boardId || loadingLists}
              className="self-end flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
              {loadingLists ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Listen laden
            </button>
          </div>
          {listsError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{listsError}</p>}
          {lists.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Liste für MPA</span>
                <select value={listMpa} onChange={e => setListMpa(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400">
                  <option value="">— auswählen —</option>
                  {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Liste für Ärzte</span>
                <select value={listArzt} onChange={e => setListArzt(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400">
                  <option value="">— auswählen —</option>
                  {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button onClick={saveConfig} disabled={!apiKey || !token || !boardId}
              className="px-4 py-2 text-sm font-semibold bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors">
              Speichern
            </button>
            {configSaved && <span className="text-sm text-green-600 font-medium">✅ Gespeichert</span>}
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 space-y-1">
            <p className="font-semibold">Einrichtung:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
              <li><a href="https://trello.com/app-key" target="_blank" rel="noreferrer" className="underline font-medium">trello.com/app-key</a> → API Key kopieren</li>
              <li>„Token" generieren → kopieren</li>
              <li>Board ID aus URL: trello.com/b/<strong>BOARD_ID</strong>/name</li>
              <li>„Listen laden" → Ziellisten zuweisen → Speichern</li>
            </ol>
          </div>
        </div>
      )}

      {/* Task creation form */}
      {canCreate && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary-600" />
            Neue Aufgabe erstellen
          </h2>

          {/* Assign mode tabs */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
            {([
              { mode: 'user' as AssignMode, label: 'Einzelperson', icon: <User className="w-3.5 h-3.5" /> },
              { mode: 'group' as AssignMode, label: 'Gruppe', icon: <Users className="w-3.5 h-3.5" /> },
              { mode: 'self' as AssignMode, label: 'Für mich', icon: <User className="w-3.5 h-3.5" /> },
            ]).map(({ mode, label, icon }) => (
              <button key={mode} type="button" onClick={() => setAssignMode(mode)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${assignMode === mode ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                {icon}{label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Titel *</span>
              <input type="text" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Aufgabentitel…"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Beschreibung</span>
              <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} placeholder="Optionale Details…" rows={2}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-400" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fälligkeit</span>
              <input type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
            </label>

            {/* Group picker */}
            {assignMode === 'group' && (
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Gruppe *</span>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
                  {([
                    { val: 'mpa' as GroupTarget, label: 'Alle MPA' },
                    { val: 'arzt' as GroupTarget, label: 'Alle Ärzte' },
                    { val: 'both' as GroupTarget, label: 'Alle Mitarbeiter' },
                  ]).map(({ val, label }) => (
                    <button key={val} type="button" onClick={() => setGroupTarget(val)}
                      className={`flex-1 py-2 transition-colors ${groupTarget === val ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {!config?.apiKey && (
                  <p className="text-xs text-amber-600 mt-1.5">Trello nicht konfiguriert — bitte Einstellungen vornehmen.</p>
                )}
              </div>
            )}

            {/* Self mode info */}
            {assignMode === 'self' && (
              <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <User className="w-3.5 h-3.5 shrink-0" />
                Aufgabe wird nur für Sie gespeichert und ist für andere nicht sichtbar.
              </div>
            )}

            {/* Individual person selection */}
            {assignMode === 'user' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Für * {taskAssignees.length > 0 && <span className="normal-case font-normal text-primary-600">({taskAssignees.length} ausgewählt)</span>}
                  </span>
                  <div className="flex gap-2">
                    {approvedUsers.some(u => u.role === 'arzt') && (
                      <button type="button" onClick={() => selectAllRole('arzt')}
                        className="text-[10px] text-blue-600 hover:text-blue-800 font-medium transition-colors">
                        {approvedUsers.filter(u => u.role === 'arzt').every(u => taskAssignees.includes(u.uid)) ? '✓ Alle Ärzte' : 'Alle Ärzte'}
                      </button>
                    )}
                    {approvedUsers.some(u => u.role === 'mpa') && (
                      <button type="button" onClick={() => selectAllRole('mpa')}
                        className="text-[10px] text-violet-600 hover:text-violet-800 font-medium transition-colors">
                        {approvedUsers.filter(u => u.role === 'mpa').every(u => taskAssignees.includes(u.uid)) ? '✓ Alle MPA' : 'Alle MPA'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
                  {approvedUsers.length === 0
                    ? <p className="px-3 py-2 text-xs text-gray-400 italic">Keine Benutzer gefunden</p>
                    : approvedUsers.map(u => {
                        const checked = taskAssignees.includes(u.uid)
                        return (
                          <button key={u.uid} type="button" onClick={() => toggleAssignee(u.uid)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${checked ? 'bg-primary-50' : 'bg-white hover:bg-gray-50'}`}>
                            <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-primary-600 border-primary-600' : 'border-gray-300'}`}>
                              {checked && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                            </div>
                            <span className="text-sm text-gray-800 flex-1">{u.displayName || u.username}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${u.role === 'arzt' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>
                              {u.role === 'arzt' ? 'Arzt' : 'MPA'}
                            </span>
                          </button>
                        )
                      })
                  }
                </div>
                {!config?.apiKey && (
                  <p className="text-xs text-amber-600 mt-1.5">
                    {isAdmin ? 'Trello nicht konfiguriert. Bitte Einstellungen vornehmen.' : 'Trello nicht konfiguriert. Bitte Administrator kontaktieren.'}
                  </p>
                )}
              </div>
            )}
          </div>

          {createErr && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" />{createErr}
            </div>
          )}
          {createSuccess && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              ✅ Aufgabe {assignMode === 'self' ? 'gespeichert' : assignMode === 'group' ? 'für Gruppe erstellt' : `für ${taskAssignees.length} Person(en) erstellt`}.
            </div>
          )}

          <button onClick={createTask}
            disabled={
              !taskTitle.trim() || creating ||
              (assignMode === 'user' && (taskAssignees.length === 0 || !config?.apiKey)) ||
              (assignMode === 'group' && !config?.apiKey)
            }
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {creating ? 'Wird erstellt…'
              : assignMode === 'self' ? 'Für mich speichern'
              : assignMode === 'group' ? 'Für Gruppe erstellen'
              : taskAssignees.length > 1 ? `${taskAssignees.length} Karten erstellen`
              : 'In Trello erstellen'}
          </button>
        </div>
      )}

      {/* ── Personal view (MPA / Arzt) ── */}
      {isEmployee && (
        <>
          {loadingMyTasks && myTasks.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" /> Aufgaben werden geladen…
            </div>
          ) : myTasksError ? (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" />{myTasksError}
            </div>
          ) : myTasks.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-sm text-gray-400">
              Keine Aufgaben zugewiesen.
            </div>
          ) : viewMode === 'board' ? (
            <BoardView tasks={myTasks} config={config} onEdit={setEditingTask}
              onStatusChange={handleStatusChange} />
          ) : (
            <div className="space-y-2">{renderTaskList(myTasks, setMyTasks)}</div>
          )}
        </>
      )}

      {/* ── Manager view (GL / Admin) ── */}
      {isManager && (
        <div className="space-y-5">
          {loadingAllTasks && allTasks.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" /> Aufgaben werden geladen…
            </div>
          ) : (() => {
            const selfList  = allTasks.filter(t => t.assigneeType === 'self')
            const mpaList   = allTasks.filter(t => t.assigneeType !== 'self' && t.assigneeRole === 'mpa')
            const arztList  = allTasks.filter(t => t.assigneeType !== 'self' && t.assigneeRole === 'arzt')

            const Section = ({ label, colorCls, tasks }: { label: string; colorCls: string; tasks: MyTask[] }) => (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${colorCls}`}>{label}</span>
                  <span className="text-xs text-gray-400">{tasks.filter(t => !t.card?.dueComplete).length} offen</span>
                </div>
                {tasks.length === 0
                  ? <p className="text-sm text-gray-400 italic px-1">Keine Aufgaben</p>
                  : <div className="space-y-2">{renderTaskList(tasks, setAllTasks)}</div>
                }
              </section>
            )

            if (allTasks.length === 0) return (
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-sm text-gray-400">
                Noch keine Aufgaben erstellt.
              </div>
            )

            if (viewMode === 'board') return (
              <BoardView tasks={allTasks} config={config} onEdit={setEditingTask}
                onStatusChange={handleStatusChange} />
            )

            return (
              <>
                {selfList.length > 0 && (
                  <Section label="Meine Aufgaben" colorCls="text-gray-700 bg-gray-100 border-gray-200" tasks={selfList} />
                )}
                {mpaList.length > 0 && (
                  <Section label="MPA" colorCls="text-violet-700 bg-violet-50 border-violet-200" tasks={mpaList} />
                )}
                {arztList.length > 0 && (
                  <Section label="Ärzte" colorCls="text-blue-700 bg-blue-50 border-blue-200" tasks={arztList} />
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* Edit modal */}
      {editingTask && (
        <EditModal
          task={editingTask}
          config={config}
          onSave={changes => {
            updateTaskInList(setMyTasks, editingTask.id, changes)
            updateTaskInList(setAllTasks, editingTask.id, changes)
          }}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  )
}
