// DOC-CONTRACT-OS-1A-UX — MICRO-FIX FINAL (revue Vincent 2026-09-28).
// Défaut signalé : le geste suivant (Créer / Rattacher) réagissait à localEffect
// (choix courant du formulaire, non sauvegardé) plutôt qu'à la qualification
// effectivement validée (isQualificationSaved). Ce fichier couvre exactement la
// continuité carte OS/Avenant : choisir → Valider la qualification → seulement
// ensuite afficher le geste suivant. Le comportement CCTP legacy (documentType
// non fourni) reste couvert par tests/components/proposal-card-engagement.test.tsx,
// inchangé par ce correctif.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProposalCard } from '@/app/(dashboard)/documents/[id]/extraction/[runId]/ProposalCard'
import type { DbDocumentExtractionProposal } from '@/types/db'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const mockCreate = vi.fn()
const mockLink = vi.fn()
const mockAccept = vi.fn()
const mockReject = vi.fn()
const mockReset = vi.fn()
const mockEdit = vi.fn()
const mockSetContractEffect = vi.fn()

vi.mock('@/app/(dashboard)/documents/[id]/extraction/[runId]/review-actions', () => ({
  acceptProposalAction: (...args: unknown[]) => mockAccept(...args),
  editProposalAction: (...args: unknown[]) => mockEdit(...args),
  rejectProposalAction: (...args: unknown[]) => mockReject(...args),
  resetProposalAction: (...args: unknown[]) => mockReset(...args),
  updatePersonAttendanceAction: vi.fn(),
  createEngagementFromProposalAction: (...args: unknown[]) => mockCreate(...args),
  linkEngagementToProposalAction: (...args: unknown[]) => mockLink(...args),
  setContractEffectAction: (...args: unknown[]) => mockSetContractEffect(...args),
}))

function makeOsProposal(overrides: Partial<DbDocumentExtractionProposal> = {}): DbDocumentExtractionProposal {
  return {
    id: 'prop-os-1',
    organization_id: 'org-1',
    extraction_run_id: 'run-1',
    document_id: 'doc-os-1',
    target_site_id: 'site-1',
    proposal_family: 'engagement',
    stable_key: null,
    label: 'Nouvelle exigence OS n°14',
    description: 'Le titulaire ajoute un contrôle mensuel des extincteurs',
    source_page: 2,
    source_excerpt: 'L’OS n°14 ajoute un contrôle mensuel des extincteurs.',
    source_payload: {
      kind: 'controle',
      category: 'compliance',
      measurable: true,
      frequency_raw: 'mensuel',
      ai_confidence: 0.9,
      contract_effect: null,
    },
    thematic_category: null,
    document_status: null,
    subject_thread_id: null,
    review_status: 'accepted',
    reviewed_label: null,
    reviewed_description: null,
    reviewed_family: null,
    reviewed_at: null,
    reviewed_by: null,
    created_at: '2026-09-28T00:00:00.000Z',
    ...overrides,
  } as DbDocumentExtractionProposal
}

function renderOsCard(overrides: Partial<DbDocumentExtractionProposal> = {}) {
  return render(
    <ProposalCard
      proposal={makeOsProposal(overrides)}
      evidence={[]}
      signedUrls={{}}
      documentId="doc-os-1"
      documentType="ordre_service"
    />,
  )
}

function effetSelect() {
  return screen.getAllByRole('combobox')[0]
}

