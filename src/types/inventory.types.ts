export const INVENTORY_CATEGORIES = [
  'Medikament',
  'Augentropfen',
  'Verbrauchsmaterial',
  'Nahtmaterial',
  'Desinfektion',
  'Schutzausrüstung',
  'Verbandmaterial',
  'Instrument',
  'Sonstiges',
] as const

export type InventoryCategory = typeof INVENTORY_CATEGORIES[number]

export interface InventoryArticle {
  id: string
  name: string
  category: string
  articleNumber?: string
  gtin?: string
  refNr?: string
  unit: string
  minStock: number
  maxStock?: number
  supplier?: string
  treatmentCategory?: string[]
  price?: number          // Nettopreis exkl. MWST (in CHF)
  quantityPerUnit?: number // Menge pro Packung (z.B. 10)
  quantityUnit?: string   // Mengeneinheit (z.B. Tabletten, ml, mg)
  notes?: string
  imageUrl?: string
  isActive: boolean
  medicationId?: string
  notDeliverable?: boolean        // manuell markiert: zurzeit nicht lieferbar
  notDeliverableNote?: string     // optionaler Hinweis (Grund, seit wann, etc.)
  notDeliverableUntil?: string    // voraussichtlich lieferbar ab (YYYY-MM-DD)
  notDeliverableUpdatedAt?: string // letzte Aktualisierung (ISO-String)
  zurRoseNota?: boolean           // automatisch via update-zurrose: in Zur Rose Nota-Liste
  zurRoseNotaDetail?: string      // z.B. "Ausstand bis 15.06.2026"
  zurRoseNotaUpdatedAt?: string   // letzte Aktualisierung (ISO-String)
  // computed
  currentStock?: number
  nextExpiryDate?: string | null
  stockStatus?: 'ok' | 'low' | 'critical' | 'out'
}

/** MWST-Satz in % je nach Kategorie (CH: Medikamente 2.6%, Sonstiges 8.1%) */
export function vatRate(category: string): number {
  return (category === 'Medikament' || category === 'Augentropfen') ? 2.6 : 8.1
}

export interface InventoryLot {
  id: string
  articleId: string
  lotNumber: string
  quantity: number
  expiryDate?: string
  deliveryDate?: string
  purchasePrice?: number
  isDepleted: boolean
  notes?: string
  createdAt?: string
  // computed
  daysUntilExpiry?: number
  expiryStatus?: 'ok' | 'warning' | 'critical' | 'expired'
}

export interface StockMovement {
  id: string
  lotId: string
  articleId: string
  movementType: 'Eingang' | 'Abgang' | 'Korrektur'
  quantityDelta: number
  reason: string
  lotNumber?: string
  patientName?: string
  notes?: string
  referenceId?: string
  performedBy?: string
  movementDate: string
}

export interface Order {
  id: string
  articleId: string
  articleName?: string
  quantityOrdered: number
  orderDate: string
  expectedDelivery?: string
  actualDelivery?: string
  supplier?: string
  orderNumber?: string
  status: 'bestellt' | 'geliefert' | 'teilgeliefert' | 'abgebrochen'
  notes?: string
}

export interface InventoryAlert {
  type: 'low_stock' | 'expiring' | 'not_deliverable'
  articleId: string
  articleName: string
  detail: string
  severity: 'warning' | 'critical'
}
