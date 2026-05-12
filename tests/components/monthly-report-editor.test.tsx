// Slice E.1 — Tests MonthlyReportEditor.
//
// Specs :
//   1. Render minimal : counts affichés
//   2. Photo grid : 6 pré-sélectionnées par défaut
//   3. Click 7ème photo → 7 sélectionnées
//   4. Click 13ème (alors qu'on a déjà 12) → bloqué + toast
//   5. Note > 300 chars → input limité (cap maxLength)
//   6. Click "Approuver" → action appelée avec bons args (mock)
//   7. Doctrine : aucun prénom typique dans le rendu (regex)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { MonthlyReportData, ReportPhotoCandidate } from '@/lib/db/monthly-report'

// Mock toast pour vérifier les appels — sonner n'a pas besoin d'être réel.
const toastInfo = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    info: (msg: string) => toastInfo(msg),
    error: (msg: string) => toastError(msg),
    success: (msg: string) => toastSuccess(msg),
  },
}))

// Mock server action — éviter l'appel réel à Supabase.
const actionMock = vi.fn(async (_input: unknown) => ({
  ok: false,
  error: 'Génération PDF disponible dans la slice E.2 (à venir).',
}))
vi.mock('@/app/(dashboard)/contracts/[id]/rapport-mensuel/actions', () => ({
  approveAndPrepareReportAction: (input: unknown) => actionMock(input),
}))

// Import APRÈS les mocks.
import { MonthlyReportEditor } from '@/app/(dashboard)/contracts/[id]/rapport-mensuel/MonthlyReportEditor'

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makePhoto(id: string, overrides: Partial<ReportPhotoCandidate> = {}): ReportPhotoCandidate {
  return {
    id,
    url: `https://example.com/${id}.jpg`,
    thumbnail_url: `https://example.com/${id}_thumb.jpg`,
    caption: overrides.caption ?? `Photo ${id}`,
    taken_at: overrides.taken_at ?? '2026-05-10T09:00:00.000Z',
    intervention_id: overrides.intervention_id ?? `intv-${id}`,
    mission_name: overrides.mission_name ?? 'Bionettoyage hebdo',
    site_name: overrides.site_name ?? 'Site A',
    kind: overrides.kind ?? 'proof',
  }
}

function makeData(photoCount: number, overrides: Partial<MonthlyReportData> = {}): MonthlyReportData {
  // UUID-shaped ids (les server actions valident en .uuid() — pour les tests on
  // s'en moque mais on conserve une cohérence visuelle simple).
  const photos = Array.from({ length: photoCount }, (_, i) =>
    makePhoto(`00000000-0000-0000-0000-${String(i).padStart(12, '0')}`),
  )
  return {
    contract: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Bionettoyage 2026',
      client_name: 'CHU Régional',
      start_date: '2026-01-01',
    },
    period: {
      year: 2026,
      month: 5,
      monthLabel: 'mai 2026',
      firstDay: '2026-05-01',
      lastDay: '2026-05-31',
    },
    counts: {
      interventionsExecuted: 47,
      interventionsValidated: 12,
      interventionsSkipped: 1,
      photosCount: 198,
      anomaliesReported: 3,
      anomaliesResolved: 2,
      validationsCount: 12,
      sitesCovered: 4,
    },
    trend: {
      interventionsDelta: 5,
      photosDelta: 23,
      anomaliesOpenDelta: -1,
    },
    cumulative: {
      totalInterventionsExecuted: 247,
      totalPhotos: 1247,
      totalAnomaliesResolved: 4,
      daysSinceStart: 131,
    },
    photoCandidates: photos,
    anomaliesResolved: [],
    anomaliesStillOpen: [],
    segmentScores: {
      promised: 1,
      planned: 1,
      executed: 0.88,
      proven: 0.84,
      validated: 0.76,
    },
    ...overrides,
  }
}

