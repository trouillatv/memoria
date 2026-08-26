// Indication reprise/ancre dans le triage (mig 195, lot réintégration GhostCamera) —
// lecture seule des colonnes existantes `is_viewpoint`/`viewpoint_of`, aucune
// nouvelle logique métier. Cf. CaptureTriage.tsx L147-153.
// Couvre les tests obligatoires #8 (reprise), #9 (ancre), #10 (photo normale).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { VisitCaptureRow } from '@/lib/db/visit-captures'

vi.mock('@/app/(field)/m/site/[siteId]/capture-actions', () => ({
  addPhotoCaptureAction: vi.fn(),
  correctCaptureLocationAction: vi.fn(),
  revertCaptureLocationAction: vi.fn(),
  appendCaptionByCaptureIdAction: vi.fn(async () => ({ ok: true, body: '' })),
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

vi.mock('@/lib/field/use-caption-dictation', () => ({
  useCaptionDictation: () => ({
    state: 'idle' as const,
    error: null,
    start: vi.fn(async () => true),
    stop: vi.fn(async () => null),
    cancel: vi.fn(),
  }),
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

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CaptureTriage — indication point de référence (mig 195)', () => {
  it('capture reprise (viewpoint_of défini) → « Reprise de : [libellé] » (test #8)', () => {
    const cap = makeCapture({ id: 'cap-2', viewpoint_of: 'anchor-1', is_viewpoint: false })

    render(
      <CaptureTriage
        captures={[cap]}
        previews={{}}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
        viewpointLabels={{ 'anchor-1': 'Porte d’entrée' }}
      />,
    )

    expect(screen.getByText('Reprise de : Porte d’entrée')).toBeInTheDocument()
  })

  it('capture reprise sans libellé résolu → repli générique (test #8)', () => {
    const cap = makeCapture({ id: 'cap-2', viewpoint_of: 'anchor-orphelin', is_viewpoint: false })

    render(
      <CaptureTriage
        captures={[cap]}
        previews={{}}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
        viewpointLabels={{}}
      />,
    )

    expect(screen.getByText('Reprise de : un point de référence')).toBeInTheDocument()
  })

  it('capture ancre (is_viewpoint) → « Point de référence » (test #9)', () => {
    const cap = makeCapture({ id: 'cap-1', is_viewpoint: true, viewpoint_of: null })

    render(
      <CaptureTriage
        captures={[cap]}
        previews={{}}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Point de référence')).toBeInTheDocument()
  })

  it('photo normale (ni ancre ni reprise) → aucune indication parasite (test #10)', () => {
    const cap = makeCapture({ id: 'cap-3', is_viewpoint: false, viewpoint_of: null })

    render(
      <CaptureTriage
        captures={[cap]}
        previews={{}}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByText('Point de référence')).not.toBeInTheDocument()
    expect(screen.queryByText(/Reprise de/)).not.toBeInTheDocument()
  })

  it('aucun wording Fantôme/Ghost visible dans le triage (test #11)', () => {
    const cap = makeCapture({ id: 'cap-1', is_viewpoint: true, viewpoint_of: null })

    render(
      <CaptureTriage
        captures={[cap]}
        previews={{}}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByText(/fantôme/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ghost/i)).not.toBeInTheDocument()
  })
})
