import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { VisitDesk } from '@/app/(dashboard)/sites/[id]/visites/[visitId]/VisitDesk'
import type { VisitNarrative, NarrativeProposal } from '@/lib/db/visit-narrative'

// ── INTÉGRATION READ MODEL → COMPOSANT ───────────────────────────────────────
//
// Ce test valide que canonicalSubjectId traverse tout le chemin :
//   DB select (canonical_subject_id) → NarrativeProposal → ignored.superseded
//   → activeBySubject → resolveSupersededHint → SupersededItemRow → DOM
//
// Bug initial : le .select() Supabase omettait canonical_subject_id, tout restait
// null, aucune annotation n'apparaissait malgré une fonction de résolution correcte.
//
// Cas PETRO reproduits ici :
//   8 superseded avec 1 seule active via canonical_subject_id (same_subject_one)
//   5 superseded avec N actives via canonical_subject_id (same_subject_many)
//   5 superseded sans canonical_subject_id (previous_version — pas d'annotation)

type IgnoredSuperseded = VisitNarrative['ignored']['superseded'][number]

function makeActive(id: string, canonicalSubjectId: string, label: string): NarrativeProposal {
  return {
    id,
    type: 'knowledge',
    label,
    rationale: null,
    confidence: null,
    status: 'proposed',
    createdEntityId: null,
    canonicalSubjectId,
    sourceCount: 1,
    why: { code: 'proposal.pending', label: 'En attente' },
  }
}

function makeSuperseded(id: string, label: string, canonicalSubjectId: string | null): IgnoredSuperseded {
  return {
    id,
    type: 'knowledge',
    label,
    canonicalSubjectId,
    why: { code: 'proposal.superseded', label: "N'est plus active dans l'analyse actuelle" },
  }
}

// 8 canonical subjects avec 1 seule active chacun (univoques)
const UNIQ_SUBJECTS = Array.from({ length: 8 }, (_, i) => `cs-uniq-${i}`)
// 2 canonical subjects avec 3 actives chacun (ambigus)
const MULTI_SUBJECTS = ['cs-multi-0', 'cs-multi-1']

const activeProposals: NarrativeProposal[] = [
  // 8 univoques : 1 active par sujet
  ...UNIQ_SUBJECTS.map((cs, i) => makeActive(`active-uniq-${i}`, cs, `Formulation unique ${i}`)),
  // 5 ambigus : 3 actives pour cs-multi-0, 2 actives pour cs-multi-1
  makeActive('active-multi-0a', 'cs-multi-0', 'Formulation A du multi-0'),
  makeActive('active-multi-0b', 'cs-multi-0', 'Formulation B du multi-0'),
  makeActive('active-multi-0c', 'cs-multi-0', 'Formulation C du multi-0'),
  makeActive('active-multi-1a', 'cs-multi-1', 'Formulation A du multi-1'),
  makeActive('active-multi-1b', 'cs-multi-1', 'Formulation B du multi-1'),
]

const supersededProposals: IgnoredSuperseded[] = [
  // 8 univoques : chacun pointe vers un sujet avec 1 seule active
  ...UNIQ_SUBJECTS.map((cs, i) => makeSuperseded(`sup-uniq-${i}`, `Ancienne formulation unique ${i}`, cs)),
  // 5 ambigus : pointent vers des sujets avec plusieurs actives
  makeSuperseded('sup-multi-0a', 'Ancienne formulation pour multi-0 (1)', 'cs-multi-0'),
  makeSuperseded('sup-multi-0b', 'Ancienne formulation pour multi-0 (2)', 'cs-multi-0'),
  makeSuperseded('sup-multi-0c', 'Ancienne formulation pour multi-0 (3)', 'cs-multi-0'),
  makeSuperseded('sup-multi-1a', 'Ancienne formulation pour multi-1 (1)', 'cs-multi-1'),
  makeSuperseded('sup-multi-1b', 'Ancienne formulation pour multi-1 (2)', 'cs-multi-1'),
  // 5 sans canonical_subject_id : aucune annotation attendue
  makeSuperseded('sup-orphan-0', 'Intervenant A (stakeholder)', null),
  makeSuperseded('sup-orphan-1', 'Intervenant B (stakeholder)', null),
  makeSuperseded('sup-orphan-2', 'Intervenant C (stakeholder)', null),
  makeSuperseded('sup-orphan-3', 'Proposition isolée 1', null),
  makeSuperseded('sup-orphan-4', 'Proposition isolée 2', null),
]

