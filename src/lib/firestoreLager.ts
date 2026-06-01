import {
  collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, deleteField
} from 'firebase/firestore'
import { db } from './firebase'
import type { InventoryArticle, InventoryLot, StockMovement, Order, InventoryAlert } from '../types/inventory.types'
import {
  sumActiveLotQuantity,
  nextExpiryDate as computeNextExpiry,
  stockStatus as computeStockStatus,
  matchZurRoseEntry,
  formatZurRoseAlertDetail,
} from './inventoryLogic'

const col = (name: string) => collection(db, name)

function fromDoc<T>(snap: any): T {
  return { id: snap.id, ...snap.data() } as T
}

export async function getArticleUnits(articleIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  await Promise.all([...new Set(articleIds)].map(async id => {
    const snap = await getDoc(doc(db, 'inventory_articles', id))
    if (snap.exists()) result.set(id, (snap.data().quantityUnit as string) || (snap.data().unit as string) || '')
  }))
  return result
}

export async function getArticleStocks(articleIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  await Promise.all([...new Set(articleIds)].map(async id => {
    const snap = await getDocs(query(col('inventory_lots'), where('articleId', '==', id)))
    const stock = snap.docs.reduce((sum, d) => {
      const data = d.data()
      return data.isDepleted ? sum : sum + (data.quantity || 0)
    }, 0)
    result.set(id, stock)
  }))
  return result
}

async function enrichArticle(article: InventoryArticle): Promise<InventoryArticle> {
  // Ein where-Feld → kein Composite-Index nötig. Pure-Logic in src/lib/inventoryLogic.ts.
  const lotsSnap = await getDocs(query(col('inventory_lots'), where('articleId', '==', article.id)))
  const lots = lotsSnap.docs.map(d => d.data() as any)
  const currentStock   = sumActiveLotQuantity(lots)
  const nextExpiryDate = computeNextExpiry(lots)
  const stockStatus    = computeStockStatus(currentStock, article.minStock)
  return { ...article, currentStock, nextExpiryDate, stockStatus }
}

// ─── Zur Rose Nota-Liste (nicht lieferbare Artikel) ──────────────────────────

interface ZurRoseEntry { pc: number; n: string; d?: string; l?: string }
interface ZurRoseData  { meta: { extractedAt: string; stand: string; entries: number }; data: ZurRoseEntry[] }

export interface ZurRoseMeta { extractedAt: string; stand: string; entries: number }

export async function getZurRoseMeta(): Promise<ZurRoseMeta | null> {
  try {
    const r = await fetch('/zurrose-nota-meta.json')
    const m = await r.json()
    return m.extractedAt ? m : null
  } catch { return null }
}

export async function getZurRoseAlerts(articles: InventoryArticle[]): Promise<InventoryAlert[]> {
  let zr: ZurRoseData
  try {
    const r = await fetch('/zurrose-nota-data.json')
    zr = await r.json()
  } catch { return [] }
  if (!zr?.data?.length) return []

  // Matching + Formatierung sind pure — siehe inventoryLogic.ts
  const alerts: InventoryAlert[] = []
  for (const article of articles) {
    if (article.isActive === false) continue
    const match = matchZurRoseEntry(article, zr.data)
    if (match) {
      alerts.push({
        type:        'not_deliverable',
        articleId:   article.id,
        articleName: article.name,
        detail:      formatZurRoseAlertDetail(match),
        severity:    'warning',
      })
    }
  }
  return alerts
}

// ─── Articles ────────────────────────────────────────────────────────────────

export async function getArticles(params?: { category?: string; search?: string }): Promise<InventoryArticle[]> {
  // Kein where+orderBy Kombination — würde Composite-Index benötigen. Filtern in JS.
  const snap = await getDocs(query(col('inventory_articles'), orderBy('name')))
  let articles = snap.docs.map(d => fromDoc<InventoryArticle>(d)).filter(a => a.isActive !== false)
  if (params?.category) articles = articles.filter(a => a.category === params.category)
  if (params?.search) {
    const s = params.search.toLowerCase()
    articles = articles.filter(a => a.name.toLowerCase().includes(s))
  }
  return Promise.all(articles.map(enrichArticle))
}

