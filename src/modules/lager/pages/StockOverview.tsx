import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, AlertTriangle, BookOpen, Search, X, Download, FileText, RefreshCw } from 'lucide-react'
import { getArticles, createArticle, getAlerts, getArticle, addLot, addMovement, getCategories } from '../../../lib/firestoreLager'
import PageHeader from '../../../components/ui/PageHeader'
import StatusBadge from '../../../components/ui/StatusBadge'
import { formatDate } from '../../../utils/dateUtils'
import ArticleForm from '../components/ArticleForm'
import BookingForm from '../components/BookingForm'
import { vatRate } from '../../../types/inventory.types'
import type { InventoryArticle } from '../../../types/inventory.types'

const safeDecode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

export default function StockOverview() {
  const [showForm, setShowForm] = useState(false)
  const [bookingArticleId, setBookingArticleId] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('Alle')
  const [search, setSearch] = useState('')
  const [slBanner, setSlBanner] = useState<{ date: string; stale: boolean } | null>(null)
  const [zurRoseBanner, setZurRoseBanner] = useState<{ stand: string; stale: boolean } | null>(null)

  useEffect(() => {
    fetch('/sl-meta.json')
      .then(r => r.json())
      .then((meta: { extractedAt: string }) => {
        const daysOld = Math.floor((Date.now() - new Date(meta.extractedAt).getTime()) / 86400000)
        if (daysOld <= 35) return
        const dismissKey = `sl-banner-dismissed-${meta.extractedAt}`
        if (localStorage.getItem(dismissKey)) return
        setSlBanner({ date: meta.extractedAt, stale: true })
      })
      .catch(() => {})
    fetch('/zurrose-nota-meta.json')
      .then(r => r.json())
      .then((meta: { extractedAt: string; stand: string }) => {
        if (!meta.extractedAt) return
        const daysOld = Math.floor((Date.now() - new Date(meta.extractedAt).getTime()) / 86400000)
        const dismissKey = `zurrose-banner-dismissed-${meta.extractedAt}`
        if (localStorage.getItem(dismissKey)) return
        setZurRoseBanner({ stand: meta.stand || meta.extractedAt, stale: daysOld > 3 })
      })
      .catch(() => {})
  }, [])
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['inventory-articles'],
    queryFn: () => getArticles(),
  })

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })

  const { data: alerts = [] } = useQuery({
    queryKey: ['inventory-alerts'],
    queryFn: getAlerts,
  })

