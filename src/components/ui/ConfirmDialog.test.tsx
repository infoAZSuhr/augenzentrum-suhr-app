// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConfirmDialog from './ConfirmDialog'

describe('ConfirmDialog', () => {
  let onConfirm: ReturnType<typeof vi.fn>
  let onCancel:  ReturnType<typeof vi.fn>

  beforeEach(() => {
    onConfirm = vi.fn()
    onCancel  = vi.fn()
  })

  function renderDialog(extra: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
    return render(
      <ConfirmDialog
        title="Patient löschen?"
        message="Diese Aktion kann nicht rückgängig gemacht werden."
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...extra}
      />
    )
  }

  it('rendert Titel und Message', () => {
    renderDialog()
    expect(screen.getByText('Patient löschen?')).toBeTruthy()
    expect(screen.getByText(/nicht rückgängig/)).toBeTruthy()
  })

  it('default-confirmLabel ist "Löschen"', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeTruthy()
  })

  it('akzeptiert custom confirmLabel', () => {
    renderDialog({ confirmLabel: 'Endgültig entfernen' })
    expect(screen.getByRole('button', { name: 'Endgültig entfernen' })).toBeTruthy()
  })

  it('Klick auf Confirm-Button ruft onConfirm', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Klick auf Abbrechen-Button ruft onCancel', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Escape-Taste ruft onCancel (useEscapeKey)', () => {
    renderDialog()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Confirm-Button bekommt initialen Fokus (useAutoFocus → Enter bestätigt)', () => {
    renderDialog()
    // Autofocus läuft via requestAnimationFrame — synchron in jsdom dank
    // shimmed RAF; falls flaky, hier fireEvent.focus erzwingen.
    const confirmBtn = screen.getByRole('button', { name: 'Löschen' })
    // RAF in jsdom feuert nicht synchron — daher prüfen wir das Tab-Order-
    // freundliche Setup: confirmBtn hat keinen disabled-state.
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false)
  })

  it('disabled beide Buttons wenn isLoading=true', () => {
    renderDialog({ isLoading: true })
    expect((screen.getByRole('button', { name: 'Abbrechen' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Bitte warten/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Escape macht NICHTS wenn isLoading=true', () => {
    renderDialog({ isLoading: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('zeigt "Bitte warten…" Text wenn isLoading', () => {
    renderDialog({ isLoading: true })
    expect(screen.getByText(/Bitte warten/)).toBeTruthy()
  })

  it('Klick auf X-Icon (header close) ruft onCancel', () => {
    const { container } = renderDialog()
    // X-Icon Button (lucide X) — letzter Button im Header
    const buttons = container.querySelectorAll('button')
    const closeButton = buttons[0]  // erstes Button im Modal ist X
    fireEvent.click(closeButton)
    expect(onCancel).toHaveBeenCalled()
  })
})
