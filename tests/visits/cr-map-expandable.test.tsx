// Non-régression : une seule <CaptureMap> montée à la fois dans CrMapExpandable
// (bug recette terrain 2026-08-26, cf. commentaire en tête de CrMapExpandable.tsx).
// CaptureMap est mockée : on ne teste pas Leaflet ici, seulement le rendu mutuellement
// exclusif petite carte / carte plein écran piloté par le contexte d'expansion.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

vi.mock('@/components/CaptureMap', () => ({
  CaptureMap: ({ heightClass }: { heightClass: string }) => (
    <div data-testid="capture-map" data-height-class={heightClass} />
  ),
}))

import {
  CrMapExpandProvider,
  CrMapExploreButton,
  CrMapExpandable,
} from '@/app/(field)/m/visite/[reportId]/cr/CrMapExpandable'

afterEach(() => cleanup())

function renderHarness() {
  return render(
    <CrMapExpandProvider>
      <CrMapExploreButton />
      <CrMapExpandable
        siteId="site-1"
        captures={[]}
        mapboxToken={null}
        reportId="report-1"
        initialStatus={{ chosen: 'plan', explicit: false, snapshotLayer: null, snapshotPath: null, satelliteAvailable: false }}
      />
    </CrMapExpandProvider>
  )
}

describe('CrMapExpandable — mutuelle exclusion des instances CaptureMap', () => {
  it('ne monte qu une seule CaptureMap avant expansion (h-60)', () => {
    renderHarness()
    const maps = screen.getAllByTestId('capture-map')
    expect(maps).toHaveLength(1)
    expect(maps[0]).toHaveAttribute('data-height-class', 'h-60')
  })

  it('ne monte qu une seule CaptureMap après expansion (h-full), jamais les deux', () => {
    renderHarness()
    fireEvent.click(screen.getByLabelText('Explorer la carte en plein écran'))

    const maps = screen.getAllByTestId('capture-map')
    expect(maps).toHaveLength(1)
    expect(maps[0]).toHaveAttribute('data-height-class', 'h-full')
  })

  it('revient à une seule CaptureMap (h-60) après fermeture', () => {
    renderHarness()
    fireEvent.click(screen.getByLabelText('Explorer la carte en plein écran'))
    fireEvent.click(screen.getByLabelText('Fermer'))

    const maps = screen.getAllByTestId('capture-map')
    expect(maps).toHaveLength(1)
    expect(maps[0]).toHaveAttribute('data-height-class', 'h-60')
  })

  it('verrouille le scroll du fond pendant l expansion puis le restaure à la fermeture', () => {
    renderHarness()
    expect(document.body.style.overflow).not.toBe('hidden')

    fireEvent.click(screen.getByLabelText('Explorer la carte en plein écran'))
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.click(screen.getByLabelText('Fermer'))
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