const { data: bookingData } = useQuery({
    queryKey: ['inventory-article', bookingArticleId],
    queryFn: () => getArticle(bookingArticleId!),
    enabled: !!bookingArticleId,
  })

  const createMut = useMutation({
    mutationFn: (data: Omit<InventoryArticle, 'id'>) => createArticle(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-articles'] }); setShowForm(false) },
  })

  const addLotMut = useMutation({
    mutationFn: (d: any) => addLot({ ...d, articleId: bookingArticleId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-articles'] }); qc.invalidateQueries({ queryKey: ['inventory-article', bookingArticleId] }); setBookingArticleId(null) },
  })

  const addMovMut = useMutation({
    mutationFn: (d: any) => addMovement({ ...d, articleId: bookingArticleId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-articles'] }); qc.invalidateQueries({ queryKey: ['inventory-article', bookingArticleId] }); setBookingArticleId(null) },
  })

  const stockBar = (article: InventoryArticle) => {
    const cur = article.currentStock ?? 0
    const max = (article.minStock || 1) * 3 || 10
    const pct = Math.min(100, Math.round((cur / max) * 100))
    const color = article.stockStatus === 'critical' || article.stockStatus === 'out' ? 'bg-red-500'
      : article.stockStatus === 'low' ? 'bg-yellow-400' : 'bg-green-500'
    return (
      <div className="flex items-center gap-2">
        <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-sm text-gray-700">{cur} {article.unit}</span>
      </div>
    )
  }

  const bookingArticle = articles.find(a => (a.id as any) === bookingArticleId)
  const bookingLots = bookingData?.lots?.filter((l: any) => !l.isDepleted) ?? []

  // Category counts (including active filter)
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { Alle: articles.length }
    for (const a of articles) counts[a.category] = (counts[a.category] ?? 0) + 1
    return counts
  }, [articles])

  // Filtered list
  const filtered = useMemo(() => {
    let list = articles
    if (activeCategory !== 'Alle') list = list.filter(a => a.category === activeCategory)
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      list = list.filter(a =>
        safeDecode(a.name).toLowerCase().includes(s) ||
        (a.articleNumber ?? '').toLowerCase().includes(s) ||
        (a.gtin ?? '').toLowerCase().includes(s) ||
        (a.refNr ?? '').toLowerCase().includes(s) ||
        (a.supplier ?? '').toLowerCase().includes(s)
      )
    }
    return list
  }, [articles, activeCategory, search])

  // Artikel-IDs mit Zur Rose Nota (aus Artikeldaten direkt)
  const zurRoseArticleIds = useMemo(() => new Set(articles.filter(a => a.zurRoseNota && !a.notDeliverable).map(a => a.id as string)), [articles])

  // Preis pro Bestelleinheit inkl. MWST + 30% Lagerkosten
  const unitPrice = (a: InventoryArticle) =>
    a.price != null ? a.price * (1 + vatRate(a.category) / 100) * 1.30 : null
  const totalPrice = (a: InventoryArticle) => {
    const up = unitPrice(a)
    return up != null ? (a.currentStock ?? 0) * up : null
  }
  const fmtCHF = (v: number | null) =>
    v == null ? '' : v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const exportCSV = (rows: InventoryArticle[]) => {
    const headers = ['Artikel', 'Kategorie', 'Behandlungsart', 'Bestand', 'Packungseinheit', 'Min-Bestand', 'Preis/Einheit +30% (CHF)', 'Gesamtpreis +30% (CHF)', 'Status', 'Nächstes MHD', 'Lieferant', 'Artikelnummer', 'GTIN']
    const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [
      headers.join(';'),
      ...rows.map(a => [
        escape(safeDecode(a.name)),
        escape(a.category),
        escape(Array.isArray(a.treatmentCategory) ? a.treatmentCategory.join(', ') : (a.treatmentCategory ?? '')),
        a.currentStock ?? 0,
        escape(a.unit),
        a.minStock,
        fmtCHF(unitPrice(a)),
        fmtCHF(totalPrice(a)),
        escape(a.stockStatus ?? ''),
        escape(a.nextExpiryDate ?? ''),
        escape(a.supplier ?? ''),
        escape(a.articleNumber ?? ''),
        escape(a.gtin ?? ''),
      ].join(';')),
    ]
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Bestandsauszug_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportPDF = (rows: InventoryArticle[]) => {
    const today = new Date().toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const statusLabel: Record<string, string> = { ok: '✓ OK', low: '⚠ Niedrig', critical: '⚠ Kritisch', out: '✗ Leer' }
    const grandTotal = rows.reduce((sum, a) => sum + (totalPrice(a) ?? 0), 0)
    const hasPrice = rows.some(a => a.price != null)
    const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"/>
<title>Bestandsauszug – Augenzentrum Suhr</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10.5px; color: #111; margin: 20px; }
  h1 { font-size: 15px; margin-bottom: 2px; }
  .sub { color: #555; font-size: 10px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f0f0f0; text-align: left; padding: 5px 7px; border-bottom: 2px solid #ccc; font-size: 9.5px; text-transform: uppercase; white-space: nowrap; }
  td { padding: 4px 7px; border-bottom: 1px solid #e8e8e8; vertical-align: middle; }
  tr:nth-child(even) td { background: #fafafa; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .ok { color: #16a34a; } .low { color: #d97706; } .critical,.out { color: #dc2626; }
  tfoot td { font-weight: bold; border-top: 2px solid #bbb; background: #f5f5f5; }
  @media print { body { margin: 0; } @page { size: A4 landscape; margin: 10mm; } }
</style></head><body>
<h1>Bestandsauszug – Augenzentrum Suhr</h1>
<div class="sub">Stand: ${today} &nbsp;·&nbsp; ${rows.length} Artikel${hasPrice ? ` &nbsp;·&nbsp; Gesamtwert: CHF ${fmtCHF(grandTotal)}` : ''}</div>
<table>
  <thead><tr>
    <th>Artikel</th><th>Kategorie</th><th>Behandlungsart</th>
    <th class="num">Bestand</th><th>Packungseinheit</th>
    <th class="num">Min.</th><th>Status</th><th>Nächstes MHD</th>
    <th class="num">Preis/Einheit +30% CHF</th><th class="num">Gesamtpreis +30% CHF</th>
    <th>Lieferant</th>
  </tr></thead>
  <tbody>${rows.map(a => {
    const up = unitPrice(a); const tp = totalPrice(a)
    return `<tr>
    <td><strong>${safeDecode(a.name)}</strong></td>
    <td>${a.category}</td><td>${Array.isArray(a.treatmentCategory) ? a.treatmentCategory.join(', ') : (a.treatmentCategory ?? '')}</td>
    <td class="num">${a.currentStock ?? 0}</td>
    <td>${a.unit}</td>
    <td class="num">${a.minStock}</td>
    <td class="${a.stockStatus ?? ''}">${statusLabel[a.stockStatus ?? ''] ?? ''}</td>
    <td>${a.nextExpiryDate ?? ''}</td>
    <td class="num">${up != null ? fmtCHF(up) : '—'}</td>
    <td class="num">${tp != null ? fmtCHF(tp) : '—'}</td>
    <td>${a.supplier ?? ''}</td>
  </tr>`}).join('')}
  </tbody>
  ${hasPrice ? `<tfoot><tr>
    <td colspan="9" style="text-align:right">Gesamtwert (exkl. MWST)</td>
    <td class="num">CHF ${fmtCHF(grandTotal)}</td>
    <td></td>
  </tr></tfoot>` : ''}
</table>
</body></html>`
    const w = window.open('', '_blank', 'width=1200,height=750')
    if (!w) { alert('Popup blockiert – bitte Popups erlauben.'); return }
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => { w.print() }, 400)
  }

  return (
    <div>
      <PageHeader
        title="Lagermanagement"
        subtitle={`${articles.length} Artikel`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCSV(filtered)}
              className="btn-secondary text-sm"
              title="Als CSV exportieren"
            >
              <Download className="w-4 h-4" /> CSV
            </button>
            <button
              onClick={() => exportPDF(filtered)}
              className="btn-secondary text-sm"
              title="Als PDF exportieren"
            >
              <FileText className="w-4 h-4" /> PDF
            </button>
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4" /> Neuer Artikel
            </button>
          </div>
        }
      />

      {slBanner && (
        <div className="mx-6 mt-4 flex items-center gap-3 px-4 py-3 rounded-lg border bg-amber-50 border-amber-200">
          <RefreshCw className="w-4 h-4 text-amber-600 shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium text-amber-800">BAG Spezialitätenliste veraltet</span>
            <span className="text-amber-700"> · Stand {slBanner.date} · wird automatisch aktualisiert</span>
          </div>
          <button onClick={() => { localStorage.setItem(`sl-banner-dismissed-${slBanner.date}`, '1'); setSlBanner(null) }}
            className="text-amber-500 hover:text-amber-700 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}
      {zurRoseBanner && (
        <div className={`mx-6 mt-2 flex items-center gap-3 px-4 py-3 rounded-lg border ${zurRoseBanner.stale ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
          <RefreshCw className={`w-4 h-4 shrink-0 ${zurRoseBanner.stale ? 'text-amber-600' : 'text-gray-400'}`} />
          <div className="flex-1 text-sm">
            {zurRoseBanner.stale
              ? <><span className="font-medium text-amber-800">Zur Rose Nota-Liste veraltet</span><span className="text-amber-700"> · Stand {zurRoseBanner.stand} · wird automatisch aktualisiert</span></>
              : <><span className="font-medium text-gray-700">Zur Rose Nota-Liste</span><span className="text-gray-500"> · Stand {zurRoseBanner.stand}</span></>
            }
          </div>
          <button onClick={() => { localStorage.setItem(`zurrose-banner-dismissed-${zurRoseBanner.stand}`, '1'); setZurRoseBanner(null) }}
            className="text-gray-400 hover:text-gray-600 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}

      {alerts.length > 0 && (
        <div className={`mx-6 mt-6 px-4 py-3 rounded-lg border flex items-start gap-3 ${
          alerts.some(a => a.severity === 'critical') ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'
        }`}>
          <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-medium">{alerts.length} Warnung{alerts.length !== 1 ? 'en' : ''}:</span>{' '}
            {alerts.slice(0, 3).map(a => a.articleName).join(', ')}
            {alerts.length > 3 && ` und ${alerts.length - 3} weitere`}
          </div>
        </div>
      )}

      {/* ── Kategorie-Tabs + Suche ── */}
      <div className="px-3 sm:px-6 pt-4 pb-2 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              className="input pl-8 pr-8 py-1.5 text-sm"
              placeholder="Suchen…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs text-gray-400 shrink-0">{filtered.length} Artikel</span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(['Alle', ...categories.map(c => c.name)]).map(cat => {
            const count = categoryCounts[cat] ?? 0
            if (cat !== 'Alle' && count === 0) return null
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === cat
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat}
                <span className={`text-[10px] ${activeCategory === cat ? 'text-primary-200' : 'text-gray-400'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-3 sm:p-6 pt-2">
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Artikel</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Kategorie</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Bestand</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Min.</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Nächstes MHD</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Laden…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{search || activeCategory !== 'Alle' ? 'Keine Artikel gefunden.' : 'Noch keine Artikel erfasst.'}</td></tr>
              ) : (
                filtered.map((a) => {
                  const isManualND = !!a.notDeliverable
                  const isBwlND = !isManualND && zurRoseArticleIds.has(a.id as string)
                  const isAnyND = isManualND || isBwlND
                  return (
                  <tr
                    key={a.id as any}
                    className={`cursor-pointer transition-colors group ${isAnyND ? 'bg-blue-50/60 hover:bg-blue-100/60' : 'hover:bg-primary-50'}`}
                    onClick={() => navigate(`/lager/${a.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {(a as any).imageUrl
                          ? <img src={(a as any).imageUrl} className="w-8 h-8 rounded object-cover flex-shrink-0" alt="" />
                          : <div className={`w-8 h-8 rounded flex-shrink-0 ${isAnyND ? 'bg-blue-100' : 'bg-gray-100'}`} />
                        }
                        <div>
                          <span className="font-medium text-gray-900 group-hover:text-primary-700 transition-colors">{safeDecode(a.name)}</span>
                          {isManualND && (
                            <div className="mt-0.5">
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-200 text-blue-800"
                                title={a.notDeliverableNote || 'Zurzeit nicht lieferbar'}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />
                                Nicht lieferbar{a.notDeliverableNote ? ` · ${a.notDeliverableNote}` : ''}
                              </span>
                            </div>
                          )}
                          {isBwlND && (
                            <div className="mt-0.5">
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-800">
                                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
                                Nota-Liste (Zur Rose)
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{a.category}</td>
                    <td className="px-4 py-3">{stockBar(a)}</td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{a.minStock} {a.unit}</td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{formatDate(a.nextExpiryDate)}</td>
                    <td className="px-4 py-3">{a.stockStatus && <StatusBadge status={a.stockStatus} />}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setBookingArticleId(a.id as string) }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <BookOpen className="w-3.5 h-3.5" /> Buchen
                      </button>
                    </td>
                  </tr>
                )})
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {showForm && (
        <ArticleForm
          onClose={() => setShowForm(false)}
          onSubmit={(data) => createMut.mutate(data as Omit<InventoryArticle, 'id'>)}
          isLoading={createMut.isPending}
        />
      )}

      {bookingArticleId && bookingArticle && (
        <BookingForm
          articleName={safeDecode(bookingArticle.name)}
          unit={bookingArticle.unit}
          lots={bookingLots}
          onClose={() => setBookingArticleId(null)}
          onEingang={(d) => addLotMut.mutate(d)}
          onAusgang={(d) => addMovMut.mutate(d)}
          isLoading={addLotMut.isPending || addMovMut.isPending}
        />
      )}
    </div>
  )
}
