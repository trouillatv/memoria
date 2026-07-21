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
      rotations: [{ id: 'rotation-e1', missionId: 'mission-1', missionName: 'Entretien magasin', siteId: 'site-1', title: 'Roulement E1', label: 'Roulement E1' }],
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
  })
})
