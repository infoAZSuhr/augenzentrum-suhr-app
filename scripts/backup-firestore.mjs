/**
 * Firestore-Voll-Backup: exportiert ALLE Collections (inkl. Subcollections)
 * als JSON-Datei mit Zeitstempel. Gedacht fuer den naechtlichen Lauf via
 * Windows-Aufgabenplanung (scripts/register-backup-task.ps1).
 *
 * Ablage:   %AZS_BACKUP_DIR%  (Default: <Home>\azs-backups)
 * Rotation: die letzten 30 Backups bleiben, aeltere werden geloescht.
 *
 * Credentials wie bei sync-glossar-defaults.mjs:
 *   GOOGLE_APPLICATION_CREDENTIALS = Pfad zur Service-Account-JSON
 *   oder FIREBASE_SERVICE_ACCOUNT  = JSON-Inhalt direkt
 *
 * Admin SDK bypasst die Firestore-Rules (privileged access) — bewusst.
 */
import admin from 'firebase-admin'
import { getFirestore } from 'firebase-admin/firestore'
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const PROJECT_ID = 'azsdb-999d6'
const BACKUP_DIR = process.env.AZS_BACKUP_DIR || path.join(os.homedir(), 'azs-backups')
const KEEP = 30
const PREFIX = 'azs-firestore-'

// ── Credentials ──────────────────────────────────────────────────────────
// Reihenfolge: 1) Service-Account (Env), 2) Login der Firebase CLI auf
// dieser Maschine (firebase-tools speichert einen Refresh-Token unter
// %APPDATA%/configstore/firebase-tools.json — das Admin SDK kann damit
// direkt authentifizieren, kein Schluessel-Download noetig).
import { readFileSync, writeFileSync } from 'node:fs'

// Oeffentliche OAuth-Client-Daten der Firebase CLI (in firebase-tools
// einkompiliert, kein Geheimnis) — noetig fuer den Refresh-Token-Flow.
const FIREBASE_CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'

function prepareCliAdcFile() {
  // configstore nutzt den XDG-Pfad (~/.config/configstore), aeltere
  // Versionen %APPDATA%/configstore — beide probieren.
  const candidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'configstore', 'firebase-tools.json'),
  ]
  let cfg = null
  for (const p of candidates) {
    try { cfg = JSON.parse(readFileSync(p, 'utf8')); break } catch { /* naechsten Pfad probieren */ }
  }
  if (!cfg) throw new Error('firebase-tools.json nicht gefunden — `firebase login` ausfuehren')
  const rt = cfg?.tokens?.refresh_token
  if (!rt) throw new Error('Kein refresh_token in firebase-tools.json')
  // Firestore im Admin SDK akzeptiert refreshToken-Credentials nicht direkt —
  // wohl aber via Application-Default-Credentials-Datei im
  // "authorized_user"-Format. Diese hier aus dem CLI-Login erzeugen.
  const adc = {
    type: 'authorized_user',
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: rt,
    quota_project_id: PROJECT_ID,
  }
  const adcPath = path.join(os.homedir(), '.config', 'azs-backup-adc.json')
  writeFileSync(adcPath, JSON.stringify(adc), 'utf8')
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath
}

let credential
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  credential = admin.credential.applicationDefault()
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
} else {
  try {
    prepareCliAdcFile()
    credential = admin.credential.applicationDefault()
    console.log('ℹ Verwende Firebase-CLI-Login (kein Service-Account gesetzt).')
  } catch (e) {
    console.error('\n❌ Fehler: keine Credentials gefunden.')
    console.error('   Option A: `firebase login` auf dieser Maschine ausfuehren, oder')
    console.error('   Option B: GOOGLE_APPLICATION_CREDENTIALS (Pfad zur Service-')
    console.error('   Account-JSON) bzw. FIREBASE_SERVICE_ACCOUNT (Inhalt) setzen.')
    console.error('   (' + (e && e.message) + ')\n')
    process.exit(1)
  }
}
admin.initializeApp({ credential, projectId: PROJECT_ID })
const db = getFirestore()

// Firestore-Timestamps u.ae. JSON-tauglich machen.
function plain(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof value.toDate === 'function') return { __timestamp: value.toDate().toISOString() }
  if (Array.isArray(value)) return value.map(plain)
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = plain(v)
  return out
}

let docCount = 0

async function dumpDocRef(docRef, data) {
  const entry = { id: docRef.id, data: plain(data) }
  docCount++
  const subs = await docRef.listCollections()
  if (subs.length > 0) {
    entry.subcollections = {}
    for (const sub of subs) {
      entry.subcollections[sub.id] = await dumpCollection(sub)
    }
  }
  return entry
}

async function dumpCollection(colRef) {
  const snap = await colRef.get()
  const docs = []
  for (const d of snap.docs) {
    docs.push(await dumpDocRef(d.ref, d.data()))
  }
  return docs
}

async function main() {
  const started = Date.now()
  const collections = await db.listCollections()
  const dump = {
    project: PROJECT_ID,
    exportedAt: new Date().toISOString(),
    collections: {},
  }
  for (const col of collections) {
    process.stdout.write(`  ${col.id} … `)
    const before = docCount
    dump.collections[col.id] = await dumpCollection(col)
    console.log(`${docCount - before} Dokumente`)
  }

  await mkdir(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
  const file = path.join(BACKUP_DIR, `${PREFIX}${stamp}.json`)
  await writeFile(file, JSON.stringify(dump), 'utf8')
  console.log(`\n✅ Backup: ${file}`)
  console.log(`   ${docCount} Dokumente, ${collections.length} Collections, ${((Date.now() - started) / 1000).toFixed(1)}s`)

  // Rotation: aelteste Backups ueber KEEP hinaus loeschen.
  const files = (await readdir(BACKUP_DIR))
    .filter(f => f.startsWith(PREFIX) && f.endsWith('.json'))
    .sort()   // Zeitstempel im Namen → lexikographisch = chronologisch
  const excess = files.slice(0, Math.max(0, files.length - KEEP))
  for (const f of excess) {
    await unlink(path.join(BACKUP_DIR, f))
    console.log(`   Rotation: ${f} geloescht`)
  }
}

main().catch(err => {
  console.error('❌ Backup fehlgeschlagen:', err)
  process.exit(1)
})
