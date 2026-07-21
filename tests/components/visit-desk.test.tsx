import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { VisitDesk } from '@/app/(dashboard)/sites/[id]/visites/[visitId]/VisitDesk'
import type { VisitNarrative, NarrativeProposal } from '@/lib/db/visit-narrative'

// ── LA PAGE DE VISITE COMME BUREAU DE TRAITEMENT ───────────────────────────
//
// « Arrêtons de penser cette page comme un rapport. » Ce qui compte : ce qui
// s'est passé, ce que MemorIA en a compris, ce qui attend une décision.
// L'audit descend en bas. Et rien n'est affiché que la base ne démontre.

const vide: VisitNarrative = {
  reportId: 'visit-1',
  siteId: 'site-1',
  captured: [],
  understood: [],
  validated: {
    document: null,
    confirmedProposals: 0,
    ignoredProposals: 0,
    pendingProposals: 0,
    supersededProposals: 0,
    correctedSections: [],
    discardedCaptures: 0,
  },
  produced: [],
  ignored: { byHuman: [], superseded: [], captures: [] },
  enrichment: { afterVisit: 0, sinceLastAnalysis: 0, lastAnalysisAt: null },
  limits: { historicalAttributions: 0, intervenantProvenanceMissing: true },
}

const prop = (over: Partial<NarrativeProposal>): NarrativeProposal => ({
  id: 'p-0',
  type: 'action',
  label: 'Communiquer le code d’accès',
  rationale: 'L’accès sécurisé est nécessaire pour l’ensemble des intervenants.',
  confidence: null,
  status: 'proposed',
  createdEntityId: null,
  sourceCount: 2,
  why: { code: 'proposal.pending', label: 'Proposée par MemorIA, en attente d’arbitrage' },
  ...over,
})

const peuple = (): VisitNarrative => ({
  ...vide,
  captured: [
    {
      id: 'cap-1',
      kind: 'vocal',
      body: 'La dépose du faux plafond est lancée. L’accès se fera par le portail arrière.',
      capturedAt: '2026-07-20T07:12:00Z',
      lat: null,
      lng: null,
      kept: true,
      intent: 'reserve',
      attachmentId: 'att-1',
      addedAt: '2026-07-20T07:12:00Z',
      addedAfterVisit: false,
      sinceLastAnalysis: false,
      dateSource: null,
      why: { code: 'capture.tagged.reserve', label: 'Retenue, taguée « réserve à lever »' },
    },
    {
      id: 'cap-2',
      kind: 'photo',
      body: 'Tableau électrique — détail du dépôt de suie',
      capturedAt: '2026-07-20T13:46:00Z',
      lat: null,
      lng: null,
      kept: true,
      intent: null,
      attachmentId: null,
      addedAt: '2026-07-22T09:12:00Z',
      addedAfterVisit: true,
      sinceLastAnalysis: true,
      dateSource: 'file',
      why: { code: 'capture.kept', label: 'Retenue comme élément à conserver' },
    },
  ],
  understood: [
    prop({ id: 'p-1', type: 'action', label: 'Communiquer le code d’accès' }),
    prop({ id: 'p-2', type: 'deadline', label: 'Dépose hottes, gaines, chambre froide' }),
    prop({ id: 'p-3', type: 'stakeholder', label: 'Clim Expert', sourceCount: 1 }),
    prop({ id: 'p-4', type: 'knowledge', label: 'Retard dans l’avancement', status: 'confirmed' }),
  ],
})

