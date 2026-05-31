import { useMemo, useState } from 'react'
import { X, Plus, Pencil, Trash2, Search, Check, BookOpen, RefreshCw } from 'lucide-react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useGlossar } from '../../lib/GlossarContext'
import { useAuth } from '../../lib/AuthContext'
import {
  addGlossarEntry,
  updateGlossarEntry,
  deleteGlossarEntry,
  syncMissingDefaults,
  type GlossarEntry,
} from '../../lib/firestoreGlossar'
import { GLOSSAR as DEFAULT_GLOSSAR } from '../../lib/glossar'

interface Props {
  onClose: () => void
}

interface DraftEntry {
  abbreviation: string
  explanation:  string
}

export default function GlossarModal({ onClose }: Props) {
  useEscapeKey(onClose)

  const { entries, loading, seeded } = useGlossar()
  const { profile, isAdmin, isGeschaeftsleitung } = useAuth()
  const canEdit = isAdmin || isGeschaeftsleitung

  const [search,    setSearch]    = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft,     setDraft]     = useState<DraftEntry>({ abbreviation: '', explanation: '' })
  const [adding,    setAdding]    = useState(false)
  const [busy,      setBusy]      = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<GlossarEntry | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e =>
      e.abbreviation.toLowerCase().includes(q) ||
      e.explanation.toLowerCase().includes(q)
    )
  }, [entries, search])

  // Wieviele Default-Einträge fehlen aktuell in Firestore?
  const missingDefaultsCount = useMemo(() => {
    const existing = new Set(entries.map(e => e.abbreviation))
    return Object.keys(DEFAULT_GLOSSAR).filter(k => !existing.has(k)).length
  }, [entries])

  const updatedBy = profile?.displayName || profile?.username || 'unknown'

  async function handleSyncDefaults() {
    if (busy) return
    setBusy(true)
    try {
      const existing = new Set(entries.map(e => e.abbreviation))
      const added = await syncMissingDefaults(DEFAULT_GLOSSAR, existing, updatedBy)
      console.log(`[Glossar] ${added} Default-Einträge synchronisiert`)
    } catch (err) {
      console.error('[Glossar] Sync fehlgeschlagen:', err)
      alert('Synchronisation fehlgeschlagen — siehe Konsole.')
    } finally { setBusy(false) }
  }

  async function handleSaveNew() {
    if (!draft.abbreviation.trim() || !draft.explanation.trim()) return
    setBusy(true)
    try {
      await addGlossarEntry(draft.abbreviation, draft.explanation, updatedBy)
      setDraft({ abbreviation: '', explanation: '' })
      setAdding(false)
    } finally { setBusy(false) }
  }

  async function handleSaveEdit() {
    if (!editingId) return
    if (!draft.abbreviation.trim() || !draft.explanation.trim()) return
    setBusy(true)
    try {
      await updateGlossarEntry(editingId, draft.abbreviation, draft.explanation, updatedBy)
      setEditingId(null)
      setDraft({ abbreviation: '', explanation: '' })
    } finally { setBusy(false) }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setBusy(true)
    try {
      await deleteGlossarEntry(confirmDelete.id)
      setConfirmDelete(null)
    } finally { setBusy(false) }
  }

  function startEdit(e: GlossarEntry) {
    setEditingId(e.id)
    setDraft({ abbreviation: e.abbreviation, explanation: e.explanation })
    setAdding(false)
  }

  function cancelEdit() {
    setEditingId(null)
    setAdding(false)
    setDraft({ abbreviation: '', explanation: '' })
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-none sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl flex flex-col h-full sm:max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-cyan-600" />
            <h2 className="text-sm font-semibold text-gray-800">Glossar &middot; Abkürzungen</h2>
            <span className="text-[10px] text-gray-400 font-medium">{entries.length}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title="Schliessen (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Suche + Add */}
        <div className="px-5 py-3 border-b border-gray-100 shrink-0 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Abkürzung oder Erklärung suchen…"
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {canEdit && !adding && !editingId && missingDefaultsCount > 0 && (
            <button
              onClick={handleSyncDefaults}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 transition-colors shrink-0 disabled:opacity-50"
              title={`${missingDefaultsCount} Standard-Einträge aus dem Code in Firestore nachtragen (überschreibt keine bestehenden)`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              {missingDefaultsCount} sync
            </button>
          )}
          {canEdit && !adding && !editingId && (
            <button
              onClick={() => { setAdding(true); setDraft({ abbreviation: '', explanation: '' }) }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-600 hover:bg-cyan-700 text-white transition-colors shrink-0"
              title="Neuen Eintrag hinzufügen"
            >
              <Plus className="w-3.5 h-3.5" /> Neu
            </button>
          )}
        </div>

        {/* Add-Form */}
        {adding && (
          <div className="px-5 py-3 border-b border-cyan-100 bg-cyan-50/40 shrink-0 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="Abkürzung (z.B. POWG)"
                className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                value={draft.abbreviation}
                onChange={e => setDraft(d => ({ ...d, abbreviation: e.target.value }))}
                autoFocus
              />
              <input
                type="text"
                placeholder="Erklärung"
                className="sm:col-span-2 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                value={draft.explanation}
                onChange={e => setDraft(d => ({ ...d, explanation: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && !busy) handleSaveNew() }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={cancelEdit} className="px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md">Abbrechen</button>
              <button
                onClick={handleSaveNew}
                disabled={busy || !draft.abbreviation.trim() || !draft.explanation.trim()}
                className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-cyan-600 hover:bg-cyan-700 text-white rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check className="w-3 h-3" /> Speichern
              </button>
            </div>
          </div>
        )}

        {/* Liste */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Lade Glossar…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400 space-y-2">
              {search ? (
                <p>Keine Treffer.</p>
              ) : !seeded ? (
                <>
                  <p>Glossar wird gerade initialisiert …</p>
                  <p className="text-xs text-gray-400">Tooltips in SOPs sind über die eingebauten Defaults sofort aktiv. Sobald ein Admin die App geöffnet hat, erscheinen die Einträge hier.</p>
                </>
              ) : (
                <p>Noch keine Einträge.</p>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map(entry => {
                const isEditing = editingId === entry.id
                return (
                  <li key={entry.id} className="px-5 py-2.5 hover:bg-gray-50/60 transition-colors">
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                            value={draft.abbreviation}
                            onChange={e => setDraft(d => ({ ...d, abbreviation: e.target.value }))}
                            autoFocus
                          />
                          <input
                            type="text"
                            className="sm:col-span-2 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                            value={draft.explanation}
                            onChange={e => setDraft(d => ({ ...d, explanation: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter' && !busy) handleSaveEdit() }}
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={cancelEdit} className="px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md">Abbrechen</button>
                          <button
                            onClick={handleSaveEdit}
                            disabled={busy || !draft.abbreviation.trim() || !draft.explanation.trim()}
                            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-cyan-600 hover:bg-cyan-700 text-white rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Check className="w-3 h-3" /> Speichern
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="font-mono text-sm font-semibold text-cyan-700 w-24 shrink-0 truncate" title={entry.abbreviation}>
                          {entry.abbreviation}
                        </div>
                        <div className="flex-1 text-sm text-gray-700 leading-snug">
                          {entry.explanation}
                        </div>
                        {canEdit && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 sm:opacity-100 shrink-0">
                            <button
                              onClick={() => startEdit(entry)}
                              className="p-1.5 rounded-md text-gray-400 hover:text-cyan-700 hover:bg-cyan-50 transition-colors"
                              title="Bearbeiten"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDelete(entry)}
                              className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Löschen"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer-Tipp */}
        <div className="px-5 py-2 border-t border-gray-100 shrink-0 bg-gray-50/60">
          <p className="text-[11px] text-gray-500">
            {canEdit
              ? 'Änderungen sind sofort in allen SOPs sichtbar (Tooltip beim Hover).'
              : 'Nur Admin/Geschäftsleitung kann Einträge bearbeiten oder hinzufügen.'}
          </p>
        </div>

        {/* Delete-Confirm */}
        {confirmDelete && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center p-4 rounded-2xl"
               onClick={() => setConfirmDelete(null)}>
            <div className="bg-white rounded-xl shadow-2xl p-5 max-w-sm w-full" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Eintrag löschen?</h3>
              <p className="text-xs text-gray-500 mb-4">
                «{confirmDelete.abbreviation}» — {confirmDelete.explanation.slice(0, 80)}{confirmDelete.explanation.length > 80 ? '…' : ''}
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-md">Abbrechen</button>
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-md disabled:opacity-40"
                >
                  Löschen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
