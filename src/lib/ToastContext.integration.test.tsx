// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ToastProvider, useToast } from './ToastContext'

// Test-Komponente, die den useToast-Hook konsumiert
function TestTrigger() {
  const toast = useToast()
  return (
    <div>
      <button onClick={() => toast.success('Erfolg-Nachricht')}>success</button>
      <button onClick={() => toast.error('Fehler-Nachricht')}>error</button>
      <button onClick={() => toast.warning('Warn-Nachricht')}>warning</button>
      <button onClick={() => toast.info('Info-Nachricht')}>info</button>
      <button onClick={() => toast.show('Custom-Nachricht', 'success', 0)}>persistent</button>
    </div>
  )
}

describe('ToastContext — Provider + Hook + Viewport', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(()  => { vi.useRealTimers() })

  it('Hook ohne Provider liefert no-op Stub (kein Crash)', () => {
    // Wenn TestTrigger ohne Provider gerendert wird, darf nichts werfen.
    expect(() => render(<TestTrigger />)).not.toThrow()
    fireEvent.click(screen.getByText('success'))
    // Ohne Provider erscheint nichts — aber auch keine Exception.
    expect(screen.queryByText('Erfolg-Nachricht')).toBeNull()
  })

  it('Toast erscheint nach trigger', () => {
    render(<ToastProvider><TestTrigger /></ToastProvider>)
    expect(screen.queryByText('Erfolg-Nachricht')).toBeNull()
    fireEvent.click(screen.getByText('success'))
    expect(screen.getByText('Erfolg-Nachricht')).toBeTruthy()
  })

  it('verschiedene Kinds werden alle gerendert', () => {
    render(<ToastProvider><TestTrigger /></ToastProvider>)
    fireEvent.click(screen.getByText('success'))
    fireEvent.click(screen.getByText('error'))
    fireEvent.click(screen.getByText('warning'))
    fireEvent.click(screen.getByText('info'))
    expect(screen.getByText('Erfolg-Nachricht')).toBeTruthy()
    expect(screen.getByText('Fehler-Nachricht')).toBeTruthy()
    expect(screen.getByText('Warn-Nachricht')).toBeTruthy()
    expect(screen.getByText('Info-Nachricht')).toBeTruthy()
  })

  it('Auto-Dismiss nach Default-Duration', () => {
    render(<ToastProvider><TestTrigger /></ToastProvider>)
    fireEvent.click(screen.getByText('success'))
    expect(screen.getByText('Erfolg-Nachricht')).toBeTruthy()
    // success = 3000ms default
    act(() => { vi.advanceTimersByTime(3001) })
    expect(screen.queryByText('Erfolg-Nachricht')).toBeNull()
  })

  it('Error-Toast hält länger als Success (6s vs 3s)', () => {
    render(<ToastProvider><TestTrigger /></ToastProvider>)
    fireEvent.click(screen.getByText('error'))
    act(() => { vi.advanceTimersByTime(3500) })  // success wäre weg
    expect(screen.getByText('Fehler-Nachricht')).toBeTruthy()  // error noch da
    act(() => { vi.advanceTimersByTime(3000) })  // jetzt > 6s total
    expect(screen.queryByText('Fehler-Nachricht')).toBeNull()
  })

  it('duration=0 → kein Auto-Dismiss', () => {
    render(<ToastProvider><TestTrigger /></ToastProvider>)
    fireEvent.click(screen.getByText('persistent'))
    expect(screen.getByText('Custom-Nachricht')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('Custom-Nachricht')).toBeTruthy()  // immer noch da
  })

  it('Klick auf X-Icon schliesst Toast vorzeitig', () => {
    render(<ToastProvider><TestTrigger /></ToastProvider>)
    fireEvent.click(screen.getByText('success'))
    const closeBtn = screen.getByLabelText('Schliessen')
    fireEvent.click(closeBtn)
    expect(screen.queryByText('Erfolg-Nachricht')).toBeNull()
  })

  it('mehrere Toasts werden gleichzeitig gestackt', () => {
    render(<ToastProvider><TestTrigger /></ToastProvider>)
    fireEvent.click(screen.getByText('success'))
    fireEvent.click(screen.getByText('success'))
    fireEvent.click(screen.getByText('success'))
    const all = screen.getAllByText('Erfolg-Nachricht')
    expect(all).toHaveLength(3)
  })
})
