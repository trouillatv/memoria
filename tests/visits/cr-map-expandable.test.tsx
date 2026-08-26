// Non-régression : une seule <CaptureMap> montée à la fois dans CrMapExpandable
// (bug recette terrain 2026-08-26, cf. commentaire en tête de CrMapExpandable.tsx).
// CaptureMap est mockée : on ne teste pas Leaflet ici, seulement le rendu mutuellement
// exclusif petite carte / carte plein écran piloté par le contexte d'expansion.
//
// Depuis 2026-08-27, couvre aussi la divergence carte visible / instantané PDF
// remontée par Vincent : la carte affichée doit toujours démarrer sur le fond
// propre au rapport (`initialStatus.chosen`), jamais sur le hint localStorage
// partagé entre surfaces — et ce montage ne doit jamais réécrire ce hint
// partagé (sinon il écraserait une préférence d'appareil posée ailleurs, ex.
// Terrain).
//
// Reconfirmé le même jour après recette (Vincent) : Plan par défaut sur
// TOUTES les visites, sans exception — un rapport jamais réglé ne doit
// JAMAIS hériter la préférence ambiante Satellite d'un autre écran.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('@/components/CaptureMap', () => ({
  CaptureMap: ({ heightClass, baseLayer }: { heightClass: string; baseLayer?: { id: string } }) => (
    <div data-testid="capture-map" data-height-class={heightClass} data-base-layer={baseLayer?.id} />
  ),
}))

const setCrMapBaseLayerAction = vi.fn()
vi.mock('../../app/(field)/m/visite/[reportId]/cr/map-snapshot-actions', () => ({
  setCrMapBaseLayerAction: (...args: unknown[]) => setCrMapBaseLayerAction(...args),
}))

import {
  CrMapExpandProvider,
  CrMapExploreButton,
  CrMapExpandable,
} from '@/app/(field)/m/visite/[reportId]/cr/CrMapExpandable'
import { BASE_LAYER_STORAGE_KEY } from '@/lib/field/use-map-base-layer'
import type { CrMapBaseLayerStatus } from '@/lib/pdf/cr-map-snapshot'

beforeEach(() => {
  setCrMapBaseLayerAction.mockResolvedValue(statusFor('plan'))
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  setCrMapBaseLayerAction.mockReset()
})

function statusFor(chosen: 'plan' | 'satellite'): CrMapBaseLayerStatus {
  return {
    chosen,
    explicit: true,
    snapshotLayer: chosen,
    snapshotPath: `/snapshots/${chosen}.png`,
    satelliteAvailable: true,
  }
}

function renderHarness(overrides?: { mapboxToken?: string | null; initialStatus?: Partial<CrMapBaseLayerStatus> }) {
  const initialStatus: CrMapBaseLayerStatus = {
    chosen: 'plan',
    explicit: false,
    snapshotLayer: null,
    snapshotPath: null,
    satelliteAvailable: false,
    ...overrides?.initialStatus,
  }
  return render(
    <CrMapExpandProvider>
      <CrMapExploreButton />
      <CrMapExpandable
        siteId="site-1"
        captures={[]}
        mapboxToken={overrides?.mapboxToken ?? null}
        reportId="report-1"
        initialStatus={initialStatus}
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

describe('CrMapExpandable — rapport déjà figé (explicit=true) : la carte suit STRICTEMENT le rapport', () => {
  it('affiche Satellite quand le rapport le choisit, même sans hint localStorage', () => {
    renderHarness({
      mapboxToken: 'tok',
      initialStatus: { chosen: 'satellite', explicit: true, satelliteAvailable: true },
    })
    const [map] = screen.getAllByTestId('capture-map')
    expect(map).toHaveAttribute('data-base-layer', 'satellite')
  })

  it('affiche Plan quand le rapport le choisit, même si l appareil a une préférence Satellite ailleurs (Terrain)', () => {
    window.localStorage.setItem(BASE_LAYER_STORAGE_KEY, 'satellite')
    renderHarness({
      mapboxToken: 'tok',
      initialStatus: { chosen: 'plan', explicit: true, satelliteAvailable: true },
    })
    const [map] = screen.getAllByTestId('capture-map')
    expect(map).toHaveAttribute('data-base-layer', 'plan')
  })

  it('ne rappelle jamais l action de persistance pour un rapport déjà figé', () => {
    renderHarness({
      mapboxToken: 'tok',
      initialStatus: { chosen: 'satellite', explicit: true, satelliteAvailable: true },
    })
    expect(setCrMapBaseLayerAction).not.toHaveBeenCalled()
  })
})

describe('CrMapExpandable — rapport jamais réglé (explicit=false) : on fige TOUJOURS Plan une seule fois', () => {
  it('fige Plan même quand la préférence d appareil courante est Satellite (Vincent, 2026-08-27)', async () => {
    window.localStorage.setItem(BASE_LAYER_STORAGE_KEY, 'satellite')
    renderHarness({
      mapboxToken: 'tok',
      initialStatus: { chosen: 'plan', explicit: false, satelliteAvailable: true },
    })
    // La carte affiche Plan immédiatement, sans attendre la persistance…
    const [map] = screen.getAllByTestId('capture-map')
    expect(map).toHaveAttribute('data-base-layer', 'plan')
    // …et cette même valeur est figée en base pour ce rapport, jamais héritée.
    await waitFor(() => expect(setCrMapBaseLayerAction).toHaveBeenCalledWith('report-1', 'plan'))
  })

  it('fige Plan quand aucune préférence Satellite n est posée', async () => {
    renderHarness({
      mapboxToken: 'tok',
      initialStatus: { chosen: 'plan', explicit: false, satelliteAvailable: true },
    })
    await waitFor(() => expect(setCrMapBaseLayerAction).toHaveBeenCalledWith('report-1', 'plan'))
  })

  it('ne réécrit jamais le hint localStorage partagé au montage (préférence d appareil intacte)', async () => {
    window.localStorage.setItem(BASE_LAYER_STORAGE_KEY, 'satellite')
    renderHarness({
      mapboxToken: 'tok',
      initialStatus: { chosen: 'plan', explicit: false, satelliteAvailable: true },
    })
    await waitFor(() => expect(setCrMapBaseLayerAction).toHaveBeenCalled())
    // La préférence d'appareil posée ailleurs (Terrain) reste intacte — le gel
    // écrit en base, jamais dans le hint local partagé.
    expect(window.localStorage.getItem(BASE_LAYER_STORAGE_KEY)).toBe('satellite')
  })
})
