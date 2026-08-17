// P5-F2b — doctrine test des cartes de correction/obsolescence de la mémoire
// (Vincent, 2026-08-17). Couvre les invariants qui ne se lisent pas dans un
// test de routeur ni de primitive DB : ceux qui ne vivent QUE dans la carte.
//
//   - aucun candidat présélectionné (radio checked au montage) ;
//   - plusieurs candidats restent réellement plusieurs candidats (pas de
//     collapse à un seul choix) ;
//   - liste de candidats vide → aucune écriture possible (bouton disabled,
//     jamais d'appel serveur) ;
//   - archivage et supersession restent deux chemins distincts (deux actions
//     serveur différentes, jamais interchangeables).
//
// listRecentCurrentInformationEntries (max 5 / current_information seule /
// jamais durable_knowledge) est déjà couvert par
// tests/lib/site-memory-entries-lifecycle.test.ts — pas dupliqué ici.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import {
  KnowledgeSupersessionProposalCard,
  KnowledgeArchiveProposalCard,
} from '@/components/copilot/CopilotProposalCards'
import {
  buildKnowledgeSupersessionProposal,
  buildKnowledgeArchiveProposal,
  type KnowledgeCorrectionCandidate,
} from '@/lib/visits/copilot-proposal'

const createCopilotKnowledgeSupersession = vi.fn()
const createCopilotKnowledgeArchive = vi.fn()
vi.mock('@/app/(dashboard)/sites/[id]/copilot-write-action', () => ({
  createCopilotKnowledgeSupersession: (input: unknown) => createCopilotKnowledgeSupersession(input),
  createCopilotKnowledgeArchive: (input: unknown) => createCopilotKnowledgeArchive(input),
}))
vi.mock('@/app/(dashboard)/sites/[id]/copilot-event-action', () => ({
  trackCopilotProposalCancelled: vi.fn(),
}))

const SITE_ID = '33333333-3333-3333-3333-333333333333'

function candidate(id: string, title: string): KnowledgeCorrectionCandidate {
  return { id, title, body: null, confirmedAt: '2026-08-10T08:00:00Z' }
}

const ONE = [candidate('entry-1', 'Jérôme passe demain matin')]
const THREE = [
  candidate('entry-1', 'Jérôme passe demain matin'),
  candidate('entry-2', 'Le code actuel est 4812'),
  candidate('entry-3', 'Accès chantier ouvert 7h-17h'),
]

beforeEach(() => {
  createCopilotKnowledgeSupersession.mockReset()
  createCopilotKnowledgeArchive.mockReset()
  createCopilotKnowledgeSupersession.mockResolvedValue({ ok: true, entryId: 'new-entry' })
  createCopilotKnowledgeArchive.mockResolvedValue({ ok: true })
})

