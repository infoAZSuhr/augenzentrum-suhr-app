#!/usr/bin/env node
/**
 * BAG Spezialitätenliste updaten
 * Ausführen: node scripts/update-sl.js
 *
 * Lädt die aktuelle Publications.xlsx vom BAG herunter,
 * extrahiert die relevanten Felder und speichert public/sl-data.json.
 * BAG aktualisiert die Liste monatlich (~27. des Monats).
 */

const https = require('https')
const fs    = require('fs')
const path  = require('path')
const os    = require('os')
const xlsx  = require('../node_modules/xlsx')

const SL_URL    = 'https://www.xn--spezialittenliste-yqb.ch/File.axd?file=Publications.xlsx'
// Cloudflare-Worker-Fallback (umgeht Cloudflare/Bot-Block auf CI-IPs).
// Setup-Detail siehe cloudflare-worker/wrangler.toml.
const SL_PROXY  = 'https://azs-zurrose-proxy.zurrose-update.workers.dev/sl-publications.xlsx'
const OUT_FILE  = path.join(__dirname, '..', 'public', 'sl-data.json')
const META_FILE = path.join(__dirname, '..', 'public', 'sl-meta.json')

function download(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Zu viele Redirects'))
    console.log('Downloading', url, '...')
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, redirectCount + 1).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} für ${url}`))
      }
      const chunks = []
      let size = 0
      const contentLength = parseInt(res.headers['content-length'] || '0')
      res.on('data', chunk => {
        chunks.push(chunk)
        size += chunk.length
        if (contentLength > 0) process.stdout.write(`\r  ${Math.round(size / 1024)}KB / ${Math.round(contentLength / 1024)}KB`)
      })
      res.on('end', () => { console.log(''); resolve({ buf: Buffer.concat(chunks), contentLength: size }) })
      res.on('error', reject)
    }).on('error', reject)
  })
}

/** XLSX = ZIP-Container, beginnt mit Magic-Bytes PK (0x50 0x4B).
 *  Plus Sanity-Check Mindestgrösse 500 KB — typisch BAG-SL hat 8+ MB. */
function isValidXLSX(buf) {
  if (!buf || buf.length < 500_000) return false
  return buf[0] === 0x50 && buf[1] === 0x4B
}

/** Playwright-Stealth: BAG ist eine SPA, der "alte" XLSX-URL redirected
 *  zur React-App. Wir starten einen Headless Chrome mit Stealth-Patches,
 *  navigieren zur Publications-Seite, warten bis JS gerendert + Daten
 *  geladen sind, klicken den Excel-Download-Button und fangen das
 *  Download-Event ab.
 *
 *  Stealth-Plugin patcht WebDriver/Headless-Fingerprints (Cloudflare /
 *  BAG-WAF erkennt Headless sonst). Plus Locale + Timezone DE-CH damit
 *  die Page direkt die richtige Sprache rendert.
 */
async function playwrightDownloadSL() {
  let chromium, stealthPlugin
  try {
    ({ chromium } = require('playwright-extra'))
    stealthPlugin = require('puppeteer-extra-plugin-stealth')()
  } catch {
    throw new Error('playwright-extra nicht installiert (siehe Workflow YAML)')
  }
  chromium.use(stealthPlugin)

  console.log('[Stealth] Starte Headless Chromium für BAG-SPA …')
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  })
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale:    'de-CH',
      timezoneId: 'Europe/Zurich',
      viewport: { width: 1920, height: 1080 },
      acceptDownloads: true,
    })
    const page = await ctx.newPage()
    // Aus der JS-Bundle-Route-Config sind die Routen flach (path: 'current-
    // and-archived-data') und scheinen direkt unter / zu liegen — wir
    // probieren beide URLs.
    const candidateUrls = [
      'https://sl.bag.admin.ch/current-and-archived-data',
      'https://sl.bag.admin.ch/sl/current-and-archived-data',
      'https://sl.bag.admin.ch/sl',
    ]
    // Erste URL laden — wenn die Excel-Buttons da nicht da sind,
    // versuchen wir später Navigation via Menü.
    let loaded = false
    let lastGotoErr = null
    for (const url of candidateUrls) {
      try {
        console.log('[Stealth] Lade:', url)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        loaded = true
        // Wait for content + check ob Excel-Buttons da sind. Wenn ja, fertig.
        await page.waitForTimeout(12_000)
        const hasExcel = await page.locator('button:has-text("Als Excel herunterladen")').count() > 0
        if (hasExcel) { console.log(`[Stealth] Excel-Buttons auf URL ${url} gefunden — verbleibe hier`); break }
        console.log(`[Stealth] Keine Excel-Buttons auf ${url} — probiere nächste URL`)
      } catch (e) {
        lastGotoErr = e
        console.warn(`[Stealth] goto failed: ${e?.message ?? e}`)
      }
    }
    if (!loaded) throw new Error(`Keine SPA-URL ladbar — letzter Fehler: ${lastGotoErr?.message ?? lastGotoErr}`)

    // Cookie-Banner / Welcome-Modal schliessen falls vorhanden — sonst
    // überlagern sie den eigentlichen Content und blockieren Click-Events.
    // Mehrere bekannte Button-Texte probieren.
    for (const closeBtn of ['Schliessen', 'Akzeptieren', 'Alle akzeptieren', 'Verstanden', 'Annehmen', 'OK', 'Weiter']) {
      try {
        const btn = page.locator(`button:has-text("${closeBtn}")`).first()
        if (await btn.isVisible({ timeout: 1500 })) {
          console.log(`[Stealth] Modal-Schliessen-Button "${closeBtn}" geklickt`)
          await btn.click({ timeout: 3000 })
          await page.waitForTimeout(1500)
          break
        }
      } catch {}
    }

    // Diagnose nach Modal-Close: jetzt sollten die echten Content-Buttons da sein.
    const buttonTexts = await page.locator('button').allTextContents().catch(() => [])
    const trimmedTexts = buttonTexts.map(t => t.trim()).filter(t => t.length > 0 && t.length < 80)
    console.log(`[Stealth] ${trimmedTexts.length} Buttons im DOM:`,
      trimmedTexts.slice(0, 20).map(t => JSON.stringify(t)).join(', '))
    // Plus: alle Links (manche Downloads sind <a> mit download-Attribut)
    const links = await page.locator('a').evaluateAll(els => els
      .map(el => ({ text: el.textContent?.trim(), href: el.getAttribute('href'), download: el.hasAttribute('download') }))
      .filter(l => l.text && l.text.length > 2 && l.text.length < 80)
      .slice(0, 15)
    ).catch(() => [])
    console.log(`[Stealth] ${links.length} relevante Links:`,
      JSON.stringify(links).slice(0, 800))

    // Aus der BAG-i18n (assets/i18n/de.json):
    //   excel.publicationCard.title       = "Aktueller Datenstamm (SL/GGSL)"
    //   excel.publicationCard.downloadButton = "Als Excel herunterladen"
    //   excel.downloadAllButton           = "Alles herunterladen"
    // "Als Excel herunterladen" kommt mehrfach vor (Datenstamm + Änderungen);
    // wir zielen via Locator-Chain auf den im "Datenstamm"-Card.
    console.log('[Stealth] Warte auf "Als Excel herunterladen"-Button (max 60s) …')

    // Variante 1: scoped via Karte mit Datenstamm-Titel
    // Variante 2: Fallback "Alles herunterladen" — lädt ZIP mit allen Files
    // Variante 3: ersten "Als Excel herunterladen"-Button als letzter Fallback
    let clicked = false
    // Promise mit catch damit ein dangling Promise (z.B. nach allen
    // failing Variants → browser.close) keine UnhandledPromiseRejection
    // triggert die das ganze Node prozessbeenden würde.
    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 }).catch(err => { throw err })
    downloadPromise.catch(() => {})  // silence unhandled rejection — wir await es später falls clicked, sonst ist der Browser zu
    const variants = [
      {
        name: 'Card "Aktueller Datenstamm" > Als Excel herunterladen',
        click: async () => {
          // Card-Container der "Aktueller Datenstamm"-Section
          const card = page.locator('text=/Aktueller Datenstamm/i').first().locator('xpath=ancestor::*[self::div or self::section or self::article][1]')
          await card.waitFor({ state: 'visible', timeout: 30_000 })
          await card.locator('button:has-text("Als Excel herunterladen")').first().click({ timeout: 10_000 })
        },
      },
      {
        name: 'Erster "Als Excel herunterladen"-Button',
        click: async () => {
          await page.locator('button:has-text("Als Excel herunterladen")').first().click({ timeout: 10_000 })
        },
      },
      {
        name: '"Alles herunterladen"-Button (ZIP-Fallback)',
        click: async () => {
          await page.locator('button:has-text("Alles herunterladen")').first().click({ timeout: 10_000 })
        },
      },
    ]
    let lastErr = null
    for (const v of variants) {
      try {
        console.log(`[Stealth] Versuche: ${v.name}`)
        await v.click()
        console.log('[Stealth] Click erfolgreich, warte auf Download …')
        clicked = true
        break
      } catch (e) {
        lastErr = e
        console.log(`[Stealth] Variante fehlgeschlagen: ${e?.message ?? e}`)
      }
    }
    if (!clicked) {
      // Diagnose-Screenshot in der Action-Artifact für visuelle Inspektion
      try { await page.screenshot({ path: '/tmp/bag-sl-fail.png', fullPage: true }) } catch {}
      throw new Error(`Kein Excel-Button klickbar — letzter Fehler: ${lastErr?.message ?? lastErr}`)
    }
    const download = await downloadPromise
    const tmpPath = path.join(os.tmpdir(), `sl-${Date.now()}.xlsx`)
    await download.saveAs(tmpPath)
    const buf = fs.readFileSync(tmpPath)
    try { fs.unlinkSync(tmpPath) } catch {}
    if (!isValidXLSX(buf)) throw new Error(`Stealth: geladene Datei ist kein gültiges XLSX (${buf.length} Bytes)`)
    return { buf, contentLength: buf.length }
  } finally {
    await browser.close().catch(() => {})
  }
}

/** Download mit Validierung. Drei-stufige Fallback-Kette:
 *    1. HTTP-Direct an BAG-URL (geht nicht mehr seit BAG die SPA hat —
 *       liefert nur die SPA-HTML, ZIP-Check schlägt fehl).
 *    2. Cloudflare-Worker-Proxy (auch blockiert weil BAG OAuth verlangt).
 *    3. Playwright-Stealth: Headless Chrome navigiert zur SPA, wartet auf
 *       JS-Render, klickt Excel-Button. Aktuell einziger Pfad der wirklich
 *       Daten bringt. Etwa 30–60s pro Run.
 */
async function downloadValidated() {
  try {
    const r = await download(SL_URL)
    if (isValidXLSX(r.buf)) {
      console.log(`✓ HTTP-Direct: ${Math.round(r.contentLength / 1024)} KB`)
      return r
    }
    console.warn(`⚠ HTTP-Direct lieferte kein gültiges XLSX (${Math.round(r.buf.length / 1024)} KB) — versuche Worker-Proxy`)
  } catch (e) {
    console.warn(`⚠ HTTP-Direct fehlgeschlagen: ${e.message} — versuche Worker-Proxy`)
  }
  try {
    const r = await download(SL_PROXY)
    if (isValidXLSX(r.buf)) {
      console.log(`✓ Worker-Proxy: ${Math.round(r.contentLength / 1024)} KB`)
      return r
    }
    console.warn(`⚠ Worker-Proxy lieferte kein gültiges XLSX (${Math.round(r.buf.length / 1024)} KB) — versuche Playwright-Stealth`)
  } catch (e) {
    console.warn(`⚠ Worker-Proxy fehlgeschlagen: ${e.message} — versuche Playwright-Stealth`)
  }
  // Letzter Pfad: Headless Chrome durch die SPA navigieren (langsam, aber robust).
  const r = await playwrightDownloadSL()
  console.log(`✓ Playwright-Stealth: ${Math.round(r.contentLength / 1024)} KB`)
  return r
}

async function checkForUpdate() {
  return new Promise((resolve) => {
    https.request({ hostname: 'www.xn--spezialittenliste-yqb.ch', path: '/File.axd?file=Publications.xlsx', method: 'HEAD' }, res => {
      resolve(parseInt(res.headers['content-length'] || '0'))
      res.destroy()
    }).on('error', () => resolve(0)).end()
  })
}

async function main() {
  // Bestehende Metadaten lesen
  let existingMeta = null
  if (fs.existsSync(META_FILE)) {
    try { existingMeta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')) } catch {}
  } else if (fs.existsSync(OUT_FILE)) {
    try { existingMeta = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).meta } catch {}
  }

  // Prüfen ob Update vorhanden — HEAD-Request für content-length-Vergleich.
  // ABER: gibt currentSize=0 zurück wenn BAG hinter Cloudflare den HEAD-
  // Request blockt → das ist KEIN Signal für "neue Version", sondern für
  // "konnte nicht prüfen". Vorher hat der Script daraus fälschlich
  // "0 !== 8 MB → neue Version" abgeleitet und massive HTML-Error-Pages
  // gedownloadet die der xlsx-Parser nicht verarbeiten konnte.
  const currentSize = await checkForUpdate()
  console.log(`Aktuelle Dateigrösse BAG: ${Math.round(currentSize / 1024)} KB`)
  if (existingMeta?.sourceSize) {
    console.log(`Gespeicherte Dateigrösse:  ${Math.round(existingMeta.sourceSize / 1024)} KB`)
    if (currentSize === 0) {
      console.log('⚠ HEAD-Request blockiert (Cloudflare?) — kann Update-Status nicht prüfen.')
      if (process.argv.includes('--force')) {
        console.log('  --force gesetzt, lade XLSX trotzdem herunter und prüfe Inhalt.')
      } else {
        console.log('  Skip — kein --force gesetzt. Erzwinge mit `npm run update-sl:force`.')
        return
      }
    } else if (currentSize === existingMeta.sourceSize) {
      console.log('✓ Keine Änderung erkannt – Update nicht nötig.')
      console.log(`  Letzte Aktualisierung: ${existingMeta.extractedAt}`)
      if (process.argv.includes('--force')) {
        console.log('  --force gesetzt, wird trotzdem aktualisiert.')
      } else {
        return
      }
    } else {
      console.log('⚡ Neue Version erkannt! Wird heruntergeladen...')
    }
  }

  // Download mit Validierung (HTTP-Direct → Worker-Proxy Fallback)
  const { buf, contentLength } = await downloadValidated()

  // Parsen
  console.log('Verarbeite Excel...')
  const wb = xlsx.read(buf, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const range = xlsx.utils.decode_range(ws['!ref'])
  const headers = []
  for (let c = 0; c <= range.e.c; c++) {
    const cell = ws[xlsx.utils.encode_cell({ r: 0, c })]
    headers.push(cell ? String(cell.v).trim() : '')
  }
  const ci = name => headers.findIndex(h => h.includes(name))
  const cols = {
    gtin: ci('GTIN'), name: ci('Bezeichnung'), h: ci('Hersteller'),
    s: ci('Substanzen'),
    p: headers.findIndex(h => h.startsWith('Pub-Preis')),
    e: headers.findIndex(h => h.startsWith('Exf-Preis'))
  }
  const get = (r, c) => { const cell = ws[xlsx.utils.encode_cell({ r, c })]; return cell ? String(cell.v).trim() : '' }

  const entries = []
  for (let r = 1; r <= range.e.r; r++) {
    const name = get(r, cols.name)
    if (!name) continue
    const entry = { n: name }
    const g = get(r, cols.gtin); if (g) entry.g = g
    const h = get(r, cols.h);    if (h) entry.h = h
    const s = get(r, cols.s);    if (s) entry.s = s
    const e = get(r, cols.e);    if (e) entry.e = parseFloat(e.replace(',', '.')) || undefined
    const p = get(r, cols.p);    if (p) entry.p = parseFloat(p.replace(',', '.')) || undefined
    entries.push(entry)
  }

  const meta = {
    extractedAt: new Date().toISOString().slice(0, 10),
    sourceSize: contentLength,
    entries: entries.length
  }

  const output = { meta, data: entries }
  fs.writeFileSync(OUT_FILE, JSON.stringify(output))
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))

  console.log(`✓ ${entries.length} Einträge gespeichert → ${OUT_FILE}`)
  console.log(`  Stand: ${meta.extractedAt}`)
  console.log('')
  console.log('Nächster Schritt: App neu deployen')
  console.log('  npm run build && firebase deploy --only hosting')
}

main().catch(e => { console.error('Fehler:', e.message); process.exit(1) })
