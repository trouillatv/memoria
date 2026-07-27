// Lot 2B.3 — politique PURE commune d'état d'attention. Le niveau suit la raison la
// plus grave (jamais une moyenne) ; l'état décrit des faits, ne juge pas l'acteur.

import { describe, expect, it } from 'vitest'
import { deriveActorAttentionState, attentionLevelLabel } from '@/lib/knowledge/actor-attention'

describe('deriveActorAttentionState — personne', () => {
  it('aucun fait → à jour, sans raison', () => {
    const s = deriveActorAttentionState({ kind: 'person', overdueActions: 0, responsibleButNotActive: false, internalAgentWithoutTeam: false })
    expect(s).toEqual({ level: 'ok', reasons: [] })
  })

  it('agent sans équipe → surveiller', () => {
    const s = deriveActorAttentionState({ kind: 'person', overdueActions: 0, responsibleButNotActive: false, internalAgentWithoutTeam: true })
    expect(s.level).toBe('attention')
    expect(s.reasons.map((r) => r.code)).toEqual(['agent_no_team'])
  })

  it('action en retard → traiter, même combinée à une raison plus faible (la plus grave prime)', () => {
    const s = deriveActorAttentionState({ kind: 'person', overdueActions: 2, responsibleButNotActive: true, internalAgentWithoutTeam: false })
    expect(s.level).toBe('urgent')
    // urgent en tête, puis attention
    expect(s.reasons[0]).toEqual({ code: 'overdue_actions', count: 2, label: '2 actions en retard' })
    expect(s.reasons.map((r) => r.code)).toContain('responsible_not_active')
  })

  it('singulier correct', () => {
    const s = deriveActorAttentionState({ kind: 'person', overdueActions: 1, responsibleButNotActive: false, internalAgentWithoutTeam: false })
    expect(s.reasons[0]!.label).toBe('1 action en retard')
  })
})

describe('deriveActorAttentionState — entreprise', () => {
  it('retard → traiter', () => {
    const s = deriveActorAttentionState({ kind: 'company', overdueActions: 3, actionsWithoutReferent: 1, leftCastingWithOpenActions: false })
    expect(s.level).toBe('urgent')
    expect(s.reasons[0]!.code).toBe('overdue_actions')
    expect(s.reasons.map((r) => r.code)).toContain('company_no_referent')
  })

  it('sans référent + sortie casting, sans retard → surveiller', () => {
    const s = deriveActorAttentionState({ kind: 'company', overdueActions: 0, actionsWithoutReferent: 2, leftCastingWithOpenActions: true })
    expect(s.level).toBe('attention')
    expect(s.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['company_no_referent', 'company_left_casting']))
  })
})

describe('deriveActorAttentionState — équipe', () => {
  it('jamais urgent, même avec des actions orphelines de membres', () => {
    const s = deriveActorAttentionState({ kind: 'team', emptyButAssigned: false, noMembers: false, activeWithoutFieldMember: false, memberOrphanActions: 5 })
    expect(s.level).toBe('attention') // pas urgent
    expect(s.reasons[0]!.code).toBe('member_orphan_actions')
  })

  it('affectée mais vide → surveiller (plus spécifique que no_member/no_field_member)', () => {
    const s = deriveActorAttentionState({ kind: 'team', emptyButAssigned: true, noMembers: true, activeWithoutFieldMember: true, memberOrphanActions: 0 })
    expect(s.level).toBe('attention')
    expect(s.reasons.map((r) => r.code)).toEqual(['team_empty_but_assigned'])
  })

  it('équipe sans aucun membre (non affectée) → surveiller · Aucun membre (jamais « à jour »)', () => {
    const s = deriveActorAttentionState({ kind: 'team', emptyButAssigned: false, noMembers: true, activeWithoutFieldMember: false, memberOrphanActions: 0 })
    expect(s.level).toBe('attention')
    expect(s.reasons.map((r) => r.code)).toEqual(['team_no_member'])
    expect(s.reasons[0]!.label).toBe('Aucun membre')
  })

  it('a des comptes mais aucun agent terrain → no_field_member', () => {
    const s = deriveActorAttentionState({ kind: 'team', emptyButAssigned: false, noMembers: false, activeWithoutFieldMember: true, memberOrphanActions: 0 })
    expect(s.reasons.map((r) => r.code)).toEqual(['team_no_field_member'])
  })
})

describe('attentionLevelLabel', () => {
  it('libellés opérationnels, jamais « santé »', () => {
    expect(attentionLevelLabel('ok')).toBe('À jour')
    expect(attentionLevelLabel('attention')).toBe('À surveiller')
    expect(attentionLevelLabel('urgent')).toBe('À traiter')
  })
})
