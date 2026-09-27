import { describe, expect, it } from 'vitest'
import { buildPlanningLectureInput } from '@/lib/planning/lecture-adapter'

describe('buildPlanningLectureInput', () => {
  it('converts existing site rows into deterministic rotation, assignment and gap evidence', () => {
    const input = buildPlanningLectureInput({
      scope: 'week',
      anchorDate: '2026-07-20',
      rows: [{
        site_id: 'site-1',
        site_name: 'Magasin',
        contract_id: 'contract-1',
        contract_name: 'Contrat',
        days: {
          '2026-07-20': [{
            id: 'int-1',
            mission_id: 'mission-1',
            mission_name: 'Entretien magasin',
            site_id: 'site-1',
            site_name: 'Magasin',
            contract_id: 'contract-1',
            contract_name: 'Contrat',
            scheduled_for: '2026-07-20',
            slot: 'morning',
            status: 'planned',
            skipped_at: null,
            assigned_team_id: null,
            assigned_team_name: null,
            assigned_team_color: null,
            template_id: 'rotation-e1',
            planned_start: null,
            planned_end: null,
          }],
        },
      }],
      missions: [{ id: 'mission-1', name: 'Entretien magasin', siteId: 'site-1', siteName: 'Magasin', clientName: null, contractName: 'Contrat', defaultTeamId: null }],
      rotations: [{ id: 'rotation-e1', missionId: 'mission-1', missionName: 'Entretien magasin', siteId: 'site-1', title: 'Roulement E1', label: 'Roulement E1', cycleId: 'cycle-e1' }],
    })

    expect(input).toMatchObject({
      scope: 'week',
      anchorDate: '2026-07-20',
      rotations: [{ id: 'rotation-e1', name: 'Roulement E1' }],
      assignments: [{ assigned: false, rotationId: 'rotation-e1', missionId: 'mission-1' }],
      gaps: [{ date: '2026-07-20', rotationId: 'rotation-e1', missionId: 'mission-1' }],
    })
  })

  it('returns only org-scoped mission and rotation options passed by the server page', () => {
    const input = buildPlanningLectureInput({
      scope: 'month',
      anchorDate: '2026-07-17',
      rows: [],
      missions: [],
      rotations: [],
    })
    expect(input.missions).toEqual([])
    expect(input.rotations).toEqual([])
    expect(input.assignments).toEqual([])
    expect(input.gaps).toEqual([])
    expect(input.missionGaps).toEqual([])
  })

  // E2E-FIX-2 correction (revue ChatGPT du SHA e69045a4) — une occurrence
  // projetée sans équipe alimente `missionGaps`, JAMAIS `gaps` : sinon elle
  // matche contre `rotations` (qui contient aussi les rythmes simples) et
  // produit à tort un signal « roulement actif ».
  it('routes unassigned projected occurrences into missionGaps, never into gaps', () => {
    const input = buildPlanningLectureInput({
      scope: 'week',
      anchorDate: '2026-09-28',
      rows: [],
      missions: [{ id: 'mission-carrelage', name: 'Entretien Carrelage', siteId: 'site-1', siteName: 'Résidence', clientName: null, contractName: null, defaultTeamId: null }],
      rotations: [],
      monthRows: [{
        siteId: 'site-1',
        siteName: 'Résidence',
        clientName: null,
        days: {
          '2026-09-28': {
            expected: 0,
            done: 0,
            kept: 0,
            projected: 1,
            closed: false,
            hasException: false,
            cycleCovers: false,
            projectedOccurrences: [{
              templateId: 'template-1',
              missionId: 'mission-carrelage',
              missionName: 'Entretien Carrelage',
              plannedStart: null,
              plannedEnd: null,
              slot: 'morning',
              assignedTeamId: null,
              assignedTeamName: null,
              assignedTeamColor: null,
            }],
          },
        },
      }],
    })

    expect(input.gaps).toEqual([])
    expect(input.missionGaps).toEqual([{ date: '2026-09-28', missionId: 'mission-carrelage' }])
  })

  // E2E-FIX-2 dernier correctif (revue ChatGPT du SHA 5d9692fe) — une cellule
  // MATÉRIALISÉE (déjà dans `rows`, pas seulement projetée) issue d'un rythme
  // simple (template.cycle_id NULL) sans équipe doit, elle aussi, produire un
  // mission-unassigned-impact, jamais un rotation-gap-impact.
  it('routes an unassigned materialized cell from a simple-rhythm template (cycleId null) into missionGaps, never gaps', () => {
    const input = buildPlanningLectureInput({
      scope: 'week',
      anchorDate: '2026-09-28',
      rows: [{
        site_id: 'site-1',
        site_name: 'Résidence',
        contract_id: 'contract-1',
        contract_name: 'Contrat',
        days: {
          '2026-09-28': [{
            id: 'int-carrelage',
            mission_id: 'mission-carrelage',
            mission_name: 'Entretien Carrelage',
            site_id: 'site-1',
            site_name: 'Résidence',
            contract_id: 'contract-1',
            contract_name: 'Contrat',
            scheduled_for: '2026-09-28',
            slot: 'morning',
            status: 'planned',
            skipped_at: null,
            assigned_team_id: null,
            assigned_team_name: null,
            assigned_team_color: null,
            template_id: 'template-simple-carrelage',
            planned_start: null,
            planned_end: null,
          }],
        },
      }],
      missions: [{ id: 'mission-carrelage', name: 'Entretien Carrelage', siteId: 'site-1', siteName: 'Résidence', clientName: null, contractName: 'Contrat', defaultTeamId: null }],
      rotations: [{
        id: 'template-simple-carrelage',
        missionId: 'mission-carrelage',
        missionName: 'Entretien Carrelage',
        siteId: 'site-1',
        title: 'Lun-Ven',
        label: 'Lun-Ven',
        cycleId: null,
      }],
    })

    expect(input.gaps).toEqual([])
    expect(input.missionGaps).toEqual([{ date: '2026-09-28', missionId: 'mission-carrelage' }])
  })

  // Symétrique : template dérivé d'un roulement avancé (cycle_id renseigné)
  // reste un vrai trou de roulement, matérialisé ou pas.
  it('routes an unassigned materialized cell from a cycle-derived template (cycleId set) into gaps, never missionGaps', () => {
    const input = buildPlanningLectureInput({
      scope: 'week',
      anchorDate: '2026-09-28',
      rows: [{
        site_id: 'site-1',
        site_name: 'Magasin',
        contract_id: 'contract-1',
        contract_name: 'Contrat',
        days: {
          '2026-09-28': [{
            id: 'int-1',
            mission_id: 'mission-1',
            mission_name: 'Entretien magasin',
            site_id: 'site-1',
            site_name: 'Magasin',
            contract_id: 'contract-1',
            contract_name: 'Contrat',
            scheduled_for: '2026-09-28',
            slot: 'morning',
            status: 'planned',
            skipped_at: null,
            assigned_team_id: null,
            assigned_team_name: null,
            assigned_team_color: null,
            template_id: 'rotation-e1',
            planned_start: null,
            planned_end: null,
          }],
        },
      }],
      missions: [{ id: 'mission-1', name: 'Entretien magasin', siteId: 'site-1', siteName: 'Magasin', clientName: null, contractName: 'Contrat', defaultTeamId: null }],
      rotations: [{
        id: 'rotation-e1',
        missionId: 'mission-1',
        missionName: 'Entretien magasin',
        siteId: 'site-1',
        title: 'Roulement E1',
        label: 'Roulement E1',
        cycleId: 'cycle-e1',
      }],
    })

    expect(input.missionGaps).toEqual([])
    expect(input.gaps).toEqual([{ date: '2026-09-28', missionId: 'mission-1', rotationId: 'rotation-e1' }])
  })
})
