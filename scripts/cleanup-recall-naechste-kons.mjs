#!/usr/bin/env node
/**
 * Bereinigt recall_patients:
 * Wenn aufgebotArt leer ist, werden naechsteKons und keinTermin geleert.
 *
 * Ausführen: node scripts/cleanup-recall-naechste-kons.mjs
 *
 * Auth (automatisch):
 *   - Lokal:  Firebase CLI Login  (firebase login)
 *   - CI/SA:  FIREBASE_SERVICE_ACCOUNT env-Variable
 */

import https from 'https'
import http  from 'http'
import fs    from 'fs'
import path  from 'path'
import os    from 'os'
import { createSign } from 'crypto'

const PROJECT_ID = 'azsdb-999d6'
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`

const CLI_CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
const CLI_CLIENT_SECRET = 'j9iVZfS8xyyrHE-Sg5Vhvtov'

// ── HTTP-Hilfsfunktionen ──────────────────────────────────────────────────────

function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = typeof data === 'string' ? data : JSON.stringify(data)
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': typeof data === 'string' ? 'application/x-www-form-urlencoded' : 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.write(body); req.end()
  })
}

function httpFetch(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'Authorization': `Bearer ${token}` } }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }))
      res.on('error', reject)
    }).on('error', reject)
  })
}

function httpPatch(url, data, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.write(body); req.end()
  })
}

// ── Token-Beschaffung ─────────────────────────────────────────────────────────

function b64url(s) {
  return Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getServiceAccountToken(sa) {
  const now = Math.floor(Date.now() / 1000)
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now }))
  const sign = createSign('RSA-SHA256'); sign.update(`${header}.${payload}`)
  const jwt = `${header}.${payload}.${b64url(sign.sign(sa.private_key))}`
  const params = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  const { status, body } = await httpPost('https://oauth2.googleapis.com/token', params.toString())
  if (status !== 200 || !body.access_token) throw new Error('SA-Token-Fehler: ' + JSON.stringify(body))
  return body.access_token
}

async function getAccessToken() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return getServiceAccountToken(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (saPath && fs.existsSync(saPath)) return getServiceAccountToken(JSON.parse(fs.readFileSync(saPath, 'utf8')))

  const cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(cfgPath)) throw new Error('Firebase CLI nicht eingeloggt. Bitte: firebase login')
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  const tokens = cfg?.tokens
  if (!tokens?.refresh_token) throw new Error('Kein Firebase CLI Token. Bitte: firebase login')
  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 60000) return tokens.access_token
  console.log('Refreshe Firebase CLI Token…')
  const params = new URLSearchParams({ client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' })
  const { status, body } = await httpPost('https://oauth2.googleapis.com/token', params.toString())
  if (status !== 200 || !body.access_token) throw new Error('Token-Refresh fehlgeschlagen: ' + JSON.stringify(body))
  tokens.access_token = body.access_token; tokens.expires_at = Date.now() + body.expires_in * 1000
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  return body.access_token
}

// ── Firestore REST API ────────────────────────────────────────────────────────

function fsStr(v)  { return { stringValue: v ?? '' } }
function fsBool(v) { return { booleanValue: !!v } }

function fsRead(field, doc) {
  const f = doc.fields?.[field]
  if (!f) return undefined
  return f.stringValue ?? f.booleanValue ?? f.nullValue ?? undefined
}

async function fsListAll(col, token) {
  const docs = []
  let pageToken = ''
  do {
    const url = `${FS_BASE}/${col}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`
    const { status, body } = await httpFetch(url, token)
    if (status !== 200) throw new Error(`Firestore list ${col}: HTTP ${status}`)
    if (body.documents) docs.push(...body.documents)
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return docs
}

// ── Hauptlogik ────────────────────────────────────────────────────────────────

async function main() {
  console.log('Token wird geholt…')
  const token = await getAccessToken()
  console.log('Token OK.\n')

  const docs = await fsListAll('recall_patients', token)
  console.log(`${docs.length} Patienten geprüft.\n`)

  const toFix = []
  for (const doc of docs) {
    const aufgebotArt  = fsRead('aufgebotArt',  doc) ?? ''
    const naechsteKons = fsRead('naechsteKons', doc) ?? ''
    const keinTermin   = fsRead('keinTermin',   doc) ?? false

    if (!aufgebotArt && (naechsteKons !== '' || keinTermin)) {
      const pid     = fsRead('pid',     doc) ?? doc.name.split('/').pop()
      const vorname = fsRead('vorname', doc) ?? ''
      toFix.push({ name: doc.name, pid, vorname, naechsteKons, keinTermin })
    }
  }

  if (toFix.length === 0) {
    console.log('✓ Keine Einträge zu korrigieren — alles in Ordnung.')
    return
  }

  console.log(`${toFix.length} Eintrag/Einträge zu bereinigen:`)
  for (const p of toFix) {
    const info = [p.naechsteKons && `naechsteKons="${p.naechsteKons}"`, p.keinTermin && `keinTermin=true`].filter(Boolean).join(', ')
    console.log(`  - ${p.vorname || '(kein Name)'} [${p.pid}]  ${info}`)
  }
  console.log()

  let ok = 0, err = 0
  for (const p of toFix) {
    const url = `https://firestore.googleapis.com/v1/${p.name}?updateMask.fieldPaths=naechsteKons&updateMask.fieldPaths=keinTermin`
    const { status } = await httpPatch(url, {
      fields: { naechsteKons: fsStr(''), keinTermin: fsBool(false) }
    }, token)
    if (status === 200) { process.stdout.write('.'); ok++ }
    else               { process.stdout.write('E'); err++ }
  }

  console.log(`\n\n✓ ${ok} bereinigt${err ? `, ${err} Fehler` : ''}.`)
}

main().catch(e => { console.error('\n' + e.message); process.exit(1) })
