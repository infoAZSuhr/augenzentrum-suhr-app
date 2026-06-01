// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Inbox } from 'lucide-react'
import EmptyState from './EmptyState'

describe('EmptyState', () => {
  it('rendert nur den Titel als Minimum', () => {
    render(<EmptyState title="Keine Patienten" />)
    expect(screen.getByText('Keine Patienten')).toBeTruthy()
  })

  it('rendert optionale Description', () => {
    render(<EmptyState title="Keine Daten" description="Lege einen neuen Eintrag an" />)
    expect(screen.getByText('Lege einen neuen Eintrag an')).toBeTruthy()
  })

  it('rendert das Icon wenn übergeben', () => {
    const { container } = render(<EmptyState title="Leer" icon={Inbox} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('rendert KEIN Icon-Wrapper wenn kein Icon übergeben', () => {
    const { container } = render(<EmptyState title="Leer" />)
    // Das Icon-Wrapper-Div mit w-12 h-12 ist nur da wenn Icon prop
    const wrapper = container.querySelector('.w-12.h-12')
    expect(wrapper).toBeNull()
  })

  it('rendert action-Slot wenn übergeben', () => {
    render(
      <EmptyState
        title="Leer"
        action={<button>Erste Aufgabe anlegen</button>}
      />
    )
    expect(screen.getByRole('button', { name: 'Erste Aufgabe anlegen' })).toBeTruthy()
  })

  it('wendet zusätzliche className an', () => {
    const { container } = render(<EmptyState title="X" className="custom-class" />)
    expect(container.querySelector('.custom-class')).not.toBeNull()
  })

  it('rendert komplexe ReactNode als description', () => {
    render(
      <EmptyState
        title="Leer"
        description={<span data-testid="desc"><strong>Tipp:</strong> Versuche eine andere Suche</span>}
      />
    )
    const desc = screen.getByTestId('desc')
    expect(desc).toBeTruthy()
    expect(desc.textContent).toContain('Tipp:')
  })
})
