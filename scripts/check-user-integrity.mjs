/**
 * Taegliche Integritaets-Pruefung der `users`-Collection: erkennt, wenn ein
 * frueher freigeschaltetes Konto stillschweigend auf role='gast' +
 * status='pending' zurueckfaellt (Firestore-Profil wurde geloescht und von
 * der App-Selbstheilung — src/lib/AuthContext.tsx — neu angelegt).
 * Hintergrund: passierte am 2026-07-09 bei zwei Konten (Ursache ungeklaert,
 * Firestore Data-Access-Audit-Logs seither aktiv). Dieses Skript soll einen
 * erneuten Vorfall SOFORT erkennen statt erst wenn sich jemand nicht
 * einloggen kann.
 *
 * Ablauf:
 *   - Baseline-Datei (users-baseline.json, im selben Ordner) haelt den
 *     zuletzt bekannten guten Zustand aller Konten (uid -> username/role/status).
 *   - Bei jedem Lauf: aktuellen Firestore-Zustand lesen, mit Baseline
 *     vergleichen. Faellt ein Konto auf gast+pending zurueck, obwohl die
 *     Baseline etwas anderes zeigte -> Alarm (Log + error_log-Eintrag).
 *   - Baseline wird danach IMMER auf den aktuellen (evtl. alarmierten)
 *     Zustand aktualisiert, damit derselbe Vorfall nicht taeglich erneut
 *     meldet, sondern nur beim UEBERGANG approved->pending/gast.
 *
 * Credentials: identisch zu backup-firestore.mjs (Firebase-CLI-Login).
 */
import admin from 'firebase-admin'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PROJECT_ID = 'azsdb-999d6'
const BASELINE_PATH = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'users-baseline.json')

const FIREBASE_CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'

function prepareCliAdcFile() {
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
  prepareCliAdcFile()
  credential = admin.credential.applicationDefault()
}
admin.initializeApp({ credential, projectId: PROJECT_ID })
const db = getFirestore()

const snap = await db.collection('users').get()
const current = {}
for (const d of snap.docs) {
  const u = d.data()
  current[d.id] = { username: u.username ?? '', role: u.role ?? '', status: u.status ?? '' }
}

let baseline = {}
if (existsSync(BASELINE_PATH)) {
  try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) } catch { /* Baseline korrupt -> wie leer behandeln */ }
}

const incidents = []
for (const [uid, u] of Object.entries(current)) {
  const prev = baseline[uid]
  const isSuspicious = u.role === 'gast' && u.status === 'pending'
  const wasFine = prev && !(prev.role === 'gast' && prev.status === 'pending')
  if (isSuspicious && (wasFine || !prev)) {
    incidents.push({ uid, vorher: prev ?? '(unbekannt/neu)', jetzt: u })
  }
}

if (incidents.length) {
  console.log(`⚠ ${incidents.length} Konto(en) unerwartet auf gast+pending zurueckgefallen:`)
  for (const i of incidents) {
    console.log(`  - ${i.uid} | vorher: ${JSON.stringify(i.vorher)} | jetzt: ${JSON.stringify(i.jetzt)}`)
  }
  await db.collection('error_log').add({
    at: admin.firestore.FieldValue.serverTimestamp(),
    context: 'user-integrity-check',
    message: `${incidents.length} Konto(en) unerwartet auf gast+pending zurueckgefallen — Profil vermutlich geloescht+selbstgeheilt.`,
    incidents,
  })
  console.log('-> error_log-Eintrag geschrieben.')
} else {
  console.log('OK — keine Auffaelligkeiten.')
}

writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2), 'utf8')
process.exit(incidents.length ? 1 : 0)
