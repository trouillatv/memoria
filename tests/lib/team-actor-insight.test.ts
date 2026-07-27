// Lot 2B.3C — composition PURE de l'éclairage acteur d'une équipe. Vérifie que
// l'équipe n'est jamais « responsable » des actions (membres seulement), le tri des
// actions portées, les orphelines, et l'état (jamais urgent).

import { describe, expect, it } from 'vitest'
import { buildTeamActorInsight, type TeamActorInsightInputs } from '@/lib/db/team-actor-insight'

function base(): TeamActorInsightInputs {
  return { today: '2026-07-27', totalMembers: 0, fieldMemberCount: 0, assignedSiteIds: [], memberOpenActions: [] }
}

describe('buildTeamActorInsight', () => {
  it('équipe INACTIVE (sans membre, non mobilisée) → à jour, pas un problème', () => {
    const i = buildTeamActorInsight(base())
    expect(i.attention.level).toBe('ok')
    expect(i.attention.reasons).toEqual([])
  })

  it('actions des membres réparties : sur chantier mobilisé vs orphelines (équipe sortie)', () => {
    const i = buildTeamActorInsight({
      ...base(),
      totalMembers: 3, fieldMemberCount: 2,
      assignedSiteIds: ['s1'],
      memberOpenActions: [
        { id: 'a1', title: 'Sur chantier actif', siteId: 's1', siteName: 'Lycée', contactId: 'c1', contactName: 'Jean', dueDate: '2026-07-01' },
        { id: 'a2', title: 'Chantier quitté', siteId: 's9', siteName: 'Ancien', contactId: 'c2', contactName: 'Paul', dueDate: null },
      ],
    })
    expect(i.memberActions.map((a) => a.id)).toEqual(['a1'])
    expect(i.orphanActions.map((a) => a.id)).toEqual(['a2'])
    expect(i.memberActions[0]!.overdue).toBe(true)
    expect(i.memberActions[0]!.href).toBe('/sites/s1/action/a1')
    // Jamais urgent, même avec un retard : l'équipe n'est pas responsable de l'action.
    expect(i.attention.level).toBe('attention')
    expect(i.attention.reasons.map((r) => r.code)).toContain('member_orphan_actions')
    expect(i.openCount).toBe(2)
    expect(i.overdueCount).toBe(1)
  })

  it('équipe mobilisée, membres présents, aucune orpheline → à jour', () => {
    const i = buildTeamActorInsight({
      ...base(),
      totalMembers: 4, fieldMemberCount: 3,
      assignedSiteIds: ['s1'],
      memberOpenActions: [{ id: 'a1', title: 'X', siteId: 's1', siteName: 'Lycée', contactId: 'c1', contactName: 'Jean', dueDate: '2027-01-01' }],
    })
    expect(i.attention.level).toBe('ok')
    expect(i.memberActions).toHaveLength(1)
    expect(i.orphanActions).toHaveLength(0)
  })

  it('a des comptes mais aucun agent terrain → à surveiller · Aucun agent terrain', () => {
    const i = buildTeamActorInsight({ ...base(), totalMembers: 2, fieldMemberCount: 0, assignedSiteIds: ['s1'] })
    expect(i.attention.reasons.map((r) => r.code)).toContain('team_no_field_member')
  })
})
