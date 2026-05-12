#!/usr/bin/env node
/**
 * Refdata Artikelstamm updaten
 * Ausführen: node scripts/update-refdata.js
 *
 * Lädt Refdata.Articles.zip herunter (täglich aktualisiert, kein Login nötig),
 * entpackt die ZIP-Datei, extrahiert relevante Felder und speichert
 * public/refdata-data.json + public/refdata-meta.json.
 * Enthält alle in der Schweiz zugelassenen Humanarzneimittel (~17'000).
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const REFDATA_URL = 'https://files.refdata.ch/simis-public-prod/Articles/1.0/Refdata.Articles.zip'
const OUT_FILE = path.join(__dirname, '..', 'public', 'refdata-data.json')
const META_FILE = path.join(__dirname, '..', 'public', 'refdata-meta.json')

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
    const u = new URL(REFDATA_URL)
    https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'HEAD' }, res => {
      resolve(parseInt(res.headers['content-length'] || '0'))
      res.destroy()
    }).on('error', () => resolve(0)).end()
  })
}

function extractZip(buf) {
  // Minimaler ZIP-Extraktor: liest ersten Dateieintrag (Local File Header)
  if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    throw new Error('Kein gültiges ZIP-Format')
  }
  const method = buf.readUInt16LE(8)
  const compressedSize = buf.readUInt32LE(18)
  const filenameLen = buf.readUInt16LE(26)
  const extraLen = buf.readUInt16LE(28)
  const dataStart = 30 + filenameLen + extraLen
  const data = buf.slice(dataStart, dataStart + compressedSize)
  if (method === 0) return data                    // stored
  if (method === 8) return zlib.inflateRawSync(data) // deflate
  throw new Error(`Nicht unterstützte ZIP-Kompressionsmethode: ${method}`)
}

function tag(str, name) {
  const m = str.match(new RegExp(`<${name}>([^<]*)</${name}>`))
  return m ? m[1].trim() : ''
}

function parseXml(xmlStr) {
  const today = new Date().toISOString().slice(0, 10)
  const entries = []

  const parts = xmlStr.split('<Article>')
  for (let i = 1; i < parts.length; i++) {
    const art = parts[i]

    // Nur Humanarzneimittel
    const domain = tag(art, 'Domain')
    if (domain && domain !== 'Human') continue

    // Abgelaufene Produkte überspringen
    const dateStopM = art.match(/<DateStop>([^<]+)<\/DateStop>/)
    if (dateStopM && dateStopM[1] <= today) continue

    // GTIN
    const gtin = tag(art, 'DataCarrierIdentifier')
    if (!gtin) continue

    // Deutscher Name
    let name = ''
    for (const block of art.matchAll(/<Name>([\s\S]*?)<\/Name>/g)) {
      if (block[1].includes('<Language>DE</Language>')) {
        const fnM = block[1].match(/<FullName>([^<]+)<\/FullName>/)
        if (fnM) { name = fnM[1].trim(); break }
      }
    }
    if (!name) continue

    // Zulassungsinhaber
    const holderM = art.match(/<Holder>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?<\/Holder>/)
    const h = holderM ? holderM[1].trim() : ''

    // ATC-Code
    const a = tag(art, 'Atc')

    // Abgabekategorie (A, B, C, D, E)
    const l = tag(art, 'LegalStatusOfSupply')

    // Publikumspreis
    const priceStr = tag(art, 'RetailPrice')
    const p = priceStr ? parseFloat(priceStr) : undefined

    const entry = { g: gtin, n: name }
    if (h) entry.h = h
    if (a) entry.a = a
    if (l) entry.l = l
    if (p) entry.p = p

    entries.push(entry)
  }

  return entries
}

async function main() {
  // Bestehende Metadaten lesen
  let existingMeta = null
  if (fs.existsSync(META_FILE)) {
    try { existingMeta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')) } catch {}
  }

  // Prüfen ob Update vorhanden
  const currentSize = await checkForUpdate()
  console.log(`Aktuelle Dateigrösse Refdata: ${Math.round(currentSize / 1024)} KB`)
  if (existingMeta?.sourceSize) {
    console.log(`Gespeicherte Dateigrösse:    ${Math.round(existingMeta.sourceSize / 1024)} KB`)
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
  const { buf, contentLength } = await download(REFDATA_URL)
  console.log(`Heruntergeladen: ${Math.round(contentLength / 1024)} KB`)

  // ZIP extrahieren
  console.log('ZIP wird entpackt...')
  const xmlBuf = extractZip(buf)
  console.log(`XML-Grösse: ${Math.round(xmlBuf.length / 1024)} KB`)

  // XML parsen
  console.log('Verarbeite XML...')
  const xmlStr = xmlBuf.toString('utf8')
  const entries = parseXml(xmlStr)

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
