// Réintégration UX GhostCamera (mig 195, lot 2026-08-26) — le panier propose la
// reprise d'un point de référence, chaîne `viewpoint_of` sur la capture qui en
// résulte (caméra in-app ET repli natif), et déclenche le MÊME post-shutter
// qu'une photo normale. Couvre les tests obligatoires #1 à #7.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { VisitCaptureRow } from '@/lib/db/visit-captures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

const removeCaptureAction = vi.fn().mockResolvedValue({ ok: true })
const setCaptureStarAction = vi.fn().mockResolvedValue({ ok: true })
const setCaptureViewpointAction = vi.fn().mockResolvedValue({ ok: true })
const addQuestionCaptureAction = vi.fn().mockResolvedValue({ ok: true })
const listVisitCapturesAction = vi.fn().mockResolvedValue([] as VisitCaptureRow[])
const listVisitCapturePreviewsAction = vi.fn().mockResolvedValue({})
const revalidateSiteMobile = vi.fn().mockResolvedValue(undefined)
const addPhotoCaptureAction = vi.fn().mockResolvedValue({ ok: true })
vi.mock('@/app/(field)/m/site/[siteId]/capture-actions', () => ({
  removeCaptureAction: (...args: unknown[]) => removeCaptureAction(...args),
  setCaptureStarAction: (...args: unknown[]) => setCaptureStarAction(...args),
  setCaptureViewpointAction: (...args: unknown[]) => setCaptureViewpointAction(...args),
  addQuestionCaptureAction: (...args: unknown[]) => addQuestionCaptureAction(...args),
  listVisitCapturesAction: (...args: unknown[]) => listVisitCapturesAction(...args),
  listVisitCapturePreviewsAction: (...args: unknown[]) => listVisitCapturePreviewsAction(...args),
  revalidateSiteMobile: (...args: unknown[]) => revalidateSiteMobile(...args),
  addPhotoCaptureAction: (...args: unknown[]) => addPhotoCaptureAction(...args),
}))

vi.mock('@/app/(field)/m/site/[siteId]/report-actions', () => ({
  uploadReportAttachmentAction: vi.fn(),
}))

vi.mock('@/app/(field)/m/site/[siteId]/visit-actions', () => ({
  endVisitAction: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/app/(field)/m/visite/[reportId]/debrief-actions', () => ({
  deleteVisitAction: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/app/(field)/m/site/[siteId]/watchlist-actions', () => ({
  setWatchlistItemStateAction: vi.fn(async () => ({ ok: true })),
  addWatchlistItemAction: vi.fn(async () => ({ ok: true })),
  getWatchlistContextAction: vi.fn(async () => ({ ok: true, context: {} })),
}))

vi.mock('@/app/(field)/m/site/[siteId]/PhotoAnnotator', () => ({
  PhotoAnnotator: () => null,
}))

const queueVisitCapture = vi.fn().mockResolvedValue(undefined)
const listQueuedVisitCapturesByReport = vi.fn().mockResolvedValue([])
vi.mock('@/lib/field/visit-capture-queue', () => ({
  queueVisitCapture: (...args: unknown[]) => queueVisitCapture(...args),
  listQueuedVisitCapturesByReport: (...args: unknown[]) => listQueuedVisitCapturesByReport(...args),
}))

vi.mock('@/lib/field/use-visit-capture-uploader', () => ({
  useVisitCaptureUploader: () => ({ queued: [], uploadingUuid: null, syncNow: vi.fn(async () => {}) }),
}))

vi.mock('@/lib/field/image-compress', () => ({
  compressImageFile: async (file: File) => file,
}))

// GhostCamera réel : flux caméra + surimpression, hors de portée de jsdom. On le
// remplace par un stub qui expose les 3 callbacks reçus du parent (mêmes noms,
// mêmes séquences que le vrai composant — cf. GhostCamera.tsx `shoot()`).
vi.mock('@/app/(field)/m/site/[siteId]/GhostCamera', () => ({
  GhostCamera: (props: {
    label: string | null
    onCapture: (file: File) => void
    onClose: () => void
    onFallbackNative: () => void
  }) => (
    <div data-testid="ghost-camera-mock">
      <span data-testid="ghost-camera-label">{props.label}</span>
      <button
        type="button"
        onClick={() => {
          props.onCapture(new File(['x'], 'reprise.jpg', { type: 'image/jpeg' }))
          props.onClose()
        }}
      >
        mock-capture
      </button>
      <button type="button" onClick={props.onFallbackNative}>mock-fallback</button>
    </div>
  ),
}))

