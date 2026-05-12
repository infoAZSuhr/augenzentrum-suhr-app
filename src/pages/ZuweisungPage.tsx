import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Filter, CheckCircle2, Clock, ExternalLink, Building2,
  Users, CalendarDays, StickyNote, ChevronDown, ChevronUp, X,
} from 'lucide-react'
import { RecallPatient, Zuweisung, subscribeZuweisungPatients, updateRecallPatient } from '../lib/firestoreRecall'
import { useAuth } from '../lib/AuthContext'

function formatDate(s: string | null | undefined): string {
  if (!s || s === 'kein Termin') return '—'
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return s
  return `${m[3]}.${m[2]}.${m[1]}`
}

type FilterStatus = 'alle' | 'ausstehend' | 'erledigt'
type FilterTyp    = 'alle' | 'intern' | 'extern'

export default function ZuweisungPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const displayLabel = profile?.displayName || profile?.username || 'System'

  const [patients, setPatients] = useState<RecallPatient[]>([])
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ausstehend')
  const [filterTyp, setFilterTyp] = useState<FilterTyp>('alle')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => subscribeZuweisungPatients(setPatients), [])

  const visible = patients.filter(p => {
    const z = p.zuweisung!
    if (filterStatus !== 'alle' && z.status !== filterStatus) return false
    if (filterTyp !== 'alle' && z.typ !== filterTyp) return false
    return true
  })

  async function markErledigt(p: RecallPatient) {
    if (savingId) return
    setSavingId(p.id)
    const updated: Zuweisung = {
      ...p.zuweisung!,
      status: 'erledigt',
      erledigtAm: new Date().toISOString().slice(0, 10),
    }
    try {
      await updateRecallPatient(p.id, { zuweisung: updated }, displayLabel)
    } finally {
      setSavingId(null)
    }
  }

  async function reopen(p: RecallPatient) {
    if (savingId) return
    setSavingId(p.id)
    const updated: Zuweisung = { ...p.zuweisung!, status: 'ausstehend', erledigtAm: '' }
    try {
      await updateRecallPatient(p.id, { zuweisung: updated }, displayLabel)
    } finally {
      setSavingId(null)
    }
  }

  const ausstehendCount = patients.filter(p => p.zuweisung?.status === 'ausstehend').length
  const erledigtCount   = patients.filter(p => p.zuweisung?.status === 'erledigt').length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-gray-900 leading-tight">Zuweisungen</h1>
            <p className="text-xs text-gray-400 leading-tight">
              {ausstehendCount} ausstehend · {erledigtCount} erledigt
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="max-w-4xl mx-auto px-4 pb-3 flex flex-wrap gap-2">
          <div className="flex gap-1 items-center">
            <Filter className="w-3.5 h-3.5 text-gray-400" />
            {(['ausstehend', 'erledigt', 'alle'] as FilterStatus[]).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors capitalize ${
                  filterStatus === s
                    ? s === 'ausstehend' ? 'bg-amber-100 text-amber-700 border border-amber-300'
                    : s === 'erledigt'  ? 'bg-green-100 text-green-700 border border-green-300'
                    :                     'bg-gray-200 text-gray-700 border border-gray-300'
                    : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
                }`}
              >
                {s === 'alle' ? 'Alle' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex gap-1 items-center ml-2">
            {(['alle', 'intern', 'extern'] as FilterTyp[]).map(t => (
              <button key={t} onClick={() => setFilterTyp(t)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  filterTyp === t
                    ? 'bg-violet-100 text-violet-700 border border-violet-300'
                    : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
                }`}
              >
                {t === 'alle' ? 'Alle Typen' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-2">
        {visible.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Keine Zuweisungen gefunden</p>
            <p className="text-xs mt-1">
              {filterStatus === 'ausstehend' ? 'Alle Zuweisungen sind erledigt.' : 'Noch keine Einträge.'}
            </p>
          </div>
        )}

        {visible.map(p => {
          const z = p.zuweisung!
          const isExpanded = expandedId === p.id
          const isErledigt = z.status === 'erledigt'
          const isSaving   = savingId === p.id

          return (
            <div key={p.id}
              className={`bg-white rounded-xl border transition-all ${
                isErledigt ? 'border-green-200 opacity-75' : 'border-gray-200 shadow-sm'
              }`}
            >
              {/* Main row */}
              <div className="p-4">
                <div className="flex items-start gap-3">
                  {/* Status icon */}
                  <div className={`mt-0.5 shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    isErledigt ? 'bg-green-100' : 'bg-amber-100'
                  }`}>
                    {isErledigt
                      ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                      : <Clock className="w-4 h-4 text-amber-600" />
                    }
                  </div>

                  {/* Patient info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">
                        {p.vorname || '—'}
                      </span>
                      {p.pid && (
                        <span className="font-mono text-xs text-gray-400">#{p.pid}</span>
                      )}
                      {p.gebDatum && (
                        <span className="text-xs text-gray-400">*{formatDate(p.gebDatum)}</span>
                      )}
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                        {p.doctor}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full border font-semibold ${
                        z.typ === 'intern'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-violet-50 text-violet-700 border-violet-200'
                      }`}>
                        {z.typ === 'intern' ? <><Users className="w-3 h-3 inline mr-1" />Intern</> : <><ExternalLink className="w-3 h-3 inline mr-1" />Extern</>}
                      </span>
                    </div>

                    {/* Ziel */}
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="text-sm font-medium text-gray-800">→ {z.ziel || '—'}</span>
                    </div>

                    {/* Grund */}
                    {z.grund && (
                      <p className="mt-1 text-xs text-gray-500 italic">{z.grund}</p>
                    )}

                    {/* Datum + erledigt */}
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" />
                        Beschlossen: {formatDate(z.datum)}
                      </span>
                      {isErledigt && z.erledigtAm && (
                        <span className="text-green-600 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Erledigt: {formatDate(z.erledigtAm)}
                        </span>
                      )}
                      {z.von && (
                        <span>von {z.von}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-1.5">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      title="Details"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {!isErledigt ? (
                      <button
                        onClick={() => markErledigt(p)}
                        disabled={isSaving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors disabled:opacity-40"
                        title="Als erledigt markieren"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Erledigt
                      </button>
                    ) : (
                      <button
                        onClick={() => reopen(p)}
                        disabled={isSaving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-40"
                        title="Wieder öffnen"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        Öffnen
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded: notiz + link to recall */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-2 bg-gray-50 rounded-b-xl">
                  {z.notiz ? (
                    <div className="flex items-start gap-2 text-sm text-gray-600">
                      <StickyNote className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
                      <p>{z.notiz}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Keine Notiz hinterlegt.</p>
                  )}
                  <button
                    onClick={() => navigate('/recall')}
                    className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-800 hover:underline transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    In Recall öffnen
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