export async function getArticle(id: string) {
  const snap = await getDoc(doc(db, 'inventory_articles', id))
  if (!snap.exists()) throw new Error('Artikel nicht gefunden')
  const article = await enrichArticle(fromDoc<InventoryArticle>(snap))

  // Kein orderBy+where Kombination — würde Composite-Index benötigen → in JS sortieren
  const lotsSnap = await getDocs(query(col('inventory_lots'), where('articleId', '==', id)))
  const lots = lotsSnap.docs.map(d => fromDoc<InventoryLot>(d))
    .sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''))

  const movSnap = await getDocs(query(col('stock_movements'), where('articleId', '==', id)))
  const movements = movSnap.docs.map(d => fromDoc<StockMovement>(d))
    .sort((a, b) => b.movementDate.localeCompare(a.movementDate))

  return { ...article, lots, movements }
}

export async function findArticleByGtin(gtin: string, excludeId?: string): Promise<{ id: string; name: string } | null> {
  const snap = await getDocs(query(col('inventory_articles'), where('gtin', '==', gtin)))
  const match = snap.docs.find(d => d.id !== excludeId && d.data().isActive !== false)
  if (!match) return null
  return { id: match.id, name: match.data().name as string }
}

export async function createArticle(data: Omit<InventoryArticle, 'id'>): Promise<InventoryArticle> {
  const ref = await addDoc(col('inventory_articles'), { ...data, isActive: true, createdAt: serverTimestamp() })
  return { id: ref.id, ...data }
}

export async function updateArticle(id: string, data: Partial<InventoryArticle>): Promise<void> {
  // Berechnete Felder herausfiltern, die nicht gespeichert werden sollen
  const { currentStock: _cs, nextExpiryDate: _ned, stockStatus: _ss, ...raw } = data as any
  // null → deleteField() (Feld aus Firestore entfernen), undefined → überspringen
  const cleanData: Record<string, any> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === null) cleanData[k] = deleteField()
    else if (v !== undefined) cleanData[k] = v
  }
  await updateDoc(doc(db, 'inventory_articles', id), { ...cleanData, updatedAt: serverTimestamp() })
}

export async function deleteArticle(id: string): Promise<void> {
  // Soft-Delete: isActive=false, damit die Buchungshistorie erhalten bleibt
  await updateDoc(doc(db, 'inventory_articles', id), { isActive: false })
}

// ─── Lots ────────────────────────────────────────────────────────────────────

export async function updateLot(id: string, data: Partial<InventoryLot>): Promise<void> {
  const { id: _id, articleId: _aid, ...raw } = data as any
  // Firestore akzeptiert keine undefined-Werte — nur definierte Felder übernehmen
  const updateData: Record<string, any> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) updateData[k] = v
  }
  await updateDoc(doc(db, 'inventory_lots', id), { ...updateData, updatedAt: serverTimestamp() })
}

export async function deleteLot(id: string, articleId: string): Promise<void> {
  // Alle zugehörigen Buchungen löschen
  const movSnap = await getDocs(query(col('stock_movements'), where('lotId', '==', id)))
  await Promise.all(movSnap.docs.map(d => deleteDoc(d.ref)))
  // Lot-Dokument löschen
  await deleteDoc(doc(db, 'inventory_lots', id))
}