describe('l’ordre est celui de la lecture, pas celui du pipeline', () => {
  it('ouvre sur ce qui s’est passé', () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByText(/Ce qui s’est passé pendant cette visite/)).toBeInTheDocument()
  })

  it('range les propositions par FAMILLE — le cerveau ne lit pas une liste plate', () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    // Chaque famille a sa carte — le nom réapparaît sur l'étiquette d'arbitrage.
    for (const f of ['Actions', 'Échéances', 'Intervenants', 'À savoir']) {
      expect(screen.getAllByText(f).length).toBeGreaterThan(0)
    }
  })

  it('met l’audit en bas, et replié', () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByRole('button', { name: /Ce qui n’a pas été retenu/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})

describe('ce qui demande une décision est le vrai travail', () => {
  it('liste les propositions en attente, jamais les tranchées', () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote crHref="/m/visite/visit-1/cr" />)
    const bloc = screen.getByText('Décisions en attente d’arbitrage').closest('section')!
    expect(bloc).toHaveTextContent('Communiquer le code d’accès')
    // « Retard dans l'avancement » est confirmée : elle n'attend plus rien.
    expect(bloc).not.toHaveTextContent('Retard dans l’avancement')
  })

  it('dit sur combien de preuves la lecture s’appuie', () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote crHref="/m/visite/visit-1/cr" />)
    expect(screen.getAllByText(/Sources : 2 éléments/).length).toBeGreaterThan(0)
  })

  it('avoue une lecture sans source unique plutôt que d’en inventer une', () => {
    const n = peuple()
    n.understood = [prop({ id: 'p-9', sourceCount: 0 })]
    render(<VisitDesk narrative={n} media={{}} canPromote crHref="/m/visite/visit-1/cr" />)
    expect(screen.getByText(/aucune source unique/i)).toBeInTheDocument()
  })

  it('n’offre le geste que là où il existe vraiment', () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    expect(screen.queryByRole('link', { name: 'Arbitrer' })).not.toBeInTheDocument()
  })
})

describe('rien n’est affiché que la base ne démontre', () => {
  it('les étiquettes de la frise viennent du tri, pas du graphisme', () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByText('Réserve')).toBeInTheDocument()
    for (const invente of ['Organisation', 'Point de vigilance', 'À confirmer']) {
      expect(screen.queryByText(invente)).not.toBeInTheDocument()
    }
  })

  it('une pièce versée après coup dit d’où vient sa date ET quand elle est entrée', () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByText(/date du fichier/i)).toBeInTheDocument()
    expect(screen.getByText(/versée au dossier le/i)).toBeInTheDocument()
  })

  it('ne prétend rien avoir produit tant que rien n’est démontrable', () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByText(/n’a encore rien produit/i)).toBeInTheDocument()
    expect(screen.getByText(/Concrétisez une ligne du compte-rendu/i)).toBeInTheDocument()
  })

  it('rappelle la règle en pied de page', () => {
    render(<VisitDesk narrative={vide} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByText(/Aucune interprétation n’est créée sans preuve/i)).toBeInTheDocument()
  })
})

describe('explorer une preuve sans quitter la page', () => {
  it('ouvre le panneau avec la transcription', async () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    fireEvent.click(screen.getByRole('button', { name: /La dépose du faux plafond/ }))
    expect(await screen.findByText('Transcription')).toBeInTheDocument()
  })

  it('ne propose de citer que le résumé et « à savoir »', async () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote crHref="/m/visite/visit-1/cr" />)
    fireEvent.click(screen.getByRole('button', { name: /La dépose du faux plafond/ }))
    expect(await screen.findAllByRole('button', { name: 'Résumé' })).not.toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'À savoir' })).not.toHaveLength(0)
  })

  it('refuse la citation quand le compte-rendu est figé', async () => {
    render(<VisitDesk narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    fireEvent.click(screen.getByRole('button', { name: /La dépose du faux plafond/ }))
    expect(await screen.findByText(/rouvrez-le pour y citer une preuve/i)).toBeInTheDocument()
  })
})

describe('les états vides parlent', () => {
  it('dit qu’il ne s’est rien passé sans en faire un reproche', () => {
    render(<VisitDesk narrative={vide} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByText(/c’est un fait, pas un manque/i)).toBeInTheDocument()
  })

  it('ne réclame aucun arbitrage quand tout est tranché', () => {
    render(<VisitDesk narrative={vide} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByText(/Rien n’attend votre arbitrage/i)).toBeInTheDocument()
  })
})
