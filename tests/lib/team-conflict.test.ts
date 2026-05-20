// Tests du helper partagé findTeamSiteConflict / listTeamConflictsForSlot.
//
// Cas Vincent 2026-05-20 :
//   - une équipe peut avoir 06h30–08h00 sur site A et 13h00–15h00 sur site B
//     (pas de chevauchement temporel → pas de conflit)
//   - 06h30–08h00 et 07h30–09h00 sur deux sites = CONFLIT (chevauchement)
//   - fallback legacy slot continue de fonctionner sans planned_end
//
// On mock le createAdminClient pour pouvoir injecter des résultats Supabase
// déterministes. Aucun appel réseau, aucun PII.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Le module testé importe 'server-only' (garde-fou Next.js). En env test
// (tsx pur), on neutralise l'import.
vi.mock('server-only', () => ({}))

// Mock Supabase admin client AVANT d'importer le module testé.
// Chaque test push ses rows dans une variable partagée que le mock relit.
let mockMissionRow: { site_id: string } | null = null
let mockCandidatesByQuery: Record<string, unknown[]> = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => buildChain(table),
  }),
}))

function buildChain(table: string): unknown {
  // Mini fluent builder qui supporte la chaîne utilisée par le helper.
  const state: { table: string; filters: Record<string, unknown>; isMission: boolean } = {
    table,
    filters: {},
    isMission: table === 'missions',
  }
  function chain(): Record<string, unknown> {
    return {
      select: () => chain(),
      eq: (k: string, v: unknown) => { state.filters[k] = v; return chain() },
      neq: () => chain(),
      in: () => chain(),
      not: () => chain(),
      maybeSingle: async () => ({ data: state.isMission ? mockMissionRow : null }),
      // when not maybeSingle, the chain itself is the result of select
      then: undefined,
    }
  }
  if (table === 'interventions') {
    return {
      select: () => ({
        neq: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ data: mockCandidatesByQuery.interventions ?? [], error: null }) }) }) }),
        eq: () => ({ in: () => ({ neq: () => ({ not: async () => ({ data: mockCandidatesByQuery.interventions ?? [], error: null }) }) }) }),
      }),
    }
  }
  return chain()
}

import { findTeamSiteConflict } from '@/lib/scheduling/team-conflict'
import { createAdminClient } from '@/lib/supabase/admin'

const TEAM_X = 'team-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
const SITE_A = 'site-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const SITE_B = 'site-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const MISSION_SOURCE = 'mss-source-xxxxxxxxxxxx-xxxxxxxxxxxx'

function adminStub(): ReturnType<typeof createAdminClient> {
  return createAdminClient()
}

beforeEach(() => {
  mockMissionRow = { site_id: SITE_A }
  mockCandidatesByQuery = {}
})

