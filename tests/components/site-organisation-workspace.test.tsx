import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OrganisationWorkspace } from '@/app/(dashboard)/sites/[id]/views/organisation/OrganisationWorkspace'
import type { DbHandoverBrief, DbMission, DbTeam } from '@/types/db'
import type { PlanningCycle } from '@/lib/db/planning-cycles'

// La modale de passation appelle la server action de /handovers. En test on ne
// vérifie que le point d'entrée : l'action réelle est couverte côté serveur.
vi.mock('@/app/(dashboard)/handovers/actions', () => ({
  createTeamTakesSiteBriefAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

describe('site organisation workspace', () => {
  it('makes the chantier transmissible instead of showing a configuration placeholder', () => {
    render(
      <OrganisationWorkspace
        siteId="site-1"
        identity={identityFixture()}
        missions={[missionFixture()]}
        cycles={[cycleFixture()]}
        teams={[teamFixture()]}
        relays={[{ id: 'team-1', name: 'Équipe nettoyage', lastPassage: '2026-07-10', interventions: 3 }]}
        passations={[briefFixture()]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Organisation' })).toBeInTheDocument()

    // La passation se prépare depuis le chantier qu'elle transmet.
    expect(screen.getByRole('heading', { name: 'Transmettre ce chantier' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Préparer une passation' })).toBeInTheDocument()

    // Une passation déjà préparée reste un objet unique, ouvrable depuis le chantier.
    const existing = screen.getByRole('link', { name: /Brief site « Discount » — pour Équipe nettoyage/ })
    expect(existing).toHaveAttribute('href', '/handovers/brief-1')
    expect(screen.getByText(/Brouillon — pas encore partagée/)).toBeInTheDocument()

    // Qui connaît le chantier : les équipes réellement venues, avec leur dernier passage.
    expect(screen.getByText('Qui connaît ce chantier (1)')).toBeInTheDocument()
    expect(screen.getByText(/3 passages/)).toBeInTheDocument()

    // Vocabulaire conducteur : aucun statut technique ne parvient à l'écran.
    expect(screen.queryByText(/published|draft|planned/)).not.toBeInTheDocument()
    expect(screen.getByText('Publié')).toBeInTheDocument()

    // Ce qui n'est pas affecté est dit, pas masqué.
    const missions = screen.getByText('Missions (1)').closest('section') as HTMLElement
    expect(within(missions).getByText('Équipe non affectée')).toBeInTheDocument()

    // Un roulement listé s'ouvre : la fiche chantier est un point d'entrée, pas un cul-de-sac.
    expect(screen.getByRole('link', { name: /Roulement semaine A\/B/ })).toHaveAttribute(
      'href',
      '/sites/site-1/roulements/cycle-1',
    )
  })

  it('says what is missing instead of faking an organisation', () => {
    render(
      <OrganisationWorkspace
        siteId="site-1"
        identity={identityFixture({ clientName: null, address: null, contractName: null, contractStartedAt: null })}
        missions={[]}
        cycles={[]}
        teams={[]}
        relays={[]}
        passations={[]}
      />,
    )

    expect(screen.getAllByText('Non renseigné').length).toBeGreaterThan(0)
    expect(screen.getByText('Aucune mission enregistrée sur ce chantier.')).toBeInTheDocument()
    // L'absence de roulement propose l'étape suivante au lieu de constater le vide.
    expect(screen.getByRole('link', { name: 'Créer un roulement' })).toHaveAttribute(
      'href',
      '/sites/site-1/roulements/nouveau',
    )
    expect(screen.getByText(/Aucune équipe n'est encore venue sur ce chantier/)).toBeInTheDocument()
    // Le placeholder « À compléter » de la maquette ne doit plus exister.
    expect(screen.queryByText('À compléter')).not.toBeInTheDocument()
  })
})

function identityFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'site-1',
    name: 'Discount',
    address: 'Poindimié',
    contractId: 'contract-1',
    contractName: 'Contrat Discount',
    clientId: 'client-1',
    clientName: 'Servinor',
    contractStartedAt: '2026-01-05',
    teamsSucceeded: 1,
    ...overrides,
  }
}

function missionFixture(overrides: Partial<DbMission> = {}): DbMission {
  return {
    id: 'mission-1',
    site_id: 'site-1',
    name: 'Nettoyage général',
    description: null,
    cadence: 'weekly',
    default_team: [],
    engagement_ids: [],
    default_checklist: [],
    active: true,
    created_at: '2026-07-13T08:00:00.000Z',
    updated_at: '2026-07-13T08:00:00.000Z',
    deleted_at: null,
    created_by: null,
    assigned_team_id: null,
    ...overrides,
  }
}

function cycleFixture(overrides: Partial<PlanningCycle> = {}): PlanningCycle {
  return {
    id: 'cycle-1',
    siteId: 'site-1',
    missionId: 'mission-1',
    name: 'Roulement semaine A/B',
    cycleLengthWeeks: 2,
    anchorDate: '2026-07-06',
    startsOn: '2026-07-06',
    endsOn: null,
    status: 'published',
    supersedesCycleId: null,
    slots: [],
    ...overrides,
  } as PlanningCycle
}

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
