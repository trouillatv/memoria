// DOC-CONTRACT-OS-1A-UX — MICRO-FIX FINAL (revue Vincent 2026-09-28).
// Défaut signalé : le geste suivant (Créer / Rattacher) réagissait à localEffect
// (choix courant du formulaire, non sauvegardé) plutôt qu'à la qualification
// effectivement validée (isQualificationSaved). Ce fichier couvre exactement la
// continuité carte OS/Avenant : choisir → Valider la qualification → seulement
// ensuite afficher le geste suivant. Le comportement CCTP legacy (documentType
// non fourni) reste couvert par tests/components/proposal-card-engagement.test.tsx,
// inchangé par ce correctif.
//
// Mis à jour DOC-CONTRACT-OS-1B1-UX-BRIDGE (mandat Vincent 2026-09-29) : pour un
// effet qualifié (NEW/MODIFY/SUSPEND/CONFIRM) sur OS/Avenant, le geste suivant
// n'est plus « Créer un nouvel Engagement »/« Rattacher à un Engagement existant »
// (anciennes RPC materializeEngagementCreateNew/LinkExisting — n'écrivaient jamais
// dans engagement_contract_effects) mais le bouton unique « Appliquer l'effet
// contractuel », qui passe par la primitive canonique 1B1
// (materializeContractEffectAction → materialize_engagement_contract_effect).
// Les anciens boutons Créer/Rattacher restent réservés au CCTP historique jamais
// qualifié (validatedEffect === null).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProposalCard } from '@/app/(dashboard)/documents/[id]/extraction/[runId]/ProposalCard'
import type { DbDocumentExtractionProposal, DbEngagement } from '@/types/db'

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
const mockMaterializeContractEffect = vi.fn()

