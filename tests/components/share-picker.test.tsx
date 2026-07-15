import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  attach: vi.fn(),
  discard: vi.fn(),
  visits: vi.fn(),
  meetings: vi.fn(),
}))

vi.mock('@/app/(field)/m/partage/share-actions', () => ({
  attachSharedBatchAction: mocks.attach,
  discardShareAction: mocks.discard,
  listRecentVisitsAction: mocks.visits,
  listRecentMeetingsAction: mocks.meetings,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { SharePicker } from '@/app/(field)/m/partage/SharePicker'

const LOT_ID = '11111111-1111-1111-1111-111111111111'
const SITE_ID = '22222222-2222-2222-2222-222222222222'

const files = [
  { path: '/tmp/a.jpg', filename: 'a.jpg', mime: 'image/jpeg', url: null },
  { path: '/tmp/b.mp3', filename: 'b.mp3', mime: 'audio/mpeg', url: null },
]

describe('SharePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    mocks.visits.mockResolvedValue([
      { id: 'visit-1', title: 'Visite AGP', at: '2026-07-13T02:00:00.000Z', items: 6, open: true },
    ])
    mocks.meetings.mockResolvedValue([
      { id: 'meeting-1', title: 'Réunion AGP', at: '2026-07-13T04:00:00.000Z', items: 4, open: true },
    ])
    mocks.attach.mockResolvedValue({ ok: true, destination: 'meeting', reportId: 'meeting-1', added: 2, duplicates: 0, transcribed: 0 })
  })

  it('n’écrit rien avant un choix explicite', () => {
    render(
      <SharePicker
        lotId={LOT_ID}
        files={files}
        sites={[{ id: SITE_ID, name: 'Discount Poindimié' }]}
        lotLabel="2 éléments partagés"
        last={null}
      />,
    )

    expect(mocks.attach).not.toHaveBeenCalled()
    expect(mocks.visits).not.toHaveBeenCalled()
    expect(mocks.meetings).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Discount Poindimié' }))
    expect(mocks.attach).not.toHaveBeenCalled()
  })

  it('une réunion existante reçoit les médias sans créer une visite', async () => {
    render(
      <SharePicker
        lotId={LOT_ID}
        files={files}
        sites={[{ id: SITE_ID, name: 'Discount Poindimié' }]}
        lotLabel="2 éléments partagés"
        last={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Discount Poindimié' }))
    fireEvent.click(screen.getByRole('button', { name: /Réunion existante/i }))

    await waitFor(() => expect(mocks.meetings).toHaveBeenCalledWith(SITE_ID))
    fireEvent.click(await screen.findByRole('button', { name: /Réunion AGP/i }))

    await waitFor(() =>
      expect(mocks.attach).toHaveBeenCalledWith({
        lotId: LOT_ID,
        siteId: SITE_ID,
        destination: { type: 'meeting', id: 'meeting-1', title: undefined },
      }),
    )
    expect(mocks.visits).not.toHaveBeenCalled()
  })

  it('une nouvelle réunion passe par intoMeeting via destination meeting', async () => {
    render(
      <SharePicker
        lotId={LOT_ID}
        files={files}
        sites={[{ id: SITE_ID, name: 'Discount Poindimié' }]}
        lotLabel="2 éléments partagés"
        last={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Discount Poindimié' }))
    fireEvent.click(screen.getByRole('button', { name: /Nouvelle réunion/i }))

    await waitFor(() => expect(mocks.meetings).toHaveBeenCalledWith(SITE_ID))
    fireEvent.change(screen.getByPlaceholderText('Titre facultatif'), { target: { value: 'Réunion AGP' } })
    fireEvent.click(screen.getByRole('button', { name: /Créer et ajouter les 2 éléments/i }))

    await waitFor(() =>
      expect(mocks.attach).toHaveBeenCalledWith({
        lotId: LOT_ID,
        siteId: SITE_ID,
        destination: { type: 'meeting', id: null, title: 'Réunion AGP' },
      }),
    )
    expect(mocks.visits).not.toHaveBeenCalled()
  })
})