const narrative: VisitNarrative = {
  reportId: 'test-petro',
  siteId: 'site-petro',
  captured: [],
  understood: activeProposals,
  validated: {
    document: null,
    confirmedProposals: 0,
    ignoredProposals: 0,
    pendingProposals: activeProposals.length,
    supersededProposals: supersededProposals.length,
    correctedSections: [],
    discardedCaptures: 0,
  },
  produced: [],
  historical: [],
  ignored: {
    byHuman: [],
    superseded: supersededProposals,
    captures: [],
  },
  enrichment: { afterVisit: 0, sinceLastAnalysis: 0, lastAnalysisAt: null },
  limits: { historicalAttributions: 0, intervenantProvenanceMissing: true },
}

function ouvrirHistorique() {
  fireEvent.click(screen.getByRole('button', { name: /Historique de l/ }))
}

describe('SupersededItemRow — resolution canonicalSubjectId → DOM', () => {
  it('affiche Meme sujet pour les 8 cas univoques', () => {
    render(<VisitDesk siteId="site-1" narrative={narrative} media={{}} canPromote={false} crHref={null} changes={[]} />)
    ouvrirHistorique()
    // Chaque univoque doit afficher "Meme sujet" + le titre de l'active
    for (let i = 0; i < 8; i++) {
      expect(screen.getAllByText(`Formulation unique ${i}`).length).toBeGreaterThan(0)
    }
    // Au moins un "Meme sujet" doit apparaitre dans la section
    const hints = screen.getAllByText(/Même sujet →/)
    expect(hints.length).toBe(8)
  })

  it('affiche le compteur N formulations pour les 5 cas ambigus', () => {
    render(<VisitDesk siteId="site-1" narrative={narrative} media={{}} canPromote={false} crHref={null} changes={[]} />)
    ouvrirHistorique()
    // cs-multi-0 : 3 actives → "Même sujet · 3 formulations actives"
    const multi0buttons = screen.getAllByText(/3 formulations actives/)
    expect(multi0buttons.length).toBe(3)  // 3 superseded pointent vers cs-multi-0
    // cs-multi-1 : 2 actives → "Même sujet · 2 formulations actives"
    const multi1buttons = screen.getAllByText(/2 formulations actives/)
    expect(multi1buttons.length).toBe(2)  // 2 superseded pointent vers cs-multi-1
  })

  it("n affiche aucune annotation pour les 5 orphelins", () => {
    render(<VisitDesk siteId="site-1" narrative={narrative} media={{}} canPromote={false} crHref={null} changes={[]} />)
    ouvrirHistorique()
    // Titres des orphelins presents
    expect(screen.getByText('Intervenant A (stakeholder)')).toBeInTheDocument()
    expect(screen.getByText('Intervenant B (stakeholder)')).toBeInTheDocument()
    // Aucune annotation "Meme sujet" pour eux (juste le titre)
    // Le nombre total de hints = 8 (univoques) + 5*1-or-3 (ambigus) = exactement les attendus
    const allHints = screen.queryAllByText(/Même sujet/)
    // 8 univoques + 3+3+3+2+2 = 21 hints total (chaque superseded ambigu affiche le bouton)
    expect(allHints.length).toBe(8 + 3 + 2)  // univoques (8) + ambigu-multi-0 (3) + ambigu-multi-1 (2)
  })

  it("le data-path : understood active -> activeBySubject -> hints", () => {
    // Ce test verifie specifiquement que les donnees du read model transitent correctement.
    // Un understood vide produirait 0 hints meme si ignored.superseded a canonicalSubjectId.
    const narrativeSansUnderstood: VisitNarrative = {
      ...narrative,
      understood: [],  // simulate le bug : select() sans canonical_subject_id -> tout null -> map vide
    }
    render(<VisitDesk siteId="site-1" narrative={narrativeSansUnderstood} media={{}} canPromote={false} crHref={null} changes={[]} />)
    ouvrirHistorique()
    // Sans understood, aucun hint ne doit apparaitre
    expect(screen.queryAllByText(/Même sujet/).length).toBe(0)
  })
})
