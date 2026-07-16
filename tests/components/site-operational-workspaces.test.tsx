import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkWorkspace } from '@/app/(dashboard)/sites/[id]/views/work/WorkWorkspace'
import { ChronologyWorkspace } from '@/app/(dashboard)/sites/[id]/views/chronology/ChronologyWorkspace'
import { PlanningWorkspace } from '@/app/(dashboard)/sites/[id]/views/planning/PlanningWorkspace'
import type { SiteActionRow } from '@/lib/db/site-actions'
import type { SiteBlocage } from '@/lib/db/site-blocages'
import type { SiteDeadline } from '@/lib/db/site-deadlines'
import type { SupervisorInterventionRow } from '@/lib/db/interventions'
import type { VisitWithCounts } from '@/lib/db/visits'
import type { DbMission, DbTeam } from '@/types/db'

describe('site operational workspaces', () => {
  it('shows work as operational commitments with origin and destination', () => {
    render(
      <WorkWorkspace
        siteId="site-1"
        missions={[missionFixture()]}
        interventions={[interventionFixture()]}
        actions={[actionFixture()]}
        blocages={[blocageFixture()]}
        proposed={[]}
        proposedTotal={0}
        completedRecent={[]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Travail' })).toBeInTheDocument()
    expect(screen.getByText('Missions (1)')).toBeInTheDocument()
    expect(screen.getByText('Interventions (1)')).toBeInTheDocument()
    // Le compte vit sur chaque temps (« Ouvertes (1) »), pas sur l'en-tête : celui-ci
    // ne comptait que les ouvertes et contredisait les propositions affichées dessous.
    expect(screen.getByRole('heading', { name: 'Actions' })).toBeInTheDocument()
    expect(screen.getByText('Ouvertes (1)')).toBeInTheDocument()
    // Origine : l'intervention porte la mission dont elle vient, et l'ouvre.
    expect(screen.getByRole('link', { name: 'Nettoyage général' })).toHaveAttribute(
      'href',
      '/interventions/intervention-1',
    )
    // Destination : ce que l'intervention doit produire.
    expect(screen.getByText('Preuve attendue : réalisation confirmée')).toBeInTheDocument()
    // La priorité est suggérée, jamais imposée sans lien vers l'objet concerné.
    expect(screen.getByText('Priorité suggérée :')).toBeInTheDocument()
  })

  // ── LE CYCLE DE VIE D'UNE ACTION ───────────────────────────────────────────
  // Travail doit montrer les TROIS temps : ce que MemorIA propose, ce qui est
  // engagé, ce qui vient d'être fait. Les propositions ne vivaient que sur la
  // synthèse — invisibles à l'endroit exact où l'on vient chercher le travail.
  it("montre le cycle de vie d'une action : à confirmer, ouvertes, terminées", () => {
    render(
      <WorkWorkspace
        siteId="site-1"
        missions={[missionFixture()]}
        interventions={[interventionFixture()]}
        actions={[actionFixture()]}
        blocages={[blocageFixture()]}
        proposed={[{ id: 'p-1', title: 'Contacter M. Vincent Milon (PAVE)' }]}
        proposedTotal={3}
        completedRecent={[{ id: 'a-9', title: 'Nettoyer la machine après prestation' }]}
        synthesisHref="/m/visite/report-1/cr"
      />,
    )

    // Ce qui attend une décision — avec son compte RÉEL (3), pas le nombre affiché.
    expect(screen.getByText('À confirmer (3)')).toBeInTheDocument()
    expect(screen.getByText('Contacter M. Vincent Milon (PAVE)')).toBeInTheDocument()
    // On confirme sur la synthèse : Travail montre, il ne décide pas à la place.
    expect(screen.getByRole('link', { name: 'Voir la synthèse et confirmer' })).toHaveAttribute(
      'href',
      '/m/visite/report-1/cr',
    )
    // Ce qui est engagé, et ce qui vient d'être fait : on doit sentir qu'on avance.
    expect(screen.getByText('Ouvertes (1)')).toBeInTheDocument()
    expect(screen.getByText('Terminées récemment')).toBeInTheDocument()
    expect(screen.getByText('Nettoyer la machine après prestation')).toBeInTheDocument()
  })

  it('se tait quand MemorIA ne propose rien', () => {
    render(
      <WorkWorkspace
        siteId="site-1"
        missions={[missionFixture()]}
        interventions={[interventionFixture()]}
        actions={[actionFixture()]}
        blocages={[blocageFixture()]}
        proposed={[]}
        proposedTotal={0}
        completedRecent={[]}
      />,
    )
    expect(screen.queryByText(/À confirmer/)).not.toBeInTheDocument()
    expect(screen.queryByText('Terminées récemment')).not.toBeInTheDocument()
  })

  it('makes chronology causal with produced objects under events', () => {
    render(
      <ChronologyWorkspace
        siteId="site-1"
        visits={[{
          visit: {
            id: 'visit-1',
            site_id: 'site-1',
            objective: 'Visite spontanée',
            started_at: '2026-07-13T08:00:00.000Z',
            ended_at: '2026-07-13T09:00:00.000Z',
            created_at: '2026-07-13T08:00:00.000Z',
          } as unknown as VisitWithCounts['visit'],
          photos: 4,
          notes: 1,
          reserves: 2,
          actions: 3,
        }]}
        changes={[]}
        interventions={[]}
        actions={[actionFixture()]}
        blocages={[]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Chronologie' })).toBeInTheDocument()
    expect(screen.getByText('Ce que cette visite a produit')).toBeInTheDocument()
    expect(screen.getByText('Actions créées')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Vérifier la toiture/ })).toHaveAttribute('href', '/sites/site-1/actions')

    // Règle reprise de SiteViewComposition (supprimé) : la lecture narrative reste
    // un MODE de la chronologie — atteignable depuis elle, sans onglet « Frise » factice.
    expect(screen.getByRole('link', { name: 'Lire le récit' })).toHaveAttribute('href', '/sites/site-1/recit')
    expect(screen.queryByRole('link', { name: 'Frise' })).not.toBeInTheDocument()
  })

  it('shows planning as a coordination view with seven days and real cycles', () => {
    render(
      <PlanningWorkspace
        siteId="site-1"
        nextEvent={null}
        interventions={[interventionFixture()]}
        missions={[missionFixture({ assigned_team_id: 'team-1' })]}
        teams={[teamFixture()]}
        blocages={[]}
        deadlines={[]}
        cycles={[{
          id: 'cycle-1',
          siteId: 'site-1',
          missionId: 'mission-1',
          name: 'Roulement Matin',
          cycleLengthWeeks: 1,
          anchorDate: '2026-07-13',
          startsOn: '2026-07-13',
          endsOn: null,
          status: 'published',
          supersedesCycleId: null,
          slots: [{ weekIndex: 0, weekday: 1, teamId: 'team-1', state: 'work', startTime: '06:00', endTime: '14:00' }],
        }]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Planning' })).toBeInTheDocument()
    expect(screen.getByText('Lun.')).toBeInTheDocument()
    expect(screen.getByText('Dim.')).toBeInTheDocument()
    expect(screen.getByText('Roulements disponibles')).toBeInTheDocument()
    expect(screen.getByText('Roulement Matin')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Utiliser pour planifier' })).toHaveAttribute('href', '/semaine?site=site-1')
  })

  // ── L'ÉCHÉANCE CONFIRMÉE ATTERRIT QUELQUE PART ─────────────────────────────
  // Une échéance sans date n'est pas une erreur : c'est du travail réel qui attend
  // un jour. Elle a sa section, avec la CONTRAINTE qui dit pourquoi elle attend —
  // dans les mots du débrief, jamais une date déduite.
  it('montre les échéances : à planifier d’un côté, datées de l’autre', () => {
    render(
      <PlanningWorkspace
        siteId="site-1"
        nextEvent={null}
        interventions={[]}
        missions={[]}
        teams={[]}
        blocages={[]}
        cycles={[]}
        deadlines={[
          deadlineFixture({ id: 'd-1', title: 'Programmer la visite PAVE', constraint_text: 'Avant le démarrage' }),
          deadlineFixture({ id: 'd-2', title: 'Poser le coffret', due_date: '2026-07-28', status: 'planned' }),
        ]}
      />,
    )

    expect(screen.getByText('À planifier (1)')).toBeInTheDocument()
    expect(screen.getByText('Programmer la visite PAVE')).toBeInTheDocument()
    expect(screen.getByText('Avant le démarrage')).toBeInTheDocument()
    // La datée vit dans le temps, pas dans l'attente.
    expect(screen.getByText('Poser le coffret')).toBeInTheDocument()
    expect(screen.getByText('28 juillet')).toBeInTheDocument()
  })

  it('se tait quand le chantier n’a aucune échéance', () => {
    render(
      <PlanningWorkspace
        siteId="site-1" nextEvent={null} interventions={[]} missions={[]}
        teams={[]} blocages={[]} cycles={[]} deadlines={[]}
      />,
    )
    expect(screen.queryByText(/À planifier/)).not.toBeInTheDocument()
  })
})

function deadlineFixture(overrides: Partial<SiteDeadline> = {}): SiteDeadline {
  return {
    id: 'd-1',
    site_id: 'site-1',
    report_id: 'report-1',
    title: 'Échéance',
    constraint_text: null,
    due_date: null,
    status: 'to_plan',
    created_at: '2026-07-17T08:00:00.000Z',
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

function interventionFixture(overrides: Partial<SupervisorInterventionRow> = {}): SupervisorInterventionRow {
  return {
    id: 'intervention-1',
    scheduled_at: '2026-07-14T14:00:00.000Z',
    scheduled_for: '2026-07-14',
    slot: 'afternoon',
    status: 'planned',
    mission_id: 'mission-1',
    skipped_reason: null,
    assigned_team_id: 'team-1',
    team: { id: 'team-1', name: 'Équipe nettoyage', color: null },
    mission: { id: 'mission-1', name: 'Nettoyage général', site: null },
    ...overrides,
  }
}

function actionFixture(overrides: Partial<SiteActionRow> = {}): SiteActionRow {
  return {
    id: 'action-1',
    title: 'Vérifier la toiture',
    body: null,
    corps_etat: 'Nettoyage général',
    assigned_to: 'Entreprise Martin',
    status: 'open',
    created_at: '2026-07-13T08:00:00.000Z',
    due_date: '2026-07-15',
    report_id: 'visit-1',
    converted_to_type: null,
    converted_to_id: null,
    site_id: 'site-1',
    site_name: 'Chantier',
    contract_id: null,
    contract_name: null,
    subject_id: null,
    last_progress_at: null,
    snooze_reason: null,
    snoozed_at: null,
    ...overrides,
  }
}

function blocageFixture(overrides: Partial<SiteBlocage> = {}): SiteBlocage {
  return {
    id: 'blocage-1',
    siteId: 'site-1',
    subjectId: null,
    type: 'acces',
    title: 'Fuite local technique',
    description: null,
    impact: 'Mission Nettoyage général',
    dateStart: '2026-07-13',
    dateEnd: null,
    sourceType: 'human',
    sourceReportId: 'visit-1',
    dayLogId: null,
    ...overrides,
  }
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
