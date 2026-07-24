import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryInbox } from '@/app/(field)/m/site/[siteId]/MemoryReviewPanel'
import type { ReviewItem } from '@/lib/knowledge/memory-review'

const promote = vi.fn()
const dismiss = vi.fn()
const search = vi.fn()

vi.mock('@/app/(field)/m/site/[siteId]/memory-actions', () => ({
  promoteFromMemoryAction: (...args: unknown[]) => promote(...args),
  dismissFromMemoryAction: (...args: unknown[]) => dismiss(...args),
}))

vi.mock('@/app/(dashboard)/sites/[id]/views/intervenants/intervenants-actions', () => ({
  searchIntervenantTargetsAction: (...args: unknown[]) => search(...args),
}))

const ginger: ReviewItem = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'stakeholder',
  title: 'Ginger',
  body: null,
  createdAt: '2026-07-15T10:00:00Z',
  capability: { available: true, label: 'Créer l’intervenant', requiredInputs: ['role'], explanation: null },
  confidence: null,
  sourceCaptureIds: [],
  provenance: { reportId: '22222222-2222-4222-8222-222222222222', visitedAt: '2026-07-15T10:00:00Z', photos: 0, vocals: 0 },
}

function proposal(kind: ReviewItem['kind'], label: string, sourceType: 'cr' | 'meeting' = 'cr'): ReviewItem {
  const requiredInputs = kind === 'knowledge' ? ['nature' as const] : []
  return {
    id: `${kind}-11111111-1111-4111-8111-111111111111`,
    kind,
    title: `${kind} de recette`,
    body: 'Élément issu de la visite de recette.',
    createdAt: '2026-07-15T10:00:00Z',
    capability: { available: true, label, requiredInputs, explanation: null },
    confidence: null,
    sourceCaptureIds: [],
    provenance: { reportId: '22222222-2222-4222-8222-222222222222', sourceType, visitedAt: '2026-07-15T10:00:00Z', photos: 0, vocals: 0 },
  }
}

describe('MemoryInbox stakeholder workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    promote.mockResolvedValue({ ok: true, objectId: '33333333-3333-4333-8333-333333333333' })
    dismiss.mockResolvedValue({ ok: true })
    search.mockResolvedValue({ ok: true, hits: [] })
  })

  it('shows one dismiss action and exposes Individu / Entreprise immediately', () => {
    render(<MemoryInbox siteId="44444444-4444-4444-8444-444444444444" items={[ginger]} />)

    expect(screen.getAllByRole('button', { name: 'Écarter' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Nouvel intervenant' }))
    expect(screen.getByRole('button', { name: 'Individu' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entreprise' })).toBeInTheDocument()
    expect(screen.getByText('Rôle sur le chantier')).toBeInTheDocument()
  })

  it('shows the correct fields for Individu and Entreprise', () => {
    render(<MemoryInbox siteId="44444444-4444-4444-8444-444444444444" items={[ginger]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nouvel intervenant' }))

    fireEvent.click(screen.getByRole('button', { name: 'Individu' }))
    expect(screen.getByPlaceholderText('Nom de la personne')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Entreprise de rattachement')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MOA' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Entreprise' }))
    expect(screen.getByPlaceholderText("Nom de l'entreprise")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Nom de la personne')).not.toBeInTheDocument()
  })

  it('opens the existing-intervenant search and displays results', async () => {
    search.mockResolvedValue({ ok: true, hits: [{ kind: 'company', companyId: '55555555-5555-4555-8555-555555555555', companyName: 'Ginger', name: 'Ginger', fonction: null, onThisSite: false, knownRole: null }] })
    render(<MemoryInbox siteId="44444444-4444-4444-8444-444444444444" items={[ginger]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rattacher' }))
    expect(screen.getByRole('button', { name: 'Chercher' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Chercher' }))
    expect(await screen.findByText('Ginger')).toBeInTheDocument()
    const result = screen.getAllByText('Ginger').at(-1)!.closest('li')!
    expect(within(result).getByText('Entreprise')).toBeInTheDocument()
  })

  it('reuses the action workflow gestures and keeps dismiss visible once', () => {
    render(<MemoryInbox siteId="44444444-4444-4444-8444-444444444444" items={[proposal('action', "Créer l'action")]} />)

    expect(screen.getByRole('button', { name: "Créer l'action" })).toBeInTheDocument()
    expect(screen.getByText('+ Affecter un responsable')).toBeInTheDocument()
    expect(screen.getByText('+ Ajouter une échéance')).toBeInTheDocument()
    expect(screen.getByText("Planifier l'intervention")).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Écarter' })).toHaveLength(1)
  })

  it('asks for the date before promoting an échéance', () => {
    render(<MemoryInbox siteId="44444444-4444-4444-8444-444444444444" items={[proposal('deadline', "Ajouter l'échéance au planning")]} />)

    fireEvent.click(screen.getByRole('button', { name: "Ajouter l'échéance au planning" }))
    expect(screen.getByLabelText("Date de l'échéance")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ajouter au planning' })).toBeInTheDocument()
  })

  it('asks for the nature before confirming une information', () => {
    render(<MemoryInbox siteId="44444444-4444-4444-8444-444444444444" items={[proposal('knowledge', 'Confirmer cette information')]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Confirmer cette information' }))
    expect(screen.getByText('Cette information est…')).toBeInTheDocument()
    expect(screen.getByText('Vraie en ce moment')).toBeInTheDocument()
    expect(screen.getByText('Vraie durablement')).toBeInTheDocument()
  })

  it('uses the same visible confirmation and dismissal contract for décision and vigilance', () => {
    render(<MemoryInbox siteId="44444444-4444-4444-8444-444444444444" items={[
      proposal('decision', 'Acter la décision'),
      proposal('vigilance', 'Retenir le point de vigilance'),
    ]} />)

    expect(screen.getByRole('button', { name: 'Acter la décision' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retenir le point de vigilance' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Écarter' })).toHaveLength(2)
  })

  it('filters proposals by CR or réunion without changing the shared workflow', () => {
    render(<MemoryInbox siteId="44444444-4444-4444-8444-444444444444" withFilters items={[
      proposal('action', 'Action issue du CR', 'cr'),
      proposal('decision', 'Décision issue de la réunion', 'meeting'),
    ]} />)

    expect(screen.getByRole('button', { name: 'CR 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réunions 1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Réunions 1' }))
    expect(screen.getByText('Décision issue de la réunion')).toBeInTheDocument()
    expect(screen.queryByText('Action issue du CR')).not.toBeInTheDocument()
  })
})