beforeEach(() => {
  toastInfo.mockClear()
  toastError.mockClear()
  toastSuccess.mockClear()
  actionMock.mockClear()
})

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('MonthlyReportEditor', () => {
  it('render minimal : compteurs du mois affichés', () => {
    const data = makeData(8)
    render(<MonthlyReportEditor data={data} contractId={data.contract.id} month="2026-05" />)
    expect(screen.getByText('47')).toBeInTheDocument()
    expect(screen.getByText('198')).toBeInTheDocument()
    // Le compteur d'anomalies résolues est 2 ET le delta affiché contient des chiffres.
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    expect(screen.getByText('Indicateurs du mois')).toBeInTheDocument()
  })

  it('photo grid : 6 pré-sélectionnées par défaut quand >= 6 candidates', () => {
    const data = makeData(10)
    render(<MonthlyReportEditor data={data} contractId={data.contract.id} month="2026-05" />)
    // Le compteur dans le titre affiche "6 / 12 max".
    expect(screen.getByText(/6 \/ 12 max/)).toBeInTheDocument()
    // 6 boutons aria-pressed=true.
    const selectedButtons = screen.getAllByRole('listitem').filter(
      (b) => b.getAttribute('aria-pressed') === 'true',
    )
    expect(selectedButtons.length).toBe(6)
  })

  it('click sur la 7ème photo non sélectionnée → 7 sélectionnées', () => {
    const data = makeData(10)
    render(<MonthlyReportEditor data={data} contractId={data.contract.id} month="2026-05" />)
    const buttons = screen.getAllByRole('listitem')
    // La 7ème (index 6) est non sélectionnée par défaut.
    expect(buttons[6].getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(buttons[6])
    expect(screen.getByText(/7 \/ 12 max/)).toBeInTheDocument()
  })

  it('tentative d\'ajouter une 13ème photo (12 déjà cochées) → bloqué + toast info', () => {
    const data = makeData(13)
    render(<MonthlyReportEditor data={data} contractId={data.contract.id} month="2026-05" />)
    const buttons = screen.getAllByRole('listitem')
    // On part de 6 sélectionnées, on en clique 6 autres → 12 sélectionnées.
    for (let i = 6; i < 12; i++) {
      fireEvent.click(buttons[i])
    }
    expect(screen.getByText(/12 \/ 12 max/)).toBeInTheDocument()
    // Click sur la 13ème → bloqué.
    fireEvent.click(buttons[12])
    expect(screen.getByText(/12 \/ 12 max/)).toBeInTheDocument()
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('12 photos'))
  })

  it('note : input maxLength 300 (impossible de coller >300 chars)', () => {
    const data = makeData(6)
    render(<MonthlyReportEditor data={data} contractId={data.contract.id} month="2026-05" />)
    const textarea = screen.getByLabelText('Note du dirigeant') as HTMLTextAreaElement
    expect(textarea.maxLength).toBe(300)
    const longText = 'a'.repeat(500)
    fireEvent.change(textarea, { target: { value: longText } })
    // Notre handler tronque à 300.
    expect(textarea.value.length).toBe(300)
  })

  it('click "Approuver" → action appelée avec contractId, month, selectedPhotoIds, note', async () => {
    const data = makeData(6)
    render(<MonthlyReportEditor data={data} contractId={data.contract.id} month="2026-05" />)
    const textarea = screen.getByLabelText('Note du dirigeant') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Bon mois.' } })

    const approveButton = screen.getByRole('button', {
      name: /Approuver et préparer le partage/i,
    })
    fireEvent.click(approveButton)

    // L'action est appelée dans une transition — on attend une microtask.
    await new Promise((r) => setTimeout(r, 0))

    expect(actionMock).toHaveBeenCalledTimes(1)
    const firstCall = actionMock.mock.calls[0]
    if (!firstCall) throw new Error('action non appelée')
    const callArg = firstCall[0] as {
      contractId: string
      month: string
      selectedPhotoIds: string[]
      note: string
    }
    expect(callArg.contractId).toBe(data.contract.id)
    expect(callArg.month).toBe('2026-05')
    expect(callArg.selectedPhotoIds).toHaveLength(6)
    expect(callArg.note).toBe('Bon mois.')
  })

  it('doctrine anti-bullshit : aucun prénom typique dans le rendu', () => {
    const data = makeData(6, {
      anomaliesResolved: [
        {
          id: 'a1',
          description: 'Salle B sale lundi',
          reported_at: '2026-05-12T08:00:00.000Z',
          resolved_at: '2026-05-13T10:00:00.000Z',
          site_name: 'Site A',
        },
      ],
    })
    const { container } = render(
      <MonthlyReportEditor data={data} contractId={data.contract.id} month="2026-05" />,
    )
    const text = container.textContent ?? ''
    // Échantillon de prénoms typiques FR/EN — l'anonymisation totale doit être stricte.
    const forbiddenNames = /\b(Marie|Jean|Pierre|Paul|Sophie|Julie|Thomas|Nicolas|Alexandre|Camille|Léa|Lucas|Emma|Hugo|Sarah|David|John|Mike|Sandra|Patricia|Mohamed|Fatima|Karim|Ahmed|Aurélie|Aurelie)\b/
    expect(text).not.toMatch(forbiddenNames)
  })
})