describe('KnowledgeSupersessionProposalCard — aucune présélection', () => {
  it('au montage, aucun radio (candidats ni "Aucune de celles-ci") n\'est coché', () => {
    const proposal = buildKnowledgeSupersessionProposal({ newTitle: 'Jérôme passe lundi', candidates: THREE })
    render(<KnowledgeSupersessionProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.some((r) => r.checked)).toBe(false)
  })

  it('bouton Valider disabled tant qu\'aucun choix n\'est fait', () => {
    const proposal = buildKnowledgeSupersessionProposal({ newTitle: 'Jérôme passe lundi', candidates: THREE })
    render(<KnowledgeSupersessionProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    expect(screen.getByRole('button', { name: /valider/i })).toBeDisabled()
  })
})

describe('KnowledgeSupersessionProposalCard — plusieurs candidats restent plusieurs candidats', () => {
  it('3 candidats fournis → 3 radios candidats + 1 radio "Aucune de celles-ci" = 4', () => {
    const proposal = buildKnowledgeSupersessionProposal({ newTitle: 'Jérôme passe lundi', candidates: THREE })
    render(<KnowledgeSupersessionProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    THREE.forEach((c) => expect(screen.getByText(c.title)).toBeInTheDocument())
  })
})

describe('KnowledgeSupersessionProposalCard — sélection explicite requise avant écriture', () => {
  it('choisir un candidat puis Valider → createCopilotKnowledgeSupersession avec oldEntryId = ce candidat', async () => {
    const proposal = buildKnowledgeSupersessionProposal({ newTitle: 'Jérôme passe lundi', candidates: THREE })
    render(<KnowledgeSupersessionProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    fireEvent.click(screen.getByText('Le code actuel est 4812'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /valider/i }))
    })
    await waitFor(() => expect(createCopilotKnowledgeSupersession).toHaveBeenCalledTimes(1))
    expect(createCopilotKnowledgeSupersession).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: SITE_ID, oldEntryId: 'entry-2' }),
    )
  })

  it('choisir « Aucune de celles-ci » → oldEntryId: null (crée une information indépendante, chemin FACT)', async () => {
    const proposal = buildKnowledgeSupersessionProposal({ newTitle: 'Jérôme passe lundi', candidates: THREE })
    render(<KnowledgeSupersessionProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    fireEvent.click(screen.getByText(/aucune de celles-ci/i))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /valider/i }))
    })
    await waitFor(() => expect(createCopilotKnowledgeSupersession).toHaveBeenCalledTimes(1))
    expect(createCopilotKnowledgeSupersession).toHaveBeenCalledWith(
      expect.objectContaining({ oldEntryId: null }),
    )
    // Chemin distinct de l'archivage : jamais createCopilotKnowledgeArchive.
    expect(createCopilotKnowledgeArchive).not.toHaveBeenCalled()
  })

  it('liste de candidats vide → pas de radio candidat, "Aucune de celles-ci" reste le seul choix possible', () => {
    const proposal = buildKnowledgeSupersessionProposal({ newTitle: 'Jérôme passe lundi', candidates: [] })
    render(<KnowledgeSupersessionProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /valider/i })).toBeDisabled()
  })
})

describe('KnowledgeArchiveProposalCard — aucune présélection, liste vide = aucune écriture possible', () => {
  it('au montage avec plusieurs candidats, aucun radio coché et Valider disabled', () => {
    const proposal = buildKnowledgeArchiveProposal({ candidates: THREE })
    render(<KnowledgeArchiveProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios).toHaveLength(3)
    expect(radios.some((r) => r.checked)).toBe(false)
    expect(screen.getByRole('button', { name: /valider/i })).toBeDisabled()
  })

  it('liste de candidats vide → aucun radio, message explicite, Valider disabled (aucune écriture possible)', () => {
    const proposal = buildKnowledgeArchiveProposal({ candidates: [] })
    render(<KnowledgeArchiveProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.getByText(/aucune information actuelle/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /valider/i })).toBeDisabled()
  })

  it('un seul candidat → proposition d\'archivage directement sur ce candidat, toujours sans présélection', () => {
    const proposal = buildKnowledgeArchiveProposal({ candidates: ONE })
    render(<KnowledgeArchiveProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios).toHaveLength(1)
    expect(radios[0].checked).toBe(false)
  })

  it('choisir un candidat puis Valider → createCopilotKnowledgeArchive avec entryId, jamais la supersession', async () => {
    const proposal = buildKnowledgeArchiveProposal({ candidates: THREE })
    render(<KnowledgeArchiveProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    fireEvent.click(screen.getByText('Accès chantier ouvert 7h-17h'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /valider/i }))
    })
    await waitFor(() => expect(createCopilotKnowledgeArchive).toHaveBeenCalledTimes(1))
    expect(createCopilotKnowledgeArchive).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: SITE_ID, entryId: 'entry-3' }),
    )
    expect(createCopilotKnowledgeSupersession).not.toHaveBeenCalled()
  })
})
