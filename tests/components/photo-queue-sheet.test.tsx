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
// photos. On la mocke pour éviter IndexedDB en jsdom (file vide + retry no-op).
vi.mock('@/lib/field/visit-capture-queue', () => ({
  listQueuedVisitCaptures: vi.fn(async () => []),
  markAllQueuedVisitCapturesReadyForRetry: vi.fn(async () => 0),
  removeQueuedVisitCapture: vi.fn(async () => {}),
}))

// Sonner — pas utilisé directement mais importé par les modules autour
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

import { PhotoQueueSheet } from '@/app/(field)/photo-queue-sheet'

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
