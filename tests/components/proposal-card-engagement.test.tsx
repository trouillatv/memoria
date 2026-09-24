// P0-2C — curation humaine des propositions Engagement avant matérialisation.
// Couvre le comportement CÔTÉ UI (ProposalCard) : les garanties serveur
// (cross-org, cross-site, idempotence RPC) sont déjà prouvées au niveau base
// dans tests/lib/db/materialize-engagement-contract.test.ts ; ce fichier
// vérifie que ProposalCard les respecte (jamais de contournement côté client)
// et surface fidèlement les erreurs serveur, sans les avaler.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProposalCard } from '@/app/(dashboard)/documents/[id]/extraction/[runId]/ProposalCard'
import type { DbDocumentExtractionProposal, DbEngagement, DbDocumentProposalMaterialization } from '@/types/db'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const mockCreate = vi.fn()
const mockLink = vi.fn()
const mockAccept = vi.fn()
const mockReject = vi.fn()
const mockReset = vi.fn()
const mockEdit = vi.fn()

vi.mock('@/app/(dashboard)/documents/[id]/extraction/[runId]/review-actions', () => ({
  acceptProposalAction: (...args: unknown[]) => mockAccept(...args),
  editProposalAction: (...args: unknown[]) => mockEdit(...args),
  rejectProposalAction: (...args: unknown[]) => mockReject(...args),
  resetProposalAction: (...args: unknown[]) => mockReset(...args),
  updatePersonAttendanceAction: vi.fn(),
  createEngagementFromProposalAction: (...args: unknown[]) => mockCreate(...args),
  linkEngagementToProposalAction: (...args: unknown[]) => mockLink(...args),
}))