export async function addLot(data: { articleId: string; lotNumber: string; quantity: number; expiryDate?: string; deliveryDate?: string }): Promise<InventoryLot> {
  // Strip undefined optional fields — Firestore rejects undefined values
  const cleanData: Record<string, any> = { articleId: data.articleId, lotNumber: data.lotNumber, quantity: data.quantity }
  if (data.expiryDate) cleanData.expiryDate = data.expiryDate
  if (data.deliveryDate) cleanData.deliveryDate = data.deliveryDate
  const ref = await addDoc(col('inventory_lots'), { ...cleanData, isDepleted: false, createdAt: serverTimestamp() })
  await addDoc(col('stock_movements'), {
    lotId: ref.id,
    articleId: data.articleId,
    movementType: 'Eingang',
    quantityDelta: data.quantity,
    reason: 'Lieferung',
    movementDate: new Date().toISOString().slice(0, 10),
  })
  return { id: ref.id, isDepleted: false, ...data }
}

// ─── Suppliers ───────────────────────────────────────────────────────────────

export interface Supplier {
  id: string
  name: string
  contact?: string
  phone?: string
  email?: string
  website?: string
  address?: string
  notes?: string
}

export async function getSuppliers(): Promise<Supplier[]> {
  const snap = await getDocs(query(col('suppliers'), orderBy('name')))
  return snap.docs.map(d => fromDoc<Supplier>(d))
}

export async function createSupplier(data: Omit<Supplier, 'id'>): Promise<Supplier> {
  const ref = await addDoc(col('suppliers'), { ...data, createdAt: serverTimestamp() })
  return { id: ref.id, ...data }
}

export async function updateSupplier(id: string, data: Partial<Supplier>): Promise<void> {
  await updateDoc(doc(db, 'suppliers', id), data)
}

export async function deleteSupplier(id: string): Promise<void> {
  await deleteDoc(doc(db, 'suppliers', id))
}

// ─── Units ───────────────────────────────────────────────────────────────────

const DEFAULT_UNITS = ['Stück', 'Box', 'ml', 'mg', 'Fläschchen', 'Ampulle', 'Packung', 'Tube', 'Dose']

export async function getUnits(): Promise<{ id: string; name: string }[]> {
  const snap = await getDocs(query(col('units'), orderBy('name')))
  if (!snap.empty) return snap.docs.map(d => ({ id: d.id, name: d.data().name as string }))
  await Promise.all(DEFAULT_UNITS.map(name => addDoc(col('units'), { name })))
  const snap2 = await getDocs(query(col('units'), orderBy('name')))
  return snap2.docs.map(d => ({ id: d.id, name: d.data().name as string }))
}

export async function addUnit(name: string): Promise<string> {
  await addDoc(col('units'), { name })
  return name
}

export async function deleteUnit(id: string): Promise<void> {
  await deleteDoc(doc(db, 'units', id))
}

// ─── Quantity Units ───────────────────────────────────────────────────────────

const DEFAULT_QTY_UNITS = ['Tabletten', 'Kapseln', 'ml', 'mg', 'g', 'Tropfen', 'Einheiten', 'Stück']

export async function getQuantityUnits(): Promise<{ id: string; name: string }[]> {
  const snap = await getDocs(query(col('quantity_units'), orderBy('name')))
  if (!snap.empty) return snap.docs.map(d => ({ id: d.id, name: d.data().name as string }))
  await Promise.all(DEFAULT_QTY_UNITS.map(name => addDoc(col('quantity_units'), { name })))
  const snap2 = await getDocs(query(col('quantity_units'), orderBy('name')))
  return snap2.docs.map(d => ({ id: d.id, name: d.data().name as string }))
}

export async function addQuantityUnit(name: string): Promise<string> {
  await addDoc(col('quantity_units'), { name })
  return name
}

export async function deleteQuantityUnit(id: string): Promise<void> {
  await deleteDoc(doc(db, 'quantity_units', id))
}

// ─── Kategorien ───────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = ['Medikament', 'Augentropfen', 'Verbrauchsmaterial', 'Nahtmaterial', 'Desinfektion', 'Schutzausrüstung', 'Verbandmaterial', 'Instrument', 'Sonstiges']