vi.mock('@/app/(dashboard)/documents/[id]/extraction/[runId]/review-actions', () => ({
  acceptProposalAction: (...args: unknown[]) => mockAccept(...args),
  editProposalAction: (...args: unknown[]) => mockEdit(...args),
  rejectProposalAction: (...args: unknown[]) => mockReject(...args),
  resetProposalAction: (...args: unknown[]) => mockReset(...args),
  updatePersonAttendanceAction: vi.fn(),
  createEngagementFromProposalAction: (...args: unknown[]) => mockCreate(...args),
  linkEngagementToProposalAction: (...args: unknown[]) => mockLink(...args),
  setContractEffectAction: (...args: unknown[]) => mockSetContractEffect(...args),
  materializeContractEffectAction: (...args: unknown[]) => mockMaterializeContractEffect(...args),
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

function makeEngagement(overrides: Partial<DbEngagement> = {}): DbEngagement {
  return {
    id: 'eng-A',
    tender_id: null,
    contract_id: null,
    site_id: 'site-1',
    source_type: 'manual',
    source_excerpt: 'excerpt existant',
    source_ref: null,
    tender_document_id: null,
    source_document_id: null,
    page_number: null,
    category: 'other',
    kind: null,
    short_label: 'Signalement incendie — Engagement A',
    measurable: false,
    ai_confidence: null,
    status: 'active',
    proof_requirement: 'none',
    destination: 'contract_engagement',
    organization_id: 'org-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    ...overrides,
  }
}

function renderOsCard(overrides: Partial<DbDocumentExtractionProposal> = {}, siteEngagements?: DbEngagement[]) {
  return render(
    <ProposalCard
      proposal={makeOsProposal(overrides)}
      evidence={[]}
      signedUrls={{}}
      documentId="doc-os-1"
      documentType="ordre_service"
      siteEngagements={siteEngagements}
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

  it('OS NEW validé → Appliquer l’effet contractuel visible', async () => {
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
    expect(screen.getByText('Appliquer l’effet contractuel')).toBeInTheDocument()
  })

  it('OS CONFIRM sélectionné mais non validé → pas de Rattacher', () => {
    renderOsCard()
    fireEvent.change(effetSelect(), { target: { value: 'confirm' } })
    expect(screen.queryByText('Rattacher à un Engagement existant')).not.toBeInTheDocument()
    expect(screen.getByText('Validez la qualification avant de poursuivre.')).toBeInTheDocument()
  })

  it('OS CONFIRM validé → Appliquer l’effet contractuel visible', async () => {
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
    expect(screen.getByText('Appliquer l’effet contractuel')).toBeInTheDocument()
  })

  it('CONFIRM cible A validé → CTA verrouillé sur A, pas de picker générique', () => {
    renderOsCard(
      {
        source_payload: {
          kind: 'controle', category: 'compliance', measurable: true,
          frequency_raw: 'mensuel', ai_confidence: 0.9,
          contract_effect: {
            effect: 'confirm', temporality: 'permanent', targetEngagementId: 'eng-A',
            startsOn: null, endsOn: null, resumeOn: null, scope: null,
          },
        },
      },
      [makeEngagement()],
    )

    // Le libellé apparaît deux fois : dans le formulaire de qualification (déjà
    // rempli avec la cible persistée) et dans le bandeau de confirmation
    // verrouillée — seule la présence compte ici, pas l'unicité.
    expect(screen.getAllByText('Signalement incendie — Engagement A').length).toBeGreaterThan(0)
    expect(screen.getByText('Appliquer l’effet contractuel')).toBeInTheDocument()
    expect(screen.queryByText('Rattacher à cet Engagement')).not.toBeInTheDocument()
    expect(screen.queryByText('Rattacher à un Engagement existant')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Appliquer l’effet contractuel'))
    expect(mockMaterializeContractEffect).toHaveBeenCalledTimes(1)
    expect(mockLink).not.toHaveBeenCalled()
    const fd = mockMaterializeContractEffect.mock.calls[0][0] as FormData
    expect(fd.get('proposal_id')).toBe('prop-os-1')
    expect(fd.get('document_id')).toBe('doc-os-1')
    expect(fd.get('engagement_id')).toBeNull()
  })

  // Correctif défaut 2 (revue Vincent/ChatGPT 2026-09-29) : MODIFY validé ne
  // doit jamais afficher « Appliquer l'effet contractuel » — cette UX ne
  // collecte qu'un texte libre humain, aucune structure effect_payload
  // générique n'existe encore. La qualification reste visible comme validée ;
  // seule l'application est expliquée comme indisponible.
  it('OS MODIFY validé → pas de CTA Appliquer, message d’indisponibilité affiché', () => {
    renderOsCard({
      source_payload: {
        kind: 'controle', category: 'compliance', measurable: true,
        frequency_raw: 'mensuel', ai_confidence: 0.9,
        contract_effect: {
          effect: 'modify', temporality: 'permanent', targetEngagementId: 'eng-1',
          startsOn: null, endsOn: null, resumeOn: null, scope: 'Zone Z2',
          scopeKey: 'frequency', effectPayload: { description: 'passage à 3x/semaine' },
        },
      },
    })
    expect(screen.queryByText('Appliquer l’effet contractuel')).not.toBeInTheDocument()
    expect(screen.getByText(/Application indisponible pour l’instant/)).toBeInTheDocument()
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
    // Qualification déjà validée dès le rendu initial — CTA visible.
    expect(screen.getByText('Appliquer l’effet contractuel')).toBeInTheDocument()

    // L'utilisateur modifie l'effet : la qualification redevient dirty.
    fireEvent.change(effetSelect(), { target: { value: 'confirm' } })

    expect(screen.queryByText('Appliquer l’effet contractuel')).not.toBeInTheDocument()
    expect(screen.queryByText('Créer un nouvel Engagement')).not.toBeInTheDocument()
    expect(screen.queryByText('Rattacher à un Engagement existant')).not.toBeInTheDocument()
    expect(screen.getByText('Validez la qualification avant de poursuivre.')).toBeInTheDocument()
  })
})
