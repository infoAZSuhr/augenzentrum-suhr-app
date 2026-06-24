/**
 * Client-side Zur-Rose Nota-Liste Update.
 *
 * Workflow:
 *   1. Browser ruft den Cloudflare-Worker auf (siehe cloudflare-worker/).
 *   2. Worker proxy't zurrose.ch (umgeht Cloudflare-Block + CORS).
 *   3. Browser parsed das XLSX (xlsx-lib bereits im Bundle für Recall/Export).
 *   4. Match jedes Lager-Artikels gegen die Nota-Einträge — schreibt
 *      zurRoseNota + zurRoseNotaDetail per Firestore-Batch zurück.
 *   5. Speichert eine kompakte Status-Meta in Firestore (notaListe/meta).
 *
 * Damit ersetzt der manuelle Klick im Lager den nicht-mehr-funktionierenden
 * CI-Cron. Bleibt der Cron drin als Best-Effort-Fallback — wenn er mal
 * läuft, super; wenn nicht, schreibt der Click die Daten korrekt.
 */
import * as XLSX from 'xlsx'
import { collection, getDocs, doc, getDoc, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { matchZurRoseEntry, formatZurRoseAlertDetail } from './inventoryLogic'
import type { InventoryArticle } from '../types/inventory.types'

// Cloudflare-Worker-Endpoint. Wird bei jedem Push auf cloudflare-worker/
// via .github/workflows/deploy-cloudflare-worker.yml neu deployt.
export const ZURROSE_WORKER_URL = 'https://azs-zurrose-proxy.zurrose-update.workers.dev'

export interface ZurRoseEntry {
  pc: number       // Produkt-Code (Pharmacode)
  n:  string       // Produktname
  d?: string       // Datum bis wann Ausstand (oder 'fehlt auf unbestimmte Zeit')
  l?: string       // Lieferform
}

export interface NotaListeMeta {
  stand:        string        // z.B. "02.06.2026"
  entries:      number
  lastSync?:    string         // ISO-Zeit des letzten erfolgreichen Sync
  syncedBy?:    string         // displayName des Users der zuletzt synct hat
  source?:      'worker' | 'cron' | 'manual'
}

export interface SyncResult {
  stand:       string
  entries:     number
  articlesMatched:  number     // Artikel die jetzt als nicht-lieferbar markiert sind
  articlesCleared:  number     // Artikel die zurückgesetzt wurden (wieder lieferbar)
  articlesScanned:  number
}

// ── Step 1: Worker-Call ──────────────────────────────────────────────────────

export async function fetchNotaListeXLSX(): Promise<ArrayBuffer> {
  const res = await fetch(`${ZURROSE_WORKER_URL}/nota-liste.xlsx`, { cache: 'no-store' })
  if (!res.ok) {
    let detail = ''
    try { detail = await res.text() } catch {}
    throw new Error(`Worker-Fetch fehlgeschlagen (HTTP ${res.status}): ${detail.slice(0, 200)}`)
  }
  const buf = await res.arrayBuffer()
  // ZIP-Magic-Bytes-Check
  const head = new Uint8Array(buf, 0, 2)
  if (head[0] !== 0x50 || head[1] !== 0x4B) {
    throw new Error(`Antwort ist kein gültiges XLSX (${buf.byteLength} Bytes)`)
  }
  return buf
}

// ── Step 2: XLSX parsen ──────────────────────────────────────────────────────

export function parseNotaListeXLSX(buf: ArrayBuffer): { stand: string; entries: ZurRoseEntry[] } {
  const wb   = XLSX.read(buf, { type: 'array' })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })

  const standRaw = String(rows[1]?.[0] || '').replace(/stand:\s*/i, '').trim()
  const entries: ZurRoseEntry[] = []
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i] as any[]
    const name = String(r[1] || '').trim()
    if (!name) continue
    const pc = r[0]
    const entry: ZurRoseEntry = {
      pc: typeof pc === 'number' ? pc : (parseInt(String(pc), 10) || 0),
      n:  name,
    }
    const d = String(r[2] || '').trim()
    if (d) entry.d = d
    const l = String(r[3] || '').trim()
    if (l) entry.l = l
    entries.push(entry)
  }
  return { stand: standRaw, entries }
}

// ── Step 3: Firestore-Artikel mit Nota-Status syncen ─────────────────────────

async function getAllArticles(): Promise<InventoryArticle[]> {
  const snap = await getDocs(collection(db, 'inventory_articles'))
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
}

async function syncArticlesAgainstNota(entries: ZurRoseEntry[]): Promise<Pick<SyncResult, 'articlesMatched' | 'articlesCleared' | 'articlesScanned'>> {
  const articles = await getAllArticles()
  const now = new Date().toISOString()
  const updates: Array<{ id: string; data: { zurRoseNota: boolean; zurRoseNotaDetail?: string | null; zurRoseNotaUpdatedAt?: string | null } }> = []

  for (const a of articles) {
    if (a.isActive === false) continue
    const match = matchZurRoseEntry(a, entries as any)
    if (match) {
      updates.push({ id: a.id, data: { zurRoseNota: true, zurRoseNotaDetail: formatZurRoseAlertDetail(match), zurRoseNotaUpdatedAt: now } })
    } else if ((a as any).zurRoseNota) {
      updates.push({ id: a.id, data: { zurRoseNota: false, zurRoseNotaDetail: null, zurRoseNotaUpdatedAt: null } })
    }
  }

  // Batches à max 400 Operations (Firestore-Limit = 500)
  for (let i = 0; i < updates.length; i += 400) {
    const batch = writeBatch(db)
    for (const u of updates.slice(i, i + 400)) {
      batch.update(doc(db, 'inventory_articles', u.id), u.data as any)
    }
    await batch.commit()
  }

  return {
    articlesScanned: articles.filter(a => a.isActive !== false).length,
    articlesMatched: updates.filter(u => u.data.zurRoseNota === true).length,
    articlesCleared: updates.filter(u => u.data.zurRoseNota === false).length,
  }
}

// ── Step 4: Status-Meta in Firestore speichern ───────────────────────────────

export async function getNotaListeMetaFromFirestore(): Promise<NotaListeMeta | null> {
  try {
    const snap = await getDoc(doc(db, 'systemStatus', 'zurroseSync'))
    if (!snap.exists()) return null
    return snap.data() as NotaListeMeta
  } catch {
    return null
  }
}

async function saveNotaListeMeta(meta: Omit<NotaListeMeta, 'lastSync'>): Promise<void> {
  await setDoc(doc(db, 'systemStatus', 'zurroseSync'), {
    ...meta,
    lastSync: serverTimestamp(),
  }, { merge: true })
}

// ── Top-Level: Komplettes Update durchführen ─────────────────────────────────

export async function syncZurRoseFromWorker(displayName: string): Promise<SyncResult> {
  const buf = await fetchNotaListeXLSX()
  const { stand, entries } = parseNotaListeXLSX(buf)
  if (!stand || entries.length === 0) {
    throw new Error(`Geparste XLSX leer oder ungültig (Stand: ${stand}, Entries: ${entries.length})`)
  }
  const articleStats = await syncArticlesAgainstNota(entries)
  await saveNotaListeMeta({
    stand,
    entries:  entries.length,
    syncedBy: displayName,
    source:   'worker',
  })
  return {
    stand,
    entries: entries.length,
    ...articleStats,
  }
}
