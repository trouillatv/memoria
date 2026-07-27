// Sécurité Lot 1 — qui peut gérer les personnes terrain d'une équipe.
// La politique est PURE : on prouve la matrice complète sans base ni réseau.

import { describe, expect, it } from 'vitest'
import { decideTeamFieldAccess } from '@/lib/auth/team-field-access-policy'

describe('decideTeamFieldAccess', () => {
  it('admin : autorisé sur une équipe de son organisation', () => {
    expect(decideTeamFieldAccess({ role: 'admin', teamInOrg: true, isMyTeam: false }).allowed).toBe(true)
  })

  it('manager : autorisé sur toute équipe de son organisation (même non membre)', () => {
    expect(decideTeamFieldAccess({ role: 'manager', teamInOrg: true, isMyTeam: false }).allowed).toBe(true)
  })

  it('chef_equipe : autorisé UNIQUEMENT sur SES équipes', () => {
    expect(decideTeamFieldAccess({ role: 'chef_equipe', teamInOrg: true, isMyTeam: true }).allowed).toBe(true)
  })

  it('chef_equipe : refusé sur une équipe de l’org qui n’est pas la sienne', () => {
    const d = decideTeamFieldAccess({ role: 'chef_equipe', teamInOrg: true, isMyTeam: false })
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toMatch(/n.est pas la vôtre/)
  })

  it('hors organisation : refusé pour TOUS les rôles (isolation tenant)', () => {
    for (const role of ['admin', 'manager', 'chef_equipe'] as const) {
      // isMyTeam=true est ignoré si l'équipe n'est pas dans l'org : la garde
      // d'org prime toujours.
      const d = decideTeamFieldAccess({ role, teamInOrg: false, isMyTeam: true })
      expect(d.allowed).toBe(false)
      if (!d.allowed) expect(d.reason).toMatch(/organisation/)
    }
  })

  it('rôle nul ou inconnu : refusé', () => {
    expect(decideTeamFieldAccess({ role: null, teamInOrg: true, isMyTeam: true }).allowed).toBe(false)
  })

  it('la garde d’org prime : chef_equipe « membre » d’une équipe hors org reste refusé', () => {
    const d = decideTeamFieldAccess({ role: 'chef_equipe', teamInOrg: false, isMyTeam: true })
    expect(d.allowed).toBe(false)
  })
})