vi.mock('@/app/(field)/m/site/[siteId]/VideoRecorder', () => ({
  VideoRecorder: () => null,
}))

vi.mock('@/app/(field)/m/site/[siteId]/PostShutterDictation', () => ({
  PostShutterDictation: (props: { clientUuid: string; onDone: () => void }) => (
    <div data-testid="post-shutter-mock" data-client-uuid={props.clientUuid}>
      <button type="button" onClick={props.onDone}>mock-done</button>
    </div>
  ),
}))

import { VisitBasket } from '@/app/(field)/m/site/[siteId]/VisitBasket'

function makeCapture(overrides: Partial<VisitCaptureRow>): VisitCaptureRow {
  return {
    id: 'cap-1',
    report_id: 'report-1',
    site_id: 'site-1',
    kind: 'photo',
    status: 'kept',
    body: null,
    transcript_status: null,
    attachment_id: null,
    subject_id: null,
    triage_intent: null,
    suite_status: null,
    starred: false,
    client_uuid: null,
    lat: null,
    lng: null,
    gps_accuracy_m: null,
    altitude_m: null,
    altitude_accuracy_m: null,
    corrected_lat: null,
    corrected_lng: null,
    captured_at: null,
    is_viewpoint: false,
    viewpoint_of: null,
    annotated_original_id: null,
    included_in_cr: true,
    cr_tier: null,
    created_at: '2026-08-26T08:00:00.000Z',
    ...overrides,
  }
}

