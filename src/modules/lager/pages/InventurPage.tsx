import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Check, X, AlertTriangle } from 'lucide-react'
import { getArticles, applyInventurCorrections } from '../../../lib/firestoreLager'
import { useAuth } from '../../../lib/AuthContext'
import PageHeader from '../../../components/ui/PageHeader'
import type { InventoryArticle } from '../../../types/inventory.types'

export default function InventurPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['inventory-articles'],
    queryFn: () => getArticles(),
  })

  // Pre-fill counts with current stock on first load
  const initialised = useMemo(() => {
    if (articles.length === 0) return false
    setCounts(prev => {
      const next = { ...prev }
      for (const a of articles) {
        if (next[a.id as string] === undefined) next[a.id as string] = String(a.currentStock ?? 0)
      }
      return next
    })
    return true
  }, [articles])

  const getCount = (a: InventoryArticle) => {
    const raw = counts[a.id as string]
    return raw === '' || raw === undefined ? null : Number(raw)
  }
  const getDiff = (a: InventoryArticle) => {
    const c = getCount(a)
    return c === null ? null : c - (a.currentStock ?? 0)
  }

  const discrepancies = articles.filter(a => getDiff(a) !== null && getDiff(a) !== 0)

  const saveMut = useMutation({
    mutationFn: () =>
      applyInventurCorrections(
        discrepancies.map(a => ({
          articleId: a.id as string,
          physicalCount: getCount(a)!,
          currentStock: a.currentStock ?? 0,
          performedBy: profile?.username ?? profile?.displayName ?? 'unbekannt',
        }))
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-articles'] })
      setSaved(true)
      setTimeout(() => navigate('/lager'), 1500)
    },
  })

  const today = new Date().toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div>
      <PageHeader
        title="Inventur"
        subtitle={`${today} · ${discrepancies.length} Differenz${discrepancies.length !== 1 ? 'en' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/lager')} className="btn-secondary">
              <X className="w-4 h-4" /> Abbrechen
            </button>
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || saved || discrepancies.length === 0}
              className="btn-primary"
            >
              <Check className="w-4 h-4" />
              {saved ? 'Gespeichert ✓' : saveMut.isPending ? 'Speichern…' : `Abschliessen${discrepancies.length > 0 ? ` (${discrepancies.length})` : ''}`}
            </button>
          </div>
        }
      />

      {discrepancies.length > 0 && !saved && (
        <div className="mx-6 mt-4 px-4 py-2.5 rounded-lg border bg-amber-50 border-amber-200 flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {discrepancies.length} Artikel mit Differenz — Bestand wird beim Abschliessen korrigiert.
        </div>
      )}

      <div className="p-3 sm:p-6">
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Artikel</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Kategorie</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">System-Bestand</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Ist-Bestand (gezählt)</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Differenz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Laden…</td></tr>
                ) : articles.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Keine Artikel erfasst.</td></tr>
                ) : articles.map(a => {
                  const diff = getDiff(a)
                  const diffColor = diff === null ? '' : diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'
                  const rowBg = diff !== null && diff !== 0 ? 'bg-red-50' : ''
                  return (
                    <tr key={a.id as string} className={`${rowBg} transition-colors`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {(a as any).imageUrl
                            ? <img src={(a as any).imageUrl} className="w-7 h-7 rounded object-cover shrink-0" alt="" />
                            : <div className="w-7 h-7 rounded bg-gray-100 shrink-0" />}
                          <span className="font-medium text-gray-900">{a.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{a.category}</td>
                      <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                        {a.currentStock ?? 0} <span className="text-gray-400 text-xs">{a.quantityUnit || a.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="input w-20 text-right py-1 text-sm"
                          value={counts[a.id as string] ?? ''}
                          onChange={e => setCounts(prev => ({ ...prev, [a.id as string]: e.target.value }))}
                        />
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${diffColor}`}>
                        {diff === null ? '—' : diff === 0 ? <span className="text-green-600">✓</span> : (diff > 0 ? '+' : '') + diff}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
