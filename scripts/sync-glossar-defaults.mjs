/**
 * Synct die DEFAULT-Glossar-Einträge aus src/lib/glossar.ts in die
 * Firestore-Collection `glossar`. Idempotent: Einträge, deren Abkürzung
 * bereits in Firestore existiert, werden NICHT überschrieben (Admin-Edits
 * bleiben intakt). Nur fehlende Defaults werden neu angelegt.
 *
 * Ausführung:
 *   - Wöchentlich via .github/workflows/sync-glossar-defaults.yml (cron)
 *   - Manuell via workflow_dispatch
 *   - Lokal: GOOGLE_APPLICATION_CREDENTIALS=/pfad/zu/sa.json
 *            node scripts/sync-glossar-defaults.mjs
 *
 * Quelle der Wahrheit: src/lib/glossar.ts exportiert `GLOSSAR`.
 * Wir kompilieren die TS-Datei zur Laufzeit mit esbuild (transitive
 * Vite-Dependency, bereits installiert) und importieren sie als Data-URL —
 * so bleibt die TS-Datei das einzige bearbeitete File für Glossar-Defaults.
 *
 * Admin SDK bypasst die Firestore-Rules (privileged access) — bewusst.
 */
import admin from 'firebase-admin'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'

const PROJECT_ID = 'azsdb-999d6'
const COLLECTION = 'glossar'

// ── Credentials ──────────────────────────────────────────────────────────
let credential
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  credential = admin.credential.applicationDefault()
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
} else {
  console.error('\n❌ Fehler: keine Service-Account-Credentials gefunden.')
  console.error('   Setze GOOGLE_APPLICATION_CREDENTIALS oder FIREBASE_SERVICE_ACCOUNT.\n')
  process.exit(1)
}
admin.initializeApp({ credential, projectId: PROJECT_ID })
const db = getFirestore()

// ── Defaults aus glossar.ts laden ────────────────────────────────────────
async function loadDefaults() {
  const tsSource = await readFile('src/lib/glossar.ts', 'utf8')
  const out = await transform(tsSource, { loader: 'ts', format: 'esm' })
  // Data-URL import — kein temp-File, kein cleanup nötig.
  const url = 'data:text/javascript;base64,' + Buffer.from(out.code).toString('base64')
  const mod = await import(url)
  if (!mod.GLOSSAR || typeof mod.GLOSSAR !== 'object') {
    throw new Error('src/lib/glossar.ts: export `GLOSSAR` fehlt oder ist kein Objekt')
  }
  return mod.GLOSSAR
}

// ── Sync ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Glossar-Sync gestartet · Projekt ${PROJECT_ID}`)

  const defaults = await loadDefaults()
  const defaultCount = Object.keys(defaults).length
  console.log(`  Defaults aus src/lib/glossar.ts geladen: ${defaultCount}`)

  // Existierende Abkürzungen einsammeln
  const snap = await db.collection(COLLECTION).get()
  const existing = new Set()
  for (const d of snap.docs) {
    const abbr = d.data()?.abbreviation
    if (typeof abbr === 'string') existing.add(abbr)
  }
  console.log(`  Bereits in Firestore: ${existing.size}`)

  // Fehlende ermitteln
  const missing = Object.entries(defaults).filter(([abbr]) => !existing.has(abbr))
  if (missing.length === 0) {
    console.log('✅ Nichts zu tun — alle Defaults bereits in Firestore.')
    return
  }
  console.log(`  Fehlend (werden hinzugefügt): ${missing.length}`)
  for (const [abbr] of missing) console.log(`    + ${abbr}`)

  // Batch-Inserts (max 500 / batch)
  let written = 0
  for (let i = 0; i < missing.length; i += 400) {
    const batch = db.batch()
    const chunk = missing.slice(i, i + 400)
    for (const [abbreviation, explanation] of chunk) {
      const ref = db.collection(COLLECTION).doc()
      batch.set(ref, {
        abbreviation,
        explanation,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'sync-defaults-cron',
      })
      written += 1
    }
    await batch.commit()
  }
  console.log(`✅ ${written} Einträge geschrieben.`)
}

main().catch(err => {
  console.error('\n❌ Sync fehlgeschlagen:', err)
  process.exit(1)
})
