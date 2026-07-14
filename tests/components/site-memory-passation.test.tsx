import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspace } from '@/app/(dashboard)/sites/[id]/views/memory/MemoryWorkspace'
import type { DbHandoverBrief, DbTeam } from '@/types/db'

// La modale de passation appelle la server action de /handovers. En test on ne
// vérifie que le point d'entrée : l'action réelle est couverte côté serveur.
vi.mock('@/app/(dashboard)/handovers/actions', () => ({
  createTeamTakesSiteBriefAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

describe('passation dans la mémoire du chantier', () => {
  it('makes the handover a projection of the memory, on a real tab', () => {
    render(
      <MemoryWorkspace
        siteId="site-1"
        siteName="Discount"
        questionSlot={<div role="search">Question réelle</div>}
        signals={[]}
        subjects={[]}
        relays={[{ id: 'team-1', name: 'Équipe nettoyage', lastPassage: '2026-07-10', interventions: 3 }]}
        teams={[teamFixture()]}
        passations={[briefFixture()]}
      />,
    )

    // La passation vit dans Mémoire — le même domaine que ce qu'elle transmet.
    expect(screen.getByRole('heading', { name: 'Mémoire' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Transmettre ce chantier' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Préparer une passation' })).toBeInTheDocument()

    // Une passation déjà préparée reste un objet unique, ouvrable depuis le chantier.
    expect(screen.getByRole('link', { name: /Brief site « Discount » — pour Équipe nettoyage/ })).toHaveAttribute(
      'href',
      '/handovers/brief-1',
    )
    expect(screen.getByText(/Brouillon — pas encore partagée/)).toBeInTheDocument()

    // Les relais restent la matière humaine de la passation.
    expect(screen.getByText('Équipe nettoyage')).toBeInTheDocument()
  })

  it('offers the handover even when the chantier has no history yet', () => {
    render(
      <MemoryWorkspace
        siteId="site-1"
        siteName="Discount"
        questionSlot={<div role="search">Question réelle</div>}
        signals={[]}
        subjects={[]}
        relays={[]}
        teams={[]}
        passations={[]}
      />,
    )

    expect(screen.getByRole('button', { name: 'Préparer une passation' })).toBeInTheDocument()
    expect(screen.queryByText(/Brouillon/)).not.toBeInTheDocument()
  })
})

function teamFixture(overrides: Partial<DbTeam> = {}): DbTeam {
  return {
    id: 'team-1',
    name: 'Équipe nettoyage',
    color: null,
    icon: null,
    specialties: [],
    active: true,
    created_at: '2026-07-13T08:00:00.000Z',
    created_by: null,
    deleted_at: null,
    referent_user_id: null,
    organization_id: null,
    ...overrides,
  }
}

function briefFixture(overrides: Partial<DbHandoverBrief> = {}): DbHandoverBrief {
  return {
    id: 'brief-1',
    kind: 'team_takes_site',
    source_team_id: null,
    target_team_id: 'team-1',
    subject_user_id: null,
    site_id: 'site-1',
    payload: { generatedAt: '2026-07-14T08:00:00.000Z', context: '', sites: [], manualNotes: null },
    title: 'Brief site « Discount » — pour Équipe nettoyage',
    status: 'draft',
    effective_date: '2026-07-21',
    shared_token: null,
    shared_at: null,
    expires_at: null,
    last_accessed_at: null,
    access_count: 0,
    acknowledged_by: null,
    acknowledged_at: null,
    created_by: null,
    created_at: '2026-07-14T08:00:00.000Z',
    deleted_at: null,
    ...overrides,
  }
}
