import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import {
  ClipboardList, CheckCircle2, Clock, Users, Check, ChevronDown, ChevronUp,
  Loader2, Plus, Save, UserCog, Trash2, X, Pencil, ExternalLink, Printer,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, query as fsQuery, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import {
  getLatestAkvDocument, updateAkvDocument, releaseAkvDocument,
  seedAkvDocument, getAkvConfirmations, confirmAkvDocument, clearAkvConfirmations,
  type AkvDocument, type AkvConfirmation, type AkvRow, type AkvPerson,
} from '../lib/firestoreAkv'
import BackButton from '../components/ui/BackButton'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateStr(s: string | undefined): string {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

function fmtTs(ts: any): string {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function incrementVersion(v: string): string {
  const n = parseFloat(v || '1.0')
  if (isNaN(n)) return '1.0'
  return (Math.round((n + 0.1) * 10) / 10).toFixed(1)
}

// Cycle through assignment codes
function cycleCode(current: string): string {
  const cycle = ['H', 'S', 'SP', '']
  const idx = cycle.indexOf(current)
  return cycle[(idx + 1) % cycle.length]
}

function roleLabel(role: string): string {
  if (role === 'admin')             return 'Admin'
  if (role === 'geschaeftsleitung') return 'GL'
  if (role === 'arzt')              return 'Arzt/Ärztin'
  if (role === 'mpa')               return 'MPA'
  return role
}

// ── Assignment badge ──────────────────────────────────────────────────────────

function CodeBadge({ code }: { code: string }) {
  if (!code) return <span className="text-gray-200 text-xs">—</span>
  const styles: Record<string, string> = {
    H:  'bg-green-100 text-green-800 border border-green-200',
    S:  'bg-blue-100 text-blue-800 border border-blue-200',
    SP: 'bg-gray-100 text-gray-600 border border-gray-200',
  }
  return (
    <span className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-bold ${styles[code] ?? 'bg-gray-100 text-gray-700'}`}>
      {code}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AkvPage() {
  const { isAdmin, isGeschaeftsleitung, profile } = useAuth()
  const navigate   = useNavigate()
  const canEdit    = isAdmin || isGeschaeftsleitung
  const username    = profile?.username    ?? ''
  const displayName = profile?.displayName ?? ''

  const [akvDoc,        setAkvDoc]        = useState<AkvDocument | null>(null)
  const [confirmations, setConfirmations] = useState<AkvConfirmation[]>([])
  const [sopUsers,      setSopUsers]      = useState<{ uid: string; displayName: string; role: string }[]>([])
  const [loading,       setLoading]       = useState(true)
  const [seeding,       setSeedingState]  = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [releasing,     setReleasing]     = useState(false)
  const [confirming,    setConfirming]    = useState(false)
  const [showRelevant,   setShowRelevant]   = useState(false)
  const [showNachweis,   setShowNachweis]   = useState(false)
  const [showPersonsModal, setShowPersonsModal] = useState(false)
  const [editPersons,    setEditPersons]    = useState<Array<AkvPerson & { _origName: string }>>([])
  const [savingPersons,  setSavingPersons]  = useState(false)

  // Task editing / adding
  const [sopPages,       setSopPages]       = useState<{ id: string; title: string }[]>([])
  const [editingRow,     setEditingRow]     = useState<{ idx: number; task: string; sopPageId?: string; sopPageTitle?: string; category: string } | null>(null)
  const [addingCategory,  setAddingCategory]  = useState<string | null>(null)
  const [newTaskName,     setNewTaskName]     = useState('')
  const [newTaskSopId,    setNewTaskSopId]    = useState('')
  const [newTaskSopTitle, setNewTaskSopTitle] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryTask, setNewCategoryTask] = useState('')

  // local editable state
  const [rows,           setRows]           = useState<AkvRow[]>([])
  const [verantwortlich, setVerantwortlich] = useState('')
  const [freigegebenVon, setFreigegebenVon] = useState('')
  const [version,        setVersion]        = useState('')
  const [gueltigAb,      setGueltigAb]      = useState('')
  const [dirty,          setDirty]          = useState(false)

  // Refs for autosave
  const docIdRef         = useRef<string | null>(null)
  const rowsRef          = useRef<AkvRow[]>([])
  const verantwortlichRef = useRef('')
  const freigegebenVonRef = useRef('')
  const versionRef        = useRef('')
  const gueltigAbRef      = useRef('')
  useEffect(() => { docIdRef.current         = akvDoc?.id ?? null    }, [akvDoc?.id])
  useEffect(() => { rowsRef.current          = rows                  }, [rows])
  useEffect(() => { verantwortlichRef.current = verantwortlich       }, [verantwortlich])
  useEffect(() => { freigegebenVonRef.current = freigegebenVon       }, [freigegebenVon])
  useEffect(() => { versionRef.current        = version              }, [version])
  useEffect(() => { gueltigAbRef.current      = gueltigAb            }, [gueltigAb])

  const savedFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load document
  useEffect(() => {
    setLoading(true)
    getLatestAkvDocument()
      .then(doc => {
        if (doc) {
          applyDoc(doc)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  // Load approved users for dropdowns
  useEffect(() => {
    getDocs(fsQuery(collection(db, 'users'), where('status', '==', 'approved')))
      .then(snap => {
        const list = snap.docs
          .map(d => { const u = d.data() as any; return { uid: u.uid, displayName: u.displayName || u.username || '', role: u.role || '' } })
          .filter(u => u.displayName)
          .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'))
        setSopUsers(list)
      })
      .catch(() => {})
  }, [])

  // Load final SOP pages for linking
  useEffect(() => {
    getDocs(fsQuery(collection(db, 'onboarding_pages'), where('status', '==', 'final')))
      .then(snap => {
        const pages = snap.docs
          .map(d => ({ id: d.id, title: (d.data() as any).title || '(ohne Titel)' }))
          .sort((a, b) => a.title.localeCompare(b.title, 'de'))
        setSopPages(pages)
      })
      .catch(() => {})
  }, [])

  function applyDoc(doc: AkvDocument) {
    setAkvDoc(doc)
    setRows(doc.rows ?? [])
    setVerantwortlich(doc.verantwortlich ?? '')
    setFreigegebenVon(doc.freigegebenVon ?? '')
    setVersion(doc.version ?? '1.0')
    setGueltigAb(doc.gueltigAb ?? '')
    setDirty(false)
    loadConfirmations(doc.id)
  }

  async function loadConfirmations(docId: string) {
    const confs = await getAkvConfirmations(docId)
    setConfirmations(confs)
  }

  const handleSave = useCallback(async () => {
    const id = docIdRef.current
    if (!id) return
    setSaving(true)
    try {
      await updateAkvDocument(id, {
        rows: rowsRef.current,
        verantwortlich: verantwortlichRef.current,
        freigegebenVon: freigegebenVonRef.current,
        version: versionRef.current,
        gueltigAb: gueltigAbRef.current,
      }, username)
      setDirty(false)
      setSaved(true)
      if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current)
      savedFadeTimer.current = setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }, [username])

  // Autosave 2s after last change
  useEffect(() => {
    if (!dirty || !canEdit) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(handleSave, 2000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [dirty, rows, verantwortlich, freigegebenVon, version, gueltigAb, canEdit, handleSave])

  const handleSeed = async () => {
    setSeedingState(true)
    try {
      const doc = await seedAkvDocument(username)
      applyDoc(doc)
    } finally {
      setSeedingState(false)
    }
  }

  const handleRelease = async () => {
    if (!akvDoc || !gueltigAb) return
    setReleasing(true)
    try {
      const newVersion = incrementVersion(versionRef.current)
      await releaseAkvDocument(akvDoc.id, gueltigAbRef.current, newVersion, username)
      await clearAkvConfirmations(akvDoc.id)
      setAkvDoc(prev => prev ? { ...prev, status: 'final', gueltigAb: gueltigAbRef.current, version: newVersion, freigabeDatum: null } : prev)
      setVersion(newVersion)
      setConfirmations([])
    } finally {
      setReleasing(false)
    }
  }

  const handleConfirm = async () => {
    if (!akvDoc) return
    setConfirming(true)
    try {
      await confirmAkvDocument(akvDoc.id, username, displayName)
      await loadConfirmations(akvDoc.id)
    } finally {
      setConfirming(false)
    }
  }

  // Persons modal
  function openPersonsModal() {
    setEditPersons((akvDoc?.persons ?? []).map(p => ({ ...p, _origName: p.name })))
    setShowPersonsModal(true)
  }

  async function handleSavePersons() {
    if (!akvDoc) return
    setSavingPersons(true)
    try {
      // Detect renames: compare _origName to current name
      const renames: Record<string, string> = {}
      editPersons.forEach(ep => {
        if (ep._origName && ep._origName !== ep.name && ep.name.trim()) {
          renames[ep._origName] = ep.name.trim()
        }
      })
      // Detect removed persons
      const editOrigNames = new Set(editPersons.filter(ep => ep._origName).map(ep => ep._origName))
      const removed = (akvDoc.persons ?? []).map(p => p.name).filter(n => !editOrigNames.has(n))

      // Build clean persons list
      const newPersons: AkvPerson[] = editPersons
        .filter(ep => ep.name.trim())
        .map(({ _origName, ...p }) => ({ ...p, name: p.name.trim(), role: p.role.trim() }))

      // Migrate row assignments: apply renames then remove deleted
      const newRows = rows.map(r => {
        const a = { ...r.assignments }
        Object.entries(renames).forEach(([oldN, newN]) => {
          if (oldN in a) { a[newN] = a[oldN]; delete a[oldN] }
        })
        removed.forEach(n => delete a[n])
        return { ...r, assignments: a }
      })

      await updateAkvDocument(akvDoc.id, { persons: newPersons, rows: newRows }, username)
      setAkvDoc(prev => prev ? { ...prev, persons: newPersons } : prev)
      setRows(newRows)
      setShowPersonsModal(false)
    } finally {
      setSavingPersons(false)
    }
  }

  // Task add / edit / delete
  function handleAddCategory() {
    if (!newCategoryName.trim() || !newCategoryTask.trim()) return
    const newRow: AkvRow = {
      category: newCategoryName.trim(),
      task: newCategoryTask.trim(),
      assignments: {},
    }
    setRows(prev => [...prev, newRow])
    setDirty(true)
    setShowNewCategory(false)
    setNewCategoryName('')
    setNewCategoryTask('')
  }

  function handleAddTask(category: string) {
    if (!newTaskName.trim()) return
    const newRow: AkvRow = {
      category,
      task: newTaskName.trim(),
      assignments: {},
      sopPageId:    newTaskSopId    || undefined,
      sopPageTitle: newTaskSopTitle || undefined,
    }
    const catLastIdx = rows.reduce((last, r, i) => r.category === category ? i : last, -1)
    const updated = [...rows]
    updated.splice(catLastIdx + 1, 0, newRow)
    setRows(updated)
    setDirty(true)
    setAddingCategory(null)
    setNewTaskName('')
    setNewTaskSopId('')
    setNewTaskSopTitle('')
  }

  function handleSaveEditRow() {
    if (!editingRow) return
    const updated = rows.map((r, i) => i === editingRow.idx ? {
      ...r,
      task: editingRow.task.trim() || r.task,
      sopPageId:    editingRow.sopPageId    || undefined,
      sopPageTitle: editingRow.sopPageTitle || undefined,
    } : r)
    setRows(updated)
    setDirty(true)
    setEditingRow(null)
  }

  function handleDeleteRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx))
    setDirty(true)
    setEditingRow(null)
  }

  // Toggle a cell assignment
  function toggleCell(rowIdx: number, personName: string) {
    if (!canEdit) return
    const newRows = rows.map((r, i) => {
      if (i !== rowIdx) return r
      const current = r.assignments[personName] ?? ''
      const next = cycleCode(current)
      const newAssignments = { ...r.assignments }
      if (next) newAssignments[personName] = next
      else delete newAssignments[personName]
      return { ...r, assignments: newAssignments }
    })
    setRows(newRows)
    setDirty(true)
  }

  // Toggle a person in relevantFuer
  async function toggleRelevantFuer(displayNameToToggle: string) {
    if (!akvDoc || !canEdit) return
    const current = akvDoc.relevantFuer ?? []
    const next = current.includes(displayNameToToggle)
      ? current.filter(n => n !== displayNameToToggle)
      : [...current, displayNameToToggle]
    await updateAkvDocument(akvDoc.id, { relevantFuer: next }, username)
    setAkvDoc(prev => prev ? { ...prev, relevantFuer: next } : prev)
  }

  // Derived
  const isZustaendigFor = akvDoc
    ? (akvDoc.verantwortlich === displayName || akvDoc.verantwortlich === username)
    : false
  const isFreigabeFor = akvDoc
    ? (akvDoc.freigegebenVon === displayName || akvDoc.freigegebenVon === username)
    : false
  // Person column linked to the current user (by uid)
  const linkedPersonName = (akvDoc?.persons ?? []).find(p => p.uid === profile?.uid)?.name
  const isRelevantFuer = akvDoc
    ? (akvDoc.relevantFuer ?? []).some(
        n => n === displayName || n === username || (linkedPersonName && n === linkedPersonName)
      )
    : false
  const hasConfirmed = confirmations.some(c => c.username === username || c.displayName === displayName)
  const canRelease = (canEdit || isFreigabeFor) && !isZustaendigFor && akvDoc?.status !== 'final'

  // Group rows by category for display
  const categories = Array.from(new Set(rows.map(r => r.category)))
  const persons = akvDoc?.persons ?? []

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    )
  }

  if (!akvDoc) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <ClipboardList className="w-12 h-12 text-gray-300" />
        <div>
          <p className="text-gray-600 font-medium">Noch keine AKV-Liste vorhanden</p>
          <p className="text-sm text-gray-400 mt-1">Erstellen Sie die Aufgaben-Kompetenzen-Verantwortungsliste aus der Excel-Vorlage.</p>
        </div>
        {canEdit && (
          <button onClick={handleSeed} disabled={seeding}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-60">
            {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            AKV-Liste aus Excel importieren
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">

      {/* ── Header ── */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-100 shrink-0 bg-violet-50">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <BackButton />
              <ClipboardList className="w-4 h-4 text-violet-600" />
              <p className="text-xs font-bold uppercase tracking-widest text-violet-600">Gelenkte Liste</p>
              {akvDoc.status === 'final'
                ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold border border-green-200">Freigegeben</span>
                : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold border border-amber-200">Entwurf</span>
              }
            </div>
            <h1 className="text-xl font-bold text-gray-900">{akvDoc.title}</h1>
          </div>

          {/* Metadata */}
          <div className="text-[11px] text-gray-500 space-y-1 shrink-0 min-w-[200px]">
            {/* Verantwortlich */}
            <div className="flex items-center justify-end gap-2">
              <span className="font-medium text-gray-600">Verantwortlich:</span>
              {canEdit ? (
                <select value={verantwortlich} onChange={e => { setVerantwortlich(e.target.value); setDirty(true) }}
                  className="text-[11px] text-gray-700 bg-transparent border-b border-dashed border-gray-300 hover:border-gray-500 outline-none w-36 cursor-pointer">
                  <option value="">—</option>
                  {sopUsers.map(u => <option key={u.uid} value={u.displayName}>{u.displayName}</option>)}
                </select>
              ) : <span>{verantwortlich || '—'}</span>}
            </div>
            {/* Freigegeben von */}
            <div className="flex items-center justify-end gap-2">
              <span className="font-medium text-gray-600">Freigabe:</span>
              {canEdit ? (
                <select value={freigegebenVon} onChange={e => { setFreigegebenVon(e.target.value); setDirty(true) }}
                  className="text-[11px] text-gray-700 bg-transparent border-b border-dashed border-gray-300 hover:border-gray-500 outline-none w-36 cursor-pointer">
                  <option value="">—</option>
                  {sopUsers.map(u => <option key={u.uid} value={u.displayName}>{u.displayName}</option>)}
                </select>
              ) : <span>{freigegebenVon || '—'}</span>}
            </div>
            {/* Version */}
            <div className="flex items-center justify-end gap-2">
              <span className="font-medium text-gray-600">Version:</span>
              <span>{version || '—'}</span>
            </div>
            {/* Gültig ab */}
            <div className="flex items-center justify-end gap-2">
              <span className="font-medium text-gray-600">Gültig ab:</span>
              {canRelease && akvDoc.status !== 'final' ? (
                <input type="date" value={gueltigAb}
                  onChange={e => { setGueltigAb(e.target.value); setDirty(true) }}
                  className="text-[11px] text-gray-700 bg-transparent border-b border-dashed border-gray-300 hover:border-gray-500 outline-none text-right w-28" />
              ) : <span>{gueltigAb ? fmtDateStr(gueltigAb) : '—'}</span>}
            </div>
            {akvDoc.freigabeDatum && (
              <div className="flex items-center justify-end gap-2">
                <span className="font-medium text-gray-600">Freigegeben:</span>
                <span>{fmtTs(akvDoc.freigabeDatum)}</span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="shrink-0 flex flex-col items-end gap-2">
            {canEdit && (
              <button onClick={openPersonsModal}
                title="Personen verwalten"
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
                <UserCog className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Personen</span>
              </button>
            )}
            <button onClick={() => window.print()}
              title="Drucken"
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Drucken</span>
            </button>
            {canRelease && (
              <button onClick={handleRelease} disabled={releasing || !gueltigAb}
                title={!gueltigAb ? 'Zuerst ein «Gültig ab»-Datum setzen' : 'Freigeben'}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                {releasing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{releasing ? 'Freigeben…' : 'Freigeben'}</span>
              </button>
            )}
            {canEdit && (
              <div className="text-xs flex items-center gap-1 min-w-[90px] justify-end">
                {saving
                  ? <span className="text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Speichern…</span>
                  : saved
                  ? <span className="text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> Gespeichert</span>
                  : dirty
                  ? <span className="text-amber-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Nicht gespeichert</span>
                  : null}
              </div>
            )}
          </div>
        </div>

        {/* Draft banner */}
        {akvDoc.status !== 'final' && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {canRelease
              ? 'Entwurf — setzen Sie ein «Gültig ab»-Datum und klicken Sie «Freigeben», um die Liste für alle zu veröffentlichen.'
              : 'Diese Liste ist noch nicht freigegeben und wird erst nach der Freigabe für alle sichtbar sein.'
            }
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* Responsibility matrix table — single overflow container for sticky to work */}
        <div className="flex-1 overflow-auto">
          <table className="text-xs border-collapse" style={{ minWidth: `${260 + persons.length * 88}px`, width: '100%' }}>
            <thead>
              {/* Names row — sticky top */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="sticky left-0 top-0 z-30 bg-gray-50 text-left px-4 py-2.5 font-semibold text-gray-700 w-64 min-w-[16rem]">
                  Aufgabe
                </th>
                {persons.map(p => (
                  <th key={p.name} className="sticky top-0 z-20 bg-gray-50 px-2 py-2.5 text-center font-medium text-gray-600 w-20 min-w-[5rem]">
                    <div className="font-semibold text-gray-800 leading-tight">{p.name.replace(' (GL)', '').replace(' (med. Leiter)', '')}</div>
                    {p.role && <div className="text-[10px] text-gray-400 font-normal">{p.role}</div>}
                    {p.name.includes('(GL)') && <div className="text-[10px] text-gray-400 font-normal">GL</div>}
                    {p.name.includes('med. Leiter') && <div className="text-[10px] text-gray-400 font-normal">med. Leiter</div>}
                  </th>
                ))}
              </tr>
              {/* Legend row — sticky top (directly below names) */}
              <tr className="border-b border-gray-100 bg-white">
                <td className="sticky left-0 top-[53px] z-30 bg-white px-4 py-1.5 text-[10px] text-gray-400">
                  <span className="mr-3"><span className="inline-block px-1 py-0.5 rounded bg-green-100 text-green-700 font-bold text-[10px] mr-0.5">H</span> Hauptverantwortung</span>
                  <span className="mr-3"><span className="inline-block px-1 py-0.5 rounded bg-blue-100 text-blue-700 font-bold text-[10px] mr-0.5">S</span> Stellvertretung</span>
                  <span><span className="inline-block px-1 py-0.5 rounded bg-gray-100 text-gray-600 font-bold text-[10px] mr-0.5">SP</span> Stellv. geplant</span>
                </td>
                <td colSpan={persons.length} className="sticky top-[53px] z-20 bg-white px-2 py-1.5 text-[10px] text-gray-400 text-center">
                  {canEdit && 'Klicken zum Bearbeiten: — → H → S → SP → —'}
                </td>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => {
                const catRows = rows.filter(r => r.category === cat)
                const firstIdx = rows.findIndex(r => r.category === cat)
                return (
                  <>
                    {/* Category header */}
                    <tr key={`cat-${cat}`} className="bg-violet-50 border-t border-b border-violet-100">
                      <td colSpan={persons.length + 1}
                        className="sticky left-0 px-4 py-2 font-semibold text-violet-800 text-xs uppercase tracking-wide">
                        {cat}
                      </td>
                    </tr>
                    {/* Task rows */}
                    {catRows.map((row, relIdx) => {
                      const absIdx = firstIdx + relIdx
                      return (
                        <tr key={`row-${absIdx}`}
                          className="border-b border-gray-100 hover:bg-gray-50 transition-colors group">
                          <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 px-4 py-2.5 text-gray-700 font-medium leading-snug">
                            <div className="flex items-start gap-1.5">
                              <span className="flex-1">{row.task}</span>
                              {/* SOP link badge */}
                              {row.sopPageId && (
                                <button
                                  onClick={() => navigate('/sop')}
                                  title={`SOP: ${row.sopPageTitle ?? row.sopPageId}`}
                                  className="shrink-0 mt-0.5 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 transition-colors">
                                  <ExternalLink className="w-2.5 h-2.5" />
                                  SOP
                                </button>
                              )}
                              {/* Edit button — canEdit only */}
                              {canEdit && (
                                <button
                                  onClick={() => setEditingRow({ idx: absIdx, task: row.task, sopPageId: row.sopPageId, sopPageTitle: row.sopPageTitle, category: row.category })}
                                  className="shrink-0 mt-0.5 p-0.5 rounded text-gray-300 hover:text-violet-500 hover:bg-violet-50 transition-colors opacity-0 group-hover:opacity-100">
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                          {persons.map(p => {
                            const code = row.assignments[p.name] ?? ''
                            return (
                              <td key={p.name}
                                onClick={() => toggleCell(absIdx, p.name)}
                                className={`px-2 py-2.5 text-center ${canEdit ? 'cursor-pointer hover:bg-violet-50' : ''}`}>
                                <CodeBadge code={code} />
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}

                    {/* Inline add-task row */}
                    {canEdit && (
                      addingCategory === cat ? (
                        <tr key={`add-${cat}`} className="bg-violet-50/60">
                          <td className="sticky left-0 z-10 bg-violet-50 px-4 py-2" colSpan={1}>
                            <input
                              autoFocus
                              value={newTaskName}
                              onChange={e => setNewTaskName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleAddTask(cat)
                                if (e.key === 'Escape') { setAddingCategory(null); setNewTaskName(''); setNewTaskSopId(''); setNewTaskSopTitle('') }
                              }}
                              placeholder="Neue Aufgabe eingeben…"
                              className="w-full text-xs bg-transparent border-b border-violet-400 focus:outline-none focus:border-violet-600 placeholder:text-violet-300 text-gray-700"
                            />
                          </td>
                          <td colSpan={persons.length} className="bg-violet-50 px-3 py-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* SOP link selector */}
                              <select
                                value={newTaskSopId}
                                onChange={e => {
                                  const id = e.target.value
                                  const page = sopPages.find(p => p.id === id)
                                  setNewTaskSopId(id)
                                  setNewTaskSopTitle(page?.title ?? '')
                                  if (page && !newTaskName.trim()) setNewTaskName(page.title)
                                }}
                                className="text-[11px] border border-violet-200 rounded bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-400 px-1.5 py-0.5 max-w-[220px]">
                                <option value="">SOP verknüpfen…</option>
                                {sopPages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                              </select>
                              {newTaskSopId && (
                                <span className="text-[10px] text-violet-600 flex items-center gap-1">
                                  <ExternalLink className="w-2.5 h-2.5" />
                                  {newTaskSopTitle}
                                </span>
                              )}
                              <button onClick={() => handleAddTask(cat)}
                                className="text-[11px] px-2 py-0.5 bg-violet-600 text-white rounded font-semibold hover:bg-violet-700 transition-colors">
                                Hinzufügen
                              </button>
                              <button onClick={() => { setAddingCategory(null); setNewTaskName(''); setNewTaskSopId(''); setNewTaskSopTitle('') }}
                                className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors">
                                Abbrechen
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={`addBtn-${cat}`}>
                          <td colSpan={persons.length + 1} className="px-4 py-1.5">
                            <button
                              onClick={() => { setAddingCategory(cat); setNewTaskName('') }}
                              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-violet-600 font-medium transition-colors group/add">
                              <Plus className="w-3 h-3 group-hover/add:text-violet-500" />
                              Aufgabe hinzufügen
                            </button>
                          </td>
                        </tr>
                      )
                    )}
                  </>
                )
              })}
            </tbody>
          </table>

          {/* ── New category form ── */}
          {canEdit && (
            <div className="border-t border-violet-100 bg-white px-4 py-2">
              {showNewCategory ? (
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Kategorie</span>
                    <input
                      autoFocus
                      value={newCategoryName}
                      onChange={e => setNewCategoryName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { setShowNewCategory(false); setNewCategoryName(''); setNewCategoryTask('') } }}
                      placeholder="z.B. Qualitätsmanagement"
                      className="px-2.5 py-1.5 text-xs border border-violet-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 w-52"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Erste Aufgabe</span>
                    <input
                      value={newCategoryTask}
                      onChange={e => setNewCategoryTask(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddCategory(); if (e.key === 'Escape') { setShowNewCategory(false); setNewCategoryName(''); setNewCategoryTask('') } }}
                      placeholder="Aufgabe eingeben…"
                      className="px-2.5 py-1.5 text-xs border border-violet-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 w-64"
                    />
                  </div>
                  <div className="flex items-end gap-2 pb-0.5">
                    <button onClick={handleAddCategory} disabled={!newCategoryName.trim() || !newCategoryTask.trim()}
                      className="px-3 py-1.5 text-xs font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-40 transition-colors">
                      Erstellen
                    </button>
                    <button onClick={() => { setShowNewCategory(false); setNewCategoryName(''); setNewCategoryTask('') }}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                      Abbrechen
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowNewCategory(true)}
                  className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-violet-600 font-medium transition-colors group/nc">
                  <Plus className="w-3.5 h-3.5 group-hover/nc:text-violet-500" />
                  Neue Kategorie
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Bottom panels ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t border-gray-100">

          {/* Relevant für */}
          <div className="border-r border-gray-100">
            <button
              onClick={() => setShowRelevant(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-500" />
                Relevant für
                <span className="text-xs font-normal text-gray-400">({(akvDoc.relevantFuer ?? []).length} Personen)</span>
              </span>
              {showRelevant ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showRelevant && (
              <div className="px-5 pb-4 space-y-1.5">
                {canEdit
                  ? sopUsers.map(u => {
                      const checked = (akvDoc.relevantFuer ?? []).includes(u.displayName)
                      return (
                        <label key={u.uid} className="flex items-center gap-2.5 cursor-pointer group">
                          <input type="checkbox" checked={checked}
                            onChange={() => toggleRelevantFuer(u.displayName)}
                            className="rounded border-gray-300 text-violet-600 focus:ring-violet-400 cursor-pointer" />
                          <span className="text-sm text-gray-700 group-hover:text-gray-900">{u.displayName}</span>
                        </label>
                      )
                    })
                  : (akvDoc.relevantFuer ?? []).length === 0
                  ? <p className="text-sm text-gray-400">Keine Personen definiert</p>
                  : (akvDoc.relevantFuer ?? []).map(name => (
                      <div key={name} className="text-sm text-gray-700">{name}</div>
                    ))
                }
              </div>
            )}
          </div>

          {/* Schulungsnachweis */}
          <div>
            <button
              onClick={() => setShowNachweis(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Schulungsnachweis
                <span className="text-xs font-normal text-gray-400">({confirmations.length} Bestätigungen)</span>
              </span>
              {showNachweis ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showNachweis && (
              <div className="px-5 pb-4 space-y-3">
                {/* Confirmation button for current user */}
                {isRelevantFuer && akvDoc.status === 'final' && (
                  hasConfirmed
                    ? <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                        <Check className="w-4 h-4" />
                        Bestätigt — Sie haben die Inhalte zur Kenntnis genommen.
                      </div>
                    : <button onClick={handleConfirm} disabled={confirming}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-60">
                        {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Ich habe die AKV-Liste gelesen und verstanden
                      </button>
                )}
                {isRelevantFuer && akvDoc.status !== 'final' && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Bestätigung wird erst nach der Freigabe möglich.
                  </p>
                )}

                {/* List of confirmations */}
                {confirmations.length > 0
                  ? <ul className="divide-y divide-gray-100">
                      {confirmations.map(c => (
                        <li key={c.id} className="flex items-center justify-between py-2 text-xs">
                          <span className="font-medium text-gray-700">{c.displayName || c.username}</span>
                          <span className="text-gray-400">{fmtTs(c.confirmedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  : <p className="text-xs text-gray-400">Noch keine Bestätigungen</p>
                }
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Task-Edit-Modal ── */}
      {editingRow && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-violet-600" />
                <h2 className="text-base font-bold text-gray-900">Aufgabe bearbeiten</h2>
              </div>
              <button onClick={() => setEditingRow(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Task name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Aufgabe</label>
                <input type="text" value={editingRow.task}
                  onChange={e => setEditingRow(prev => prev ? { ...prev, task: e.target.value } : prev)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                  placeholder="Aufgabenbeschreibung" />
              </div>

              {/* SOP link */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  SOP verlinken
                  {sopPages.length === 0 && <span className="text-gray-400 font-normal ml-1">(keine freigegebenen SOP-Seiten vorhanden)</span>}
                </label>
                <select
                  value={editingRow.sopPageId ?? ''}
                  onChange={e => {
                    const id = e.target.value
                    const page = sopPages.find(p => p.id === id)
                    setEditingRow(prev => prev ? { ...prev, sopPageId: id || undefined, sopPageTitle: page?.title || undefined } : prev)
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white">
                  <option value="">— keine SOP-Seite —</option>
                  {sopPages.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
                {editingRow.sopPageId && (
                  <p className="mt-1.5 text-[11px] text-violet-600 flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" />
                    Verknüpft mit: <span className="font-semibold">{editingRow.sopPageTitle ?? editingRow.sopPageId}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
              <button onClick={() => handleDeleteRow(editingRow.idx)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
                Aufgabe löschen
              </button>
              <div className="flex gap-3">
                <button onClick={() => setEditingRow(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  Abbrechen
                </button>
                <button onClick={handleSaveEditRow}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors">
                  <Save className="w-3.5 h-3.5" />
                  Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Personen-Modal ── */}
      {showPersonsModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <UserCog className="w-5 h-5 text-violet-600" />
                <h2 className="text-base font-bold text-gray-900">Personen verwalten</h2>
              </div>
              <button onClick={() => setShowPersonsModal(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <p className="text-xs text-gray-400 mb-4">
                Spalten umbenennen, Funktion ändern oder mit einem Benutzerkonto verknüpfen. Neue Personen frei hinzufügen.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="text-left pb-2 pr-3 w-[35%]">Spaltenname</th>
                    <th className="text-left pb-2 pr-3 w-[25%]">Funktion</th>
                    <th className="text-left pb-2 pr-3">Verknüpft mit Benutzer</th>
                    <th className="pb-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {editPersons.map((ep, i) => (
                    <tr key={i} className="group border-b border-gray-50">
                      <td className="py-2 pr-3">
                        <input type="text" value={ep.name}
                          onChange={e => setEditPersons(prev => prev.map((p, j) => j === i ? { ...p, name: e.target.value } : p))}
                          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent"
                          placeholder="Name" />
                      </td>
                      <td className="py-2 pr-3">
                        <input type="text" value={ep.role}
                          onChange={e => setEditPersons(prev => prev.map((p, j) => j === i ? { ...p, role: e.target.value } : p))}
                          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent"
                          placeholder="MPA, Arzt, GL …" />
                      </td>
                      <td className="py-2 pr-3">
                        <select value={ep.uid ?? ''}
                          onChange={e => {
                            const uid = e.target.value
                            const linked = sopUsers.find(u => u.uid === uid)
                            setEditPersons(prev => prev.map((p, j) => j === i ? {
                              ...p,
                              uid: uid || undefined,
                              ...(linked ? { role: roleLabel(linked.role) } : {}),
                            } : p))
                          }}
                          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white">
                          <option value="">— kein Benutzer —</option>
                          {sopUsers.map(u => (
                            <option key={u.uid} value={u.uid}>{u.displayName}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 text-center">
                        <button
                          onClick={() => setEditPersons(prev => prev.filter((_, j) => j !== i))}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                onClick={() => setEditPersons(prev => [...prev, { name: '', role: '', uid: undefined, _origName: '' }])}
                className="mt-4 flex items-center gap-2 text-sm text-violet-600 hover:text-violet-800 font-medium transition-colors">
                <Plus className="w-4 h-4" />
                Person hinzufügen
              </button>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
              <p className="text-xs text-gray-400">Umbenennungen werden in der Tabelle automatisch übernommen.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowPersonsModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  Abbrechen
                </button>
                <button onClick={handleSavePersons} disabled={savingPersons}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-60">
                  {savingPersons ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Print portal — rendered at <body>, invisible normally, visible on print ── */}
      {akvDoc && createPortal(
        <div id="akv-print-root" style={{ display: 'none', fontFamily: 'Arial, Helvetica, sans-serif' }}>
          <style>{`
            @media print {
              body > * { display: none !important; }
              #akv-print-root {
                display: block !important;
                background: white;
                color: #111;
                font-family: Arial, Helvetica, sans-serif;
              }
              @page { size: A4 landscape; margin: 10mm 10mm; }
              #akv-print-root table { border-collapse: collapse; width: 100%; table-layout: auto; }
              #akv-print-root .p-th-task { text-align: left; font-size: 7pt; font-weight: bold; padding: 3px 6px; background: #f3f4f6; border-bottom: 2px solid #9ca3af; min-width: 170px; }
              #akv-print-root .p-th-person { text-align: center; font-size: 6.5pt; font-weight: bold; padding: 3px 3px; background: #f3f4f6; border-bottom: 2px solid #9ca3af; min-width: 44px; }
              #akv-print-root .p-td-task { font-size: 7pt; padding: 2px 6px; border-bottom: 0.5px solid #e5e7eb; color: #1f2937; vertical-align: top; line-height: 1.3; }
              #akv-print-root .p-td-cell { text-align: center; padding: 2px 3px; border-bottom: 0.5px solid #e5e7eb; }
              #akv-print-root .p-cat { font-size: 6.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #5b21b6; background: #ede9fe; padding: 2px 6px; border-top: 1px solid #c4b5fd; }
              #akv-print-root .badge { display: inline-block; padding: 1px 4px; border-radius: 2px; font-size: 6.5pt; font-weight: bold; }
              #akv-print-root .bH  { background: #dcfce7; color: #166534; border: 0.5px solid #bbf7d0; }
              #akv-print-root .bS  { background: #dbeafe; color: #1e40af; border: 0.5px solid #bfdbfe; }
              #akv-print-root .bSP { background: #f3f4f6; color: #4b5563; border: 0.5px solid #d1d5db; }
              #akv-print-root .sop-hint { font-size: 5.5pt; color: #7c3aed; font-style: italic; margin-left: 3px; }
            }
          `}</style>

          {/* ── Document header ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '7px', paddingBottom: '5px', borderBottom: '2.5px solid #4c1d95' }}>
            <div>
              <div style={{ fontSize: '6.5pt', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1.2px', color: '#7c3aed', marginBottom: '2px' }}>
                Augenzentrum Suhr — Gelenkte Liste
              </div>
              <div style={{ fontSize: '13pt', fontWeight: 'bold', color: '#111', lineHeight: 1.1 }}>
                {akvDoc.title}
              </div>
            </div>
            <table style={{ fontSize: '7pt', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Version',        akvDoc.version],
                  ['Gültig ab',      fmtDateStr(akvDoc.gueltigAb)],
                  ['Verantwortlich', akvDoc.verantwortlich],
                  ['Freigabe',       akvDoc.freigegebenVon],
                ].map(([label, val]) => (
                  <tr key={label}>
                    <td style={{ color: '#666', paddingRight: '6px', whiteSpace: 'nowrap' }}>{label}:</td>
                    <td style={{ fontWeight: 'bold' }}>{val || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Responsibility matrix ── */}
          <table>
            <thead>
              <tr>
                <th className="p-th-task">Aufgabe</th>
                {persons.map(p => {
                  const display = p.name.replace(' (GL)', '').replace(' (med. Leiter)', '')
                  const sub = p.role || (p.name.includes('(GL)') ? 'GL' : p.name.includes('med. Leiter') ? 'med. Leiter' : '')
                  return (
                    <th key={p.name} className="p-th-person">
                      {display}
                      {sub && <><br /><span style={{ fontWeight: 'normal', color: '#666' }}>{sub}</span></>}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set(rows.map(r => r.category))).map(cat => {
                const catRows = rows.filter(r => r.category === cat)
                return (
                  <Fragment key={`pc-${cat}`}>
                    <tr>
                      <td className="p-cat" colSpan={persons.length + 1}>{cat}</td>
                    </tr>
                    {catRows.map((row, i) => (
                      <tr key={`pr-${cat}-${i}`}>
                        <td className="p-td-task">
                          {row.task}
                          {row.sopPageTitle && <span className="sop-hint">[SOP: {row.sopPageTitle}]</span>}
                        </td>
                        {persons.map(p => {
                          const code = row.assignments[p.name] ?? ''
                          const cls = code === 'H' ? 'bH' : code === 'S' ? 'bS' : code === 'SP' ? 'bSP' : ''
                          return (
                            <td key={p.name} className="p-td-cell">
                              {code && <span className={`badge ${cls}`}>{code}</span>}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>

          {/* ── Footer ── */}
          <div style={{ marginTop: '7px', borderTop: '0.5px solid #d1d5db', paddingTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '6.5pt', color: '#666' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span><strong>Legende:</strong></span>
              {(['H','S','SP'] as const).map(c => (
                <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <span className={`badge ${c === 'H' ? 'bH' : c === 'S' ? 'bS' : 'bSP'}`}>{c}</span>
                  <span>{c === 'H' ? 'Hauptverantwortung' : c === 'S' ? 'Stellvertretung' : 'Stellv. geplant'}</span>
                </span>
              ))}
            </div>
            <div>Druckdatum: {new Date().toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
