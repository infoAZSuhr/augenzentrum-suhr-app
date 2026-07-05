/** Reine, UI-freie Hilfsfunktionen der Recall-Seite — hierher extrahiert,
 *  damit sie testbar sind (vitest) und RecallPage.tsx schrumpft.
 *  KEINE Firebase-/React-Imports in dieser Datei. */

// Safe coercion – Firestore may store numbers where we expect strings
export function s(v: unknown): string { return v == null ? '' : String(v) }

export function formatDate(val: string | null): string {
  if (!val) return '—'
  if (val === 'kein Termin') return 'Im Recall'   // stored value → display label
  if (val === 'NaT' || val === 'nan') return '—'
  // datetime: YYYY-MM-DDTHH:MM
  const mDT = val.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/)
  if (mDT) return `${mDT[3]}.${mDT[2]}.${mDT[1]} ${mDT[4]}`
  const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}.${m[2]}.${m[1]}`
  return val
}

/** Alter in Jahren aus Geburtsdatum (ISO) — null wenn kein gueltiges Datum. */
export function ageFromGeb(gebDatum: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(gebDatum || ''))
  if (!m) return null
  const t = new Date()
  let a = t.getFullYear() - parseInt(m[1], 10)
  const mo = t.getMonth() + 1, d = t.getDate()
  if (mo < parseInt(m[2], 10) || (mo === parseInt(m[2], 10) && d < parseInt(m[3], 10))) a--
  return a
}

export function isKeinTermin(val: string | null): boolean { return val === 'kein Termin' }

/** Parst hineingezogenen Text in ein ISO-Datum (YYYY-MM-DD).
 *  Erkennt: TT.MM.JJJJ, TT.MM.JJ, TT/MM/JJJJ, TT-MM-JJJJ, JJJJ-MM-TT.
 *  Gibt '' zurück wenn kein Datum erkennbar ist. */
export function parseDroppedDate(raw: string): string {
  if (!raw) return ''
  const t = raw.trim()
  // Bereits ISO (YYYY-MM-DD)
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // TT.MM.JJJJ  oder  TT/MM/JJJJ  oder  TT-MM-JJJJ
  m = t.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/)
  if (m) {
    const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0')
    return `${m[3]}-${mo}-${d}`
  }
  // TT.MM.JJ  (zweistelliges Jahr → 20JJ)
  m = t.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2})(?!\d)/)
  if (m) {
    const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0')
    return `20${m[3]}-${mo}-${d}`
  }
  return ''
}

/** Normalize Liris address format (Name / PLZ / Strasse / Ort) → Swiss standard (Name / Strasse / PLZ Ort) */
export function normalizeLirisAddress(raw: string): string {
  const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean)
  // Liris exports: line 0 = Name, line 1 = PLZ (digits only), line 2 = Street, line 3 = City
  if (lines.length === 4 && /^\d{4,5}$/.test(lines[1])) {
    return `${lines[0]}\n${lines[2]}\n${lines[1]} ${lines[3]}`
  }
  return raw.trim()
}

export function isFutureDate(val: string | null): boolean {
  if (!val) return false
  if (val.includes('T')) return new Date(val) >= new Date()
  const m = val.match(/^(\d{4}-\d{2}-\d{2})/)
  if (!m) return false
  const today = new Date().toISOString().slice(0, 10)
  return m[1] >= today
}

/** Convert stored date to date-input value (YYYY-MM-DD), '' if none. */
export function toInputDate(val: string | null | undefined): string {
  if (!val || val === 'kein Termin') return ''
  const m = val.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

/** Convert stored datetime string to datetime-local input value (YYYY-MM-DDTHH:MM) */
export function toInputDatetime(val: string | null | undefined): string {
  if (!val || val === 'kein Termin') return ''
  const mDT = val.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  if (mDT) return `${mDT[1]}T${mDT[2]}`
  const mD = val.match(/^(\d{4}-\d{2}-\d{2})/)
  if (mD) return `${mD[1]}T00:00`
  return ''
}

/** Parse a recallTimestamp string "26.04.2026 14:30 – Username" */
export function parseStamp(ts: string | null): { dateStr: string; isoDate: string; user: string } | null {
  if (!ts) return null
  const m = ts.match(/^(\d{2})\.(\d{2})\.(\d{4}).*?–\s*(.+)$/)
  if (!m) return null
  return { dateStr: `${m[1]}.${m[2]}.${m[3]}`, isoDate: `${m[3]}-${m[2]}-${m[1]}`, user: m[4].trim() }
}

/** Convert any embedded ISO date (YYYY-MM-DD) in a string to Swiss format (DD.MM.YYYY) */
export function formatErgebnis(val: string): string {
  return val.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3.$2.$1')
}

/** Returns a human-readable label for the pending contact tasks of a patient. */
export function pendingVorgehenLabel(patient: { verlauf?: { aktion: string; ergebnis: string }[] | null }): string {
  const types = (patient.verlauf ?? [])
    .filter(v => v.ergebnis === 'noch zu erledigen')
    .map(v => v.aktion)
  const hasTel   = types.includes('Telefonanruf')
  const hasEmail = types.includes('E-Mail')
  if (hasTel && hasEmail) return 'Patient anrufen & E-Mail senden'
  if (hasTel)             return 'Patient anrufen'
  if (hasEmail)           return 'E-Mail senden'
  return 'Noch zu erledigen'
}

/** Strip leading # and leading zeros from a PID string.  "01722" → "1722", "#007" → "7" */
export function normalizePid(val: string | null | undefined): string {
  return s(val).replace(/^#+/, '').replace(/^0+(\d)/, '$1')
}

/** Wandelt VOLLSTÄNDIG grossgeschriebene Namens-Wörter (Liris liefert oft
 *  "PUMA TORIERI") in normale Schreibweise um: erster Buchstabe gross, Rest
 *  klein. Bereits gemischt geschriebene Wörter (z.B. "McDonald") bleiben
 *  unverändert. Bindestriche/Apostrophe werden je Teil korrekt behandelt. */
export function titleCaseName(val: string | null | undefined): string {
  return s(val).replace(/\p{L}+/gu, w =>
    w.length > 1 && w === w.toUpperCase()
      ? w.charAt(0) + w.slice(1).toLowerCase()
      : w
  )
}

/** Returns true if the recallTimestamp is within the last 7 days */
export function isWithin7Days(erstelltStamp: string | null | undefined): boolean {
  const ps = parseStamp(erstelltStamp ?? null)
  if (!ps) return false
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7)
  return new Date(ps.isoDate) >= cutoff
}

/** Parse an interval string like "1j", "6m", "2w", "10t" */
export function parseKonsInterval(val: string): { n: number; unit: 'year' | 'month' | 'week' | 'day' } | null {
  const m = val.trim().match(/^(\d+)\s*([jJmMwWtT])$/)
  if (!m) return null
  const n = parseInt(m[1])
  if (n <= 0 || n > 120) return null
  const u = m[2].toLowerCase()
  return { n, unit: u === 'j' ? 'year' : u === 'm' ? 'month' : u === 'w' ? 'week' : 'day' }
}

/** Compute ISO date string from base date + interval string, or null if not parseable */
export function computeNextKons(base: string, interval: string): string | null {
  if (!base || !interval.trim()) return null
  const parsed = parseKonsInterval(interval)
  if (!parsed) return null
  const d = new Date(base + 'T00:00:00Z')
  if (isNaN(d.getTime())) return null
  const { n, unit } = parsed
  if (unit === 'year')  d.setUTCFullYear(d.getUTCFullYear() + n)
  if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + n)
  if (unit === 'week')  d.setUTCDate(d.getUTCDate() + n * 7)
  if (unit === 'day')   d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
