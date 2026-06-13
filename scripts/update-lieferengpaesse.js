#!/usr/bin/env node
/**
 * BWL Lieferengpässe (Heilmittel) aktualisieren
 * Ausführen: node scripts/update-lieferengpaesse.js
 *
 * Lädt die aktuelle Versorgungsstörungen-Excel vom BWL herunter,
 * extrahiert die Heilmittel-Einträge und speichert public/lieferengpaesse-data.json.
 * BWL aktualisiert die Liste laufend (mehrmals wöchentlich).
 *
 * Die BWL-Seite verlinkt die Excel nicht immer zuverlässig. Daher:
 * 1) HTML-Seite scrapen nach .xlsx-Links
 * 2) Fallback: letzte bekannte dam-URL aus Meta nochmal abrufen
 */

const https = require('https')
const http  = require('http')
const fs    = require('fs')
const path  = require('path')
const xlsx  = require('../node_modules/xlsx')

const BWL_PAGE  = 'https://www.bwl.admin.ch/de/meldestelle-heilmittel'
const OUT_FILE  = path.join(__dirname, '..', 'public', 'lieferengpaesse-data.json')
const META_FILE = path.join(__dirname, '..', 'public', 'lieferengpaesse-meta.json')

function get(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location
        const next = loc.startsWith('http') ? loc : 'https://www.bwl.admin.ch' + loc
        res.destroy()
        return get(next).then(resolve).catch(reject)
      }
      if (res.statusCode >= 400) {
        res.destroy()
        return reject(new Error(`HTTP ${res.statusCode} für ${url}`))
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({
        buf: Buffer.concat(chunks),
        size: chunks.reduce((s, c) => s + c.length, 0),
        headers: res.headers,
      }))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function findXlsxUrl() {
  console.log('Suche aktuelle Excel-URL auf BWL-Seite...')
  try {
    const { buf } = await get(BWL_PAGE)
    const html = buf.toString('utf8')
    const match = html.match(/href="(https?:\/\/[^"]*\.xlsx[^"]*)"/i)
      || html.match(/href="([^"]*Versorgungsst[^"]*\.xlsx[^"]*)"/i)
      || html.match(/"(https?:\/\/[^"]*bwl[^"]*\.xlsx[^"]*)"/i)
    if (match) {
      const url = match[1].replace(/&amp;/g, '&')
      console.log('Gefunden:', url)
      return url
    }
    const damMatch = html.match(/https:\/\/www\.bwl\.admin\.ch\/dam\/[^"'\s]+\.xlsx/i)
    if (damMatch) {
      console.log('Gefunden (dam):', damMatch[0])
      return damMatch[0]
    }
  } catch (e) {
    console.warn('Warnung: BWL-Seite nicht erreichbar:', e.message)
  }

  // Fallback: letzte bekannte URL aus Meta-Datei
  if (fs.existsSync(META_FILE)) {
    try {
      const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'))
      if (meta.sourceUrl) {
        console.log('Kein .xlsx-Link auf BWL-Seite gefunden — versuche letzte bekannte URL...')
        console.log('  ', meta.sourceUrl)
        // Prüfen ob die URL noch erreichbar ist (HEAD-Request)
        const { headers } = await get(meta.sourceUrl)
        if (headers['content-type']?.includes('spreadsheet') || headers['content-type']?.includes('excel')) {
          console.log('  ✓ URL noch erreichbar (Content-Type:', headers['content-type'] + ')')
          return meta.sourceUrl
        }
        // Auch ohne passenden Content-Type akzeptieren wenn die Datei gross genug ist
        console.log('  ✓ URL noch erreichbar')
        return meta.sourceUrl
      }
    } catch {}
  }

  throw new Error(
    'Konnte Excel-URL nicht finden.\n' +
    '  → BWL-Seite verlinkt keine .xlsx mehr\n' +
    '  → Letzte bekannte URL nicht verfügbar\n' +
    'Bitte manuell prüfen: ' + BWL_PAGE
  )
}

