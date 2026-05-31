import { describe, it, expect } from 'vitest'
import { formatLastSeen } from './formatLastSeen'

const NOW = new Date('2026-05-31T12:00:00Z').getTime()
const ts = (secondsAgo: number) => ({ seconds: NOW / 1000 - secondsAgo })

describe('formatLastSeen', () => {
  it('returns "noch nie" when value is missing', () => {
    expect(formatLastSeen(undefined, NOW)).toBe('noch nie')
    expect(formatLastSeen(null, NOW)).toBe('noch nie')
    expect(formatLastSeen({}, NOW)).toBe('noch nie')
    expect(formatLastSeen({ seconds: 0 }, NOW)).toBe('noch nie')
  })

  it('returns "gerade eben" within last minute', () => {
    expect(formatLastSeen(ts(0),  NOW)).toBe('gerade eben')
    expect(formatLastSeen(ts(30), NOW)).toBe('gerade eben')
    expect(formatLastSeen(ts(59), NOW)).toBe('gerade eben')
  })

  it('returns minutes for < 1 hour', () => {
    expect(formatLastSeen(ts(60),   NOW)).toBe('vor 1 Min')
    expect(formatLastSeen(ts(300),  NOW)).toBe('vor 5 Min')
    expect(formatLastSeen(ts(3599), NOW)).toBe('vor 59 Min')
  })

  it('returns hours for < 24 hours', () => {
    expect(formatLastSeen(ts(3600),     NOW)).toBe('vor 1 Std')
    expect(formatLastSeen(ts(7200),     NOW)).toBe('vor 2 Std')
    expect(formatLastSeen(ts(86400-1),  NOW)).toBe('vor 23 Std')
  })

  it('returns days for < 7 days with singular/plural', () => {
    expect(formatLastSeen(ts(86400),     NOW)).toBe('vor 1 Tag')
    expect(formatLastSeen(ts(86400 * 2), NOW)).toBe('vor 2 Tagen')
    expect(formatLastSeen(ts(86400 * 6), NOW)).toBe('vor 6 Tagen')
  })

  it('falls back to Swiss date for > 7 days', () => {
    const result = formatLastSeen(ts(86400 * 30), NOW)
    // Format: DD.MM.YY (de-CH, 2-digit year). Beispiel: "01.05.26"
    expect(result).toMatch(/^\d{2}\.\d{2}\.\d{2}$/)
  })
})
