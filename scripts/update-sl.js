#!/usr/bin/env node
/**
 * BAG Spezialitätenliste (SL) updaten
 * Ausführen: node scripts/update-sl.js
 *
 * Neu geschrieben am 2026-07-10: Das BAG hat die alte Website
 * (spezialitaetenliste.ch, File.axd-Downloads) am 01.06.2026 abgeschaltet
 * und durch die ePL-Plattform ersetzt (sl.bag.admin.ch). Downloads laufen
 * jetzt über eine JSON-API, die auf die aktuelle Publications.xlsx zeigt:
 *
 *   1. GET https://epl.bag.admin.ch/api/sl/public/resources/current
 *      → excel.publication.fileUrl + lastUpdated (= "Stand")
 *   2. Download https://epl.bag.admin.ch/static/<fileUrl>
 *   3. Sheet "Publications" parsen, Spalten per Header-Name mappen
 *      (robust gegen Spalten-Umsortierung durch das BAG)
 *   4. public/sl-data.json + public/sl-meta.json schreiben
 *
 * Ausgabeformat (kompakt, kompatibel zum bisherigen sl-data.json):
 *   n = Bezeichnung, g = GTIN, h = Hersteller, s = Substanzen (Wirkstoff),
 *   e = Exf-Preis, p = Pub-Preis
 */

const fs = require('fs')
const path = require('path')
const XLSX = require('../node_modules/xlsx')

const API_RESOURCES = 'https://epl.bag.admin.ch/api/sl/public/resources/current'
const STATIC_BASE = 'https://epl.bag.admin.ch/static/'
const OUT_FILE = path.join(__dirname, '..', 'public', 'sl-data.json')
const META_FILE = path.join(__dirname, '..', 'public', 'sl-meta.json')

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`)
  return res.json()
}

async function fetchBuffer(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

function colIndex(header, needle) {
  const i = header.findIndex(h => String(h).toLowerCase().includes(needle.toLowerCase()))
  if (i === -1) throw new Error(`Spalte "${needle}" nicht im Header gefunden: ${JSON.stringify(header)}`)
  return i
}

async function main() {
  console.log('Hole Resource-Liste von der BAG ePL-API…')
  const resources = await fetchJson(API_RESOURCES)
  const pub = resources?.excel?.publication
  if (!pub?.fileUrl) throw new Error('excel.publication.fileUrl fehlt in der API-Antwort')
  const stand = pub.lastUpdated || new Date().toISOString().slice(0, 10)
  const url = STATIC_BASE + pub.fileUrl
  console.log(`Publications.xlsx (Stand ${stand}): ${url}`)

  const buf = await fetchBuffer(url)
  console.log(`Heruntergeladen: ${buf.length} Bytes`)

  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets['Publications'] || wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (rows.length < 2) throw new Error('Publications-Sheet leer')

  const header = rows[0]
  const iName = colIndex(header, 'Bezeichnung')
  const iGtin = colIndex(header, 'GTIN')
  const iHerst = colIndex(header, 'Hersteller')
  const iSubst = colIndex(header, 'Substanzen')
  const iExf = colIndex(header, 'Exf-Preis')
  const iPub = colIndex(header, 'Pub-Preis')

  const data = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const n = String(r[iName] || '').trim()
    if (!n) continue
    const entry = { n }
    const g = String(r[iGtin] || '').trim()
    if (g) entry.g = g
    const h = String(r[iHerst] || '').trim()
    if (h) entry.h = h
    const s = String(r[iSubst] || '').trim()
    if (s) entry.s = s
    const e = parseFloat(r[iExf])
    if (!isNaN(e)) entry.e = e
    const p = parseFloat(r[iPub])
    if (!isNaN(p)) entry.p = p
    data.push(entry)
  }

  if (data.length < 5000) throw new Error(`Nur ${data.length} Einträge geparst — sieht nach Strukturänderung aus, Abbruch (alte Datei bleibt erhalten)`)

  const meta = { extractedAt: stand, sourceSize: buf.length, entries: data.length }
  fs.writeFileSync(OUT_FILE, JSON.stringify({ meta, data }), 'utf8')
  fs.writeFileSync(META_FILE, JSON.stringify(meta), 'utf8')
  console.log(`OK: ${data.length} Einträge → public/sl-data.json (Stand ${stand})`)
}

main().catch(err => { console.error('FEHLER:', err.message); process.exit(1) })