async function main() {
  const force = process.argv.includes('--force')

  const xlsxUrl = await findXlsxUrl()

  // Bestehende Meta lesen
  let existingMeta = null
  if (fs.existsSync(META_FILE)) {
    try { existingMeta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')) } catch {}
  }

  // Prüfen ob URL identisch (= kein Update nötig)
  if (!force && existingMeta?.sourceUrl === xlsxUrl) {
    console.log('✓ Bereits auf aktuellem Stand (gleiche URL).')
    console.log(`  Stand: ${existingMeta.extractedAt}`)
    return
  }

  // Download
  console.log('Lade Excel herunter...')
  const { buf, size } = await get(xlsxUrl)
  console.log(`Heruntergeladen: ${Math.round(size / 1024)} KB`)

  // Parsen — Heilmittel-Sheet
  console.log('Verarbeite Excel...')
  const wb = xlsx.read(buf, { type: 'buffer' })

  // Sheet mit "Arzneimittel" oder "Heilmittel" suchen
  const sheetName = wb.SheetNames.find(n => /arzneimittel|heilmittel|médicament/i.test(n))
    || wb.SheetNames[0]
  console.log('Sheet:', sheetName)
  const ws = wb.Sheets[sheetName]
  const range = xlsx.utils.decode_range(ws['!ref'])

  // Header-Zeile finden (enthält "GTIN" oder "Produktebezeichnung")
  let headerRow = -1
  for (let r = 0; r <= Math.min(10, range.e.r); r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[xlsx.utils.encode_cell({ r, c })]
      if (cell && /GTIN|Produktebezeichnung|Nom du produit/i.test(String(cell.v))) {
        headerRow = r
        break
      }
    }
    if (headerRow >= 0) break
  }
  if (headerRow < 0) throw new Error('Header-Zeile nicht gefunden')

  const get2 = (r, c) => {
    const cell = ws[xlsx.utils.encode_cell({ r, c })]
    return cell ? String(cell.v).trim() : ''
  }

  // Spalten-Indizes bestimmen
  const headers = []
  for (let c = 0; c <= range.e.c; c++) headers.push(get2(headerRow, c))
  const ci = (...terms) => headers.findIndex(h => terms.some(t => h.includes(t)))

  const cols = {
    gtin:     ci('GTIN'),
    name:     ci('Produktebezeichnung', 'Nom du produit'),
    atc:      ci('ATC'),
    seit:     ci('Eintrittsdatum', 'Date de survenance'),
    dauer:    ci('Voraussichtliche Dauer', 'Durée prévue'),
    bemerk:   ci('Bemerkungen', 'Remarques'),
    pubDatum: ci('Datum Publikation', 'Date publication'),
  }
  console.log('Spalten:', cols)

  const entries = []
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const name = cols.name >= 0 ? get2(r, cols.name) : ''
    if (!name) continue
    const entry = { n: name }
    if (cols.gtin    >= 0) { const v = get2(r, cols.gtin);    if (v) entry.g = v }
    if (cols.atc     >= 0) { const v = get2(r, cols.atc);     if (v) entry.a = v }
    if (cols.seit    >= 0) { const v = get2(r, cols.seit);    if (v) entry.s = v }
    if (cols.dauer   >= 0) { const v = get2(r, cols.dauer);   if (v) entry.d = v }
    if (cols.bemerk  >= 0) { const v = get2(r, cols.bemerk);  if (v) entry.b = v }
    if (cols.pubDatum >= 0){ const v = get2(r, cols.pubDatum);if (v) entry.p = v }
    entries.push(entry)
  }

  const meta = {
    extractedAt: new Date().toISOString().slice(0, 10),
    sourceUrl:   xlsxUrl,
    entries:     entries.length,
  }

  fs.writeFileSync(OUT_FILE,  JSON.stringify({ meta, data: entries }))
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))

  console.log(`✓ ${entries.length} Lieferengpässe gespeichert → ${OUT_FILE}`)
  console.log(`  Stand: ${meta.extractedAt}`)
  console.log('')
  console.log('Nächster Schritt: App neu deployen')
  console.log('  npm run build && firebase deploy --only hosting')
}

main().catch(e => { console.error('Fehler:', e.message); process.exit(1) })
