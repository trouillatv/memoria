// PLAN-SEC-1 (mandat Vincent 2026-09-26) — `requireTeamCompatibleWithOrg` est le
// garde canonique resource-vs-resource : compare l'équipe choisie à
// l'organisation du CHANTIER RÉEL ciblé, jamais à celle de l'appelant. Cas
// métier : Guillaume (multi-org AGP + Servinor) ne doit jamais pouvoir affecter
// une équipe Servinor à un chantier AGP, même si les deux `requireOwned`
// (appelant-vs-mission, appelant-vs-équipe) passent séparément.

import { beforeEach, describe, expect, it, vi } from 'vitest'

let teamRow: Record<string, unknown> | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from() {
      const query = {
        select() { return query },
        eq() { return query },
        maybeSingle: () => Promise.resolve({ data: teamRow, error: null }),
      }
      return query
    },
  }),
}))

import { requireTeamCompatibleWithOrg } from '@/lib/auth/team-compatibility'

const ORG_A = '11111111-1111-1111-1111-111111111111'
const ORG_B = '22222222-2222-2222-2222-222222222222'
const TEAM_A = '33333333-3333-3333-3333-333333333333'
const FORGED_UUID = '99999999-9999-9999-9999-999999999999'

beforeEach(() => {
  teamRow = null
})

describe('requireTeamCompatibleWithOrg', () => {
  it('site A + équipe A (même organisation) : autorisé', async () => {
    teamRow = { id: TEAM_A, organization_id: ORG_A, active: true, deleted_at: null }

    const result = await requireTeamCompatibleWithOrg(TEAM_A, ORG_A)

    expect(result).toEqual({ allowed: true })
  })

  it('site A + équipe B (organisation différente, cas Guillaume multi-org) : refusé', async () => {
    teamRow = { id: TEAM_A, organization_id: ORG_B, active: true, deleted_at: null }

    const result = await requireTeamCompatibleWithOrg(TEAM_A, ORG_A)

    expect(result.allowed).toBe(false)
  })

  it('équipe inactive : refusée même si organisation correcte', async () => {
    teamRow = { id: TEAM_A, organization_id: ORG_A, active: false, deleted_at: null }

    const result = await requireTeamCompatibleWithOrg(TEAM_A, ORG_A)

    expect(result.allowed).toBe(false)
  })

  it('équipe archivée (deleted_at non null) : refusée même si organisation correcte', async () => {
    teamRow = { id: TEAM_A, organization_id: ORG_A, active: true, deleted_at: '2026-01-01T00:00:00.000Z' }

    const result = await requireTeamCompatibleWithOrg(TEAM_A, ORG_A)

    expect(result.allowed).toBe(false)
  })

  it('UUID forgé (équipe introuvable) : refusé', async () => {
    teamRow = null

    const result = await requireTeamCompatibleWithOrg(FORGED_UUID, ORG_A)

    expect(result.allowed).toBe(false)
  })

  it('même message générique pour tous les refus (aucun oracle sur la raison exacte)', async () => {
    teamRow = null
    const notFound = await requireTeamCompatibleWithOrg(FORGED_UUID, ORG_A)

    teamRow = { id: TEAM_A, organization_id: ORG_B, active: true, deleted_at: null }
    const wrongOrg = await requireTeamCompatibleWithOrg(TEAM_A, ORG_A)

    teamRow = { id: TEAM_A, organization_id: ORG_A, active: false, deleted_at: null }
    const inactive = await requireTeamCompatibleWithOrg(TEAM_A, ORG_A)

    expect(notFound.allowed).toBe(false)
    expect(wrongOrg.allowed).toBe(false)
    expect(inactive.allowed).toBe(false)
    if (!notFound.allowed && !wrongOrg.allowed && !inactive.allowed) {
      expect(notFound.error).toBe(wrongOrg.error)
      expect(wrongOrg.error).toBe(inactive.error)
    }
  })
})
