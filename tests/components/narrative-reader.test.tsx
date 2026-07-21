import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NarrativeReader } from '@/app/(dashboard)/sites/[id]/visites/[visitId]/recit/NarrativeReader'
import type { VisitNarrative } from '@/lib/db/visit-narrative'

// ── N3.2 — LA SALLE D'ENQUÊTE ───────────────────────────────────────────────
//
// Ce qui doit tenir : on explore une preuve sans quitter le récit, et les états
// vides parlent. Sur les visites réelles du dépôt, 3 sur 4 n'ont AUCUN
// compte-rendu — l'état vide est la norme, pas le cas limite.

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
  limits: { historicalAttributions: 0, intervenantProvenanceMissing: true },
}

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
      intent: null,
      attachmentId: 'att-1',
      why: { code: 'capture.kept', label: 'Retenue comme élément à conserver' },
    },
    {
      id: 'cap-2',
      kind: 'note',
      body: 'Rien à signaler',
      capturedAt: '2026-07-20T09:40:00Z',
      lat: null,
      lng: null,
      kept: false,
      intent: null,
      attachmentId: null,
      why: { code: 'capture.discarded', label: 'Écartée du compte-rendu par le conducteur' },
    },
  ],
  produced: [
    {
      kind: 'action',
      id: 'act-1',
      label: 'Relancer Clim Expert',
      createdAt: '2026-07-21T08:00:00Z',
      provenance: 'registry',
      sourceSection: 'actions',
      why: { code: 'produced.fromDocument', label: 'Créé à partir de la section « Actions » du compte-rendu' },
      evidence: null,
    },
  ],
})

describe('Le récit se lit sans rien avoir à deviner', () => {
  it('donne un sommaire qui couvre les cinq couches', () => {
    render(<NarrativeReader narrative={vide} media={{}} canPromote={false} crHref={null} />)
    const sommaire = screen.getByRole('navigation', { name: /sommaire/i })
    for (const label of ['Capté', 'Compris', 'Tranché', 'Produit', 'Écarté']) {
      expect(sommaire).toHaveTextContent(label)
    }
  })

  it('répond « pourquoi est-ce ici ? » sur chaque ligne produite', () => {
    render(<NarrativeReader narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByText(/Créé à partir de la section/)).toBeInTheDocument()
  })

  it('avoue l’absence de preuve unique au lieu de la fabriquer', () => {
    render(<NarrativeReader narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByText(/aucune preuve unique n’est démontrable/i)).toBeInTheDocument()
  })
})

describe('Les états vides disent ce qui les remplirait', () => {
  it('ne laisse aucune couche muette', () => {
    render(<NarrativeReader narrative={vide} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByText(/n’a rien laissé derrière elle/i)).toBeInTheDocument()
    expect(screen.getByText(/MemorIA n’a rien proposé/i)).toBeInTheDocument()
    expect(screen.getByText(/Rien n’est encore sorti de cette visite/i)).toBeInTheDocument()
    expect(screen.getByText(/Rien n’a été mis de côté/i)).toBeInTheDocument()
  })

  it('explique comment remplir « produit » — concrétiser, pas attendre', () => {
    render(<NarrativeReader narrative={vide} media={{}} canPromote={false} crHref={null} />)
    expect(screen.getByText(/Concrétisez une ligne du compte-rendu/i)).toBeInTheDocument()
  })
})

describe('Explorer une preuve sans quitter sa place', () => {
  it('ouvre le panneau latéral avec la transcription', async () => {
    render(<NarrativeReader narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    fireEvent.click(screen.getByRole('button', { name: /La dépose du faux plafond/ }))
    expect(await screen.findByText('Transcription')).toBeInTheDocument()
  })

  it('ne propose de citer une preuve que si le compte-rendu est ouvert', async () => {
    render(<NarrativeReader narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    fireEvent.click(screen.getByRole('button', { name: /La dépose du faux plafond/ }))
    expect(await screen.findByText(/rouvrez-le pour y citer une preuve/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Résumé' })).not.toBeInTheDocument()
  })

  it('propose les deux seules sections citables quand il est ouvert', async () => {
    render(<NarrativeReader narrative={peuple()} media={{}} canPromote crHref="/m/visite/visit-1/cr" />)
    fireEvent.click(screen.getByRole('button', { name: /La dépose du faux plafond/ }))
    expect(await screen.findAllByRole('button', { name: 'Résumé' })).not.toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'À savoir' })).not.toHaveLength(0)
    // Un engagement ne se fabrique pas d'un clic depuis une preuve.
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Décisions' })).not.toBeInTheDocument()
  })
})

describe('Replier une section', () => {
  it('masque son contenu sans quitter la page', async () => {
    render(<NarrativeReader narrative={peuple()} media={{}} canPromote={false} crHref={null} />)
    const entete = screen.getByRole('button', { name: /Ce qui a été capté/ })
    expect(entete).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(entete)
    expect(entete).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /La dépose du faux plafond/ })).not.toBeInTheDocument()
  })
})
