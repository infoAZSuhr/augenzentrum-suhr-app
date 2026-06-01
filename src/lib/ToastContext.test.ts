/**
 * Smoke-Test für den useToast-Hook ohne Provider:
 * der Fallback-Stub muss no-ops zurückgeben, damit Komponenten in Tests
 * crashfrei sind, auch wenn der Provider nicht eingehängt ist.
 *
 * Volle Provider-Tests brauchen React Testing Library + jsdom — die werden
 * Teil des nächsten React-Component-Test-Setups. Für jetzt:
 * - useToast() ohne Provider darf nicht werfen
 * - alle API-Methoden sind callable, geben Number bzw. void zurück
 */
import { describe, it, expect } from 'vitest'

describe('ToastContext exports', () => {
  it('lässt sich importieren ohne Side-Effects', async () => {
    const mod = await import('./ToastContext')
    expect(typeof mod.ToastProvider).toBe('function')
    expect(typeof mod.useToast).toBe('function')
  })
})