describe('findTeamSiteConflict — V6.1 chevauchement horaire', () => {
  it('PAS de conflit : 06h30-08h00 site A + 13h00-15h00 site B (Vincent cas typique)', async () => {
    mockCandidatesByQuery.interventions = [
      {
        slot: 'afternoon',
        planned_start: '2026-05-20T13:00:00.000Z',
        planned_end: '2026-05-20T15:00:00.000Z',
        mission: { site: { id: SITE_B, name: 'Site B' } },
        team: { name: 'Équipe X' },
      },
    ]
    const r = await findTeamSiteConflict({
      admin: adminStub(),
      teamId: TEAM_X,
      missionId: MISSION_SOURCE,
      scheduledFor: '2026-05-20',
      slot: 'morning',
      sourcePlannedStart: '2026-05-20T06:30:00.000Z',
      sourcePlannedEnd: '2026-05-20T08:00:00.000Z',
      excludeInterventionId: '00000000-0000-0000-0000-000000000000',
    })
    expect(r).toBeNull()
  })

  it('CONFLIT : 06h30-08h00 site A + 07h30-09h00 site B (chevauchement)', async () => {
    mockCandidatesByQuery.interventions = [
      {
        slot: 'morning',
        planned_start: '2026-05-20T07:30:00.000Z',
        planned_end: '2026-05-20T09:00:00.000Z',
        mission: { site: { id: SITE_B, name: 'Site B' } },
        team: { name: 'Équipe X' },
      },
    ]
    const r = await findTeamSiteConflict({
      admin: adminStub(),
      teamId: TEAM_X,
      missionId: MISSION_SOURCE,
      scheduledFor: '2026-05-20',
      slot: 'morning',
      sourcePlannedStart: '2026-05-20T06:30:00.000Z',
      sourcePlannedEnd: '2026-05-20T08:00:00.000Z',
      excludeInterventionId: '00000000-0000-0000-0000-000000000000',
    })
    expect(r).not.toBeNull()
    expect(r?.siteName).toBe('Site B')
  })

  it('PAS de conflit même site (multi-mission OK) — 06h30-08h00 et 07h30-09h00 sur SITE A', async () => {
    mockCandidatesByQuery.interventions = [
      {
        slot: 'morning',
        planned_start: '2026-05-20T07:30:00.000Z',
        planned_end: '2026-05-20T09:00:00.000Z',
        mission: { site: { id: SITE_A, name: 'Site A' } },
        team: { name: 'Équipe X' },
      },
    ]
    const r = await findTeamSiteConflict({
      admin: adminStub(),
      teamId: TEAM_X,
      missionId: MISSION_SOURCE,
      scheduledFor: '2026-05-20',
      slot: 'morning',
      sourcePlannedStart: '2026-05-20T06:30:00.000Z',
      sourcePlannedEnd: '2026-05-20T08:00:00.000Z',
      excludeInterventionId: '00000000-0000-0000-0000-000000000000',
    })
    expect(r).toBeNull()
  })

  it('FALLBACK slot : si planned_end absent côté CANDIDATE → critère slot grossier', async () => {
    mockCandidatesByQuery.interventions = [
      {
        slot: 'morning',
        planned_start: '2026-05-20T07:00:00.000Z', // ancrage canonique
        planned_end: null,                          // pas de range
        mission: { site: { id: SITE_B, name: 'Site B' } },
        team: { name: 'Équipe X' },
      },
    ]
    // Source a un range mais candidate non → fallback slot identique (matin = matin)
    const r = await findTeamSiteConflict({
      admin: adminStub(),
      teamId: TEAM_X,
      missionId: MISSION_SOURCE,
      scheduledFor: '2026-05-20',
      slot: 'morning',
      sourcePlannedStart: '2026-05-20T06:30:00.000Z',
      sourcePlannedEnd: '2026-05-20T08:00:00.000Z',
      excludeInterventionId: '00000000-0000-0000-0000-000000000000',
    })
    expect(r).not.toBeNull()
    expect(r?.siteName).toBe('Site B')
  })

  it('FALLBACK slot : si planned_end absent CÔTÉ SOURCE → critère slot grossier', async () => {
    mockCandidatesByQuery.interventions = [
      {
        slot: 'morning',
        planned_start: '2026-05-20T06:30:00.000Z',
        planned_end: '2026-05-20T08:00:00.000Z',
        mission: { site: { id: SITE_B, name: 'Site B' } },
        team: { name: 'Équipe X' },
      },
    ]
    // Source slot='morning' sans range → comparé à row.slot='morning' = conflit
    const r = await findTeamSiteConflict({
      admin: adminStub(),
      teamId: TEAM_X,
      missionId: MISSION_SOURCE,
      scheduledFor: '2026-05-20',
      slot: 'morning',
      sourcePlannedStart: null,
      sourcePlannedEnd: null,
      excludeInterventionId: '00000000-0000-0000-0000-000000000000',
    })
    expect(r).not.toBeNull()
  })

  it('PAS de conflit : ancien comportement préservé — slots différents sans heures', async () => {
    mockCandidatesByQuery.interventions = [
      {
        slot: 'afternoon',
        planned_start: '2026-05-20T14:00:00.000Z',
        planned_end: null,
        mission: { site: { id: SITE_B, name: 'Site B' } },
        team: { name: 'Équipe X' },
      },
    ]
    const r = await findTeamSiteConflict({
      admin: adminStub(),
      teamId: TEAM_X,
      missionId: MISSION_SOURCE,
      scheduledFor: '2026-05-20',
      slot: 'morning',
      sourcePlannedStart: null,
      sourcePlannedEnd: null,
      excludeInterventionId: '00000000-0000-0000-0000-000000000000',
    })
    expect(r).toBeNull()
  })

  it('Limite stricte : fin = début de l\'autre n\'est PAS un chevauchement (équipe peut enchaîner)', async () => {
    mockCandidatesByQuery.interventions = [
      {
        slot: 'morning',
        planned_start: '2026-05-20T08:00:00.000Z',
        planned_end: '2026-05-20T09:30:00.000Z',
        mission: { site: { id: SITE_B, name: 'Site B' } },
        team: { name: 'Équipe X' },
      },
    ]
    // 06h30-08h00 termine quand 08h00-09h30 commence → enchaînement OK
    const r = await findTeamSiteConflict({
      admin: adminStub(),
      teamId: TEAM_X,
      missionId: MISSION_SOURCE,
      scheduledFor: '2026-05-20',
      slot: 'morning',
      sourcePlannedStart: '2026-05-20T06:30:00.000Z',
      sourcePlannedEnd: '2026-05-20T08:00:00.000Z',
      excludeInterventionId: '00000000-0000-0000-0000-000000000000',
    })
    expect(r).toBeNull()
  })
})
