/**
 * Vitest globales Setup — läuft VOR jeder Test-Datei (via vitest.config.ts
 * setupFiles). Reine pure-logic-Tests im node-Environment werden davon nicht
 * tangiert; die Cleanup-Calls erfordern jsdom, also läuft afterEach nur,
 * wenn ein document existiert.
 *
 * Aufgabe: nach jedem Test das React-DOM aufräumen, damit der nächste Test
 * mit einem frischen Body startet. Sonst stacken sich Renders und Queries
 * wie getByText finden mehrere Treffer.
 */
import { afterEach } from 'vitest'

afterEach(async () => {
  if (typeof document === 'undefined') return
  // Dynamisch importieren, damit pure-logic-Tests im node-Env
  // nicht versuchen react-dom zu laden.
  const { cleanup } = await import('@testing-library/react')
  cleanup()
})