function makeEngagementProposal(overrides: Partial<DbDocumentExtractionProposal> = {}): DbDocumentExtractionProposal {
  return {
    id: 'prop-1',
    organization_id: 'org-1',
    extraction_run_id: 'run-1',
    document_id: 'doc-1',
    target_site_id: 'site-1',
    proposal_family: 'engagement',
    stable_key: null,
    label: 'Nettoyage mensuel des VMC',
    description: 'Le prestataire nettoie les VMC une fois par mois',
    source_page: 4,
    source_excerpt: 'Le titulaire procède au nettoyage mensuel des groupes VMC.',
    source_payload: {
      kind: 'obligation',
      category: 'frequency',
      measurable: true,
      frequency_raw: 'mensuel',
      ai_confidence: 0.82,
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
    created_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as DbDocumentExtractionProposal
}

function makeEngagement(overrides: Partial<DbEngagement> = {}): DbEngagement {
  return {
    id: 'eng-existing-1',
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
    short_label: 'VMC — entretien annuel',
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

function renderCard(opts: {
  proposal?: Partial<DbDocumentExtractionProposal>
  siteEngagements?: DbEngagement[]
  materializations?: DbDocumentProposalMaterialization[]
} = {}) {
  return render(
    <ProposalCard
      proposal={makeEngagementProposal(opts.proposal)}
      evidence={[]}
      signedUrls={{}}
      documentId="doc-1"
      siteEngagements={opts.siteEngagements}
      materializations={opts.materializations}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProposalCard — Engagement — Affichage', () => {
  it('affiche la preuve documentaire toujours visible, sans repli/dépliage', () => {
    renderCard()
    // Pas de <summary>/<details> à ouvrir : tout est déjà dans le DOM.
    expect(screen.getByText('mensuel')).toBeInTheDocument()
    expect(screen.getByText('Oui')).toBeInTheDocument() // mesurable
    expect(screen.getByText('82%')).toBeInTheDocument() // confiance IA
    expect(screen.getByText('4')).toBeInTheDocument() // page
    expect(screen.getByText(/nettoyage mensuel des groupes VMC/)).toBeInTheDocument()
  })
})

describe('ProposalCard — Engagement — Pending bloque la matérialisation', () => {
  it('une proposition encore pending ne montre aucun bouton Créer/Rattacher', () => {
    renderCard({ proposal: { review_status: 'pending' } })
    expect(screen.queryByText('Créer un nouvel Engagement')).not.toBeInTheDocument()
    expect(screen.queryByText('Rattacher à un Engagement existant')).not.toBeInTheDocument()
    expect(screen.getByText(/Acceptez ou corrigez la proposition/)).toBeInTheDocument()
  })
})

describe('ProposalCard — Engagement — Reject', () => {
  it('Refuser appelle rejectProposalAction et bascule le badge sur Refusée', async () => {
    mockReject.mockResolvedValue({ ok: true })
    renderCard()
    fireEvent.click(screen.getByText('Refuser'))
    await waitFor(() => expect(mockReject).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getAllByText('Refusée').length).toBeGreaterThan(0))
  })
})

describe('ProposalCard — Engagement — Edit (correction humaine catégorie/nature/mesurable)', () => {
  it('la correction humaine de catégorie/nature/mesurable est envoyée au serveur, pas le brut IA', async () => {
    mockCreate.mockResolvedValue({ ok: true, engagementId: 'eng-new-1' })
    renderCard()

    fireEvent.change(screen.getByDisplayValue('Fréquence'), { target: { value: 'compliance' } })
    fireEvent.change(screen.getByDisplayValue('Obligation'), { target: { value: 'controle' } })
    fireEvent.click(screen.getByLabelText('Mesurable (confirmé humainement)'))

    fireEvent.click(screen.getByText('Créer un nouvel Engagement'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    const fd = mockCreate.mock.calls[0][0] as FormData
    expect(fd.get('category')).toBe('compliance')
    expect(fd.get('kind')).toBe('controle')
    expect(fd.get('measurable')).toBe('false') // décoché depuis true
    expect(fd.get('proposal_id')).toBe('prop-1')
    expect(fd.get('document_id')).toBe('doc-1')
  })
})

describe('ProposalCard — Engagement — Create new', () => {
  it('crée un nouvel Engagement et passe en état matérialisé (curated, jamais actif)', async () => {
    mockCreate.mockResolvedValue({ ok: true, engagementId: 'eng-new-1' })
    renderCard()
    fireEvent.click(screen.getByText('Créer un nouvel Engagement'))
    await waitFor(() => expect(screen.getByText('Matérialisée')).toBeInTheDocument())
    // Curated-never-active : aucun bouton d'activation n'existe dans ce parcours.
    expect(screen.queryByText(/Activer/)).not.toBeInTheDocument()
  })

  it('affiche l’erreur serveur sans la masquer', async () => {
    mockCreate.mockResolvedValue({ ok: false, error: 'aucune preuve associée à cette proposition' })
    renderCard()
    fireEvent.click(screen.getByText('Créer un nouvel Engagement'))
    await waitFor(() => expect(screen.getByText('aucune preuve associée à cette proposition')).toBeInTheDocument())
  })
})

describe('ProposalCard — Engagement — Link existing', () => {
  it('ouvre le sélecteur, filtre par recherche, et rattache à l’Engagement choisi', async () => {
    mockLink.mockResolvedValue({ ok: true, engagementId: 'eng-existing-1' })
    const siteEngagements = [makeEngagement(), makeEngagement({ id: 'eng-2', short_label: 'Extincteurs — contrôle' })]
    renderCard({ siteEngagements })

    fireEvent.click(screen.getByText('Rattacher à un Engagement existant'))
    fireEvent.change(screen.getByPlaceholderText('Rechercher un Engagement du chantier…'), { target: { value: 'VMC' } })
    expect(screen.getByText('VMC — entretien annuel')).toBeInTheDocument()
    expect(screen.queryByText('Extincteurs — contrôle')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('VMC — entretien annuel'))

    await waitFor(() => expect(mockLink).toHaveBeenCalledTimes(1))
    const fd = mockLink.mock.calls[0][0] as FormData
    expect(fd.get('proposal_id')).toBe('prop-1')
    expect(fd.get('document_id')).toBe('doc-1')
    expect(fd.get('engagement_id')).toBe('eng-existing-1')
  })

  it('surface une erreur cross-site renvoyée par le serveur sans la masquer', async () => {
    mockLink.mockResolvedValue({ ok: false, error: 'rattachement cross-site refusé' })
    renderCard({ siteEngagements: [makeEngagement()] })
    fireEvent.click(screen.getByText('Rattacher à un Engagement existant'))
    fireEvent.click(screen.getByText('VMC — entretien annuel'))
    await waitFor(() => expect(screen.getByText('rattachement cross-site refusé')).toBeInTheDocument())
  })
})

describe('ProposalCard — Engagement — Idempotence et Provenance après matérialisation', () => {
  it('une fois matérialisée, les contrôles de création/rattachement disparaissent mais la preuve reste visible', async () => {
    const materializations: DbDocumentProposalMaterialization[] = [{
      id: 'mat-1', organization_id: 'org-1', proposal_id: 'prop-1',
      target_entity_type: 'engagement', target_entity_id: 'eng-existing-1',
      status: 'done', error_message: null, created_at: '2026-09-02T00:00:00.000Z', created_by: null,
    }]
    renderCard({
      proposal: { review_status: 'materialized' },
      siteEngagements: [makeEngagement()],
      materializations,
    })

    expect(screen.queryByText('Créer un nouvel Engagement')).not.toBeInTheDocument()
    expect(screen.queryByText('Rattacher à un Engagement existant')).not.toBeInTheDocument()
    // Provenance toujours visible, pas seulement avant matérialisation.
    expect(screen.getByText(/nettoyage mensuel des groupes VMC/)).toBeInTheDocument()
    expect(screen.getByText(/Rattaché à l.Engagement « VMC — entretien annuel »/)).toBeInTheDocument()
  })
})