export async function getCategories(): Promise<{ id: string; name: string }[]> {
  const snap = await getDocs(query(col('categories'), orderBy('name')))
  if (!snap.empty) {
    // Deduplizieren nach Name (falls durch Race-Condition Duplikate entstanden sind)
    const seen = new Set<string>()
    return snap.docs
      .map(d => ({ id: d.id, name: d.data().name as string }))
      .filter(c => seen.has(c.name) ? false : !!seen.add(c.name))
  }
  // Seed mit stabilen IDs (name-basiert) → verhindert Duplikate bei parallelen Aufrufen
  await Promise.all(DEFAULT_CATEGORIES.map(name =>
    setDoc(doc(db, 'categories', name.toLowerCase().replace(/[^a-z0-9]/g, '-')), { name })
  ))
  const snap2 = await getDocs(query(col('categories'), orderBy('name')))
  return snap2.docs.map(d => ({ id: d.id, name: d.data().name as string }))
}

export async function addCategory(name: string): Promise<string> {
  await addDoc(col('categories'), { name })
  return name
}

export async function deleteCategory(id: string): Promise<void> {
  await deleteDoc(doc(db, 'categories', id))
}

export async function getArticleLots(articleId: string): Promise<InventoryLot[]> {
  const snap = await getDocs(query(col('inventory_lots'), where('articleId', '==', articleId)))
  return snap.docs.map(d => fromDoc<InventoryLot>(d)).filter(l => !l.isDepleted)
}

// ─── Movements ───────────────────────────────────────────────────────────────

export async function addMovement(data: {
  lotId: string; articleId: string; movementType: string; quantityDelta: number;
  reason?: string; lotNumber?: string; patientName?: string; notes?: string; performedBy?: string
}): Promise<void> {
  const clean: Record<string, any> = { ...data, movementDate: new Date().toISOString().slice(0, 10) }
  for (const k of Object.keys(clean)) { if (clean[k] === undefined || clean[k] === '') delete clean[k] }
  await addDoc(col('stock_movements'), clean)
  const lotSnap = await getDoc(doc(db, 'inventory_lots', data.lotId))
  if (lotSnap.exists()) {
    const newQty = (lotSnap.data().quantity || 0) + data.quantityDelta
    await updateDoc(doc(db, 'inventory_lots', data.lotId), {
      quantity: Math.max(0, newQty),
      isDepleted: newQty <= 0,
    })
  }
}

export async function updateMovement(
  id: string,
  oldDelta: number,
  data: Partial<StockMovement>
): Promise<void> {
  const { id: _id, articleId: _aid, ...raw } = data as any
  const cleanData: Record<string, any> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === '') cleanData[k] = deleteField()
    else if (v !== undefined) cleanData[k] = v
  }
  await updateDoc(doc(db, 'stock_movements', id), cleanData)
  // Lot-Bestand anpassen wenn Menge geändert
  if (data.quantityDelta !== undefined && data.lotId && data.quantityDelta !== oldDelta) {
    const diff = data.quantityDelta - oldDelta
    const lotSnap = await getDoc(doc(db, 'inventory_lots', data.lotId))
    if (lotSnap.exists()) {
      const newQty = (lotSnap.data().quantity || 0) + diff
      await updateDoc(doc(db, 'inventory_lots', data.lotId), {
        quantity: Math.max(0, newQty),
        isDepleted: newQty <= 0,
      })
    }
  }
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