function temporaliteSelect() {
  return screen.getAllByRole('combobox')[1]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProposalCard — DOC-CONTRACT-OS-1A-UX — continuité carte OS/Avenant', () => {
  it('OS accepted + NEW sélectionné mais non validé → pas de Créer', () => {
    renderOsCard()
    fireEvent.change(effetSelect(), { target: { value: 'new' } })
    expect(screen.queryByText('Créer un nouvel Engagement')).not.toBeInTheDocument()
    expect(screen.getByText('Validez la qualification avant de poursuivre.')).toBeInTheDocument()
  })

  it('OS NEW validé → Créer visible', async () => {
    mockSetContractEffect.mockResolvedValue({ ok: true })
    const { rerender } = renderOsCard()
    fireEvent.change(effetSelect(), { target: { value: 'new' } })
    fireEvent.change(temporaliteSelect(), { target: { value: 'permanent' } })
    fireEvent.click(screen.getByText('Valider la qualification'))
    await waitFor(() => expect(mockSetContractEffect).toHaveBeenCalledTimes(1))

    // Le parent (RSC) rafraîchit la proposition avec la qualification persistée —
    // simulé ici par un rerender avec source_payload.contract_effect à jour.
    rerender(
      <ProposalCard
        proposal={makeOsProposal({
          source_payload: {
            kind: 'controle', category: 'compliance', measurable: true,
            frequency_raw: 'mensuel', ai_confidence: 0.9,
            contract_effect: {
              effect: 'new', temporality: 'permanent', targetEngagementId: null,
              startsOn: null, endsOn: null, resumeOn: null, scope: null,
            },
          },
        })}
        evidence={[]}
        signedUrls={{}}
        documentId="doc-os-1"
        documentType="ordre_service"
      />,
    )
    expect(screen.getByText('Créer un nouvel Engagement')).toBeInTheDocument()
  })

  it('OS CONFIRM sélectionné mais non validé → pas de Rattacher', () => {
    renderOsCard()
    fireEvent.change(effetSelect(), { target: { value: 'confirm' } })
    expect(screen.queryByText('Rattacher à un Engagement existant')).not.toBeInTheDocument()
    expect(screen.getByText('Validez la qualification avant de poursuivre.')).toBeInTheDocument()
  })

  it('OS CONFIRM validé → Rattacher visible', async () => {
    mockSetContractEffect.mockResolvedValue({ ok: true })
    const { rerender } = renderOsCard()
    fireEvent.change(effetSelect(), { target: { value: 'confirm' } })
    fireEvent.change(temporaliteSelect(), { target: { value: 'permanent' } })
    fireEvent.click(screen.getByText('Valider la qualification'))
    await waitFor(() => expect(mockSetContractEffect).toHaveBeenCalledTimes(1))

    rerender(
      <ProposalCard
        proposal={makeOsProposal({
          source_payload: {
            kind: 'controle', category: 'compliance', measurable: true,
            frequency_raw: 'mensuel', ai_confidence: 0.9,
            contract_effect: {
              effect: 'confirm', temporality: 'permanent', targetEngagementId: null,
              startsOn: null, endsOn: null, resumeOn: null, scope: null,
            },
          },
        })}
        evidence={[]}
        signedUrls={{}}
        documentId="doc-os-1"
        documentType="ordre_service"
      />,
    )
    expect(screen.getByText('Rattacher à un Engagement existant')).toBeInTheDocument()
  })

  it('qualification validée puis champ modifié → CTA disparaît jusqu’à revalidation', () => {
    renderOsCard({
      source_payload: {
        kind: 'controle', category: 'compliance', measurable: true,
        frequency_raw: 'mensuel', ai_confidence: 0.9,
        contract_effect: {
          effect: 'new', temporality: 'permanent', targetEngagementId: null,
          startsOn: null, endsOn: null, resumeOn: null, scope: null,
        },
      },
    })
    // Qualification déjà validée dès le rendu initial — Créer visible.
    expect(screen.getByText('Créer un nouvel Engagement')).toBeInTheDocument()

    // L'utilisateur modifie l'effet : la qualification redevient dirty.
    fireEvent.change(effetSelect(), { target: { value: 'confirm' } })

    expect(screen.queryByText('Créer un nouvel Engagement')).not.toBeInTheDocument()
    expect(screen.queryByText('Rattacher à un Engagement existant')).not.toBeInTheDocument()
    expect(screen.getByText('Validez la qualification avant de poursuivre.')).toBeInTheDocument()
  })
})
