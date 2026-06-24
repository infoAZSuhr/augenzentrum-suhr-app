#!/usr/bin/env node
/**
 * Zur Rose Nota-Liste aktualisieren + Firestore-Sync
 * Ausführen: node scripts/update-zurrose.js
 *
 * 1. Lädt die aktuelle Nota-Liste von Zur Rose herunter
 * 2. Matched Artikel aus Firestore und schreibt zurRoseNota/zurRoseNotaDetail direkt
 * 3. Speichert public/zurrose-nota-meta.json (für den Stand-Banner)
 *
 * Authentifizierung: Firebase CLI Login (~/.config/configstore/firebase-tools.json)
 * Kein Service Account nötig — nutzt bestehenden firebase login.
 */

const https  = require('https')
const http   = require('http')
const fs     = require('fs')
const path   = require('path')
const os     = require('os')
const xlsx   = require('../node_modules/xlsx')

const XLSX_URL        = 'https://www.zurrose.ch/sites/default/files/media/downloads/Nota-Liste.xlsx'
const XLSX_LOCAL_COPY = path.join(__dirname, 'Nota-Liste.xlsx')   // lokale Kopie im Repo
const META_FILE       = path.join(__dirname, '..', 'public', 'zurrose-nota-meta.json')
const PROJECT_ID = 'azsdb-999d6'
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`

// Firebase CLI OAuth2-Credentials (öffentlich, aus Firebase CLI Quellcode)
const CLI_CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
const CLI_CLIENT_SECRET = 'j9iVZfS8xyyrHE-Sg5Vhvtov'

// ── Browser-basierter Download (mit Cloudflare-Bypass) ───────────────────────
//
// Zur Rose ist hinter Cloudflare. Einfache HTTP-Requests von GitHub-Actions-IPs
// werden 403/blockiert. Wir versuchen zwei Browser-Strategien:
//
//  1. STEALTH (preferred): playwright-extra + puppeteer-extra-plugin-stealth
//     patcht alle WebDriver/Headless-Fingerprints, die Cloudflare zur Bot-
//     Erkennung nutzt. Download via echter Browser-Navigation + 'download'-
//     Event — für Cloudflare nicht von einem User unterscheidbar.
//
//  2. PLAIN-PLAYWRIGHT (legacy fallback): wie vorher, ohne Stealth. Bleibt
//     drin falls playwright-extra mal Probleme macht — manchmal ist plain
//     gut genug.
//
// Beide laden im headless Mode mit deutschem Locale + Zurich-Timezone und
// machen vorher einen Warm-up-Besuch auf zurrose.ch, damit Cloudflare-
// Cookies gesetzt sind.

async function stealthDownload(url) {
  let chromium, stealthPlugin
  try {
    ({ chromium } = require('playwright-extra'))
    stealthPlugin = require('puppeteer-extra-plugin-stealth')()
  } catch {
    throw new Error('playwright-extra nicht installiert — siehe Workflow YAML')
  }
  chromium.use(stealthPlugin)

  console.log('[Stealth] Starte stealthed Chromium …')
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  })

  // Hilfs-Funktion: download-Event abwarten + Buffer zurückgeben
  async function captureDownload(page, navUrl) {
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    page.goto(navUrl).catch(() => {})   // Navigation triggert Download — goto wird 'cancelled'
    const download = await downloadPromise
    const tmpPath = path.join(os.tmpdir(), `nota-${Date.now()}.xlsx`)
    await download.saveAs(tmpPath)
    const buf = fs.readFileSync(tmpPath)
    try { fs.unlinkSync(tmpPath) } catch {}
    if (buf[0] !== 0x50 || buf[1] !== 0x4B) {
      throw new Error(`keine XLSX (${buf.length} Bytes)`)
    }
    return buf
  }

  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'de-CH',
      viewport: { width: 1920, height: 1080 },
      timezoneId: 'Europe/Zurich',
      acceptDownloads: true,
    })
    const page = await ctx.newPage()

    // VERSUCH 1: Direkt-Download ohne Warm-up. Cloudflare lässt manchmal
    // statische File-Requests durch ohne Challenge.
    try {
      console.log('[Stealth] Direkt-Download (ohne Warm-up) …')
      const buf = await captureDownload(page, url)
      console.log(`[Stealth] ✓ Direkt: ${Math.round(buf.length / 1024)} KB`)
      return buf
    } catch (directErr) {
      console.warn(`[Stealth] Direkt fehlgeschlagen: ${directErr.message}`)
    }

    // VERSUCH 2: Warm-up mit domcontentloaded (NICHT networkidle — Cloudflare
    // hält Verbindungen offen → networkidle würde immer ins Timeout laufen).
    // Danach 10s warten für JS-Challenge, dann erneut versuchen.
    console.log('[Stealth] Warm-up: zurrose.ch (domcontentloaded) …')
    await page.goto('https://www.zurrose.ch/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(10_000)
    console.log('[Stealth] Download nach Warm-up …')
    const buf = await captureDownload(page, url)
    console.log(`[Stealth] ✓ Nach-Warm-up: ${Math.round(buf.length / 1024)} KB`)
    return buf
  } finally {
    await browser.close().catch(() => {})
  }
}

async function playwrightDownload(url) {
  let playwright
  try {
    playwright = require('playwright')
  } catch {
    throw new Error('Playwright nicht installiert — `npm install playwright` und `npx playwright install chromium`')
  }
  console.log('[Playwright] Starte headless Chromium …')
  const browser = await playwright.chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'de-CH',
      viewport: { width: 1280, height: 800 },
    })
    const page = await ctx.newPage()
    console.log('[Playwright] Warm-up: lade zurrose.ch …')
    await page.goto('https://www.zurrose.ch/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(2000)
    console.log('[Playwright] Lade XLSX:', url)
    const response = await ctx.request.get(url, {
      headers: {
        'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
        'Referer': 'https://www.zurrose.ch/',
      },
      timeout: 30_000,
    })
    if (response.status() !== 200) {
      throw new Error(`Playwright HTTP ${response.status()} für ${url}`)
    }
    const buf = Buffer.from(await response.body())
    if (buf[0] !== 0x50 || buf[1] !== 0x4B) {
      const preview = buf.slice(0, 200).toString('utf8')
      throw new Error(`Playwright: keine XLSX-Datei (${buf.length} Bytes). Anfang: ${preview}`)
    }
    return buf
  } finally {
    await browser.close().catch(() => {})
  }
}

// ── HTTP-Hilfsfunktionen ──────────────────────────────────────────────────────

function httpGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
      'Accept-Language': 'de-CH,de;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Referer': 'https://www.zurrose.ch/',
      ...extraHeaders,
    }
    mod.get(url, { headers }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        res.destroy()
        const location = res.headers.location
        return httpGet(location.startsWith('http') ? location : new URL(location, url).href).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        res.destroy()
        return reject(new Error(`HTTP ${res.statusCode} für ${url}`))
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        // Sicherheitscheck: Excel-Dateien beginnen mit PK (ZIP-Magic-Bytes 50 4B)
        if (buf[0] === 0x50 && buf[1] === 0x4B) return resolve(buf)
        // Möglicherweise HTML-Fehlerseite zurückgegeben
        const preview = buf.slice(0, 200).toString('utf8')
        return reject(new Error(`Keine XLSX-Datei erhalten (${buf.length} Bytes). Anfang: ${preview}`))
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = typeof data === 'string' ? data : JSON.stringify(data)
    const u = new URL(url)
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': typeof data === 'string' ? 'application/x-www-form-urlencoded' : 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function httpPatch(url, data, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const u = new URL(url)
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => { const r = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, body: r }) })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.write(body)
    req.end()
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

// ── Token-Beschaffung: Service Account (CI) oder Firebase CLI (lokal) ─────────

const { createSign } = require('crypto')

function b64url(s) {
  return Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getServiceAccountToken(sa) {
  const now = Math.floor(Date.now() / 1000)
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  }))
  const sign = createSign('RSA-SHA256')
  sign.update(`${header}.${payload}`)
  const jwt = `${header}.${payload}.${b64url(sign.sign(sa.private_key))}`

  const params = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  const { status, body } = await httpPost('https://oauth2.googleapis.com/token', params.toString())
  if (status !== 200 || !body.access_token) throw new Error('Service-Account-Token-Fehler: ' + JSON.stringify(body))
  return body.access_token
}

async function getAccessToken() {
  // CI: Service Account JSON als Umgebungsvariable (GitHub Secret)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    return getServiceAccountToken(sa)
  }
  // CI: Service Account JSON als Datei (GOOGLE_APPLICATION_CREDENTIALS)
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (saPath && fs.existsSync(saPath)) {
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'))
    return getServiceAccountToken(sa)
  }

  // Lokal: Firebase CLI Token
  const cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(cfgPath)) throw new Error('Firebase CLI nicht eingeloggt. Bitte: firebase login')
  const cfg    = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  const tokens = cfg?.tokens
  if (!tokens?.refresh_token) throw new Error('Kein Firebase CLI Token gefunden. Bitte: firebase login')

  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 60000)
    return tokens.access_token

  console.log('Refreshe Firebase CLI Token...')
  const params = new URLSearchParams({
    client_id:     CLI_CLIENT_ID,
    client_secret: CLI_CLIENT_SECRET,
    refresh_token: tokens.refresh_token,
    grant_type:    'refresh_token',
  })
  const { status, body } = await httpPost('https://oauth2.googleapis.com/token', params.toString())
  if (status !== 200 || !body.access_token) throw new Error('Token-Refresh fehlgeschlagen: ' + JSON.stringify(body))
  tokens.access_token = body.access_token
  tokens.expires_at   = Date.now() + body.expires_in * 1000
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  return body.access_token
}

// ── Firestore REST API ────────────────────────────────────────────────────────

function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number')  return { integerValue: String(v) }
  return { stringValue: String(v) }
}

async function fsListAll(collection, token) {
  const docs = []
  let pageToken = ''
  do {
    const url = `${FS_BASE}/${collection}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`
    const { status, body } = await httpFetch(url, token)
    if (status !== 200) throw new Error(`Firestore Lesefehler ${status}: ${JSON.stringify(body)}`)
    if (body.documents) docs.push(...body.documents)
    pageToken = body.nextPageToken || ''
  } while (pageToken)
  return docs
}

async function fsUpdate(collection, docId, fields, token) {
  const fieldPaths = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&')
  const url = `${FS_BASE}/${collection}/${docId}?${fieldPaths}`
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fsValue(v)])) }
  const { status } = await httpPatch(url, body, token)
  if (status !== 200) throw new Error(`Firestore Update-Fehler ${status} für ${docId}`)
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function excelDateToISO(serial) {
  if (typeof serial !== 'number') return String(serial).trim()
  return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString().slice(0, 10)
}

function safeName(n) {
  try { return decodeURIComponent(n).toLowerCase() } catch { return n.toLowerCase() }
}

function getField(doc, field) {
  const f = doc.fields?.[field]
  if (!f) return undefined
  return f.booleanValue ?? f.stringValue ?? f.integerValue ?? f.nullValue
}

// ── Hauptlogik ────────────────────────────────────────────────────────────────

async function main() {
  const force = process.argv.includes('--force')

  if (!force && fs.existsSync(META_FILE)) {
    try {
      const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'))
      if ((Date.now() - new Date(meta.extractedAt).getTime()) / 86400000 < 1) {
        console.log(`✓ Bereits heute aktualisiert (Stand: ${meta.stand} · ${meta.entries} Einträge).`)
        return
      }
    } catch {}
  }

  // ── 1. Excel laden ────────────────────────────────────────────────────────
  // Priorität: 1. ZURROSE_XLSX_PATH env  2. einfacher HTTP-Download
  //            3. Playwright (umgeht Cloudflare)  4. lokale Repo-Kopie
  let buf
  let downloadStrategy = 'unknown'
  const xlsxPath = process.env.ZURROSE_XLSX_PATH
  if (xlsxPath && fs.existsSync(xlsxPath)) {
    buf = fs.readFileSync(xlsxPath)
    downloadStrategy = 'env-path'
    console.log(`Lese Datei von ZURROSE_XLSX_PATH: ${xlsxPath} (${Math.round(buf.length / 1024)} KB)`)
  } else {
    // Fallback-Kette: HTTP → Stealth → Plain-Playwright → Local-Repo-Kopie.
    // Jede Strategie ist langsamer/schwerer als die vorherige, aber dafür
    // robuster gegen Cloudflare. Stealth ist seit dem Wechsel der primäre
    // Pfad (Plain-Playwright wird inzwischen oft 403'd).
    try {
      console.log('Lade Zur Rose Nota-Liste herunter (HTTP)…')
      buf = await httpGet(XLSX_URL)
      downloadStrategy = 'http'
      console.log(`✓ HTTP: ${Math.round(buf.length / 1024)} KB`)
    } catch (httpErr) {
      console.warn(`⚠ HTTP-Download fehlgeschlagen: ${httpErr.message}`)
      try {
        buf = await stealthDownload(XLSX_URL)
        downloadStrategy = 'stealth'
        console.log(`✓ Stealth: ${Math.round(buf.length / 1024)} KB`)
      } catch (stErr) {
        console.warn(`⚠ Stealth-Download fehlgeschlagen: ${stErr.message}`)
        try {
          buf = await playwrightDownload(XLSX_URL)
          downloadStrategy = 'playwright'
          console.log(`✓ Plain-Playwright: ${Math.round(buf.length / 1024)} KB`)
        } catch (pwErr) {
          console.warn(`⚠ Plain-Playwright fehlgeschlagen: ${pwErr.message}`)
          if (fs.existsSync(XLSX_LOCAL_COPY)) {
            buf = fs.readFileSync(XLSX_LOCAL_COPY)
            downloadStrategy = 'local-fallback'
            console.warn(`⚠ Verwende veraltete lokale Repo-Kopie: ${XLSX_LOCAL_COPY} (${Math.round(buf.length / 1024)} KB)`)
            console.warn('  Alle drei Online-Strategien fehlgeschlagen — Cloudflare-Setup hat sich evtl. geändert.')
          } else {
            throw new Error('Kein XLSX verfügbar: HTTP, Stealth & Plain-Playwright fehlgeschlagen, keine lokale Kopie vorhanden.')
          }
        }
      }
    }
    // Bei erfolgreichem Online-Download die lokale Kopie als Backup aktualisieren
    if (downloadStrategy === 'http' || downloadStrategy === 'stealth' || downloadStrategy === 'playwright') {
      fs.writeFileSync(XLSX_LOCAL_COPY, buf)
      console.log(`Lokale Kopie aktualisiert: ${XLSX_LOCAL_COPY}`)
    }
  }
  console.log(`Download-Strategie: ${downloadStrategy}`)

  // ── 2. Excel parsen ───────────────────────────────────────────────────────
  const wb   = xlsx.read(buf, { type: 'buffer' })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' })

  const standRaw = String(rows[1]?.[0] || '').replace(/stand:\s*/i, '').trim()
  const notaEntries = []
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i]; const name = String(r[1] || '').trim(); if (!name) continue
    const pc = r[0]
    const entry = { pc: typeof pc === 'number' ? pc : (parseInt(pc) || 0), n: name }
    if (r[2] !== '') entry.d = excelDateToISO(r[2])
    notaEntries.push(entry)
  }
  console.log(`${notaEntries.length} Einträge (Stand: ${standRaw})`)

  // ── 3. Token holen ────────────────────────────────────────────────────────
  const token = await getAccessToken()

  // ── 4. Alle Artikel aus Firestore lesen ───────────────────────────────────
  console.log('Lese Artikel aus Firestore...')
  const fsDocs = await fsListAll('inventory_articles', token)
  const articles = fsDocs.filter(d => getField(d, 'isActive') !== false)
  console.log(`${articles.length} aktive Artikel gefunden`)

  // ── 5. Matching + Updates ─────────────────────────────────────────────────
  let matched = 0, cleared = 0
  const updates = []

  for (const doc of articles) {
    const docId    = doc.name.split('/').pop()
    const artName  = safeName(String(getField(doc, 'name') || ''))
    const artNr    = String(getField(doc, 'articleNumber') || '')
    const wasNota  = getField(doc, 'zurRoseNota') === true

    let entry = undefined

    // 1. Pharmacode (articleNumber)
    if (artNr) {
      const pc = parseInt(artNr.trim())
      if (!isNaN(pc)) entry = notaEntries.find(e => e.pc === pc)
    }

    // 2. Name (bidirektionales Präfix-Matching)
    if (!entry) {
      const artFirst = artName.split(/[\s%]/)[0]
      entry = notaEntries.find(e => {
        const zrFirst = e.n.split(/\s/)[0].toLowerCase()
        return zrFirst.length > 3 && (artFirst.startsWith(zrFirst) || zrFirst.startsWith(artFirst))
      })
    }

    if (entry) {
      const d = entry.d
      const detail = d
        ? (d.startsWith('fehlt') ? 'Auf unbestimmte Zeit' : `Ausstand bis ${new Date(d).toLocaleDateString('de-CH')}`)
        : 'Nicht lieferbar (Zur Rose)'
      const oldDetail = String(getField(doc, 'zurRoseNotaDetail') || '')
      if (!wasNota || oldDetail !== detail) {
        updates.push({ docId, fields: { zurRoseNota: true, zurRoseNotaDetail: detail, zurRoseNotaUpdatedAt: new Date().toISOString() } })
        matched++
      }
    } else if (wasNota) {
      updates.push({ docId, fields: { zurRoseNota: false, zurRoseNotaDetail: null, zurRoseNotaUpdatedAt: null } })
      cleared++
    }
  }

  // Sequentiell um Rate-Limits zu vermeiden
  if (updates.length > 0) {
    process.stdout.write(`Aktualisiere ${updates.length} Artikel in Firestore`)
    for (let i = 0; i < updates.length; i++) {
      const { docId, fields } = updates[i]
      await fsUpdate('inventory_articles', docId, fields, token)
      if ((i + 1) % 10 === 0) process.stdout.write('.')
    }
    console.log(' ✓')
  }

  console.log(`✓ ${matched} Artikel als "nicht lieferbar" markiert, ${cleared} zurückgesetzt`)

  // ── 6. Meta-Datei speichern ───────────────────────────────────────────────
  // Wichtig: wenn nur local-fallback genutzt wurde UND die Quellen-XLSX seit
  // dem letzten Run unverändert ist, schreiben wir die Meta NICHT neu. Sonst
  // committet der Workflow täglich ein Meta-Update mit neuem extractedAt —
  // sieht aus, als wären die Daten frisch, in Wahrheit sind sie alt.
  let existingMeta = null
  if (fs.existsSync(META_FILE)) {
    try { existingMeta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')) } catch {}
  }
  const contentUnchanged = existingMeta
    && existingMeta.stand === standRaw
    && existingMeta.entries === notaEntries.length
  if (downloadStrategy === 'local-fallback' && contentUnchanged) {
    console.log('')
    console.log('::warning::Zur Rose Nota-Liste: HTTP + Playwright fehlgeschlagen, lokale Fallback-XLSX unverändert.')
    console.log('::warning::Meta NICHT aktualisiert — Stand bleibt ' + (existingMeta?.stand ?? '?') + '.')
    console.log('::warning::Fix: scripts/Nota-Liste.xlsx von zurrose.ch nachpflegen ODER Playwright-Pfad reparieren.')
    return
  }
  const meta = { extractedAt: new Date().toISOString().slice(0, 10), stand: standRaw, entries: notaEntries.length }
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  console.log(`✓ Meta gespeichert → public/zurrose-nota-meta.json`)
  if (downloadStrategy === 'local-fallback') {
    console.log('::warning::Zur Rose: nur local-fallback verfügbar, aber Inhalt hat sich geändert — committet.')
  }
  console.log('')
  console.log('Nächster Schritt: App neu deployen')
  console.log('  npm run build && firebase deploy --only hosting --project azsdb-999d6')
}

main().catch(e => { console.error('\n✗ Fehler:', e.message); process.exit(1) })
