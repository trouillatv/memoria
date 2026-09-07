// Test d'INTÉGRATION (vraie Supabase) — Phase 6E.1C, wrapper lib/db/tracked-point-consolidation.ts.
//
// Les guards SQL bruts (migration 392) sont couverts par
// tests/lib/db/merge-tracked-points-guards.test.ts. Ce fichier couvre la couche wrapper
// AU-DESSUS : idempotence ALREADY_CONSOLIDATED (déliverable 2), STALE_PAIR quand la paire ne
// correspond plus à un état en attente, INVALID_PAIR_ID, et rejectPointIdentityPair exact-pair
// au niveau du read-model dérivé (deriveCandidatePointPairs), pas seulement au niveau RPC.
//
// HARD STOP inchangé : fusions exclusivement sur des tracked_point synthétiques tagués.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { consolidateTrackedPoints, rejectPointIdentityPair } from '@/lib/db/tracked-point-consolidation'

const TAG = `__test_6e1c_wrapper_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let adminUserId: string

async function makePoint(overrides: Record<string, unknown> = {}) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point')
    .insert({ site_id: siteId, label: `${TAG} point`, founding_kind: 'manual', seed_source: 'manual', ...overrides })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function makeCandidate(overrides: Record<string, unknown>) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_identity_candidate')
    .insert({ site_id: siteId, subject_thread_id: randomUUID(), reason: 'test', ...overrides })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

function pairIdOf(a: string, b: string): string {
  return [a, b].sort().join('~')
}

beforeAll(async () => {
  const db = createAdminClient()
  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  const { data: admin } = await db.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  if (!admin) throw new Error('Aucun admin user — seed requis')
  adminUserId = (admin as { id: string }).id

  const { data: client, error: cErr } = await db
    .from('clients')
    .insert({ name: `${TAG}client`, organization_id: orgId })
    .select('id').single()
  if (cErr) throw cErr
  clientId = (client as { id: string }).id

  const { data: site, error: sErr } = await db
    .from('sites')
    .insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId })
    .select('id').single()
  if (sErr) throw sErr
  siteId = (site as { id: string }).id
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('tracked_point_identity_candidate').delete().eq('site_id', siteId)
  const { data: pts } = await db.from('tracked_point').select('id').eq('site_id', siteId)
  const ptIds = ((pts ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (ptIds.length > 0) {
    await db.from('tracked_point_member').delete().in('tracked_point_id', ptIds)
  }
  await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('site_id', siteId)
  await db.from('tracked_point').delete().eq('site_id', siteId)
  await db.from('sites').delete().eq('id', siteId)
  await db.from('clients').delete().eq('id', clientId)
})

describe('consolidateTrackedPoints', () => {
  it('INVALID_PAIR_ID sur un pairId mal formé', async () => {
    const result = await consolidateTrackedPoints({ siteId, pairId: 'not-a-pair-id' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_PAIR_ID')
  })

  it('STALE_PAIR quand les deux extrémités ne se résolvent à rien de commun ni à une paire en attente', async () => {
    const a = await makePoint()
    const b = await makePoint()
    const result = await consolidateTrackedPoints({ siteId, pairId: pairIdOf(a, b) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/STALE_PAIR/)
  })

  it('ALREADY_CONSOLIDATED : idempotent, aucune écriture, quand les deux extrémités résolvent déjà au même canonique', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const b = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: a, subject_thread_id: randomUUID() })
    // Fusion réelle préalable (hors wrapper) pour placer a.merged_into_id = b — nécessite un
    // rattachement 7bis valide : founding_kind trackable_condition sur b.
    await db.from('tracked_point').update({ founding_kind: 'trackable_condition', founding_reference: randomUUID() }).eq('id', b)
    const { data: bRow } = await db.from('tracked_point').select('founding_reference').eq('id', b).single()
    const threadRef = (bRow as { founding_reference: string }).founding_reference
    await db.from('tracked_point_identity_candidate').update({ subject_thread_id: threadRef }).eq('id', cand)

    const { error: mergeErr } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(mergeErr).toBeNull()

    const result = await consolidateTrackedPoints({ siteId, pairId: pairIdOf(a, b) })
    expect(result.ok).toBe(true)
    if (result.ok && result.alreadyConsolidated) {
      expect(result.canonicalPointId).toBe(b)
    } else {
      throw new Error('attendu alreadyConsolidated=true')
    }

    // Repli pour afterAll (merged_into_id FK RESTRICT).
    await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('id', a)
  })

  it('succès : recalcule la direction canonique en direct (jamais celle du client) et fusionne via le read-model dérivé', async () => {
    const db = createAdminClient()
    const threadX = randomUUID()
    const a = await makePoint()
    const b = await makePoint({ founding_kind: 'trackable_condition', founding_reference: threadX })
    await makeCandidate({ candidate_point_id: a, subject_thread_id: threadX })

    const result = await consolidateTrackedPoints({ siteId, pairId: pairIdOf(a, b) })
    expect(result.ok).toBe(true)
    if (!result.ok || result.alreadyConsolidated) throw new Error('attendu une fusion réelle')
    expect([a, b]).toContain(result.sourceId)
    expect([a, b]).toContain(result.targetId)
    expect(result.sourceId).not.toBe(result.targetId)
    expect(result.candidatesAccepted).toBe(1)

    const { data: sourceRow } = await db.from('tracked_point').select('status, merged_into_id').eq('id', result.sourceId).single()
    expect((sourceRow as { status: string; merged_into_id: string }).status).toBe('merged')
    expect((sourceRow as { status: string; merged_into_id: string }).merged_into_id).toBe(result.targetId)

    await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('id', result.sourceId)
  })
})

describe('rejectPointIdentityPair', () => {
  it('STALE_PAIR quand la paire n\'existe pas dans le read-model dérivé', async () => {
    const a = await makePoint()
    const b = await makePoint()
    const result = await rejectPointIdentityPair({ siteId, pairId: pairIdOf(a, b), actorUserId: adminUserId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/STALE_PAIR/)
  })

  it('rejette exactement les candidateIds de la paire dérivée, jamais une candidate hors paire', async () => {
    const db = createAdminClient()
    const threadX = randomUUID()
    const threadY = randomUUID()
    const a = await makePoint()
    const b = await makePoint({ founding_kind: 'trackable_condition', founding_reference: threadX })
    await db.from('tracked_point_member').insert({ tracked_point_id: a, subject_thread_id: threadY, scope: 'thread', resolution_source: 'manual' })

    const candAtoB = await makeCandidate({ candidate_point_id: a, subject_thread_id: threadX }) // b→a (founder de b)
    const candBtoA = await makeCandidate({ candidate_point_id: b, subject_thread_id: threadY }) // a→b (membership de a)
    // Candidate hors paire : cible un tiers, ne doit jamais être affectée.
    const other = await makePoint()
    const untouched = await makeCandidate({ candidate_point_id: other, subject_thread_id: randomUUID() })

    const result = await rejectPointIdentityPair({ siteId, pairId: pairIdOf(a, b), actorUserId: adminUserId })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rejectedCount).toBe(2)

    const { data: rows } = await db
      .from('tracked_point_identity_candidate')
      .select('id, status')
      .in('id', [candAtoB, candBtoA, untouched])
    const byId = new Map(((rows ?? []) as Array<{ id: string; status: string }>).map((r) => [r.id, r.status]))
    expect(byId.get(candAtoB)).toBe('rejected')
    expect(byId.get(candBtoA)).toBe('rejected')
    expect(byId.get(untouched)).toBe('pending')

    await db.from('tracked_point_member').delete().eq('tracked_point_id', a).eq('subject_thread_id', threadY)
  })
})
