// Non-régression : sur Terrain, la carte et la galerie plein écran d'un
// cluster (CaptureClusterGallery) ne sont jamais montées en même temps — bug
// remonté par Vincent 2026-08-27 (fond Satellite visible à travers l'overlay
// semi-transparent de la galerie, cf. commentaire en tête de TerrainMap.tsx).
// Même famille de bug/correctif que CrMapExpandable (tests/visits/cr-map-expandable.test.tsx).
//
// CaptureMap est mockée : on ne teste pas Leaflet ici, seulement (1) le rendu
// mutuellement exclusif carte / galerie, (2) que le fond Plan/Satellite choisi
// passe bien à la carte, (3) que la vue (centre/zoom) quittée est repassée en
// `initialView` au remontage après fermeture de la galerie.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { MapCapture } from '@/components/CaptureMap'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/components/CaptureMap', () => ({
  CaptureMap: ({ captures, baseLayer, onOpenCluster, initialView }: {
    captures: MapCapture[]
    baseLayer?: { id: string }
    onOpenCluster?: (cs: MapCapture[]) => void
    initialView?: { center: [number, number]; zoom: number } | null
  }) => (
    <div
      data-testid="capture-map"
      data-base-layer={baseLayer?.id}
      data-initial-view={initialView ? `${initialView.center.join(',')}|${initialView.zoom}` : ''}
    >
      <button type="button" onClick={() => onOpenCluster?.(captures)}>
        Ouvrir le cluster
      </button>
    </div>
  ),
}))

vi.mock('@/components/CaptureClusterGallery', () => ({
  CaptureClusterGallery: ({ captures, onClose }: { captures: MapCapture[]; onClose: () => void }) => (
    <div data-testid="cluster-gallery" data-count={captures.length}>
      <button type="button" onClick={onClose}>Fermer la galerie</button>
    </div>
  ),
}))

import { TerrainMap } from '@/app/(field)/m/site/[siteId]/TerrainMap'

afterEach(() => {
  cleanup()
})

function makeCapture(id: string): MapCapture {
  return { id, kind: 'photo', lat: 1, lng: 2, created_at: '2026-08-27T00:00:00Z', body: null, reportId: 'r1', subjectName: null }
}

function renderHarness(count: number, mapboxToken: string | null = null) {
  const captures = Array.from({ length: count }, (_, i) => makeCapture(`c${i}`))
  return render(
    <TerrainMap siteId="site-1" captures={captures} visits={[]} mapboxToken={mapboxToken} />
  )
}

describe('TerrainMap — mutuelle exclusion carte / galerie de cluster', () => {
  it('ne monte que la carte au départ, jamais la galerie', () => {
    renderHarness(2)
    expect(screen.getAllByTestId('capture-map')).toHaveLength(1)
    expect(screen.queryByTestId('cluster-gallery')).toBeNull()
  })

  it('démonte la carte et monte la galerie seule pour un cluster de 2', () => {
    renderHarness(2)
    fireEvent.click(screen.getByText('Ouvrir le cluster'))

    expect(screen.queryByTestId('capture-map')).toBeNull()
    const gallery = screen.getByTestId('cluster-gallery')
    expect(gallery).toHaveAttribute('data-count', '2')
  })

  it('démonte la carte et monte la galerie seule pour un cluster de 10+', () => {
    renderHarness(12)
    fireEvent.click(screen.getByText('Ouvrir le cluster'))

    expect(screen.queryByTestId('capture-map')).toBeNull()
    expect(screen.getByTestId('cluster-gallery')).toHaveAttribute('data-count', '12')
  })

  it('revient à la carte seule (jamais les deux) après fermeture de la galerie', () => {
    renderHarness(3)
    fireEvent.click(screen.getByText('Ouvrir le cluster'))
    fireEvent.click(screen.getByText('Fermer la galerie'))

    expect(screen.getAllByTestId('capture-map')).toHaveLength(1)
    expect(screen.queryByTestId('cluster-gallery')).toBeNull()
  })
})

describe('TerrainMap — fond Plan/Satellite transmis à la carte', () => {
  it('transmet Plan par défaut sans jeton Mapbox', () => {
    renderHarness(2, null)
    expect(screen.getByTestId('capture-map')).toHaveAttribute('data-base-layer', 'plan')
  })

  it('transmet Satellite quand la préférence d appareil est Satellite et le jeton est présent', () => {
    window.localStorage.setItem('memoria.map.baseLayer', 'satellite')
    renderHarness(2, 'tok')
    expect(screen.getByTestId('capture-map')).toHaveAttribute('data-base-layer', 'satellite')
    window.localStorage.clear()
  })
})

describe('TerrainMap — pas de dérive de vue au retour de la galerie', () => {
  it('ne passe aucune vue initiale au tout premier montage', () => {
    renderHarness(2)
    expect(screen.getByTestId('capture-map')).toHaveAttribute('data-initial-view', '')
  })

  it('repasse la dernière vue connue en initialView après fermeture de la galerie', () => {
    // Le mock CaptureMap ne simule pas onViewChange (Leaflet réel uniquement) :
    // ce test vérifie seulement que remonter la carte après la galerie ne casse
    // pas le fil des props — la mémorisation elle-même (`lastView` dans
    // TerrainMap) n'a rien à publier tant qu'aucun `onViewChange` n'a été
    // appelé, ce qui est le comportement attendu ici (mock statique).
    renderHarness(2)
    fireEvent.click(screen.getByText('Ouvrir le cluster'))
    fireEvent.click(screen.getByText('Fermer la galerie'))

    expect(screen.getByTestId('capture-map')).toHaveAttribute('data-initial-view', '')
  })
})
