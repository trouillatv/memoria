// Micro du triage — même légende que le micro post-shutter (test #5/#6/#7),
// jamais de fuite entre captures pendant la navigation (test #3/#4/#12),
// jamais de double-enregistrement (test #10).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import type { VisitCaptureRow } from '@/lib/db/visit-captures'

const addPhotoCaptureAction = vi.fn()
const correctCaptureLocationAction = vi.fn()
const revertCaptureLocationAction = vi.fn()
const appendCaptionByCaptureIdAction = vi.fn()
vi.mock('@/app/(field)/m/site/[siteId]/capture-actions', () => ({
  addPhotoCaptureAction: (...args: unknown[]) => addPhotoCaptureAction(...args),
  correctCaptureLocationAction: (...args: unknown[]) => correctCaptureLocationAction(...args),
  revertCaptureLocationAction: (...args: unknown[]) => revertCaptureLocationAction(...args),
  appendCaptionByCaptureIdAction: (...args: unknown[]) => appendCaptionByCaptureIdAction(...args),
}))

vi.mock('@/app/(field)/m/site/[siteId]/report-actions', () => ({
  uploadReportAttachmentAction: vi.fn(),
}))

vi.mock('@/app/(field)/m/site/[siteId]/PhotoAnnotator', () => ({
  PhotoAnnotator: () => null,
}))

vi.mock('@/components/LocationCorrectionMap', () => ({
  LocationCorrectionMap: () => null,
}))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

const dictationMock = {
  state: 'idle' as const,
  error: null as string | null,
  start: vi.fn(async () => true),
  stop: vi.fn(async () => null as string | null),
  cancel: vi.fn(),
}
vi.mock('@/lib/field/use-caption-dictation', () => ({
  useCaptionDictation: () => dictationMock,
}))

import { CaptureTriage } from '@/app/(field)/m/visite/[reportId]/CaptureTriage'

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
    triage_intent: 'memoire',
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
    created_at: '2026-08-20T08:00:00.000Z',
    ...overrides,
  }
}

const micButton = () => screen.getByLabelText(/Dicter la légende|Arrêter la dictée/)
const commentInput = () => document.querySelector('input[maxlength]') as HTMLInputElement

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  dictationMock.start.mockResolvedValue(true)
  dictationMock.stop.mockResolvedValue(null)
  appendCaptionByCaptureIdAction.mockResolvedValue({ ok: true, body: '' })
})

describe('CaptureTriage — dictée', () => {
  it('idle → recording → stop : attache la légende dictée à la bonne capture (test #2/#5)', async () => {
    const cap1 = makeCapture({ id: 'cap-1', body: null })
    dictationMock.stop.mockResolvedValue('chambre 2')
    appendCaptionByCaptureIdAction.mockResolvedValue({ ok: true, body: 'chambre 2' })

    render(
      <CaptureTriage
        captures={[cap1]}
        previews={{}}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(micButton())
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalledTimes(1))

    await act(async () => { fireEvent.click(micButton()) })

    await waitFor(() => expect(appendCaptionByCaptureIdAction).toHaveBeenCalledWith({
      capture_id: 'cap-1',
      text: 'chambre 2',
    }))
    expect(commentInput().value).toBe('chambre 2')
  })

  it('légende déjà existante + nouvelle dictée : jamais d’écrasement silencieux (test #6)', async () => {
    const cap2 = makeCapture({ id: 'cap-2', body: 'Fissure au plafond' })
    dictationMock.stop.mockResolvedValue('chambre 2')
    appendCaptionByCaptureIdAction.mockResolvedValue({ ok: true, body: 'Fissure au plafond chambre 2' })

    render(
      <CaptureTriage
        captures={[cap2]}
        previews={{}}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(commentInput().value).toBe('Fissure au plafond')
    fireEvent.click(micButton())
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await act(async () => { fireEvent.click(micButton()) })

    await waitFor(() => expect(appendCaptionByCaptureIdAction).toHaveBeenCalledWith({
      capture_id: 'cap-2',
      text: 'chambre 2',
    }))
    expect(commentInput().value).toBe('Fissure au plafond chambre 2')
  })

  it('saisie clavier puis dictée : coexistence, la dictée s’ajoute à ce qui a été enregistré (test #7)', async () => {
    const cap1 = makeCapture({ id: 'cap-1', body: null })
    const onDecide = vi.fn()
    dictationMock.stop.mockResolvedValue('précision orale')
    appendCaptionByCaptureIdAction.mockResolvedValue({ ok: true, body: 'Saisie clavier précision orale' })

    render(
      <CaptureTriage
        captures={[cap1]}
        previews={{}}
        onDecide={onDecide}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(commentInput(), { target: { value: 'Saisie clavier' } })
    fireEvent.blur(commentInput())
    expect(onDecide).toHaveBeenCalledWith(cap1, 'memoire', 'Saisie clavier')

    fireEvent.click(micButton())
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await act(async () => { fireEvent.click(micButton()) })

    await waitFor(() => expect(appendCaptionByCaptureIdAction).toHaveBeenCalledWith({
      capture_id: 'cap-1',
      text: 'précision orale',
    }))
    expect(commentInput().value).toBe('Saisie clavier précision orale')
  })

  it('transcription vide : aucune modification (test #8)', async () => {
    const cap1 = makeCapture({ id: 'cap-1', body: null })
    dictationMock.stop.mockResolvedValue(null)

    render(
      <CaptureTriage
        captures={[cap1]}
        previews={{}}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(micButton())
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await act(async () => { fireEvent.click(micButton()) })
    expect(appendCaptionByCaptureIdAction).not.toHaveBeenCalled()
  })

  it('navigation pendant un enregistrement : annule, aucune fuite vers l’autre capture (test #3/#4/#12)', async () => {
    const cap1 = makeCapture({ id: 'cap-1', body: null })
    const cap2 = makeCapture({ id: 'cap-2', body: 'Photo deux' })

    render(
      <CaptureTriage
        captures={[cap1, cap2]}
        previews={{}}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(micButton())
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByLabelText('Suivant'))

    expect(dictationMock.cancel).toHaveBeenCalledTimes(1)
    expect(dictationMock.stop).not.toHaveBeenCalled()
    expect(appendCaptionByCaptureIdAction).not.toHaveBeenCalled()
    // La capture affichée est bien la seconde, avec SA propre légende — aucun
    // résidu de la dictée annulée sur la première.
    expect(commentInput().value).toBe('Photo deux')
  })

  it('double tap sur le micro pendant la transcription : ignoré (test #10)', async () => {
    const cap1 = makeCapture({ id: 'cap-1', body: null })
    let resolveStop: (text: string | null) => void = () => {}
    dictationMock.stop.mockImplementation(() => new Promise((resolve) => { resolveStop = resolve }))

    render(
      <CaptureTriage
        captures={[cap1]}
        previews={{}}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(micButton())
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalledTimes(1))

    fireEvent.click(micButton()) // recording → transcribing (stop() pending)
    await waitFor(() => expect(dictationMock.stop).toHaveBeenCalledTimes(1))

    // Le bouton est désactivé pendant la transcription : un second tap ne
    // relance rien.
    fireEvent.click(micButton())
    expect(dictationMock.stop).toHaveBeenCalledTimes(1)
    expect(dictationMock.start).toHaveBeenCalledTimes(1)

    await act(async () => { resolveStop('texte') })
  })
})
