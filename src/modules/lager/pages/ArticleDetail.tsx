import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Pencil, Trash2, X, Save, RotateCcw, RotateCw, Loader2, AlertTriangle } from 'lucide-react'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../../lib/firebase'
import { getArticle, addLot, addMovement, updateMovement, updateArticle, updateLot, deleteArticle, deleteLot } from '../../../lib/firestoreLager'
import { getPatientNames } from '../../../lib/firestorePatients'
import PageHeader from '../../../components/ui/PageHeader'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import { formatDate, daysUntil, formatSwissDate } from '../../../utils/dateUtils'
import { useToast } from '../../../lib/ToastContext'
import { vatRate } from '../../../types/inventory.types'
import BookingForm from '../components/BookingForm'
import ArticleForm from '../components/ArticleForm'
import LotEditForm from '../components/LotEditForm'

const safeDecode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

function MovementEditModal({ movement, unit, isLoading, onClose, onSave }: {
  movement: any
  unit: string
  isLoading: boolean
  onClose: () => void
  onSave: (data: any) => void
}) {
  const { data: patientNames = [] } = useQuery({ queryKey: ['patient-names'], queryFn: getPatientNames })
  const [form, setForm] = useState({
    movementDate: movement.movementDate ?? '',
    movementType: movement.movementType ?? 'Abgang',
    quantityDelta: movement.quantityDelta ?? 0,
    reason: movement.reason ?? '',
    patientName: movement.patientName ?? '',
    notes: movement.notes ?? '',
  })

  const handleSave = () => {
    onSave({
      movementDate: form.movementDate,
      movementType: form.movementType,
      quantityDelta: Number(form.quantityDelta),
      reason: form.reason,
      patientName: form.patientName || null,
      notes: form.notes || null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Buchung korrigieren</h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">
              {movement.lotNumber && `Charge: ${movement.lotNumber}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Datum</label>
              <input type="date" className="input" value={form.movementDate}
                onChange={e => setForm(f => ({ ...f, movementDate: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Typ</label>
              <select className="input" value={form.movementType}
                onChange={e => setForm(f => ({ ...f, movementType: e.target.value }))}>
                <option>Eingang</option>
                <option>Abgang</option>
                <option>Korrektur</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Menge ({unit})</label>
              <input type="number" className="input" value={form.quantityDelta}
                onChange={e => setForm(f => ({ ...f, quantityDelta: Number(e.target.value) }))} />
              <p className="text-xs text-gray-400 mt-1">Negativ = Abgang, Positiv = Eingang</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Grund</label>
              <input className="input" value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Patient</label>
            <input className="input" placeholder="Vor- und Nachname (optional)" value={form.patientName}
              list="mov-patient-names-list"
              onChange={e => setForm(f => ({ ...f, patientName: e.target.value }))} />
            <datalist id="mov-patient-names-list">
              {patientNames.map(n => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notiz</label>
            <input className="input" placeholder="Optional" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-gray-200">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
            Abbrechen
          </button>
          <button onClick={handleSave} disabled={isLoading}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
            <Save className="w-4 h-4" />
            {isLoading ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Lightbox({ url, articleId, onClose, onSaved }: {
  url: string
  articleId: string
  onClose: () => void
  onSaved: (newUrl: string) => void
}) {
  const [rotation, setRotation] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleSave() {
    setSaving(true)
    try {
      const resp = await fetch(url)
      const srcBlob = await resp.blob()
      const bitmap = await createImageBitmap(srcBlob)
      const rad = (rotation * Math.PI) / 180
      const swapped = rotation === 90 || rotation === 270
      const canvas = document.createElement('canvas')
      canvas.width  = swapped ? bitmap.height : bitmap.width
      canvas.height = swapped ? bitmap.width  : bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(rad)
      ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
      const rotatedBlob = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), 'image/jpeg', 0.92))
      const storageRef = ref(storage, `articles/${articleId}/${Date.now()}.jpg`)
      await uploadBytes(storageRef, rotatedBlob)
      const newUrl = await getDownloadURL(storageRef)
      await updateArticle(articleId, { imageUrl: newUrl } as any)
      onSaved(newUrl)
      onClose()
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      {/* Controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        {rotation !== 0 && (
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Speichern
          </button>
        )}
        <button onClick={() => setRotation(r => (r - 90 + 360) % 360)}
          className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors" title="Links drehen">
          <RotateCcw className="w-5 h-5" />
        </button>
        <button onClick={() => setRotation(r => (r + 90) % 360)}
          className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors" title="Rechts drehen">
          <RotateCw className="w-5 h-5" />
        </button>
        <button onClick={onClose} className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>
      <img
        src={url}
        alt=""
        onClick={e => e.stopPropagation()}
        className="max-w-full max-h-full object-contain rounded-xl shadow-2xl transition-transform duration-300"
        style={{ transform: `rotate(${rotation}deg)` }}
      />
    </div>
  )
}

export default function ArticleDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [showBooking, setShowBooking] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [confirmDeleteArticle, setConfirmDeleteArticle] = useState(false)
  const [deleteLotTarget, setDeleteLotTarget] = useState<any | null>(null)
  const [editLotTarget, setEditLotTarget] = useState<any | null>(null)
  const [editMovTarget, setEditMovTarget] = useState<any | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-article', id],
    queryFn: () => getArticle(id!),
  })

const addLotMut = useMutation({
    mutationFn: (d: any) => addLot({ ...d, articleId: id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-article', id] }); qc.invalidateQueries({ queryKey: ['inventory-articles'] }); setShowBooking(false) },
  })

  const addMovMut = useMutation({
    mutationFn: (d: any) => addMovement({ ...d, articleId: id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-article', id] }); qc.invalidateQueries({ queryKey: ['inventory-articles'] }); setShowBooking(false) },
  })

  const updateMut = useMutation({
    mutationFn: (d: any) => updateArticle(id!, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-article', id] })
      qc.invalidateQueries({ queryKey: ['inventory-articles'] })
      setShowEdit(false)
      toast.success('Artikel gespeichert')
    },
    onError: (e: any) => {
      toast.error(`Fehler beim Speichern: ${e?.message || String(e)}`)
    },
  })

  const deleteArticleMut = useMutation({
    mutationFn: () => deleteArticle(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-articles'] })
      navigate('/lager')
    },
  })

  const deleteLotMut = useMutation({
    mutationFn: (lotId: string) => deleteLot(lotId, id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-article', id] })
      qc.invalidateQueries({ queryKey: ['inventory-articles'] })
      setDeleteLotTarget(null)
    },
  })

  const updateLotMut = useMutation({
    mutationFn: (data: any) => updateLot(editLotTarget!.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-article', id] })
      qc.invalidateQueries({ queryKey: ['inventory-articles'] })
      setEditLotTarget(null)
    },
  })

  const updateMovMut = useMutation({
    mutationFn: (data: any) => updateMovement(editMovTarget!.id, editMovTarget!.quantityDelta, { ...data, lotId: editMovTarget!.lotId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-article', id] })
      qc.invalidateQueries({ queryKey: ['inventory-articles'] })
      setEditMovTarget(null)
    },
  })

  if (isLoading) return <div className="p-6 text-gray-400">Laden…</div>
  if (!data) return <div className="p-6 text-gray-400">Artikel nicht gefunden.</div>

  const { lots = [], movements = [], ...article } = data
  const activeLots = lots.filter((l: any) => !l.isDepleted)
  const isZurRoseND = !!article.zurRoseNota && !article.notDeliverable
  const zurRoseDetail = article.zurRoseNotaDetail ?? ''

  const expiryColor = (days: number | null) => {
    if (days === null) return 'text-gray-400'
    if (days < 0) return 'text-red-600 font-semibold'
    if (days <= 30) return 'text-red-500 font-semibold'
    if (days <= 90) return 'text-yellow-600'
    return 'text-green-600'
  }

  return (
    <div>
      <PageHeader
        title={safeDecode(article.name)}
        subtitle={`${article.category} · ${article.currentStock ?? 0} ${article.unit} auf Lager`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowEdit(true)} title="Bearbeiten">
              <Pencil className="w-4 h-4" /> <span className="hidden sm:inline">Bearbeiten</span>
            </button>
            <button
              className="px-2.5 sm:px-4 py-2 rounded-xl text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 transition-colors flex items-center gap-2"
              onClick={() => setConfirmDeleteArticle(true)}
              title="Artikel löschen"
            >
              <Trash2 className="w-4 h-4" /> <span className="hidden sm:inline">Artikel löschen</span>
            </button>
            <button className="btn-primary" onClick={() => setShowBooking(true)} title="Ein- / Ausbuchen">
              <BookOpen className="w-4 h-4" /> <span className="hidden sm:inline">Ein- / Ausbuchen</span>
            </button>
          </>
        }
      />

      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        {/* Artikelbild */}
        {(article as any).imageUrl && (
          <>
            <img
              src={(article as any).imageUrl}
              alt={safeDecode(article.name)}
              onClick={() => setLightboxUrl((article as any).imageUrl)}
              className="w-full max-h-48 object-contain rounded-xl mb-4 cursor-zoom-in"
            />
            {lightboxUrl && (
              <Lightbox
                url={lightboxUrl}
                articleId={id!}
                onClose={() => setLightboxUrl(null)}
                onSaved={(newUrl) => {
                  setLightboxUrl(null)
                  qc.invalidateQueries({ queryKey: ['inventory-article', id] })
                  qc.invalidateQueries({ queryKey: ['inventory-articles'] })
                }}
              />
            )}
          </>
        )}

        {/* Lieferstatus-Banner */}
        {article.notDeliverable && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border bg-blue-50 border-blue-200">
            <AlertTriangle className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-blue-800">
                Ausstand{article.notDeliverableUntil
                  ? ` bis ${new Date(article.notDeliverableUntil).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
                  : ' · unbestimmt'}
              </p>
              {article.notDeliverableNote && (
                <p className="text-sm text-blue-700 mt-0.5">{article.notDeliverableNote}</p>
              )}
              {article.notDeliverableUpdatedAt && (
                <p className="text-xs text-blue-500 mt-1">
                  Aktualisiert: {new Date(article.notDeliverableUpdatedAt).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>
        )}
        {isZurRoseND && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border bg-orange-50 border-orange-200">
            <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-orange-800">{zurRoseDetail || 'Ausstand'}</p>
              {article.zurRoseNotaUpdatedAt && (
                <p className="text-xs text-orange-500 mt-1">
                  Aktualisiert: {new Date(article.zurRoseNotaUpdatedAt).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Info-Karten */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Bestand', value: `${article.currentStock ?? 0} ${article.unit}` },
            { label: 'Mindestbestand', value: `${article.minStock} ${article.unit}` },
            { label: 'Lieferant', value: article.supplier || '—' },
            { label: 'Kategorie', value: article.category || '—' },
            { label: 'GTIN', value: (article as any).gtin || '—' },
            { label: 'REF-Nr.', value: (article as any).refNr || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="card p-4">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-sm font-medium mt-1">{value}</p>
            </div>
          ))}
          {(article as any).price > 0 && (() => {
            const p = Number((article as any).price)
            const vat = vatRate(article.category)
            const brutto = p * (1 + vat / 100)
            const mitLager = brutto * 1.30
            const qty = article.quantityPerUnit
            const mitLagerPerStk = qty && qty > 0 ? mitLager / qty : null
            const bruttoPerStk = qty && qty > 0 ? brutto / qty : null
            const nettoPerStk = qty && qty > 0 ? p / qty : null
            return (
              <div className="card p-4 col-span-2 md:col-span-2">
                <p className="text-xs text-gray-500 mb-2">Preis inkl. MWST {vat}% + 30% Lagerkosten</p>
                <div className="flex gap-4 flex-wrap">
                  <div>
                    <p className="text-[11px] text-gray-400">pro {article.unit || 'Packung'}</p>
                    <p className="text-base font-semibold text-amber-800">CHF {mitLager.toFixed(2)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Netto {p.toFixed(2)} · Brutto {brutto.toFixed(2)}</p>
                  </div>
                  {mitLagerPerStk !== null && (
                    <>
                      <div className="w-px bg-gray-200 self-stretch" />
                      <div>
                        <p className="text-[11px] text-gray-400">pro {article.quantityUnit || 'Stück'}</p>
                        <p className="text-base font-semibold text-amber-800">CHF {mitLagerPerStk.toFixed(2)}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">Netto {nettoPerStk!.toFixed(2)} · Brutto {bruttoPerStk!.toFixed(2)}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })()}
          {(() => {
            const raw = (article as any).treatmentCategory
            const cats: string[] = Array.isArray(raw) ? raw : raw ? [raw] : []
            if (!cats.length) return null
            return (
              <div className="card p-4">
                <p className="text-xs text-gray-500">Behandlungsart</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {cats.map(c => (
                    <span key={c} className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Aktive Lots */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Aktive Chargen / Lots ({activeLots.length})</h2>
            <span className="text-sm text-gray-500">Gesamt: <span className="font-semibold text-gray-800">{article.currentStock ?? 0} {article.unit}</span></span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Charge / Lot-Nr.</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Menge</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ablaufdatum (MHD)</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Verfall in</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Lieferdatum</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activeLots.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Keine aktiven Chargen vorhanden. Bitte einbuchen.</td></tr>
              ) : (
                activeLots.map((lot: any) => {
                  const days = daysUntil(lot.expiryDate)
                  return (
                    <tr key={lot.id} className={`hover:bg-gray-50 group ${days !== null && days <= 30 ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-800">{lot.lotNumber}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{lot.quantity} <span className="text-gray-400 font-normal text-xs">{article.unit}</span></td>
                      <td className="px-4 py-3">
                        {lot.expiryDate
                          ? <span className={days !== null && days <= 90 ? (days <= 30 ? 'text-red-600 font-semibold' : 'text-yellow-700') : 'text-gray-700'}>
                              {formatSwissDate(lot.expiryDate)}
                            </span>
                          : <span className="text-gray-400">—</span>
                        }
                      </td>
                      <td className={`px-4 py-3 text-sm ${expiryColor(days)}`}>
                        {days === null ? '—' : days < 0 ? '⚠ Abgelaufen' : `${days} Tage`}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{formatDate(lot.deliveryDate)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditLotTarget(lot)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                            title="Charge bearbeiten"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteLotTarget(lot)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Charge löschen"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* Buchungshistorie — nach Charge gruppiert */}
        <div className="flex items-center gap-2 px-1">
          <h2 className="font-semibold text-gray-800">Buchungshistorie</h2>
          <span className="text-xs text-gray-400">nach Charge gruppiert</span>
        </div>
        {(() => {
          // Gruppe pro Charge aufbauen
          const byLot = new Map<string, { lotNumber: string; lot: any; items: any[] }>()
          movements.forEach((m: any) => {
            const lotId = m.lotId || '__unknown__'
            const lotData = lots.find((l: any) => l.id === lotId)
            const lotNumber = m.lotNumber || lotData?.lotNumber || '—'
            if (!byLot.has(lotId)) byLot.set(lotId, { lotNumber, lot: lotData ?? null, items: [] })
            byLot.get(lotId)!.items.push(m)
          })
          const groups = Array.from(byLot.values()).sort((a, b) =>
            a.lotNumber.localeCompare(b.lotNumber)
          )

          if (groups.length === 0) return (
            <div className="card px-5 py-8 text-center text-gray-400 text-sm">Keine Buchungen vorhanden.</div>
          )

          return (
            <div className="space-y-3">
              {groups.map(({ lotNumber, lot, items }) => (
                <div key={lotNumber} className="card overflow-hidden">
                  {/* Chargen-Header */}
                  <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3 bg-gray-50/70">
                    <span className="font-mono text-sm font-bold text-gray-800">{lotNumber}</span>
                    {lot?.expiryDate && (
                      <span className="text-xs text-gray-500">
                        MHD: <span className={`font-medium ${daysUntil(lot.expiryDate) !== null && daysUntil(lot.expiryDate)! <= 30 ? 'text-red-600' : 'text-gray-700'}`}>
                          {formatSwissDate(lot.expiryDate)}
                        </span>
                      </span>
                    )}
                    {lot?.isDepleted && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">aufgebraucht</span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">{items.length} Buchung{items.length !== 1 ? 'en' : ''}</span>
                  </div>
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white border-b border-gray-100">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs whitespace-nowrap">Datum</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Typ</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Menge</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Grund</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Patient</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs hidden lg:table-cell">Notiz</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map((m: any) => (
                        <tr key={m.id} className="hover:bg-gray-50 group">
                          <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(m.movementDate)}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                              m.movementType === 'Eingang'   ? 'bg-green-100 text-green-700' :
                              m.movementType === 'Abgang'    ? 'bg-red-100 text-red-700' :
                              m.movementType === 'Korrektur' ? 'bg-orange-100 text-orange-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>{m.movementType}</span>
                          </td>
                          <td className={`px-4 py-2.5 font-semibold whitespace-nowrap ${m.quantityDelta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {m.quantityDelta > 0 ? '+' : ''}{m.quantityDelta} {article.unit}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{m.reason}</td>
                          <td className="px-4 py-2.5 text-gray-700 font-medium">{m.patientName || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs hidden lg:table-cell max-w-[160px] truncate">{m.notes || ''}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => setEditMovTarget(m)}
                              className="p-1.5 rounded-lg text-gray-300 hover:text-primary-600 hover:bg-primary-50 opacity-0 group-hover:opacity-100 transition-all"
                              title="Buchung korrigieren"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      {showBooking && (
        <BookingForm
          articleName={safeDecode(article.name)}
          unit={article.unit}
          quantityPerUnit={article.quantityPerUnit}
          quantityUnit={article.quantityUnit}
          lots={activeLots}
          onClose={() => setShowBooking(false)}
          onEingang={(d) => addLotMut.mutate(d)}
          onAusgang={(d) => addMovMut.mutate(d)}
          isLoading={addLotMut.isPending || addMovMut.isPending}
        />
      )}

      {showEdit && (
        <ArticleForm
          initial={article as any}
          onClose={() => setShowEdit(false)}
          onSubmit={(d) => updateMut.mutate(d)}
          isLoading={updateMut.isPending}
        />
      )}

      {editLotTarget && (
        <LotEditForm
          lot={editLotTarget}
          unit={article.unit}
          onClose={() => setEditLotTarget(null)}
          onSubmit={(d) => updateLotMut.mutate(d)}
          isLoading={updateLotMut.isPending}
        />
      )}

      {confirmDeleteArticle && (
        <ConfirmDialog
          title="Artikel löschen?"
          message={`«${safeDecode(article.name)}» wird deaktiviert und aus der Übersicht entfernt. Die Buchungshistorie bleibt erhalten.`}
          confirmLabel="Artikel entfernen"
          isLoading={deleteArticleMut.isPending}
          onConfirm={() => deleteArticleMut.mutate()}
          onCancel={() => setConfirmDeleteArticle(false)}
        />
      )}

      {deleteLotTarget && (
        <ConfirmDialog
          title="Charge löschen?"
          message={`Charge «${deleteLotTarget.lotNumber}» mit ${deleteLotTarget.quantity} ${article.unit} und alle dazugehörigen Buchungen werden unwiderruflich gelöscht.`}
          confirmLabel="Charge löschen"
          isLoading={deleteLotMut.isPending}
          onConfirm={() => deleteLotMut.mutate(deleteLotTarget.id)}
          onCancel={() => setDeleteLotTarget(null)}
        />
      )}

      {/* Buchung bearbeiten */}
      {editMovTarget && (
        <MovementEditModal
          movement={editMovTarget}
          unit={article.quantityUnit || article.unit}
          isLoading={updateMovMut.isPending}
          onClose={() => setEditMovTarget(null)}
          onSave={(d) => updateMovMut.mutate(d)}
        />
      )}
    </div>
  )
}
