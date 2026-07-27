// Lot 2B.2 — composition PURE du répertoire des acteurs (person | company | team).
// Vérifie le statut déterministe, les alertes, la dédup compte↔contact et les compteurs,
// sans jamais fusionner les entités ni masquer un acteur historique.

import { describe, expect, it } from 'vitest'
import { buildActorsCockpit, type ActorsCockpitInputs, type CockpitActor } from '@/lib/db/actors-cockpit'

function base(): ActorsCockpitInputs {
  return {
    today: '2026-07-27',
    companies: [], contacts: [], teams: [], users: [],
    teamMembers: [], fieldMembers: [], missions: [], casting: [], actions: [], proposalCount: 0,
  }
}

/** Codes des raisons d'attention d'un acteur (politique commune). */
const codes = (a: CockpitActor) => a.attention.reasons.map((r) => r.code)

describe('buildActorsCockpit', () => {
  it('org vide → répertoire vide, compteurs à zéro', () => {
    const d = buildActorsCockpit(base())
    expect(d.actors).toEqual([])
    expect(d.counters).toEqual({
      personsActive: 0, companiesActive: 0, teamsActive: 0,
      actionsWithoutOwner: 0, companiesOverdue: 0, agentsWithoutTeam: 0,
      companiesActionsNoReferent: 0, detectedUnconfirmed: 0, overdueActions: 0,
    })
  })

  it('action ouverte sans aucun responsable → compteur actionsWithoutOwner', () => {
    const d = buildActorsCockpit({
      ...base(),
      actions: [
        { assigned_contact_id: null, assigned_company_id: null, due_date: null },
        { assigned_contact_id: null, assigned_company_id: null, due_date: '2026-07-01' },
      ],
    })
    expect(d.counters.actionsWithoutOwner).toBe(2)
  })

  it('companiesOverdue compte les entreprises distinctes en retard, pas les actions', () => {
    const d = buildActorsCockpit({
      ...base(),
      companies: [{ id: 'co1', name: 'A', short_name: null }, { id: 'co2', name: 'B', short_name: null }],
      casting: [{ company_id: 'co1', main_contact_id: null, role: 'X' }, { company_id: 'co2', main_contact_id: null, role: 'Y' }],
      actions: [
        { assigned_contact_id: null, assigned_company_id: 'co1', due_date: '2026-07-01' },
        { assigned_contact_id: null, assigned_company_id: 'co1', due_date: '2026-07-02' },
        { assigned_contact_id: null, assigned_company_id: 'co2', due_date: '2026-07-03' },
      ],
    })
    expect(d.counters.companiesOverdue).toBe(2) // co1 + co2, malgré 3 actions
    expect(d.counters.overdueActions).toBe(3)
  })

  it('agent interne sans équipe → alerte agent_no_team + statut incomplet', () => {
    const d = buildActorsCockpit({
      ...base(),
      contacts: [{ id: 'c1', full_name: 'Jean Dupont', function: 'Électricien', company_id: null, is_internal_agent: true, email: null }],
    })
    const jean = d.actors.find((a) => a.id === 'c1')!
    expect(jean.kind).toBe('person')
    expect(jean.status).toBe('incomplete')
    expect(codes(jean)).toContain('agent_no_team')
    expect(jean.attention.level).toBe('attention')
    expect(d.counters.agentsWithoutTeam).toBe(1)
    expect(d.counters.personsActive).toBe(0)
  })

  it('agent avec équipe active → actif, état à jour', () => {
    const d = buildActorsCockpit({
      ...base(),
      contacts: [{ id: 'c1', full_name: 'Jean Dupont', function: null, company_id: null, is_internal_agent: true, email: null }],
      teams: [{ id: 't1', name: 'Électricité' }],
      fieldMembers: [{ team_id: 't1', contact_id: 'c1' }],
    })
    const jean = d.actors.find((a) => a.id === 'c1')!
    expect(jean.status).toBe('active')
    expect(jean.attention.level).toBe('ok')
    expect(d.counters.personsActive).toBe(1)
  })

  it('entreprise avec action ouverte en retard sans référent → urgent + 2 raisons + compteurs', () => {
    const d = buildActorsCockpit({
      ...base(),
      companies: [{ id: 'co1', name: 'SOTRAP SARL', short_name: 'SOTRAP' }],
      casting: [{ company_id: 'co1', main_contact_id: null, role: 'ETV' }],
      actions: [{ assigned_contact_id: null, assigned_company_id: 'co1', due_date: '2026-07-01' }],
    })
    const co = d.actors.find((a) => a.id === 'co1')!
    expect(co.kind).toBe('company')
    expect(co.name).toBe('SOTRAP')
    expect(co.status).toBe('active')
    expect(co.attention.level).toBe('urgent') // le retard prime
    expect(codes(co)).toEqual(expect.arrayContaining(['overdue_actions', 'company_no_referent']))
    expect(co.overdueActions).toBe(1)
    expect(d.counters.overdueActions).toBe(1)
    expect(d.counters.companiesOverdue).toBe(1)
    expect(d.counters.companiesActionsNoReferent).toBe(1)
  })

  it('entreprise responsable mais sortie du casting → raison company_left_casting, jamais masquée', () => {
    const d = buildActorsCockpit({
      ...base(),
      companies: [{ id: 'co1', name: 'OldCo', short_name: null }],
      casting: [], // plus au casting actif
      actions: [{ assigned_contact_id: null, assigned_company_id: 'co1', due_date: null }],
    })
    const co = d.actors.find((a) => a.id === 'co1')!
    expect(codes(co)).toContain('company_left_casting')
    expect(co.attention.level).toBe('attention')
    expect(co.status).toBe('active') // open>0 ⇒ toujours mobilisée
  })

  it('équipe affectée à un chantier mais vide → à surveiller (team_empty_but_assigned)', () => {
    const d = buildActorsCockpit({
      ...base(),
      teams: [{ id: 't1', name: 'Gros œuvre' }],
      missions: [{ site_id: 's1', assigned_team_id: 't1' }],
    })
    const t = d.actors.find((a) => a.id === 't1')!
    expect(t.kind).toBe('team')
    expect(t.attention.level).toBe('attention') // équipe : jamais urgent
    expect(codes(t)).toEqual(['team_empty_but_assigned'])
    expect(t.href).toBe('/equipes/t1')
  })

  it('équipe vide et non affectée → à surveiller · Aucun membre (jamais « à jour »)', () => {
    const d = buildActorsCockpit({ ...base(), teams: [{ id: 't1', name: 'Gros œuvre' }] })
    const t = d.actors.find((a) => a.id === 't1')!
    expect(t.status).toBe('incomplete')
    expect(t.attention.level).toBe('attention')
    expect(codes(t)).toEqual(['team_no_member'])
  })

  it('dédup compte↔contact : un user avec le même e-mail qu\'un contact n\'est pas double-compté', () => {
    const d = buildActorsCockpit({
      ...base(),
      contacts: [{ id: 'c1', full_name: 'Marie Martin', function: null, company_id: null, is_internal_agent: true, email: 'marie@ex.fr' }],
      teams: [{ id: 't1', name: 'Élec' }],
      fieldMembers: [{ team_id: 't1', contact_id: 'c1' }],
      users: [{ id: 'u1', full_name: 'Marie Martin', email: 'marie@ex.fr', role: 'chef_equipe' }],
      teamMembers: [{ team_id: 't1', user_id: 'u1' }],
    })
    const persons = d.actors.filter((a) => a.kind === 'person')
    expect(persons).toHaveLength(1) // le contact, pas le compte
    expect(persons[0]!.id).toBe('c1')
    expect(persons[0]!.linkedAccountHint).toBe(true)
  })

  it('compte avec présence métier et SANS contact correspondant → présent avec href fiche', () => {
    const d = buildActorsCockpit({
      ...base(),
      teams: [{ id: 't1', name: 'Élec' }],
      users: [{ id: 'u1', full_name: 'Paul Neuf', email: 'paul@ex.fr', role: 'chef_equipe' }],
      teamMembers: [{ team_id: 't1', user_id: 'u1' }],
    })
    const paul = d.actors.find((a) => a.id === 'u1')!
    expect(paul.kind).toBe('person')
    expect(paul.href).toBe('/intervenants/u1')
    expect(d.counters.personsActive).toBe(1)
  })

  it('propositions stakeholder non confirmées remontées telles quelles', () => {
    const d = buildActorsCockpit({ ...base(), proposalCount: 4 })
    expect(d.counters.detectedUnconfirmed).toBe(4)
  })
})
