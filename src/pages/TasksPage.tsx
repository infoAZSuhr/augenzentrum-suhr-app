import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import {
  TaskBoard, StandalonePoll, PollOption, BOARD_COLORS, VISIBILITY_LABELS, BoardVisibility,
  subscribeBoards, createBoard, updateBoard, deleteBoard, createTaskNotification,
  subscribePolls, createStandalonePoll, updateStandalonePoll, deleteStandalonePoll,
} from '../lib/firestoreTasks'
import { Plus, LayoutList, Trash2, Settings, X, Loader2, BarChart2, Clock, Check } from 'lucide-react'
import BackButton from '../components/ui/BackButton'

interface UserEntry { uid: string; displayName: string; username: string }

const DEFAULT_COLUMNS = ['Offen', 'In Bearbeitung', 'Erledigt']

function boardColor(color: string) {
  return BOARD_COLORS.find(c => c.id === color) ?? BOARD_COLORS[0]
}

function canSeeBoard(board: TaskBoard, role: string, isAdmin: boolean, isGl: boolean, uid: string, additionalRoles: string[]): boolean {
  const hasRole = (r: string) => role === r || additionalRoles.includes(r)
  if (board.visibleTo === 'creator') return board.createdByUid === uid
  if (board.visibleTo === 'user') {
    if (board.createdByUid === uid) return true
    // multi-person array (new) takes precedence, fall back to single uid
    if (board.visibleToUids?.length) return board.visibleToUids.includes(uid)
    return board.visibleToUid === uid
  }
  if (board.visibleTo === 'gl') return isGl
  if (board.visibleTo === 'managers') return isAdmin
  if (isAdmin) return true
  if (board.visibleTo === 'all') return true
  if (board.visibleTo === 'mpa')  return hasRole('mpa')
  if (board.visibleTo === 'arzt') return hasRole('arzt')
  return false
}

function canSeePoll(poll: StandalonePoll, role: string, isAdmin: boolean, isGl: boolean, uid: string, additionalRoles: string[]): boolean {
  const hasRole = (r: string) => role === r || additionalRoles.includes(r)
  if (poll.visibleTo === 'creator') return poll.createdByUid === uid
  if (poll.visibleTo === 'user') {
    if (poll.createdByUid === uid) return true
    if (poll.visibleToUids?.length) return poll.visibleToUids.includes(uid)
    return poll.visibleToUid === uid
  }
  if (poll.visibleTo === 'gl') return isGl
  if (poll.visibleTo === 'managers') return isAdmin
  if (isAdmin) return true
  if (poll.visibleTo === 'all') return true
  if (poll.visibleTo === 'mpa')  return hasRole('mpa')
  if (poll.visibleTo === 'arzt') return hasRole('arzt')
  return false
}

