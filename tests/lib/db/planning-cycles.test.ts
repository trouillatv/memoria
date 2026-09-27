// PLAN-INTEG-1 FINAL — review ChatGPT du SHA 9eda7fdc (FIX_REQUIRED, mandat
// Vincent 2026-09-27).
//
// Bug #2 (non-atomicité), couche profonde : `regenerateTemplates` archivait les
// anciens rythmes PUIS en insérait de nouveaux via deux appels Supabase-JS
// séparés — chacun se commit seul. Si l'insertion échouait après l'archivage,
// le cycle se retrouvait sans AUCUN rythme actif. La fonction route désormais
// les deux étapes dans UNE transaction via la RPC service_role
// `fn_plan_regenerate_cycle_templates` (mig 442/443) : plus aucun appel direct
// à `intervention_templates` depuis createCycle/updateCycle/supersedeCycle.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireTeamCompatibleWithOrg: vi.fn(),
  getOrgIdsOfUser: vi.fn(),
}))

vi.mock('@/lib/auth/team-compatibility', () => ({ requireTeamCompatibleWithOrg: mocks.requireTeamCompatibleWithOrg }))
vi.mock('@/lib/auth/memberships', () => ({ getOrgIdsOfUser: mocks.getOrgIdsOfUser }))

/**
 * Faux client Postgrest minimal : chaque `.from(table)` ouvre une chaîne dont
 * seule la DERNIÈRE méthode appelée avant le `await` détermine la réponse —
 * suffisant pour distinguer `.insert().select().single()` (création, attend un
 * id) de `.update().eq().is()` (mise à jour, attend juste une erreur) sans
 * reproduire tout Postgrest. Chaque appel `.from(table)` est enregistré pour
 * pouvoir prouver qu'AUCUN appel direct à `intervention_templates` n'a lieu.
 */
function makeDb(responses: Record<string, unknown>) {
  const fromCalls: string[] = []
  const from = vi.fn((table: string) => {
    fromCalls.push(table)
    let lastMethod = ''
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop: string) {
        if (prop === 'then') {
          const key = `${table}:${lastMethod}`
          const res = responses[key] ?? { data: null, error: null }
          return (resolve: (v: unknown) => unknown) => resolve(res)
        }
        return () => {
          lastMethod = prop
          return proxy
        }
      },
    }
    const proxy = new Proxy({}, handler)
    return proxy
  })
  return { from, rpc: mocks.rpc, fromCalls }
}

const orgId = '99999999-9999-4999-8999-999999999999'
const userId = '22222222-2222-4222-8222-222222222222'
const teamId = '44444444-4444-4444-8444-444444444444'
const cycleId = '33333333-3333-4333-8333-333333333333'
const newCycleId = '66666666-6666-4666-8666-666666666666'
const missionId = '88888888-8888-4888-8888-888888888888'
const siteId = '11111111-1111-4111-8111-111111111111'

const cycleRow = {
  id: cycleId,
  site_id: siteId,
  mission_id: missionId,
  name: 'Roulement magasin',
  cycle_length_weeks: 1,
  anchor_date: '2026-01-05',
  starts_on: '2026-01-05',
  ends_on: null,
  status: 'published',
  supersedes_cycle_id: null,
}

function baseResponses(): Record<string, unknown> {
  return {
    'planning_cycles:single': { data: { id: newCycleId }, error: null },
    'planning_cycles:is': { error: null },
    'planning_cycles:maybeSingle': { data: cycleRow, error: null },
    'planning_cycle_slots:eq': { data: [], error: null },
    'planning_cycle_slots:insert': { error: null },
  }
}

function makeInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    siteId,
    missionId,
    organizationId: orgId,
    name: 'Roulement magasin',
    cycleLengthWeeks: 1,
    anchorDate: '2026-01-05',
    startsOn: '2026-01-05',
    endsOn: null as string | null,
    slots: [
      {
        weekIndex: 0,
        weekday: 1,
        teamId,
        state: 'work' as const,
        startTime: '08:00',
        endTime: '12:00',
      },
    ],
    userId,
    status: 'published' as const,
    ...overrides,
  }
}

let db: ReturnType<typeof makeDb>

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }))

import { createCycle, updateCycle, supersedeCycle } from '@/lib/db/planning-cycles'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireTeamCompatibleWithOrg.mockResolvedValue({ allowed: true })
  mocks.rpc.mockResolvedValue({ error: null })
  db = makeDb(baseResponses())
})

describe('regenerateTemplates — routage atomique par RPC (PLAN-INTEG-1 Bug #2)', () => {
  it('createCycle : régénère via UNE SEULE rpc, jamais un appel direct à intervention_templates', async () => {
    const id = await createCycle(makeInput())

    expect(id).toBe(newCycleId)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('fn_plan_regenerate_cycle_templates', {
      p_cycle_id: newCycleId,
      p_actor_id: userId,
    })
    expect(db.fromCalls).not.toContain('intervention_templates')
  })

  it('updateCycle : régénère via UNE SEULE rpc, jamais d’archive/insert séparés sur intervention_templates', async () => {
    await updateCycle(cycleId, makeInput())

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('fn_plan_regenerate_cycle_templates', {
      p_cycle_id: cycleId,
      p_actor_id: userId,
    })
    expect(db.fromCalls).not.toContain('intervention_templates')
  })

  it('supersedeCycle : régénère l’ANCIENNE version puis crée+publie la NOUVELLE, deux rpc atomiques, jamais un appel direct à intervention_templates', async () => {
    const id = await supersedeCycle(cycleId, makeInput(), '2026-10-01')

    expect(id).toBe(newCycleId)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'fn_plan_regenerate_cycle_templates', {
      p_cycle_id: cycleId,
      p_actor_id: userId,
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'fn_plan_regenerate_cycle_templates', {
      p_cycle_id: newCycleId,
      p_actor_id: userId,
    })
    expect(db.fromCalls).not.toContain('intervention_templates')
  })

  it('remonte l’erreur de la RPC sans avaler l’échec (fail-closed, pas de succès silencieux)', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'boom' } })

    await expect(createCycle(makeInput())).rejects.toThrow('boom')
  })

  it('rejette AVANT la rpc si une équipe de la grille n’appartient pas à l’organisation du cycle', async () => {
    mocks.requireTeamCompatibleWithOrg.mockResolvedValue({ allowed: false, error: 'Équipe étrangère' })

    await expect(createCycle(makeInput())).rejects.toThrow('Équipe étrangère')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
