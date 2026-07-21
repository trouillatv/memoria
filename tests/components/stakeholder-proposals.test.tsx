import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { SummaryItem } from '@/lib/knowledge/visit-summary'

// ── G2 + G3 — UNE PROPOSITION NE RESTE JAMAIS COINCÉE ───────────────────────
//
// Guillaume ne dit pas « l'IA s'est trompée ». Il dit « je suis bloqué ».
// Un intervenant exige un RÔLE ; le moteur répondait `needs_input` et l'écran
// traduisait « Promotion impossible ». La question n'était posée nulle part.
//
// Contrat : confirmer · corriger · ignorer. Toujours les trois.

const promoteSpy = vi.fn()
const dismissSpy = vi.fn()
let promoteResult: unknown = { ok: true, objectId: 'i1' }
vi.mock('@/app/(field)/m/visite/[reportId]/debrief-actions', () => ({
  promoteStakeholderProposalAction: (a: unknown) => { promoteSpy(a); return Promise.resolve(promoteResult) },
  dismissActionProposalAction: (a: unknown) => { dismissSpy(a); return Promise.resolve({ ok: true }) },
}))

const { StakeholderProposals } = await import('@/app/(field)/m/visite/[reportId]/cr/StakeholderProposals')

const item = (title: string, proposalId: string | null = 'p1'): SummaryItem =>
  ({ id: `i-${title}`, title, detail: null, proposalId, promotedObjectId: null, owner: null, priority: null }) as SummaryItem

const carte = () => document.querySelector('[data-slot="stakeholder-proposal"]') as HTMLElement

beforeEach(() => {
  promoteSpy.mockClear()
  dismissSpy.mockClear()
  promoteResult = { ok: true, objectId: 'i1' }
})

describe('Les trois issues sont toujours offertes', () => {
  it('propose Confirmer, Corriger et Ignorer', () => {
    render(<StakeholderProposals reportId="r1" items={[item('Ginger')]} />)
    for (const nom of [/Confirmer/, /Corriger/, /Ignorer/]) {
      expect(within(carte()).getByRole('button', { name: nom })).toBeTruthy()
    }
  })

  it('ne montre rien quand il n’y a aucune proposition', () => {
    const { container } = render(<StakeholderProposals reportId="r1" items={[]} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('Le rôle est demandé, jamais deviné', () => {
  it('refuse de confirmer sans rôle, et le dit', async () => {
    render(<StakeholderProposals reportId="r1" items={[item('Ginger')]} />)
    fireEvent.click(within(carte()).getByRole('button', { name: /Confirmer/ }))

    await waitFor(() => expect(within(carte()).getByText(/il ne se devine pas/)).toBeTruthy())
    expect(promoteSpy).not.toHaveBeenCalled()
  })

  it('confirme avec le rôle saisi, et transmet l’entreprise lue', async () => {
    render(<StakeholderProposals reportId="r1" items={[item('Ginger')]} />)
    fireEvent.change(within(carte()).getByLabelText('Rôle sur le chantier'), { target: { value: 'Bureau d’études' } })
    fireEvent.click(within(carte()).getByRole('button', { name: /Confirmer/ }))

    await waitFor(() => expect(promoteSpy).toHaveBeenCalled())
    expect(promoteSpy.mock.calls[0]![0]).toMatchObject({
      report_id: 'r1', proposal_id: 'p1', role: 'Bureau d’études', company_name: 'Ginger',
    })
  })
})

describe('G3 — corriger avant de valider', () => {
  it('permet de remplacer la société mal lue', async () => {
    render(<StakeholderProposals reportId="r1" items={[item('Gingerre')]} />)
    fireEvent.click(within(carte()).getByRole('button', { name: /Corriger/ }))
    fireEvent.change(within(carte()).getByLabelText('Entreprise'), { target: { value: 'Ginger SAS' } })
    fireEvent.change(within(carte()).getByLabelText('Personne'), { target: { value: 'Yann Dupont' } })
    fireEvent.change(within(carte()).getByLabelText('Rôle sur le chantier'), { target: { value: 'Entreprise' } })
    fireEvent.click(within(carte()).getByRole('button', { name: /Confirmer/ }))

    await waitFor(() => expect(promoteSpy).toHaveBeenCalled())
    expect(promoteSpy.mock.calls[0]![0]).toMatchObject({
      company_name: 'Ginger SAS', person_name: 'Yann Dupont', role: 'Entreprise',
    })
  })
})

describe('Ignorer clôt aussi la proposition', () => {
  it('appelle l’écart et le dit à l’écran', async () => {
    render(<StakeholderProposals reportId="r1" items={[item('Ginger')]} />)
    fireEvent.click(within(carte()).getByRole('button', { name: /Ignorer/ }))

    await waitFor(() => expect(dismissSpy).toHaveBeenCalledWith({ report_id: 'r1', proposal_id: 'p1' }))
    expect(screen.getByText(/ignoré/)).toBeTruthy()
  })
})

describe('Un échec serveur laisse la main', () => {
  it('affiche l’erreur sans clore la carte', async () => {
    promoteResult = { ok: false, error: 'Une personne doit être rattachée à une entreprise.' }
    render(<StakeholderProposals reportId="r1" items={[item('Yann')]} />)
    fireEvent.change(within(carte()).getByLabelText('Rôle sur le chantier'), { target: { value: 'Entreprise' } })
    fireEvent.click(within(carte()).getByRole('button', { name: /Confirmer/ }))

    await waitFor(() =>
      expect(within(carte()).getByText('Une personne doit être rattachée à une entreprise.')).toBeTruthy(),
    )
    expect(within(carte()).getByRole('button', { name: /Confirmer/ })).toBeTruthy()
  })
})
