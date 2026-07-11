// Slice A.1 — Tests composant PhotoQueueSheet.
//
// Tests :
//   1. Rendu vide → empty state visible ("Toutes vos photos sont synchronisées").
//   2. Rendu avec 2 entries → 2 lignes visibles + bouton "Re-essayer maintenant".
//   3. Click "Re-essayer maintenant" → markAllReadyForRetry + onRetryNow appelés.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { QueuedPhoto } from '@/lib/field/photo-queue'

// Mocks centralisés — réutilisés par useQueueEntries (qui appelle listQueuedPhotos)
// et par le bouton retry (markAllReadyForRetry).
const listQueuedPhotosMock = vi.fn<() => Promise<QueuedPhoto[]>>(async () => [])
const markAllReadyForRetryMock = vi.fn<() => Promise<number>>(async () => 0)

// Stub blobToDataUrl — jsdom n'a pas un FileReader plein, et un data URL
// vide est OK pour les tests structurels.
vi.mock('@/lib/field/photo-queue', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/field/photo-queue')>(
      '@/lib/field/photo-queue',
    )
  return {
    ...actual,
    listQueuedPhotos: () => listQueuedPhotosMock(),
    listQueuedPhotosByIntervention: vi.fn(async () => []),
    markAllReadyForRetry: () => markAllReadyForRetryMock(),
    blobToDataUrl: vi.fn(async () => 'data:image/png;base64,AAAA'),
  }
})

// PR-1 — la sheet agrège désormais la file des captures de visite en plus des
// photos. On la mocke pour éviter IndexedDB en jsdom.
const listQueuedVisitCapturesMock = vi.fn<() => Promise<unknown[]>>(async () => [])
vi.mock('@/lib/field/visit-capture-queue', () => ({
  listQueuedVisitCaptures: () => listQueuedVisitCapturesMock(),
  markAllQueuedVisitCapturesReadyForRetry: vi.fn(async () => 0),
  removeQueuedVisitCapture: vi.fn(async () => {}),
  LIGHT_VISIT_KINDS: new Set(['note', 'verification', 'position']),
}))

// Sonner — pas utilisé directement mais importé par les modules autour
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

import { PhotoQueueSheet } from '@/app/(field)/photo-queue-sheet'
import { reportUploadSuccess } from '@/lib/field/sync-status'

function makeEntry(overrides: Partial<QueuedPhoto> = {}): QueuedPhoto {
  return {
    tempId: overrides.tempId ?? `t-${Math.random().toString(36).slice(2, 8)}`,
    blob: overrides.blob ?? new Blob(['x'], { type: 'image/jpeg' }),
    filename: overrides.filename ?? 'photo.jpg',
    mimeType: overrides.mimeType ?? 'image/jpeg',
    interventionId: overrides.interventionId ?? '00000000-0000-0000-0000-000000000001',
    checklistItemId: overrides.checklistItemId ?? null,
    kind: overrides.kind ?? 'before',
    takenAt: overrides.takenAt ?? Date.now() - 60_000,
    attempts: overrides.attempts ?? 0,
    lastAttemptAt: overrides.lastAttemptAt,
    lastError: overrides.lastError,
  }
}

beforeEach(() => {
  listQueuedPhotosMock.mockReset()
  listQueuedPhotosMock.mockResolvedValue([])
  markAllReadyForRetryMock.mockReset()
  markAllReadyForRetryMock.mockResolvedValue(0)
  listQueuedVisitCapturesMock.mockReset()
  listQueuedVisitCapturesMock.mockResolvedValue([])
})

describe('PhotoQueueSheet — empty state', () => {
  it('affiche le message "Toutes vos photos sont synchronisées" quand la queue est vide', async () => {
    listQueuedPhotosMock.mockResolvedValue([])

    await act(async () => {
      render(
        <PhotoQueueSheet
          trigger={<button type="button">trigger</button>}
          open
        />,
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('photo-queue-empty')).toBeInTheDocument()
    })
    expect(
      screen.getByText(/toutes vos captures sont synchronisées/i),
    ).toBeInTheDocument()

    // Pas de bouton "Re-essayer maintenant" dans l'empty state
    expect(screen.queryByTestId('photo-queue-retry')).not.toBeInTheDocument()
  })
})

describe('PhotoQueueSheet — entries listing', () => {
  it('rend 2 lignes pour 2 entries en queue + bouton retry visible', async () => {
    listQueuedPhotosMock.mockResolvedValue([
      makeEntry({ tempId: 'a', kind: 'before' }),
      makeEntry({ tempId: 'b', kind: 'after' }),
    ])

    await act(async () => {
      render(
        <PhotoQueueSheet
          trigger={<button type="button">trigger</button>}
          open
        />,
      )
    })

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-queue-row')).toHaveLength(2)
    })

    expect(screen.getByTestId('photo-queue-list')).toBeInTheDocument()
    expect(screen.getByTestId('photo-queue-retry')).toBeInTheDocument()
    expect(screen.queryByTestId('photo-queue-empty')).not.toBeInTheDocument()
  })
})

describe('PhotoQueueSheet — geste léger en attente (PR-2)', () => {
  it('affiche une note de visite en file (sans blob) avec type + chantier', async () => {
    listQueuedVisitCapturesMock.mockResolvedValue([
      {
        tempId: 'v-1',
        clientUuid: '00000000-0000-0000-0000-00000000000a',
        reportId: '00000000-0000-0000-0000-000000000002',
        siteId: '00000000-0000-0000-0000-000000000003',
        siteName: 'Cuisine Petratiti',
        kind: 'note',
        body: 'odeur persistante réserve froide',
        takenAt: Date.now() - 30_000,
        attempts: 0,
      },
    ])

    await act(async () => {
      render(
        <PhotoQueueSheet
          trigger={<button type="button">trigger</button>}
          open
        />,
      )
    })

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-queue-row')).toHaveLength(1)
    })
    // Type + chantier lisibles — la ligne est identifiable sans média.
    expect(screen.getByText(/note — cuisine petratiti/i)).toBeInTheDocument()
  })
})

describe('PhotoQueueSheet — file vivante (envoyé à l’instant)', () => {
  it('un envoi réussi apparaît sous « Envoyé à l’instant » avec type + chantier', async () => {
    reportUploadSuccess({ kindLabel: 'Vocal', siteName: 'Cuisine Petratiti' })

    await act(async () => {
      render(
        <PhotoQueueSheet
          trigger={<button type="button">trigger</button>}
          open
        />,
      )
    })

    await waitFor(() => {
      expect(screen.getAllByTestId('recently-sent-row').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getByText(/vocal — cuisine petratiti/i)).toBeInTheDocument()
  })
})

describe('PhotoQueueSheet — retry handler', () => {
  it('click sur "Re-essayer maintenant" → markAllReadyForRetry + onRetryNow appelés', async () => {
    listQueuedPhotosMock.mockResolvedValue([makeEntry({ tempId: 'a' })])
    markAllReadyForRetryMock.mockResolvedValue(1)
    const onRetryNow = vi.fn()

    await act(async () => {
      render(
        <PhotoQueueSheet
          trigger={<button type="button">trigger</button>}
          open
          onRetryNow={onRetryNow}
        />,
      )
    })

    const retryBtn = await screen.findByTestId('photo-queue-retry')
    await act(async () => {
      fireEvent.click(retryBtn)
    })

    await waitFor(() => {
      expect(markAllReadyForRetryMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(onRetryNow).toHaveBeenCalledTimes(1)
    })
  })
})
