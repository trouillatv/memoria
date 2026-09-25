// SUIVI-1 — VisitOutcomeSummaryCard, témoin réel Sextant. Prouve que le
// statut du CR (crStatus, déjà transporté par le read-model) est bien rendu
// à l'écran, et que le wording "à rattacher" n'affirme pas un état définitif.

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VisitOutcomeSummaryCard } from '@/app/(field)/m/visite/[reportId]/cr/VisitOutcomeSummaryCard'
import type { VisitOutcomeSummary } from '@/lib/db/visit-outcome-summary'

const SUBJECT_ID = 'ece93032-1ef4-4bb3-9e92-55acb75b9062'

const SEXTANT_SUMMARY: VisitOutcomeSummary = {
  visitId: 'ad4abcd2-18e5-4b7f-9f52-e8617a1b764f',
  siteId: '90bdfbd3-d4bb-44c4-bf61-28ade78b4df2',
  crStatus: 'draft',
  produced: { proposals: [] },
  materialized: {
    proposals: [
      {
        ref: { id: 'e891c84a-f536-4638-a1c4-474e4a213013', type: 'proposal' },
        kind: 'action',
        status: 'proposed',
        title: 'Intégrer le nettoyage des murs par salle dans les roulements de la cuisine du Sextant',
        canonicalSubjectId: SUBJECT_ID,
        canonicalSubjectLabel: 'Nettoyage des murs par salle — roulements cuisine',
        canonicalResolutionStatus: 'resolved',
      },
    ],
  },
  pending: {
    traces: [
      {
        ref: { id: 'd3c888bb-9200-4d44-aa05-0b37113b1dae', type: 'pending_trace' },
        reason: 'Founding unit (scope=thread) sans famille actionnable classifiable — trackability indéterminée (5E V2).',
        evidenceStatus: 'unresolved',
        createdAt: '2026-09-24T19:02:42.784758+00:00',
        canonicalSubjectId: SUBJECT_ID,
        canonicalSubjectLabel: 'Nettoyage des murs par salle — roulements cuisine',
      },
    ],
  },
  unresolved: {
    orphanedProposals: [
      {
        ref: { id: '8cfb54a5-e808-4ddc-b4f0-1c0ccee6f49f', type: 'proposal' },
        kind: 'action',
        status: 'proposed',
        title: "Préparer une nouvelle offre de prestations d'entretien",
        canonicalSubjectId: null,
        canonicalSubjectLabel: null,
        canonicalResolutionStatus: 'not_found',
      },
      {
        ref: { id: 'e939e818-3461-4dfe-b8e0-a9b7487a6fec', type: 'proposal' },
        kind: 'action',
        status: 'proposed',
        title: 'Organiser une intervention pour le nettoyage des vitres des salles de banquets',
        canonicalSubjectId: null,
        canonicalSubjectLabel: null,
        canonicalResolutionStatus: 'not_found',
      },
      {
        ref: { id: '13d954fa-4aaf-4166-bf97-80283082a498', type: 'proposal' },
        kind: 'deadline',
        status: 'proposed',
        title: 'Intervention pour le nettoyage des vitres des salles de banquets',
        canonicalSubjectId: null,
        canonicalSubjectLabel: null,
        canonicalResolutionStatus: 'not_found',
      },
    ],
    actors: [{ ref: { id: 'Monsieur Cope', type: 'actor' }, rawText: 'Monsieur Cope' }],
  },
  memoryIndexed: false,
}

describe('VisitOutcomeSummaryCard — témoin Sextant', () => {
  it('affiche le CR comme brouillon non validé, une fois déplié', () => {
    render(<VisitOutcomeSummaryCard summary={SEXTANT_SUMMARY} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Brouillon — à valider')).toBeInTheDocument()
  })

  it('affiche la mémoire comme non indexée', () => {
    render(<VisitOutcomeSummaryCard summary={SEXTANT_SUMMARY} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Pas encore indexée')).toBeInTheDocument()
  })

  it('titre le groupe orphelin "À rattacher à un sujet" (non définitif)', () => {
    render(<VisitOutcomeSummaryCard summary={SEXTANT_SUMMARY} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('À rattacher à un sujet')).toBeInTheDocument()
    expect(screen.queryByText(/Jamais rattaché/)).not.toBeInTheDocument()
  })

  it('affiche le sujet matérialisé, les 3 orphelins, la trace en attente et Monsieur Cope', () => {
    render(<VisitOutcomeSummaryCard summary={SEXTANT_SUMMARY} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Rattaché à un sujet suivi')).toBeInTheDocument()
    expect(screen.getByText("Préparer une nouvelle offre de prestations d'entretien")).toBeInTheDocument()
    expect(screen.getByText('Organiser une intervention pour le nettoyage des vitres des salles de banquets')).toBeInTheDocument()
    expect(screen.getByText('Intervention pour le nettoyage des vitres des salles de banquets')).toBeInTheDocument()
    expect(screen.getByText("En attente d'une décision de suivi")).toBeInTheDocument()
    expect(screen.getByText('Monsieur Cope')).toBeInTheDocument()
  })
})

// SUIVI-2A — la carte devient un hub de NAVIGATION vers les surfaces où le
// geste métier existe déjà. Aucun bouton d'action ici : uniquement des liens.
describe('VisitOutcomeSummaryCard — CTA de découvrabilité (SUIVI-2A)', () => {
  it('les 2 actions + 1 échéance orphelines renvoient vers /actions#propositions', () => {
    render(<VisitOutcomeSummaryCard summary={SEXTANT_SUMMARY} />)
    fireEvent.click(screen.getByRole('button'))
    const link = screen.getByRole('link', { name: /Ouvrir les propositions/ })
    expect(link).toHaveAttribute('href', '/sites/90bdfbd3-d4bb-44c4-bf61-28ade78b4df2/actions#propositions')
  })

  it('la trace Live Writer en attente renvoie vers Besoin de toi', () => {
    render(<VisitOutcomeSummaryCard summary={SEXTANT_SUMMARY} />)
    fireEvent.click(screen.getByRole('button'))
    const link = screen.getByRole('link', { name: /Ouvrir Besoin de toi/ })
    expect(link).toHaveAttribute('href', '/sites/90bdfbd3-d4bb-44c4-bf61-28ade78b4df2/besoin-de-toi')
  })

  it('Monsieur Cope renvoie vers la page de compréhension de la visite', () => {
    render(<VisitOutcomeSummaryCard summary={SEXTANT_SUMMARY} />)
    fireEvent.click(screen.getByRole('button'))
    const link = screen.getByRole('link', { name: /Identifier l'intervenant/ })
    expect(link).toHaveAttribute('href', '/m/visite/ad4abcd2-18e5-4b7f-9f52-e8617a1b764f/comprehension')
  })
})
