/**
 * Zur-Rose Nota-Liste Proxy für die AZS-App.
 *
 * Warum: zurrose.ch blockt GitHub-Actions-IPs via Cloudflare. Direkter
 * Browser-Fetch der App scheitert an CORS (zurrose.ch setzt keine
 * Access-Control-Allow-Origin-Header). Dieser Worker fungiert als
 * Mittelsmann: läuft auf Cloudflare-Edge (nicht-blockierte IP) und
 * spiegelt die Datei mit den nötigen CORS-Headern.
 *
 * Endpoints:
 *   GET  /                     → Health-Check ("ok")
 *   GET  /nota-liste.xlsx      → Live-Proxy: holt XLSX von zurrose.ch
 *                                und liefert mit CORS-Headers zurück
 *   GET  /status               → {status, lastTry, lastSuccess, bytes,
 *                                 error?}
 *   OPTIONS *                  → CORS-Preflight
 *
 * Cron: täglich 06:15 UTC, frischt /nota-liste.xlsx einmal an (für
 * cf-cache-Wärme), keine externe Speicherung — KV bewusst vermieden,
 * damit das Setup auf 0 Cloudflare-Resources beschränkt bleibt.
 */

const ZURROSE_URL = 'https://www.zurrose.ch/sites/default/files/media/downloads/Nota-Liste.xlsx'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age':       '86400',
}

async function fetchZurRose() {
  return fetch(ZURROSE_URL, {
    headers: {
      'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
      'Accept-Language':  'de-CH,de;q=0.9,en;q=0.5',
      'Referer':          'https://www.zurrose.ch/',
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  })
}

export default {
  async fetch(request, _env, _ctx) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (url.pathname === '/' || url.pathname === '') {
      return new Response('ok — zur-rose proxy live', { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } })
    }

    if (url.pathname === '/nota-liste.xlsx') {
      return proxyXLSX(await fetchZurRose(), 'zur-rose')
    }

    if (url.pathname === '/status') {
      // Live-HEAD-Request zu Zur Rose, damit App kurz prüfen kann ohne den
      // ganzen XLSX zu ziehen.
      try {
        const head = await fetch(ZURROSE_URL, { method: 'HEAD' })
        return jsonOk({
          status:        head.ok ? 'ok' : 'error',
          httpStatus:    head.status,
          contentLength: head.headers.get('content-length'),
          lastModified:  head.headers.get('last-modified'),
          checkedAt:     new Date().toISOString(),
        })
      } catch (e) {
        return jsonError(String(e?.message ?? e), 502)
      }
    }

    return jsonError('Unknown endpoint. Use /nota-liste.xlsx or /status', 404)
  },

  async scheduled(_event, _env, ctx) {
    // Cron: warmt den cf-cache für /nota-liste.xlsx. Erste App-Anfrage
    // am Morgen wird damit unter ~200ms beantwortet.
    ctx.waitUntil(fetchZurRose().catch(() => {}))
  },
}

/** Gemeinsamer XLSX-Proxy: prüft HTTP-Status, ZIP-Magic-Bytes, gibt
 *  CORS-aware Response zurück oder JSON-Error. source = Label für
 *  X-Source-Header (Debug). */
async function proxyXLSX(upstream, source) {
  try {
    if (!upstream.ok) {
      return jsonError(`Upstream HTTP ${upstream.status} (${source})`, 502)
    }
    const body = await upstream.arrayBuffer()
    const head = new Uint8Array(body, 0, 2)
    if (head[0] !== 0x50 || head[1] !== 0x4B) {
      return jsonError(`Upstream lieferte keine XLSX-Datei (${body.byteLength} Bytes, ${source})`, 502)
    }
    return new Response(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type':   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Length': String(body.byteLength),
        'X-Source':       `cloudflare-worker:${source}`,
        'Cache-Control':  'public, max-age=300',
      },
    })
  } catch (e) {
    return jsonError(String(e?.message ?? e), 502)
  }
}

function jsonOk(data)            { return jsonResponse(data, 200) }
function jsonError(message, code) { return jsonResponse({ error: message }, code) }
function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
