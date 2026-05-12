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
const fs = require('fs')
const path = require('path')
const xlsx = require('../node_modules/xlsx')

const SL_URL = 'https://www.xn--spezialittenliste-yqb.ch/File.axd?file=Publications.xlsx'
const OUT_FILE = path.join(__dirname, '..', 'public', 'sl-data.json')
const META_FILE = path.join(__dirname, '..', 'public', 'sl-meta.json')

function download(url) {
  return new Promise((resolve, reject) => {
    console.log('Downloading', url, '...')
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location).then(resolve).catch(reject)
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

  // Prüfen ob Update vorhanden
  const currentSize = await checkForUpdate()
  console.log(`Aktuelle Dateigrösse BAG: ${Math.round(currentSize / 1024)} KB`)
  if (existingMeta?.sourceSize) {
    console.log(`Gespeicherte Dateigrösse:  ${Math.round(existingMeta.sourceSize / 1024)} KB`)
    if (currentSize === existingMeta.sourceSize) {
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

  // Download
  const { buf, contentLength } = await download(SL_URL)
  console.log(`Heruntergeladen: ${Math.round(contentLength / 1024)} KB`)

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
