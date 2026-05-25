import { useState, useMemo, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Plus, ScanLine, ImageIcon, GripHorizontal, ExternalLink } from 'lucide-react'
import { useDraggable } from '../../../hooks/useDraggable'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { vatRate } from '../../../types/inventory.types'
import { getUnits, addUnit, deleteUnit, getSuppliers, createSupplier, getQuantityUnits, addQuantityUnit, deleteQuantityUnit, getCategories, addCategory, deleteCategory, findArticleByGtin } from '../../../lib/firestoreLager'
import { getTreatmentTypes, addTreatmentType } from '../../../lib/firestorePatients'
import BarcodeScanner from '../../../components/ui/BarcodeScanner'
import ImagePicker from '../../../components/ui/ImagePicker'
import type { InventoryArticle } from '../../../types/inventory.types'

type FormData = Omit<InventoryArticle, 'id' | 'maxStock' | 'articleNumber'>

interface Props {
  onClose: () => void
  onSubmit: (data: FormData & { imageUrl?: string }) => void
  isLoading?: boolean
  initial?: Partial<InventoryArticle>
}

export default function ArticleForm({ onClose, onSubmit, isLoading, initial }: Props) {
  const [neueEinheit, setNeueEinheit] = useState(false)
  const [neueEinheitName, setNeueEinheitName] = useState('')
  const [neueMengeneinheit, setNeueMengeneinheit] = useState(false)
  const [neueMengeneinheitName, setNeueMengeneinheitName] = useState('')
  const [neueKategorie, setNeueKategorie] = useState(false)
  const [neueKategorieName, setNeueKategorieName] = useState('')
  const [neueBehandlungsart, setNeueBehandlungsart] = useState(false)
  const [neueBehandlungsartName, setNeueBehandlungsartName] = useState('')
  const [neuerLieferant, setNeuerLieferant] = useState(false)
  const [neuerLieferantName, setNeuerLieferantName] = useState('')
  const [showScanner, setShowScanner] = useState(false)
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [gtinSuggestion, setGtinSuggestion] = useState<string | null>(null)
  const [gtinLookupLoading, setGtinLookupLoading] = useState(false)
  const [gtinDuplicate, setGtinDuplicate] = useState<{ id: string; name: string } | null>(null)
  const [showCompendium, setShowCompendium] = useState(false)
  const [compTab, setCompTab] = useState<'sl' | 'comp'>('sl')
  const [compSearch, setCompSearch] = useState(initial?.gtin ?? '')

  // SL-Datenbank (BAG Spezialitätenliste)
  interface SlEntry { n: string; g?: string; h?: string; s?: string; e?: number; p?: number }
  interface SlMeta { extractedAt: string; sourceSize: number; entries: number }
  // Refdata Artikelstamm (alle CH-zugelassenen Arzneimittel)
  interface RdEntry { g: string; n: string; h?: string; a?: string; l?: string; p?: number }

  const [slData, setSlData] = useState<SlEntry[] | null>(null)
  const [slMeta, setSlMeta] = useState<SlMeta | null>(null)
  const [slLoading, setSlLoading] = useState(false)
  const [rdData, setRdData] = useState<RdEntry[] | null>(null)
  const [rdLoading, setRdLoading] = useState(false)
  const [slSearch, setSlSearch] = useState('')

  const slDaysOld = slMeta
    ? Math.floor((Date.now() - new Date(slMeta.extractedAt).getTime()) / 86400000)
    : null
  const slStale = slDaysOld !== null && slDaysOld > 35

  async function loadSlData() {
    if (slData !== null || slLoading) return
    setSlLoading(true)
    try {
      const res = await fetch('/sl-data.json')
      const json = await res.json()
      if (json.meta && json.data) {
        setSlMeta(json.meta)
        setSlData(json.data)
      } else {
        setSlData(json) // legacy flat array
      }
    } catch { setSlData([]) }
    setSlLoading(false)
    loadRdData()
  }

  async function loadRdData() {
    if (rdData !== null || rdLoading) return
    setRdLoading(true)
    try {
      const res = await fetch('/refdata-data.json')
      const json = await res.json()
      setRdData(json.data ?? json)
    } catch { setRdData([]) }
    setRdLoading(false)
  }

  type CombinedEntry = (SlEntry & { src: 'sl' }) | (RdEntry & { src: 'rd' })

  const combinedResults = useMemo((): CombinedEntry[] => {
    if (!slSearch.trim()) return []
    const q = slSearch.toLowerCase()

    const slHits: CombinedEntry[] = slData
      ? slData.filter(e =>
          e.n.toLowerCase().includes(q) ||
          e.g?.includes(q) ||
          e.s?.toLowerCase().includes(q) ||
          e.h?.toLowerCase().includes(q)
        ).slice(0, 30).map(e => ({ ...e, src: 'sl' as const }))
      : []

    const slGtins = new Set(slHits.map(e => e.g).filter(Boolean))

    const rdHits: CombinedEntry[] = rdData
      ? rdData.filter(e =>
          !slGtins.has(e.g) && (
            e.n.toLowerCase().includes(q) ||
            e.g.includes(q) ||
            e.h?.toLowerCase().includes(q) ||
            e.a?.toLowerCase().includes(q)
          )
        ).slice(0, 30).map(e => ({ ...e, src: 'rd' as const }))
      : []

    return [...slHits, ...rdHits].slice(0, 60)
  }, [slData, rdData, slSearch])

  function importSlEntry(e: SlEntry) {
    setValue('name', e.n)
    if (e.g) setValue('gtin', e.g)
    if (e.e) setValue('price', e.e)
    if (e.g) lookupGtin(e.g)
    setShowCompendium(false)
  }

  function importRdEntry(e: RdEntry) {
    setValue('name', e.n)
    if (e.g) setValue('gtin', e.g)
    if (e.g) lookupGtin(e.g)
    setShowCompendium(false)
  }

  async function lookupGtin(gtin: string) {
    setGtinSuggestion(null)
    setGtinLookupLoading(true)
    try {
      const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${gtin}`)
      if (res.ok) {
        const data = await res.json()
        const title = data.items?.[0]?.title as string | undefined
        if (title) { setGtinSuggestion(title); setGtinLookupLoading(false); return }
      }
    } catch (_) {}
    // Fallback: Open Food Facts
    try {
      const res2 = await fetch(`https://world.openfoodfacts.org/api/v2/product/${gtin}?fields=product_name`)
      if (res2.ok) {
        const data2 = await res2.json()
        const name = data2.product?.product_name as string | undefined
        if (name) { setGtinSuggestion(name); setGtinLookupLoading(false); return }
      }
    } catch (_) {}
    setGtinSuggestion('')  // leer = nicht gefunden
    setGtinLookupLoading(false)
  }
  const [imageUrl, setImageUrl] = useState<string>(initial?.imageUrl ?? '')
  const qc = useQueryClient()
  const { style: dragStyle, onHeaderMouseDown } = useDraggable()
  useEscapeKey(onClose)

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: getUnits })
  const { data: quantityUnits = [] } = useQuery({ queryKey: ['quantity_units'], queryFn: getQuantityUnits })
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: getSuppliers })
  const { data: treatmentTypes = [] } = useQuery({ queryKey: ['treatment_types'], queryFn: getTreatmentTypes })

  const addUnitMut = useMutation({
    mutationFn: (name: string) => addUnit(name),
    onSuccess: (name) => {
      qc.invalidateQueries({ queryKey: ['units'] })
      setValue('unit', name)
      setNeueEinheit(false)
      setNeueEinheitName('')
    },
  })

  const addQtyUnitMut = useMutation({
    mutationFn: (name: string) => addQuantityUnit(name),
    onSuccess: (name) => {
      qc.invalidateQueries({ queryKey: ['quantity_units'] })
      setValue('quantityUnit', name)
      setNeueMengeneinheit(false)
      setNeueMengeneinheitName('')
    },
  })

  const deleteUnitMut = useMutation({
    mutationFn: (id: string) => deleteUnit(id),
    onSuccess: (_, id) => {
      const deleted = units.find(u => u.id === id)
      if (deleted && selectedUnit === deleted.name) setValue('unit', '')
      qc.invalidateQueries({ queryKey: ['units'] })
    },
  })

  const deleteQtyUnitMut = useMutation({
    mutationFn: (id: string) => deleteQuantityUnit(id),
    onSuccess: (_, id) => {
      const deleted = quantityUnits.find(u => u.id === id)
      if (deleted && selectedQuantityUnit === deleted.name) setValue('quantityUnit', '')
      qc.invalidateQueries({ queryKey: ['quantity_units'] })
    },
  })

  const addCategoryMut = useMutation({
    mutationFn: (name: string) => addCategory(name),
    onSuccess: (name) => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      setValue('category', name)
      setNeueKategorie(false)
      setNeueKategorieName('')
    },
  })

  const deleteCategoryMut = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: (_, id) => {
      const deleted = categories.find(c => c.id === id)
      if (deleted && selectedCategory === deleted.name) setValue('category', '')
      qc.invalidateQueries({ queryKey: ['categories'] })
    },
  })

  const addTypeMut = useMutation({
    mutationFn: (name: string) => addTreatmentType(name),
    onSuccess: (name) => {
      qc.invalidateQueries({ queryKey: ['treatment_types'] })
      const cur = getValues('treatmentCategory') as string[] || []
      setValue('treatmentCategory', [...cur, name])
      setNeueBehandlungsart(false)
      setNeueBehandlungsartName('')
    },
  })

  const addSupplierMut = useMutation({
    mutationFn: (name: string) => createSupplier({ name }),
    onSuccess: (supplier) => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setValue('supplier', supplier.name)
      setNeuerLieferant(false)
      setNeuerLieferantName('')
    },
  })

  const { register, handleSubmit, watch, setValue, getValues, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      name: initial?.name ?? '',
      category: initial?.category ?? 'Medikament',
      treatmentCategory: initial?.treatmentCategory
        ? (Array.isArray(initial.treatmentCategory) ? initial.treatmentCategory : [initial.treatmentCategory])
        : [],
      unit: initial?.unit ?? '',
      minStock: initial?.minStock ?? 1,
      supplier: initial?.supplier ?? '',
      notes: initial?.notes ?? '',
      isActive: initial?.isActive ?? true,
      notDeliverable: initial?.notDeliverable ?? false,
      notDeliverableNote: initial?.notDeliverableNote ?? '',
      gtin: initial?.gtin ?? '',
      refNr: initial?.refNr ?? '',
      price: initial?.price ?? undefined,
      quantityPerUnit: initial?.quantityPerUnit ?? undefined,
      quantityUnit: initial?.quantityUnit ?? '',
    },
  })

  const selectedUnit = watch('unit')
  const selectedCategory = watch('category')
  const treatmentCategory = watch('treatmentCategory')
  const price = watch('price')
  const selectedSupplier = watch('supplier')
  const selectedQuantityUnit = watch('quantityUnit')

  // GTIN-Duplikat-Prüfung (debounced)
  const watchedGtin = watch('gtin')
  useEffect(() => {
    setGtinDuplicate(null)
    const gtin = (watchedGtin ?? '').trim()
    if (!gtin) return
    const timer = setTimeout(async () => {
      const found = await findArticleByGtin(gtin, initial?.id)
      setGtinDuplicate(found)
    }, 500)
    return () => clearTimeout(timer)
  }, [watchedGtin, initial?.id])

  const handleSubmitWithImage = (data: FormData) => {
    const clean: any = { ...data }
    // Name: URL-kodierte Zeichen bereinigen (%25 → %)
    if (clean.name) {
      try { clean.name = decodeURIComponent(clean.name) } catch {}
    }
    // Bild
    if (!imageUrl) clean.imageUrl = initial?.imageUrl ? null : undefined
    else clean.imageUrl = imageUrl
    // Zahlenfelder: NaN/0/leer → null (Firestore deleteField beim Update, ignoriert beim Create)
    if (isNaN(clean.minStock) || clean.minStock < 0) clean.minStock = initial?.minStock ?? 0
    if (isNaN(clean.price) || clean.price === 0) clean.price = initial?.price ? null : undefined
    if (isNaN(clean.quantityPerUnit) || clean.quantityPerUnit <= 0) clean.quantityPerUnit = initial?.quantityPerUnit ? null : undefined
    // Behandlungsart: leeres Array → null/undefined
    const hadCat = Array.isArray(initial?.treatmentCategory) ? initial.treatmentCategory.length > 0 : !!initial?.treatmentCategory
    if (!clean.treatmentCategory?.length) clean.treatmentCategory = hadCat ? null : undefined
    // Textfelder: leer → null beim Bearbeiten, undefined beim Erstellen
    if (!clean.quantityUnit) clean.quantityUnit = initial?.quantityUnit ? null : undefined
    if (!clean.supplier) clean.supplier = initial?.supplier ? null : undefined
    if (!clean.gtin) clean.gtin = initial?.gtin ? null : undefined
    if (!clean.refNr) clean.refNr = initial?.refNr ? null : undefined
    if (!clean.notes) clean.notes = initial?.notes ? null : undefined
    // undefined-Werte entfernen (nicht speichern)
    for (const k of Object.keys(clean)) { if (clean[k] === undefined) delete clean[k] }
    onSubmit(clean)
  }

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-xl shadow-xl w-full flex max-h-[90vh] transition-[max-width] duration-200 ${showCompendium ? 'max-w-3xl' : 'max-w-lg'}`} style={dragStyle}>
        {/* LEFT: Formular */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0 cursor-grab select-none" onMouseDown={onHeaderMouseDown}>
          <div className="flex items-center gap-2">
            <GripHorizontal className="w-4 h-4 text-gray-300" />
            <h2 className="font-semibold text-gray-900">{initial ? 'Artikel bearbeiten' : 'Neuer Artikel'}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <form onSubmit={handleSubmit(handleSubmitWithImage)} className="flex flex-col flex-1 min-h-0">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">

            {/* Bild */}
            <div>
              {imageUrl ? (
                <div className="relative">
                  <img src={imageUrl} alt="Artikelbild" className="w-full max-h-32 object-contain rounded-xl border border-gray-200 mb-1" />
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary flex-1 text-sm" onClick={() => setShowImagePicker(true)}>
                      <ImageIcon className="w-3.5 h-3.5" /> Bild ändern
                    </button>
                    <button type="button" className="btn-secondary text-sm px-3 text-red-500 hover:text-red-700" onClick={() => setImageUrl('')}>
                      Entfernen
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowImagePicker(true)}
                  className="w-full border-2 border-dashed border-gray-300 rounded-xl py-4 flex items-center justify-center gap-2 text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors"
                >
                  <ImageIcon className="w-4 h-4" /> Bild hinzufügen
                </button>
              )}
            </div>

            {/* Name */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">Artikelname *</label>
                <button
                  type="button"
                  onClick={() => {
                    const gtin = watch('gtin') || ''
                    setShowCompendium(v => !v)
                    setCompSearch(gtin)
                    if (gtin) { setSlSearch(gtin); loadSlData() }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${showCompendium ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                >
                  <ExternalLink className="w-3 h-3" /> CH-Arzneimittel-DB
                </button>
              </div>
              <input className={`input ${errors.name ? 'border-red-400' : ''}`}
                {...register('name', { required: 'Name ist erforderlich' })} />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
            </div>

            {/* GTIN + REF-Nr */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">GTIN / Barcode</label>
                <div className="flex gap-2">
                  <input className={`input flex-1 ${gtinDuplicate ? 'border-red-400' : ''}`} placeholder="z.B. 7612345678901"
                    {...register('gtin')} />
                  <button type="button" onClick={() => setShowScanner(true)}
                    className="btn-secondary flex items-center gap-1.5 whitespace-nowrap px-3"
                    title="Barcode / QR-Code scannen">
                    <ScanLine className="w-4 h-4" />
                  </button>
                </div>
                {gtinDuplicate && (
                  <p className="text-xs text-red-600 mt-1">⚠ GTIN bereits vergeben: <b>{gtinDuplicate.name}</b></p>
                )}
              </div>
              <div>
                <label className="label">REF-Nr.</label>
                <input className="input" placeholder="z.B. 12345-A"
                  {...register('refNr')} />
              </div>
            </div>

            {/* GTIN Lookup Ergebnis */}
            {gtinLookupLoading && (
              <p className="text-xs text-gray-500 -mt-2 animate-pulse">🔍 Produktname wird gesucht…</p>
            )}
            {!gtinLookupLoading && gtinSuggestion !== null && (
              gtinSuggestion ? (
                <div className="flex items-center gap-2 -mt-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                  <span className="text-xs text-green-800 flex-1">✓ Gefunden: <b>{gtinSuggestion}</b></span>
                  <button type="button"
                    className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
                    onClick={() => { setValue('name', gtinSuggestion); setGtinSuggestion(null) }}>
                    Übernehmen
                  </button>
                  <button type="button" className="text-xs text-gray-400 hover:text-gray-600"
                    onClick={() => setGtinSuggestion(null)}>✕</button>
                </div>
              ) : (
                <p className="text-xs text-gray-400 -mt-2">Kein Produktname gefunden — bitte manuell eingeben.</p>
              )
            )}

            {/* Kategorie */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">Kategorie</label>
                <button type="button" onClick={() => setNeueKategorie(v => !v)}
                  className="text-xs text-primary-600 hover:underline flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Verwalten
                </button>
              </div>
              {neueKategorie ? (
                <div className="border border-gray-200 rounded-lg p-2 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map(c => (
                      <span key={c.id} className="flex items-center gap-1 bg-gray-100 rounded-md px-2 py-0.5 text-xs text-gray-700">
                        {c.name}
                        <button type="button" onClick={() => deleteCategoryMut.mutate(c.id)}
                          disabled={deleteCategoryMut.isPending}
                          className="text-gray-400 hover:text-red-500 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <input className="input text-sm flex-1" placeholder="Neue Kategorie…"
                      value={neueKategorieName} onChange={e => setNeueKategorieName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && neueKategorieName && addCategoryMut.mutate(neueKategorieName)} />
                    <button type="button" className="btn-primary whitespace-nowrap text-sm"
                      disabled={!neueKategorieName || addCategoryMut.isPending}
                      onClick={() => addCategoryMut.mutate(neueKategorieName)}>
                      {addCategoryMut.isPending ? '…' : 'OK'}
                    </button>
                    <button type="button" onClick={() => setNeueKategorie(false)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-1">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <select className="input" value={selectedCategory ?? ''}
                  onChange={e => setValue('category', e.target.value)}>
                  <option value="">— Kategorie wählen —</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              )}
              <input type="hidden" {...register('category', { required: 'Kategorie ist erforderlich' })} />
              {errors.category && <p className="text-xs text-red-500 mt-1">{errors.category.message}</p>}
            </div>

            {/* Behandlungsart (Unterkategorie) – nur bei Medikament / Augentropfen */}
            {(selectedCategory === 'Medikament' || selectedCategory === 'Augentropfen') && <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">Behandlungsart</label>
                <button type="button" onClick={() => setNeueBehandlungsart(!neueBehandlungsart)}
                  className="text-xs text-primary-600 hover:underline flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Neue Art
                </button>
              </div>
              {neueBehandlungsart ? (
                <div className="flex gap-2">
                  <input className="input" placeholder="z.B. Laserbehandlung"
                    value={neueBehandlungsartName} onChange={e => setNeueBehandlungsartName(e.target.value)} />
                  <button type="button" className="btn-primary whitespace-nowrap"
                    disabled={!neueBehandlungsartName || addTypeMut.isPending}
                    onClick={() => addTypeMut.mutate(neueBehandlungsartName)}>
                    {addTypeMut.isPending ? '…' : 'Speichern'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {treatmentTypes.map(t => {
                    const selected = (treatmentCategory as string[] | undefined)?.includes(t) ?? false
                    return (
                      <button key={t} type="button"
                        onClick={() => {
                          const cur = (getValues('treatmentCategory') as string[]) || []
                          setValue('treatmentCategory', selected ? cur.filter(c => c !== t) : [...cur, t])
                        }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                          selected
                            ? 'bg-primary-600 border-primary-600 text-white'
                            : 'bg-white border-gray-300 text-gray-700 hover:border-primary-400'
                        }`}>
                        {t}
                      </button>
                    )
                  })}
                </div>
              )}
              {(treatmentCategory as string[] | undefined)?.length ? (
                <button type="button" onClick={() => setValue('treatmentCategory', [])}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                  Auswahl zurücksetzen
                </button>
              ) : null}
            </div>}

            {/* Packungseinheit + Inhalt */}
            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Verpackung</p>

              {/* Packungseinheit */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label mb-0">Bestelleinheit *</label>
                  <button type="button" onClick={() => setNeueEinheit(!neueEinheit)}
                    className="text-xs text-primary-600 hover:underline flex items-center gap-1">
                    <Plus className="w-3 h-3" /> {neueEinheit ? 'Schliessen' : 'Verwalten'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mb-1">Die Einheit, in der bestellt/eingekauft wird (z.B. Karton, Flasche)</p>
                {neueEinheit ? (
                  <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {units.map(u => (
                        <span key={u.id} className="flex items-center gap-1 bg-gray-100 rounded-md px-2 py-1 text-xs text-gray-700">
                          {u.name}
                          <button type="button" onClick={() => deleteUnitMut.mutate(u.id)}
                            disabled={deleteUnitMut.isPending}
                            className="text-gray-400 hover:text-red-500 transition-colors ml-0.5">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input className="input text-sm" placeholder="Neue Bestelleinheit…"
                        value={neueEinheitName} onChange={e => setNeueEinheitName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && neueEinheitName && addUnitMut.mutate(neueEinheitName)} />
                      <button type="button" className="btn-primary whitespace-nowrap text-sm"
                        disabled={!neueEinheitName || addUnitMut.isPending}
                        onClick={() => addUnitMut.mutate(neueEinheitName)}>
                        {addUnitMut.isPending ? '…' : 'Hinzufügen'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <select
                    className={`input ${errors.unit ? 'border-red-400' : ''}`}
                    value={selectedUnit}
                    onChange={e => setValue('unit', e.target.value)}
                  >
                    <option value="">— Bestelleinheit auswählen —</option>
                    {units.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                  </select>
                )}
                <input type="hidden" {...register('unit', { required: 'Packungseinheit ist erforderlich' })} />
                {errors.unit && <p className="text-xs text-red-500 mt-1">{errors.unit.message}</p>}
              </div>

              {/* Inhalt: Menge + Mengeneinheit */}
              <div>
                <label className="label">Inhalt pro Bestelleinheit</label>
                <p className="text-xs text-gray-400 mb-1">Wie viele Einzelstücke enthält eine Bestelleinheit?</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500 shrink-0">1 {selectedUnit || '…'} =</span>
                  <input type="number" className="input w-24" min={1} placeholder="10"
                    {...register('quantityPerUnit', { valueAsNumber: true, min: 1 })} />
                  <div className="flex-1">
                    {neueMengeneinheit ? (
                      <div className="border border-gray-200 rounded-lg p-2 space-y-2 flex-1">
                        <div className="flex flex-wrap gap-1.5">
                          {quantityUnits.map(u => (
                            <span key={u.id} className="flex items-center gap-1 bg-gray-100 rounded-md px-2 py-0.5 text-xs text-gray-700">
                              {u.name}
                              <button type="button" onClick={() => deleteQtyUnitMut.mutate(u.id)}
                                disabled={deleteQtyUnitMut.isPending}
                                className="text-gray-400 hover:text-red-500 transition-colors">
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <input className="input text-sm flex-1" placeholder="Neue Inhaltseinheit…"
                            value={neueMengeneinheitName} onChange={e => setNeueMengeneinheitName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && neueMengeneinheitName && addQtyUnitMut.mutate(neueMengeneinheitName)} />
                          <button type="button" className="btn-primary whitespace-nowrap text-sm"
                            disabled={!neueMengeneinheitName || addQtyUnitMut.isPending}
                            onClick={() => addQtyUnitMut.mutate(neueMengeneinheitName)}>
                            {addQtyUnitMut.isPending ? '…' : 'OK'}
                          </button>
                          <button type="button" onClick={() => setNeueMengeneinheit(false)}
                            className="text-xs text-gray-400 hover:text-gray-600 px-1">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <select className="input flex-1" value={selectedQuantityUnit ?? ''}
                          onChange={e => setValue('quantityUnit', e.target.value)}>
                          <option value="">— Einheit —</option>
                          {quantityUnits.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                        </select>
                        <button type="button" onClick={() => setNeueMengeneinheit(true)}
                          className="text-xs text-primary-600 hover:underline whitespace-nowrap flex items-center gap-1">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <input type="hidden" {...register('quantityUnit')} />
                {/* Zusammenfassung */}
                {selectedUnit && (watch('quantityPerUnit') ?? 0) > 0 && selectedQuantityUnit && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary-700 bg-primary-50 rounded-lg px-3 py-1.5 w-fit">
                    <span>1 {selectedUnit} = {watch('quantityPerUnit')} {selectedQuantityUnit}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Mindestbestand */}
            <div>
              <label className="label">Mindestbestand (in {selectedUnit || 'Bestelleinheit'})</label>
              <div className="flex items-center gap-3">
                <input type="number" className="input flex-1" min={0} step={1}
                  {...register('minStock', { valueAsNumber: true, required: 'Pflichtfeld', min: { value: 0, message: 'Min. 0' } })} />
                <span className="text-sm text-gray-500 shrink-0">{selectedUnit || 'Bestelleinheit'}</span>
              </div>
              {errors.minStock && <p className="text-xs text-red-500 mt-1">{errors.minStock.message}</p>}
              <p className="text-xs text-gray-400 mt-1">Bestand bezieht sich immer auf die Bestelleinheit</p>
            </div>

            {/* Lieferant */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">Lieferant</label>
                <button type="button" onClick={() => { setNeuerLieferant(v => !v); setNeuerLieferantName('') }}
                  className="text-xs text-primary-600 hover:underline flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Neuer Lieferant
                </button>
              </div>
              {neuerLieferant ? (
                <div className="flex gap-1">
                  <input className="input text-sm flex-1" placeholder="Lieferantenname…"
                    value={neuerLieferantName} onChange={e => setNeuerLieferantName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && neuerLieferantName && addSupplierMut.mutate(neuerLieferantName)} />
                  <button type="button" className="btn-primary whitespace-nowrap text-sm"
                    disabled={!neuerLieferantName || addSupplierMut.isPending}
                    onClick={() => addSupplierMut.mutate(neuerLieferantName)}>
                    {addSupplierMut.isPending ? '…' : 'OK'}
                  </button>
                  <button type="button" onClick={() => setNeuerLieferant(false)}
                    className="text-xs text-gray-400 hover:text-gray-600 px-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <select className="input" value={selectedSupplier ?? ''}
                  onChange={e => setValue('supplier', e.target.value)}>
                  <option value="">— Kein Lieferant —</option>
                  {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              )}
              <input type="hidden" {...register('supplier')} />
            </div>

            {/* Preis + MWST + Kalkulation */}
            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Preis</p>

              {/* Eingabe Nettopreis */}
              <div>
                <label className="label">Einkaufspreis netto pro {selectedUnit || 'Bestelleinheit'} (exkl. MWST, CHF)</label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">CHF</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="input pl-12"
                      placeholder="0.00"
                      {...register('price', { valueAsNumber: true, min: 0 })}
                    />
                  </div>
                  <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 whitespace-nowrap">
                    MWST {vatRate(selectedCategory)}%
                    {price && price > 0 && (
                      <span className="ml-2 font-semibold text-gray-700">
                        = CHF {(price * (1 + vatRate(selectedCategory) / 100)).toFixed(2)} inkl.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Kalkulation */}
              {price && price > 0 && (() => {
                const vat = vatRate(selectedCategory) / 100
                const qty = watch('quantityPerUnit') ?? 0
                const unit = selectedUnit || 'Einheit'
                const qUnit = selectedQuantityUnit || 'Stück'
                const LAGER = 0.30
                const nettoPerPack = price
                const bruttoPerPack = price * (1 + vat)
                const nettoPerPiece = qty > 0 ? price / qty : null
                const bruttoPerPiece = qty > 0 ? bruttoPerPack / qty : null
                return (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-500">Kalkulation</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="text-left px-2 py-1.5 border border-gray-200 font-medium text-gray-600"></th>
                            <th className="text-right px-2 py-1.5 border border-gray-200 font-medium text-gray-600">Netto</th>
                            <th className="text-right px-2 py-1.5 border border-gray-200 font-medium text-gray-600">Brutto ({vatRate(selectedCategory)}%)</th>
                            <th className="text-right px-2 py-1.5 border border-gray-200 font-medium text-amber-700 bg-amber-50">+ Lagerkosten (30%)</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="px-2 py-1.5 border border-gray-200 font-medium text-gray-700">pro {unit}</td>
                            <td className="px-2 py-1.5 border border-gray-200 text-right tabular-nums">CHF {nettoPerPack.toFixed(2)}</td>
                            <td className="px-2 py-1.5 border border-gray-200 text-right tabular-nums font-medium">CHF {bruttoPerPack.toFixed(2)}</td>
                            <td className="px-2 py-1.5 border border-gray-200 text-right tabular-nums font-semibold text-amber-800 bg-amber-50">CHF {(bruttoPerPack * (1 + LAGER)).toFixed(2)}</td>
                          </tr>
                          {nettoPerPiece !== null && (
                            <tr className="bg-gray-50/50">
                              <td className="px-2 py-1.5 border border-gray-200 font-medium text-gray-700">pro {qUnit}</td>
                              <td className="px-2 py-1.5 border border-gray-200 text-right tabular-nums">CHF {nettoPerPiece.toFixed(2)}</td>
                              <td className="px-2 py-1.5 border border-gray-200 text-right tabular-nums font-medium">CHF {bruttoPerPiece!.toFixed(2)}</td>
                              <td className="px-2 py-1.5 border border-gray-200 text-right tabular-nums font-semibold text-amber-800 bg-amber-50">CHF {(bruttoPerPiece! * (1 + LAGER)).toFixed(2)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-gray-400">Lagerkosten: Einkaufspreis brutto + 30% Overhead</p>
                  </div>
                )
              })()}
            </div>

            {/* Notizen */}
            <div>
              <label className="label">Notizen</label>
              <textarea className="input" rows={2} {...register('notes')} />
            </div>

            {/* Nicht lieferbar */}
            <div className={`rounded-lg border p-3 space-y-2 ${watch('notDeliverable') ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" {...register('notDeliverable')}
                  className="w-4 h-4 rounded accent-blue-600" />
                <span className={`text-sm font-semibold ${watch('notDeliverable') ? 'text-blue-700' : 'text-gray-700'}`}>
                  Zurzeit nicht lieferbar
                </span>
              </label>
              {watch('notDeliverable') && (
                <input type="text" className="input text-sm"
                  placeholder="Hinweis (z.B. Lieferengpass bis ca. Aug. 2026)"
                  {...register('notDeliverableNote')} />
              )}
            </div>
          </div>

          {/* Footer – immer sichtbar */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
            <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={isLoading || !!gtinDuplicate}>
              {isLoading ? 'Speichern…' : initial ? 'Änderungen speichern' : 'Artikel speichern'}
            </button>
          </div>
        </form>
        </div>{/* end LEFT */}

        {/* RIGHT: Medikamenten-Panel */}
        {showCompendium && (
          <div className="w-80 border-l border-gray-200 flex flex-col flex-shrink-0 rounded-r-xl overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between flex-shrink-0">
              <span className="text-sm font-semibold text-gray-800">Medikament suchen</span>
              <button type="button" onClick={() => setShowCompendium(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 flex-shrink-0">
              {(['sl', 'comp'] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => { setCompTab(tab); if (tab === 'sl') loadSlData() }}
                  className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${compTab === tab ? 'text-primary-600 border-primary-500' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
                >
                  {tab === 'sl' ? 'CH-Arzneimittel' : 'Compendium.ch'}
                </button>
              ))}
            </div>

            {/* SL-Datenbank Tab */}
            {compTab === 'sl' && (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="p-3 border-b border-gray-100 flex-shrink-0">
                  <input
                    className="input text-sm w-full"
                    placeholder="Name, GTIN oder Wirkstoff…"
                    value={slSearch}
                    autoFocus
                    onChange={e => { setSlSearch(e.target.value); loadSlData() }}
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    {(slLoading || rdLoading) ? 'Datenbank wird geladen…' :
                     slSearch
                       ? `${combinedResults.length} Ergebnis${combinedResults.length !== 1 ? 'se' : ''} · ${combinedResults.filter(e => e.src === 'sl').length} kassenpflichtig, ${combinedResults.filter(e => e.src === 'rd').length} weitere`
                       : `${(slData?.length ?? 0).toLocaleString('de-CH')} kassenpflichtig (BAG SL) + ${(rdData?.length ?? 0).toLocaleString('de-CH')} Refdata`}
                  </p>
                  {slMeta && !slSearch && (
                    <p className={`text-[11px] mt-0.5 ${slStale ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                      {slStale ? `⚠ Stand ${slMeta.extractedAt} · Daten könnten veraltet sein` : `Stand: ${slMeta.extractedAt}`}
                    </p>
                  )}
                </div>
                <div className="overflow-y-auto flex-1">
                  {!slData && !slLoading && (
                    <div className="p-4 text-center">
                      <button type="button" className="btn-primary text-sm" onClick={loadSlData}>
                        Datenbank laden
                      </button>
                    </div>
                  )}
                  {(slLoading || rdLoading) && (
                    <div className="p-4 text-center text-xs text-gray-400 animate-pulse">Wird geladen…</div>
                  )}
                  {!slLoading && !rdLoading && slSearch && combinedResults.length === 0 && slData && (
                    <p className="p-4 text-xs text-gray-400 text-center">Kein Ergebnis für «{slSearch}»</p>
                  )}
                  {combinedResults.map((entry, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => entry.src === 'sl' ? importSlEntry(entry) : importRdEntry(entry)}
                      className="w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-primary-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <p className="text-xs font-medium text-gray-900 leading-snug flex-1">{entry.n}</p>
                        {entry.src === 'sl'
                          ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 shrink-0">SL</span>
                          : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">RD</span>
                        }
                      </div>
                      {entry.h && <p className="text-[11px] text-gray-500 mt-0.5">{entry.h}</p>}
                      {entry.src === 'sl' && entry.s && <p className="text-[11px] text-gray-400 truncate">{entry.s}</p>}
                      {entry.src === 'rd' && entry.a && <p className="text-[11px] text-gray-400">ATC: {entry.a}</p>}
                      <div className="flex items-center justify-between mt-1 gap-2">
                        {entry.src === 'sl' && entry.e != null && (
                          <span className="text-[11px] font-medium text-primary-700">CHF {entry.e.toFixed(2)} exkl.</span>
                        )}
                        {entry.src === 'rd' && entry.p != null && (
                          <span className="text-[11px] text-gray-500">Pub. CHF {entry.p.toFixed(2)}</span>
                        )}
                        {entry.src === 'rd' && entry.l && (
                          <span className="text-[11px] text-gray-400">Kat. {entry.l}</span>
                        )}
                        {entry.g && <span className="text-[11px] font-mono text-gray-400 shrink-0">{entry.g}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Compendium.ch Tab */}
            {compTab === 'comp' && (
              <div className="p-4 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className="label">Suche via GTIN / EAN</label>
                  <div className="flex gap-1.5">
                    <input
                      className="input flex-1 text-sm font-mono"
                      value={compSearch}
                      onChange={e => setCompSearch(e.target.value)}
                      placeholder="z.B. 7680…"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && compSearch)
                          window.open(`https://www.compendium.ch/search/de?q=${encodeURIComponent(compSearch)}`, '_blank')
                      }}
                    />
                    <a
                      href={compSearch ? `https://www.compendium.ch/search/de?q=${encodeURIComponent(compSearch)}` : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => !compSearch && e.preventDefault()}
                      className={`flex items-center justify-center w-9 rounded-lg border flex-shrink-0 transition-colors ${compSearch ? 'bg-primary-600 border-primary-600 text-white hover:bg-primary-700' : 'bg-gray-100 border-gray-200 text-gray-300 pointer-events-none'}`}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Öffnet compendium.ch mit GTIN-Suche in neuem Tab</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showScanner && (
        <BarcodeScanner key={Date.now()}
          onResult={(r) => {
            const g = r.gtin ?? r.value
            setValue('gtin', g)
            setShowScanner(false)
            lookupGtin(g)
          }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {showImagePicker && (
        <ImagePicker
          articleId={initial?.id ?? 'new'}
          onImage={(url) => { setImageUrl(url); setShowImagePicker(false) }}
          onClose={() => setShowImagePicker(false)}
        />
      )}
    </div>
  )
}