function nativePhotoInput(): HTMLInputElement {
  return document.querySelector('input[type="file"][accept="image/*"][capture="environment"]') as HTMLInputElement
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('VisitBasket — réintégration GhostCamera (UX)', () => {
  it('sans point de référence sur le chantier : aucun chip, la Photo normale enfile comme avant (test #1)', async () => {
    render(
      <VisitBasket
        reportId="report-1"
        siteId="site-1"
        userId="user-1"
        startedAt={null}
        subjects={[]}
        subjectMemory={{}}
        initialCaptures={[]}
        viewpoints={[]}
      />,
    )

    expect(screen.queryByText('Reprendre le même point de vue')).not.toBeInTheDocument()
    expect(screen.queryByTestId('viewpoint-chip')).not.toBeInTheDocument()

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
    fireEvent.change(nativePhotoInput(), { target: { files: [file] } })

    await waitFor(() => expect(queueVisitCapture).toHaveBeenCalledTimes(1))
    expect(queueVisitCapture.mock.calls[0][0]).toMatchObject({ kind: 'photo', viewpointOf: undefined })
    expect(screen.getByTestId('post-shutter-mock')).toBeInTheDocument()
  })

  it('épingler une photo : état visible immédiatement, action serveur envoyée (test #2)', async () => {
    const cap = makeCapture({ id: 'cap-1', is_viewpoint: false })
    render(
      <VisitBasket
        reportId="report-1"
        siteId="site-1"
        userId="user-1"
        startedAt={null}
        subjects={[]}
        subjectMemory={{}}
        initialCaptures={[cap]}
        viewpoints={[]}
      />,
    )

    fireEvent.click(screen.getByLabelText('Définir comme point de référence'))

    await waitFor(() => expect(setCaptureViewpointAction).toHaveBeenCalledWith({ capture_id: 'cap-1', is_viewpoint: true }))
    expect(screen.getByLabelText('Point de référence — ne plus la refaire')).toBeInTheDocument()
    expect(screen.getByText('Point de référence ✓')).toBeInTheDocument()
  })

  it('un point de référence existant sur le chantier est proposé en chip (test #3)', () => {
    render(
      <VisitBasket
        reportId="report-1"
        siteId="site-1"
        userId="user-1"
        startedAt={null}
        subjects={[]}
        subjectMemory={{}}
        initialCaptures={[]}
        viewpoints={[{ anchorId: 'anchor-1', label: 'Porte d’entrée', lastUrl: 'https://x/photo.jpg', shots: 2 }]}
      />,
    )

    expect(screen.getByText('Reprendre le même point de vue')).toBeInTheDocument()
    const chip = screen.getByTestId('viewpoint-chip')
    expect(chip).toHaveTextContent('Porte d’entrée')
    expect(chip).toHaveTextContent('2 photos')
  })

  it('capture via GhostCamera : viewpoint_of conservé sur la nouvelle capture (test #4)', async () => {
    render(
      <VisitBasket
        reportId="report-1"
        siteId="site-1"
        userId="user-1"
        startedAt={null}
        subjects={[]}
        subjectMemory={{}}
        initialCaptures={[]}
        viewpoints={[{ anchorId: 'anchor-1', label: 'Porte d’entrée', lastUrl: 'https://x/photo.jpg', shots: 1 }]}
      />,
    )

    fireEvent.click(screen.getByTestId('viewpoint-chip'))
    expect(screen.getByTestId('ghost-camera-mock')).toBeInTheDocument()

    fireEvent.click(screen.getByText('mock-capture'))

    await waitFor(() => expect(queueVisitCapture).toHaveBeenCalledTimes(1))
    expect(queueVisitCapture.mock.calls[0][0]).toMatchObject({ kind: 'photo', viewpointOf: 'anchor-1' })
  })

  it('capture via GhostCamera : le post-shutter s’affiche, comme une photo normale (test #5)', async () => {
    render(
      <VisitBasket
        reportId="report-1"
        siteId="site-1"
        userId="user-1"
        startedAt={null}
        subjects={[]}
        subjectMemory={{}}
        initialCaptures={[]}
        viewpoints={[{ anchorId: 'anchor-1', label: 'Porte d’entrée', lastUrl: 'https://x/photo.jpg', shots: 1 }]}
      />,
    )

    fireEvent.click(screen.getByTestId('viewpoint-chip'))
    fireEvent.click(screen.getByText('mock-capture'))

    expect(await screen.findByTestId('post-shutter-mock')).toBeInTheDocument()
    // La caméra fantôme s'est refermée (onClose appelé par le vrai composant à
    // chaque déclenchement) — pas de superposition d'écrans.
    expect(screen.queryByTestId('ghost-camera-mock')).not.toBeInTheDocument()
  })

  it('repli appareil natif : la reprise reste chaînée, le post-shutter s’affiche (test #6)', async () => {
    render(
      <VisitBasket
        reportId="report-1"
        siteId="site-1"
        userId="user-1"
        startedAt={null}
        subjects={[]}
        subjectMemory={{}}
        initialCaptures={[]}
        viewpoints={[{ anchorId: 'anchor-1', label: 'Porte d’entrée', lastUrl: 'https://x/photo.jpg', shots: 1 }]}
      />,
    )

    fireEvent.click(screen.getByTestId('viewpoint-chip'))
    fireEvent.click(screen.getByText('mock-fallback'))

    // La caméra in-app s'est fermée ; le repli ouvre l'appareil natif (input caché).
    expect(screen.queryByTestId('ghost-camera-mock')).not.toBeInTheDocument()

    const file = new File(['x'], 'reprise-native.jpg', { type: 'image/jpeg' })
    fireEvent.change(nativePhotoInput(), { target: { files: [file] } })

    await waitFor(() => expect(queueVisitCapture).toHaveBeenCalledTimes(1))
    expect(queueVisitCapture.mock.calls[0][0]).toMatchObject({ kind: 'photo', viewpointOf: 'anchor-1' })
    expect(await screen.findByTestId('post-shutter-mock')).toBeInTheDocument()
  })

  it('la dictée post-shutter s’attache à LA capture issue de la reprise, jamais à une autre (test #7)', async () => {
    render(
      <VisitBasket
        reportId="report-1"
        siteId="site-1"
        userId="user-1"
        startedAt={null}
        subjects={[]}
        subjectMemory={{}}
        initialCaptures={[]}
        viewpoints={[{ anchorId: 'anchor-1', label: 'Porte d’entrée', lastUrl: 'https://x/photo.jpg', shots: 1 }]}
      />,
    )

    fireEvent.click(screen.getByTestId('viewpoint-chip'))
    fireEvent.click(screen.getByText('mock-capture'))

    await waitFor(() => expect(queueVisitCapture).toHaveBeenCalledTimes(1))
    const enqueuedUuid = (queueVisitCapture.mock.calls[0][0] as { clientUuid: string }).clientUuid

    const postShutter = await screen.findByTestId('post-shutter-mock')
    expect(postShutter.dataset.clientUuid).toBe(enqueuedUuid)
  })
})