export async function getAlerts(): Promise<InventoryAlert[]> {
  const snap = await getDocs(col('inventory_articles'))
  const articles = snap.docs.map(d => fromDoc<InventoryArticle>(d)).filter(a => a.isActive !== false)
  const alerts: InventoryAlert[] = []
  const in30Str = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

  await Promise.all(articles.map(async (a) => {
    if (a.notDeliverable) {
      alerts.push({
        type: 'not_deliverable', articleId: a.id, articleName: a.name,
        detail: a.notDeliverableNote || 'Zurzeit nicht lieferbar',
        severity: 'warning',
      })
    } else if (a.zurRoseNota) {
      alerts.push({
        type: 'not_deliverable', articleId: a.id, articleName: a.name,
        detail: a.zurRoseNotaDetail || 'Nicht lieferbar (Zur Rose)',
        severity: 'warning',
      })
    }
    // Alle Lots einmal holen — Stock-Summe und Ablauf-Filter teilen sich die Query.
    const lotsSnap = await getDocs(query(col('inventory_lots'), where('articleId', '==', a.id)))
    const lots = lotsSnap.docs.map(d => d.data() as any)
    const stock = sumActiveLotQuantity(lots)
    if (stock < (a.minStock || 0)) {
      const qu = a.quantityUnit || a.unit
      alerts.push({
        type: 'low_stock', articleId: a.id, articleName: a.name,
        detail: `Bestand: ${stock} ${qu} (Min: ${a.minStock} ${qu})`,
        severity: stock === 0 ? 'critical' : 'warning',
      })
    }
    const expiring = lots
      .filter(l => !l.isDepleted && l.expiryDate && l.expiryDate <= in30Str)
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
    if (expiring.length > 0) {
      const lot = expiring[0]
      const days = Math.ceil((new Date(lot.expiryDate).getTime() - Date.now()) / 86400000)
      alerts.push({
        type: 'expiring', articleId: a.id, articleName: a.name,
        detail: `Lot ${lot.lotNumber} läuft in ${days} Tagen ab`,
        severity: days <= 7 ? 'critical' : 'warning',
      })
    }
  }))
  return alerts
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export async function getOrders(): Promise<Order[]> {
  const snap = await getDocs(query(col('orders'), orderBy('orderDate', 'desc')))
  return snap.docs.map(d => fromDoc<Order>(d))
}

export async function createOrder(data: Omit<Order, 'id'>): Promise<Order> {
  const ref = await addDoc(col('orders'), { ...data, orderDate: new Date().toISOString().slice(0, 10) })
  return { id: ref.id, ...data }
}

export async function updateOrder(id: string, data: Partial<Order>): Promise<void> {
  await updateDoc(doc(db, 'orders', id), data)
}

export async function applyInventurCorrections(
  corrections: Array<{ articleId: string; physicalCount: number; currentStock: number; performedBy: string }>,
): Promise<number> {
  const date = new Date().toISOString().slice(0, 10)
  const lotTag = `INV-${date.replace(/-/g, '')}`
  let corrected = 0

  for (const c of corrections) {
    const diff = c.physicalCount - c.currentStock
    if (diff === 0) continue

    if (diff > 0) {
      // Surplus → new correction lot
      const lotRef = await addDoc(col('inventory_lots'), {
        articleId: c.articleId, lotNumber: lotTag, quantity: diff,
        isDepleted: false, createdAt: serverTimestamp(),
      })
      await addDoc(col('stock_movements'), {
        lotId: lotRef.id, articleId: c.articleId, movementType: 'Korrektur',
        quantityDelta: diff, reason: 'Inventur', performedBy: c.performedBy, movementDate: date,
      })
    } else {
      // Deficit → reduce existing lots FIFO (oldest expiry first)
      let remaining = Math.abs(diff)
      const snap = await getDocs(query(col('inventory_lots'), where('articleId', '==', c.articleId), where('isDepleted', '==', false)))
      const lots = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .sort((a: any, b: any) => (a.expiryDate ?? '9').localeCompare(b.expiryDate ?? '9'))
      for (const lot of lots) {
        if (remaining <= 0) break
        const reduce = Math.min(remaining, lot.quantity as number)
        const newQty = (lot.quantity as number) - reduce
        await updateDoc(doc(db, 'inventory_lots', lot.id), { quantity: newQty, isDepleted: newQty <= 0 })
        await addDoc(col('stock_movements'), {
          lotId: lot.id, articleId: c.articleId, movementType: 'Korrektur',
          quantityDelta: -reduce, reason: 'Inventur', performedBy: c.performedBy, movementDate: date,
        })
        remaining -= reduce
      }
    }
    corrected++
  }
  return corrected
}