// ── Board create/edit modal ────────────────────────────────────────────────────
function BoardModal({ onClose, onSave, initial, isAdmin, isGl, currentUid }: {
  onClose: () => void
  onSave: (name: string, description: string, color: string, columns: string[], visibleTo: BoardVisibility, selectedUids: string[], selectedNames: string[]) => Promise<void>
  initial?: TaskBoard
  isAdmin: boolean
  isGl: boolean
  currentUid: string
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [color, setColor] = useState(initial?.color ?? 'blue')
  const [visibleTo, setVisibleTo] = useState<BoardVisibility>(initial?.visibleTo ?? 'creator')
  // multi-person selection: seed from existing visibleToUids or fall back to visibleToUid
  const [selectedUids, setSelectedUids] = useState<string[]>(() => {
    if (initial?.visibleToUids?.length) return initial.visibleToUids
    if (initial?.visibleToUid) return [initial.visibleToUid]
    return []
  })
  const [users, setUsers] = useState<UserEntry[]>([])
  const [columns, setColumns] = useState<string[]>(
    initial ? initial.columns.map(c => c.name) : [...DEFAULT_COLUMNS]
  )
  const [newCol, setNewCol] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (visibleTo !== 'user') return
    getDocs(collection(db, 'users')).then(snap => {
      setUsers(snap.docs
        .map(d => { const x = d.data(); return { uid: d.id, displayName: x.displayName || x.username || '', username: x.username || '' } })
        .filter(u => u.uid !== currentUid && u.uid)
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
      )
    })
  }, [visibleTo, currentUid])

  function toggleUser(u: UserEntry) {
    setSelectedUids(prev =>
      prev.includes(u.uid) ? prev.filter(id => id !== u.uid) : [...prev, u.uid]
    )
  }

  function addCol() {
    if (newCol.trim()) { setColumns(p => [...p, newCol.trim()]); setNewCol('') }
  }

  async function handleSave() {
    if (!name.trim() || columns.length === 0) return
    if (visibleTo === 'user' && selectedUids.length === 0) { setErr('Bitte mindestens eine Person auswählen.'); return }
    setSaving(true); setErr('')
    const selectedNames = selectedUids.map(uid => users.find(u => u.uid === uid)?.displayName ?? uid)
    try {
      await onSave(name.trim(), description.trim(), color, columns, visibleTo, selectedUids, selectedNames)
      onClose()
    }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Fehler'); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">{initial ? 'Board bearbeiten' : 'Neues Board'}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Name *</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="z.B. MPA Aufgaben"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Beschreibung</span>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optionale Beschreibung"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
        </label>

        <div>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Farbe</span>
          <div className="flex gap-2">
            {BOARD_COLORS.map(c => (
              <button key={c.id} onClick={() => setColor(c.id)}
                className={`w-7 h-7 rounded-full ${c.bg} transition-transform ${color === c.id ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'}`} />
            ))}
          </div>
        </div>

        <div>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Sichtbar für</span>
          <div className="flex flex-wrap gap-1">
            {(isAdmin
              ? ['creator', 'user', 'all', 'mpa', 'arzt', 'gl', 'managers'] as BoardVisibility[]
              : isGl
              ? ['creator', 'user', 'all', 'gl'] as BoardVisibility[]
              : ['creator', 'user', 'all'] as BoardVisibility[]
            ).map(v => (
              <button key={v} onClick={() => setVisibleTo(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${visibleTo === v ? 'bg-primary-600 text-white border-primary-600' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                {VISIBILITY_LABELS[v]}
              </button>
            ))}
          </div>

          {visibleTo === 'user' && (
            <div className="mt-2">
              {users.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">Wird geladen…</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                  {users.map(u => {
                    const active = selectedUids.includes(u.uid)
                    const initials = u.displayName.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                    return (
                      <button key={u.uid} onClick={() => toggleUser(u)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${active ? 'bg-primary-100 text-primary-700 border-primary-300' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${active ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                          {initials}
                        </span>
                        {u.displayName}
                      </button>
                    )
                  })}
                </div>
              )}
              {selectedUids.length > 0 && (
                <p className="text-[11px] text-gray-400 mt-1.5">{selectedUids.length} Person{selectedUids.length !== 1 ? 'en' : ''} ausgewählt</p>
              )}
            </div>
          )}
        </div>

        <div>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Spalten *</span>
          <div className="space-y-1.5 mb-2">
            {columns.map((col, i) => (
              <div key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                <span className="flex-1 text-sm text-gray-700">{col}</span>
                <button onClick={() => setColumns(p => p.filter((_, j) => j !== i))}
                  className="text-gray-300 hover:text-red-400 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newCol} onChange={e => setNewCol(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCol()}
              placeholder="Neue Spalte…"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
            <button onClick={addCol} disabled={!newCol.trim()}
              className="px-3 py-1.5 text-sm font-semibold bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-40 transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} disabled={!name.trim() || columns.length === 0 || saving}
            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-semibold bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors">
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

// ── Poll create modal ──────────────────────────────────────────────────────────
function PollCreateModal({ onClose, onSave, isAdmin, isGl, currentUid }: {
  onClose: () => void
  onSave: (
    question: string, options: string[], multiSelect: boolean,
    dueDate: string | null, visibleTo: BoardVisibility, visibleToUid?: string, visibleToName?: string
  ) => Promise<void>
  isAdmin: boolean
  isGl: boolean
  currentUid: string
}) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiSelect, setMultiSelect] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [visibleTo, setVisibleTo] = useState<BoardVisibility>('all')
  const [visibleToUid, setVisibleToUid] = useState('')
  const [visibleToName, setVisibleToName] = useState('')
  const [users, setUsers] = useState<UserEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (visibleTo !== 'user') return
    getDocs(collection(db, 'users')).then(snap => {
      setUsers(snap.docs
        .map(d => { const x = d.data(); return { uid: d.id, displayName: x.displayName || x.username || '', username: x.username || '' } })
        .filter(u => u.uid !== currentUid)
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
      )
    })
  }, [visibleTo, currentUid])

  async function handleSave() {
    const validOptions = options.map(o => o.trim()).filter(Boolean)
    if (!question.trim()) { setErr('Bitte eine Frage eingeben.'); return }
    if (validOptions.length < 2) { setErr('Mindestens 2 gültige Optionen erforderlich.'); return }
    if (visibleTo === 'user' && !visibleToUid) { setErr('Bitte eine Person auswählen.'); return }
    setSaving(true); setErr('')
    try {
      await onSave(question.trim(), validOptions, multiSelect, dueDate || null, visibleTo,
        visibleTo === 'user' ? visibleToUid : undefined,
        visibleTo === 'user' ? visibleToName : undefined)
      onClose()
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Fehler'); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Neue Umfrage</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Frage *</span>
          <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={2}
            placeholder="Was möchten Sie fragen?"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none" />
        </label>

        <div>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Antwortmöglichkeiten *</span>
          <div className="space-y-1.5 mb-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={opt} onChange={e => setOptions(p => p.map((o, j) => j === i ? e.target.value : o))}
                  placeholder={`Option ${i + 1}`}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
                {options.length > 2 && (
                  <button onClick={() => setOptions(p => p.filter((_, j) => j !== i))}
                    className="text-gray-300 hover:text-red-400 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => setOptions(p => [...p, ''])}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-100 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Option hinzufügen
          </button>
        </div>

        <div className="flex items-start gap-4">
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Auswahl</span>
            <div className="flex gap-2">
              <button onClick={() => setMultiSelect(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${!multiSelect ? 'bg-primary-600 text-white border-primary-600' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                Einfach
              </button>
              <button onClick={() => setMultiSelect(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${multiSelect ? 'bg-primary-600 text-white border-primary-600' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                Mehrfach
              </button>
            </div>
          </div>
          <div className="flex-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Frist</span>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
          </div>
        </div>

        <div>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Sichtbar für</span>
          <div className="flex flex-wrap gap-1">
            {(isAdmin
              ? ['creator', 'user', 'all', 'mpa', 'arzt', 'gl', 'managers'] as BoardVisibility[]
              : isGl
              ? ['creator', 'user', 'all', 'gl'] as BoardVisibility[]
              : ['creator', 'user', 'all'] as BoardVisibility[]
            ).map(v => (
              <button key={v} onClick={() => setVisibleTo(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${visibleTo === v ? 'bg-primary-600 text-white border-primary-600' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                {VISIBILITY_LABELS[v]}
              </button>
            ))}
          </div>
          {visibleTo === 'user' && (
            <select value={visibleToUid}
              onChange={e => {
                const u = users.find(x => x.uid === e.target.value)
                setVisibleToUid(e.target.value)
                setVisibleToName(u?.displayName ?? '')
              }}
              className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400">
              <option value="">— Person auswählen —</option>
              {users.map(u => (
                <option key={u.uid} value={u.uid}>{u.displayName} ({u.username})</option>
              ))}
            </select>
          )}
        </div>

        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} disabled={!question.trim() || options.filter(o => o.trim()).length < 2 || saving}
            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-semibold bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-40 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Speichern…' : 'Umfrage erstellen'}
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

// ── Poll detail / voting modal ─────────────────────────────────────────────────
function PollDetailModal({ poll, uid, canManage, onClose, onVote, onDelete }: {
  poll: StandalonePoll
  uid: string
  canManage: boolean
  onClose: () => void
  onVote: (optionId: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const isExpired = poll.dueDate ? new Date(poll.dueDate) < new Date(new Date().toDateString()) : false
  const totalVotes = poll.options.reduce((s, o) => s + o.votes.length, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-5 border-b border-gray-100">
          <BarChart2 className="w-5 h-5 text-primary-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-gray-900 text-base leading-snug">{poll.question}</p>
            {poll.dueDate && (
              <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border mt-1.5 ${isExpired ? 'bg-red-50 text-red-500 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                <Clock className="w-3 h-3" />
                {isExpired ? 'Abgelaufen · ' : 'Frist: '}
                {new Date(poll.dueDate).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
          <p className="text-xs text-gray-400">
            {totalVotes} Stimme{totalVotes !== 1 ? 'n' : ''} · {poll.multiSelect ? 'Mehrfachauswahl' : 'Einfachauswahl'}
            {isExpired && ' · Abstimmung beendet'}
          </p>
          {poll.options.map(opt => {
            const hasVoted = opt.votes.includes(uid)
            const count = opt.votes.length
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0
            return (
              <button key={opt.id}
                onClick={() => !isExpired && onVote(opt.id)}
                disabled={isExpired}
                className={`w-full text-left rounded-xl border p-3 transition-all ${hasVoted ? 'border-primary-300 bg-primary-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'} ${isExpired ? 'cursor-default' : 'cursor-pointer'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${hasVoted ? 'bg-primary-600 border-primary-600' : 'border-gray-300'}`}>
                    {hasVoted && <Check className="w-2.5 h-2.5 text-white" />}
                  </span>
                  <span className={`flex-1 text-sm font-medium ${hasVoted ? 'text-primary-800' : 'text-gray-800'}`}>{opt.text}</span>
                  <span className="text-xs text-gray-400 shrink-0">{count} ({pct}%)</span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${hasVoted ? 'bg-primary-500' : 'bg-gray-300'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100">
          <span className="text-xs text-gray-400">{poll.createdBy}</span>
          <div className="flex-1" />
          {canManage && (
            <button onClick={onDelete}
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 border border-gray-200 rounded-xl transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main tasks page ────────────────────────────────────────────────────────────
export default function TasksPage() {
  const navigate = useNavigate()
  const { profile, isAdmin, isGeschaeftsleitung } = useAuth()
  const role = profile?.role ?? ''
  const additionalRoles = profile?.additionalRoles ?? []
  const uid = profile?.uid ?? ''

  const [boards, setBoards] = useState<TaskBoard[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingBoard, setEditingBoard] = useState<TaskBoard | null>(null)

  const [polls, setPolls] = useState<StandalonePoll[]>([])
  const [pollsLoading, setPollsLoading] = useState(true)
  const [selectedPollId, setSelectedPollId] = useState<string | null>(null)
  const [showPollCreate, setShowPollCreate] = useState(false)

  const [userMap, setUserMap] = useState<Record<string, string>>({})

  useEffect(() => subscribeBoards(b => { setBoards(b); setLoading(false) }), [])
  useEffect(() => subscribePolls(p => { setPolls(p); setPollsLoading(false) }), [])
  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      const map: Record<string, string> = {}
      snap.docs.forEach(d => { const x = d.data(); map[d.id] = x.displayName || x.username || '' })
      setUserMap(map)
    })
  }, [])

  const visibleBoards = boards.filter(b => canSeeBoard(b, role, isAdmin, isGeschaeftsleitung, uid, additionalRoles))
  const visiblePolls  = polls.filter(p => canSeePoll(p, role, isAdmin, isGeschaeftsleitung, uid, additionalRoles))

  async function handleSaveBoard(name: string, description: string, color: string, columnNames: string[], visibleTo: BoardVisibility, selectedUids: string[], selectedNames: string[]) {
    const columns = columnNames.map((n, i) => ({ id: `col_${Date.now()}_${i}`, name: n, order: i }))
    const authorName = profile?.displayName || profile?.username || ''
    const extra = visibleTo === 'user'
      ? {
          visibleToUid: selectedUids[0] ?? '',
          visibleToName: selectedNames[0] ?? '',
          visibleToUids: selectedUids,
          visibleToNames: selectedNames,
        }
      : { visibleToUid: '', visibleToName: '', visibleToUids: [], visibleToNames: [] }
    if (editingBoard) {
      const existingIds = new Set(editingBoard.columns.map(c => c.name))
      const merged = [
        ...editingBoard.columns.filter(c => columnNames.includes(c.name)),
        ...columns.filter(c => !existingIds.has(c.name)),
      ].map((c, i) => ({ ...c, order: i }))
      await updateBoard(editingBoard.id, { name, description, color, columns: merged, visibleTo, ...extra })
      // Notify newly added persons
      if (visibleTo === 'user') {
        const prevUids = new Set(editingBoard.visibleToUids ?? (editingBoard.visibleToUid ? [editingBoard.visibleToUid] : []))
        const newUids = selectedUids.filter(u => !prevUids.has(u))
        await Promise.all(newUids.map(recipientUid =>
          createTaskNotification({ type: 'board_assignment', recipientUid, cardId: '', boardId: editingBoard.id, cardTitle: '', boardName: name.trim(), assignerName: authorName })
        ))
      }
    } else {
      const newId = await createBoard({ name, description, color, columns, visibleTo, ...extra, createdBy: authorName, createdByUid: uid })
      if (visibleTo === 'user') {
        await Promise.all(selectedUids.map(recipientUid =>
          createTaskNotification({ type: 'board_assignment', recipientUid, cardId: '', boardId: newId, cardTitle: '', boardName: name.trim(), assignerName: authorName })
        ))
      }
    }
  }

  async function handleDeleteBoard(board: TaskBoard) {
    if (!confirm(`Board „${board.name}" wirklich löschen?`)) return
    await deleteBoard(board.id)
  }

  async function handleCreatePoll(
    question: string, options: string[], multiSelect: boolean,
    dueDate: string | null, visibleTo: BoardVisibility, visibleToUid?: string, visibleToName?: string
  ) {
    const authorName = profile?.displayName || profile?.username || ''
    const pollOptions: PollOption[] = options.map((text, i) => ({ id: `opt_${Date.now()}_${i}`, text, votes: [] }))
    const newId = await createStandalonePoll({
      question, options: pollOptions, multiSelect, dueDate, visibleTo,
      visibleToUid: visibleTo === 'user' ? visibleToUid : undefined,
      visibleToName: visibleTo === 'user' ? visibleToName : undefined,
      createdBy: authorName, createdByUid: uid,
    })
    if (visibleTo === 'user' && visibleToUid) {
      await createTaskNotification({
        type: 'poll_assignment', recipientUid: visibleToUid,
        cardId: newId, boardId: '', cardTitle: question, boardName: 'Umfrage',
        assignerName: authorName,
      })
    }
  }

  async function handleVotePoll(poll: StandalonePoll, optionId: string) {
    if (!uid) return
    const updatedOptions = poll.options.map(o => {
      if (o.id === optionId) {
        const alreadyVoted = o.votes.includes(uid)
        return { ...o, votes: alreadyVoted ? o.votes.filter(v => v !== uid) : [...o.votes, uid] }
      }
      if (!poll.multiSelect) return { ...o, votes: o.votes.filter(v => v !== uid) }
      return o
    })
    await updateStandalonePoll(poll.id, { options: updatedOptions })
  }

  async function handleDeletePoll(poll: StandalonePoll) {
    if (!confirm('Umfrage löschen?')) return
    setSelectedPollId(null)
    await deleteStandalonePoll(poll.id)
  }

  const selectedPoll = visiblePolls.find(p => p.id === selectedPollId) ?? null

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-8">
      {/* ── Boards ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="mb-2"><BackButton /></div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <LayoutList className="w-5 h-5 text-primary-600" />
              Aufgaben
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">{visibleBoards.length} Board{visibleBoards.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => { setEditingBoard(null); setShowCreate(true) }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors">
            <Plus className="w-4 h-4" /> Neues Board
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" /> Boards werden geladen…
          </div>
        ) : visibleBoards.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center space-y-2">
            <p className="text-sm text-gray-400">Noch keine Boards vorhanden.</p>
            <button onClick={() => setShowCreate(true)}
              className="text-sm font-semibold text-primary-600 hover:underline">
              Erstes Board erstellen →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleBoards.map(board => {
              const col = boardColor(board.color)
              return (
                <div key={board.id}
                  onClick={() => navigate(`/aufgaben/${board.id}`)}
                  className="group bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md transition-all cursor-pointer">
                  <div className={`h-2 w-full ${col.bg}`} />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h2 className="font-bold text-gray-900 text-sm truncate">{board.name}</h2>
                        {board.description && (
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{board.description}</p>
                        )}
                      </div>
                      {(isAdmin || isGeschaeftsleitung || board.createdByUid === uid) && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={e => e.stopPropagation()}>
                          <button onClick={() => { setEditingBoard(board); setShowCreate(true) }}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDeleteBoard(board)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${col.light}`}>
                        {board.columns.length} Spalten
                      </span>
                      <span className="text-[10px] font-medium text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded">
                        {board.visibleTo === 'user'
                          ? (board.visibleToUids?.length
                              ? (board.visibleToUids.length === 1
                                  ? (userMap[board.visibleToUids[0]] ?? '…')
                                  : `${board.visibleToUids.length} Personen`)
                              : (board.visibleToUid ? (userMap[board.visibleToUid] ?? '…') : VISIBILITY_LABELS['user']))
                          : VISIBILITY_LABELS[board.visibleTo]}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {board.createdBy && (
                        <span title={`Ersteller: ${board.createdBy}`} className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full">
                          <span className="w-3.5 h-3.5 rounded-full bg-gray-300 text-white flex items-center justify-center text-[8px] font-bold shrink-0">
                            {board.createdBy.split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0].toUpperCase()).join('')}
                          </span>
                          {board.createdBy}
                        </span>
                      )}
                      {board.visibleTo === 'user' && (
                        (board.visibleToUids?.length
                          ? board.visibleToUids
                          : board.visibleToUid ? [board.visibleToUid] : []
                        ).map(uid => userMap[uid] ? (
                          <span key={uid} title={`Zuständig: ${userMap[uid]}`} className="inline-flex items-center gap-1 text-[10px] font-medium text-primary-700 bg-primary-50 border border-primary-200 px-1.5 py-0.5 rounded-full">
                            <span className="w-3.5 h-3.5 rounded-full bg-primary-400 text-white flex items-center justify-center text-[8px] font-bold shrink-0">
                              {userMap[uid].split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0].toUpperCase()).join('')}
                            </span>
                            {userMap[uid]}
                          </span>
                        ) : null)
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Polls ── */}
      <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-primary-600" />
              <h2 className="text-base font-bold text-gray-900">Umfragen</h2>
              {!pollsLoading && (
                <span className="text-sm text-gray-500">{visiblePolls.length}</span>
              )}
            </div>
            <button onClick={() => setShowPollCreate(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors">
              <Plus className="w-4 h-4" /> Neue Umfrage
            </button>
          </div>

          {pollsLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" /> Umfragen werden geladen…
            </div>
          ) : visiblePolls.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center">
              <p className="text-sm text-gray-400">Noch keine Umfragen vorhanden.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visiblePolls.map(poll => {
                const totalVotes = poll.options.reduce((s, o) => s + o.votes.length, 0)
                const hasVoted = uid ? poll.options.some(o => o.votes.includes(uid)) : false
                const isExpired = poll.dueDate ? new Date(poll.dueDate) < new Date(new Date().toDateString()) : false
                const canManage = isAdmin || isGeschaeftsleitung || poll.createdByUid === uid
                return (
                  <div key={poll.id}
                    onClick={() => setSelectedPollId(poll.id)}
                    className="group bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md transition-all cursor-pointer">
                    <div className="h-2 w-full bg-primary-500" />
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0 flex items-start gap-2">
                          <BarChart2 className="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
                          <p className="font-bold text-gray-900 text-sm line-clamp-2">{poll.question}</p>
                        </div>
                        {canManage && (
                          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            onClick={e => e.stopPropagation()}>
                            <button onClick={() => handleDeletePoll(poll)}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-primary-50 text-primary-700 border-primary-200">
                          {poll.options.length} Optionen
                        </span>
                        <span className="text-[10px] font-medium text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded">
                          {poll.visibleTo === 'user'
                            ? (poll.visibleToUid ? (userMap[poll.visibleToUid] ?? '…') : VISIBILITY_LABELS['user'])
                            : VISIBILITY_LABELS[poll.visibleTo]}
                        </span>
                        {poll.dueDate && (
                          <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border ${isExpired ? 'bg-red-50 text-red-500 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                            <Clock className="w-2.5 h-2.5" />
                            {new Date(poll.dueDate).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] text-gray-400">{totalVotes} Stimme{totalVotes !== 1 ? 'n' : ''}</span>
                        {hasVoted && <span className="text-[10px] font-semibold text-primary-600">· Abgestimmt ✓</span>}
                        {isExpired && <span className="text-[10px] text-red-500 font-medium">· Abgelaufen</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {showCreate && (
        <BoardModal
          onClose={() => { setShowCreate(false); setEditingBoard(null) }}
          onSave={handleSaveBoard}
          initial={editingBoard ?? undefined}
          isAdmin={isAdmin}
          isGl={isGeschaeftsleitung}
          currentUid={uid}
        />
      )}

      {showPollCreate && (
        <PollCreateModal
          onClose={() => setShowPollCreate(false)}
          onSave={handleCreatePoll}
          isAdmin={isAdmin}
          isGl={isGeschaeftsleitung}
          currentUid={uid}
        />
      )}

      {selectedPoll && (
        <PollDetailModal
          poll={selectedPoll}
          uid={uid}
          canManage={isAdmin || isGeschaeftsleitung || selectedPoll.createdByUid === uid}
          onClose={() => setSelectedPollId(null)}
          onVote={optionId => handleVotePoll(selectedPoll, optionId)}
          onDelete={() => handleDeletePoll(selectedPoll)}
        />
      )}
    </div>
  )
}
