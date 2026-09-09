// P6 Live Writer — matrice des 16 témoins d'intégration (design §5,
// docs/tracked-points/p6-live-writer-design.md, frozen commit 620450d7).
//
// HARD STOP explicite : ce fichier est écrit contre les migrations 399/400, qui NE SONT PAS
// appliquées dans ce lot (mandat NO GO APPLY). Aucun de ces 16 témoins n'a été exécuté contre
// une vraie base — la véracité des assertions est dérivée d'une lecture statique complète du
// SQL de la migration 400 (fn_reconcile_tracked_point_unit), jamais d'une exécution réelle.
// Avant la première exécution réelle de cette suite (après une éventuelle GO APPLY), s'attendre
// à devoir ajuster des détails de timing/ordre (témoins 11, 12, 15) et à confirmer le
// comportement exact du témoin 13 (voir commentaire dédié — zone d'incertitude assumée).
//
// Conventions reprises à l'identique de tests/lib/db/tracked-point-pending-resolution.test.ts
// (même TAG, même chaîne beforeAll/afterAll org→client→site(s)→document→run, mêmes helpers
// makePoint/makePendingTrace/makeCandidate, children-before-parents en afterAll).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileTrackedPointUnit } from '@/lib/db/tracked-point-live-writer'
import { acceptTraceIdentityCandidate } from '@/lib/db/tracked-point-trace-acceptance'
import type { FoundingOutcomeV2, FoundingUnit } from '@/lib/knowledge/tracked-point-founding'
import { foundingReferenceOf } from '@/lib/knowledge/tracked-point-write-plan'

const TAG = `__test_p6_live_writer_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let otherSiteId: string
let docId: string
let runId: string

// ── Fabrique d'unité — même style que lib/knowledge/tracked-point-fingerprint.test.ts,
//    threadId par défaut = un nouveau thread synthétique par appel (jamais partagé sauf si
//    le témoin l'exige explicitement en overrides). ────────────────────────────────────────
function unit(overrides: Partial<FoundingUnit> & { outcomeV2: FoundingOutcomeV2 }): FoundingUnit {
  return {
    threadId: overrides.threadId ?? randomUUID(),
    scope: overrides.scope ?? 'thread',
    proposalSetOf: overrides.proposalSetOf,
    props: overrides.props ?? [],
    families: overrides.families ?? [],
    threadLabel: overrides.threadLabel ?? `${TAG} thread`,
    outcomeOld: overrides.outcomeOld ?? 'UNCOVERED_FAMILY_COMBINATION',
    outcomeV2: overrides.outcomeV2,
    trackability: overrides.trackability,
  }
}

async function makePoint(overrides: Record<string, unknown> = {}, targetSiteId: string = siteId) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point')
    .insert({ site_id: targetSiteId, label: `${TAG} point`, founding_kind: 'manual', seed_source: 'manual', ...overrides })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function makeCbo(overrides: Record<string, unknown> = {}, targetSiteId: string = siteId) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('canonical_business_object')
    .insert({ site_id: targetSiteId, object_type: 'site_reserve', label: `${TAG} cbo`, ...overrides })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function makeMember(pointId: string, threadId: string, overrides: Record<string, unknown> = {}) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_member')
    .insert({
      tracked_point_id: pointId,
      subject_thread_id: threadId,
      scope: 'thread',
      proposal_ids: null,
      evidence_grade: 'HARD',
      resolution_source: 'deterministic',
      status: 'active',
      ...overrides,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function makeCandidate(overrides: Record<string, unknown>) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_identity_candidate')
    .insert({ site_id: siteId, subject_thread_id: randomUUID(), scope: 'thread', reason: 'test', ...overrides })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function getPoint(id: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point')
    .select('id, status, identity_status, founding_kind, founding_reference')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as { id: string; status: string; identity_status: string; founding_kind: string; founding_reference: string | null }
}

async function getCbo(id: string) {
  const db = createAdminClient()
  const { data, error } = await db.from('canonical_business_object').select('id, tracked_point_id').eq('id', id).single()
  if (error) throw error
  return data as { id: string; tracked_point_id: string | null }
}

async function countArtifacts(reconcileEventId: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_reconcile_artifact')
    .select('artifact_kind, artifact_id')
    .eq('reconcile_event_id', reconcileEventId)
  if (error) throw error
  return data as Array<{ artifact_kind: string; artifact_id: string }>
}

async function countMembersOnThread(threadId: string, status = 'active') {
  const db = createAdminClient()
  const { count } = await db
    .from('tracked_point_member')
    .select('id', { count: 'exact', head: true })
    .eq('subject_thread_id', threadId)
    .eq('status', status)
  return count ?? 0
}

beforeAll(async () => {
  const db = createAdminClient()

  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  otherSiteId = (await db.from('sites').insert({ name: `${TAG}site2`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  docId = (await db.from('documents').insert({ organization_id: orgId, document_type: 'historical_visit_report', storage_path: `${TAG}/x.pdf`, filename: 'x.pdf' }).select('id').single()).data!.id as string
  runId = (await db.from('document_extraction_run').insert({ organization_id: orgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()

  const { data: events } = await db
    .from('tracked_point_reconcile_event')
    .select('id')
    .in('site_id', [siteId, otherSiteId])
  const eventIds = ((events ?? []) as Array<{ id: string }>).map((e) => e.id)
  if (eventIds.length > 0) {
    await db.from('tracked_point_reconcile_artifact').delete().in('reconcile_event_id', eventIds)
  }
  await db.from('tracked_point_reconcile_event').delete().in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point_reconcile_state').delete().in('site_id', [siteId, otherSiteId])

  const { data: pts } = await db.from('tracked_point').select('id').in('site_id', [siteId, otherSiteId])
  const ptIds = ((pts ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (ptIds.length > 0) {
    await db.from('tracked_point_member').delete().in('tracked_point_id', ptIds)
    await db.from('tracked_point_identity_candidate').delete().in('candidate_point_id', ptIds)
  }
  await db.from('canonical_business_object').update({ tracked_point_id: null }).in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point').delete().in('site_id', [siteId, otherSiteId])
  await db.from('canonical_business_object').delete().in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point_pending_trace').delete().in('site_id', [siteId, otherSiteId])
  await db.from('document_extraction_proposal').delete().eq('document_id', docId)
  await db.from('document_extraction_run').delete().eq('id', runId)
  await db.from('documents').delete().eq('id', docId)
  await db.from('sites').delete().in('id', [siteId, otherSiteId])
  await db.from('clients').delete().eq('id', clientId)
})

describe('Témoin 1 — AUTO_CREATED / CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK', () => {
  it('CBO frais sans tracked_point_id, aucun sibling → crée le Point CONFIRMED et lie le CBO', async () => {
    const cboId = await makeCbo()
    const u = unit({ outcomeV2: { kind: 'CONFIRMED', cboId } })

    const result = await reconcileTrackedPointUnit({ siteId, unit: u, ctx: { cboLabel: 'CBO témoin 1' }, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.verdict).toBe('AUTO_CREATED')
    expect(result.writePattern).toBe('CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK')
    expect(result.replayed).toBe(false)
    expect(result.targetPointId).toBeTruthy()

    const point = await getPoint(result.targetPointId as string)
    expect(point.founding_kind).toBe('cbo')
    expect(point.founding_reference).toBe(cboId)
    expect(point.identity_status).toBe('CONFIRMED')

    const cbo = await getCbo(cboId)
    expect(cbo.tracked_point_id).toBe(result.targetPointId)

    expect(await countMembersOnThread(u.threadId)).toBe(1)

    const artifacts = await countArtifacts(result.reconcileEventId)
    expect(artifacts.map((a) => a.artifact_kind).sort()).toEqual(['canonical_business_object', 'tracked_point', 'tracked_point_member'])
  })
})

describe('Témoin 2 — AUTO_CREATED / CREATE_POINT_WITH_MEMBERSHIP (P6-A, trackable déterministe sans concurrence)', () => {
  it('unité trackable_condition sans CBO, sans sibling → fonde un Point PROVISIONAL', async () => {
    const u = unit({ outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } })

    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.verdict).toBe('AUTO_CREATED')
    expect(result.writePattern).toBe('CREATE_POINT_WITH_MEMBERSHIP')

    const point = await getPoint(result.targetPointId as string)
    expect(point.founding_kind).toBe('trackable_condition')
    expect(point.founding_reference).toBe(foundingReferenceOf(u))
    expect(point.identity_status).toBe('PROVISIONAL')
  })
})

describe('Témoin 3 — AUTO_LINKED / ATTACH_MEMBER', () => {
  it('CBO déjà lié à un Point actif → rattache la nouvelle unité sans créer de Point', async () => {
    const target = await makePoint()
    const cboId = await makeCbo({ tracked_point_id: target })
    const u = unit({ outcomeV2: { kind: 'CONFIRMED', cboId } })

    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.verdict).toBe('AUTO_LINKED')
    expect(result.writePattern).toBe('ATTACH_MEMBER')
    expect(result.targetPointId).toBe(target)

    expect(await countMembersOnThread(u.threadId)).toBe(1)
  })
})

describe('Témoin 4 — NEEDS_HUMAN / CREATE_PENDING_TRACE (aucune cible plausible)', () => {
  it('trackability indéterminée, aucun sibling, aucune pending trace préexistante → crée une pending trace', async () => {
    const u = unit({ outcomeV2: { kind: 'PENDING_TRACKABILITY' } })

    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.verdict).toBe('NEEDS_HUMAN')
    expect(result.writePattern).toBe('CREATE_PENDING_TRACE')
    expect(result.targetPointId).toBeNull()
    expect(result.pendingTraceId).toBeTruthy()

    const db = createAdminClient()
    const { data: pt } = await db.from('tracked_point_pending_trace').select('source_thread_id, kind, status').eq('id', result.pendingTraceId as string).single()
    expect((pt as { source_thread_id: string }).source_thread_id).toBe(u.threadId)
    expect((pt as { status: string }).status).toBe('pending')
  })
})

describe('Témoin 5 — NEEDS_HUMAN / CREATE_CANDIDATES (plusieurs cibles plausibles)', () => {
  it('2 siblings actifs sur le même thread → propose 2 candidats + 1 pending trace, 3 artefacts', async () => {
    const threadId = randomUUID()
    const pointA = await makePoint()
    const pointB = await makePoint()
    await makeMember(pointA, threadId)
    await makeMember(pointB, threadId)

    const u = unit({ threadId, outcomeV2: { kind: 'PENDING_TRACKABILITY' } })
    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.verdict).toBe('NEEDS_HUMAN')
    expect(result.writePattern).toBe('CREATE_CANDIDATES')
    expect(result.newCandidateIds.length).toBe(2)
    expect(result.pendingTraceId).toBeTruthy()

    const artifacts = await countArtifacts(result.reconcileEventId)
    expect(artifacts.length).toBe(3)
    expect(artifacts.filter((a) => a.artifact_kind === 'tracked_point_identity_candidate').length).toBe(2)
    expect(artifacts.filter((a) => a.artifact_kind === 'tracked_point_pending_trace').length).toBe(1)
  })
})

describe('Témoin 6 — NEEDS_HUMAN forcé par cible merged (P6-B)', () => {
  it('CBO lié à un Point merged → jamais ATTACH_MEMBER, toujours NEEDS_HUMAN', async () => {
    const db = createAdminClient()
    const mergedInto = await makePoint()
    const target = await makePoint()
    await db.from('tracked_point').update({ status: 'merged', merged_into_id: mergedInto }).eq('id', target)
    const cboId = await makeCbo({ tracked_point_id: target })
    const u = unit({ outcomeV2: { kind: 'CONFIRMED', cboId } })

    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.verdict).toBe('NEEDS_HUMAN')
    expect(result.writePattern).toBe('CREATE_PENDING_TRACE')
    expect(result.targetPointId).toBeNull()

    await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('id', target)
  })
})

describe('Témoin 7 — NEEDS_HUMAN forcé par cible CONFLICTED', () => {
  it('CBO lié à un Point identity_status=CONFLICTED → jamais ATTACH_MEMBER', async () => {
    const target = await makePoint({ identity_status: 'CONFLICTED' })
    const cboId = await makeCbo({ tracked_point_id: target })
    const u = unit({ outcomeV2: { kind: 'CONFIRMED', cboId } })

    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.verdict).toBe('NEEDS_HUMAN')
    expect(result.writePattern).toBe('CREATE_PENDING_TRACE')
    expect(result.targetPointId).toBeNull()
  })
})

describe('Témoin 8 — NOOP : rejeu strict (même fingerprint, aucun changement live)', () => {
  it('rejouer exactement la même unité → replayed=true, 0 écriture business supplémentaire', async () => {
    const cboId = await makeCbo()
    const u = unit({ outcomeV2: { kind: 'CONFIRMED', cboId } })

    const first = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('attendu un succès')
    expect(first.replayed).toBe(false)

    const replay = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error('attendu un succès')
    expect(replay.writePattern).toBe('NOOP')
    expect(replay.replayed).toBe(true)
    expect(replay.targetPointId).toBe(first.targetPointId)

    // 0 écriture business supplémentaire : toujours exactement 1 Point pour cette identité de
    // fondation, 1 membership active sur ce thread.
    const db = createAdminClient()
    const { count: pointCount } = await db
      .from('tracked_point')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('founding_kind', 'cbo')
      .eq('founding_reference', cboId)
    expect(pointCount).toBe(1)
    expect(await countMembersOnThread(u.threadId)).toBe(1)
  })
})

describe('Témoin 9 — même fingerprint mais état live incompatible → PAS un NOOP', () => {
  it('AUTO_LINKED à T0, Point mergé à T1, rejeu à T2 → NEEDS_HUMAN (jamais un rejeu silencieux)', async () => {
    const db = createAdminClient()
    const target = await makePoint()
    const otherTarget = await makePoint()
    const cboId = await makeCbo({ tracked_point_id: target })
    const u = unit({ outcomeV2: { kind: 'CONFIRMED', cboId } })

    const t0 = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(t0.ok).toBe(true)
    if (!t0.ok) throw new Error('attendu un succès')
    expect(t0.writePattern).toBe('ATTACH_MEMBER')
    expect(t0.targetPointId).toBe(target)

    await db.from('tracked_point').update({ status: 'merged', merged_into_id: otherTarget }).eq('id', target)

    const t2 = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(t2.ok).toBe(true)
    if (!t2.ok) throw new Error('attendu un succès')
    expect(t2.writePattern).not.toBe('NOOP')
    expect(t2.replayed).toBe(false)
    expect(t2.verdict).toBe('NEEDS_HUMAN')
    expect(t2.writePattern).toBe('CREATE_PENDING_TRACE')
    expect(t2.targetPointId).toBeNull()

    await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('id', target)
  })
})

describe('Témoin 10 — CBO tardif sur un Point trackable_condition déjà fondé (P6-C)', () => {
  it('un 2e appel apportant un CBO sur le même thread enrichit le Point existant sans changer sa fondation', async () => {
    const threadId = randomUUID()
    const first = await reconcileTrackedPointUnit({
      siteId, unit: unit({ threadId, outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } }),
      sourceKind: 'historical_pdf', sourceRefId: docId,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('attendu un succès')
    expect(first.writePattern).toBe('CREATE_POINT_WITH_MEMBERSHIP')
    const pointBefore = await getPoint(first.targetPointId as string)

    const cboId = await makeCbo()
    const second = await reconcileTrackedPointUnit({
      siteId, unit: unit({ threadId, outcomeV2: { kind: 'CONFIRMED', cboId } }),
      sourceKind: 'historical_pdf', sourceRefId: docId,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('attendu un succès')
    expect(second.verdict).toBe('AUTO_LINKED')
    expect(second.writePattern).toBe('ENRICH_EXISTING_POINT')
    expect(second.targetPointId).toBe(first.targetPointId)

    const pointAfter = await getPoint(first.targetPointId as string)
    expect(pointAfter.founding_kind).toBe(pointBefore.founding_kind)
    expect(pointAfter.founding_reference).toBe(pointBefore.founding_reference)
    expect(pointAfter.identity_status).toBe(pointBefore.identity_status)

    const cbo = await getCbo(cboId)
    expect(cbo.tracked_point_id).toBe(first.targetPointId)
  })
})

describe('Témoin 11 — concurrence sur la même unité (un seul effet business, rejeu propre)', () => {
  it('2 appels concurrents strictement identiques → 1 seul writePattern non-NOOP, 1 seul Point', async () => {
    const cboId = await makeCbo()
    const u = unit({ outcomeV2: { kind: 'CONFIRMED', cboId } })

    const [a, b] = await Promise.all([
      reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId }),
      reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId }),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) throw new Error('attendu deux succès')

    const replayedFlags = [a.replayed, b.replayed].sort()
    expect(replayedFlags).toEqual([false, true])
    expect(a.targetPointId).toBe(b.targetPointId)

    const db = createAdminClient()
    const { count } = await db
      .from('tracked_point')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('founding_kind', 'cbo')
      .eq('founding_reference', cboId)
    expect(count).toBe(1)
  })
})

describe('Témoin 12 — concurrence cross-unité, même domaine d\'identité (même thread)', () => {
  it('2 unités distinctes du même thread en parallèle → pas de deadlock, jamais d\'écrasement de founding_kind', async () => {
    const threadId = randomUUID()
    const cboId = await makeCbo()
    const unitA = unit({ threadId, scope: 'proposal_set', proposalSetOf: 'cbo:x', outcomeV2: { kind: 'CONFIRMED', cboId } })
    const unitB = unit({ threadId, scope: 'thread', outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } })
    expect(foundingReferenceOf(unitA)).not.toBe(foundingReferenceOf(unitB))

    const [a, b] = await Promise.all([
      reconcileTrackedPointUnit({ siteId, unit: unitA, sourceKind: 'historical_pdf', sourceRefId: docId }),
      reconcileTrackedPointUnit({ siteId, unit: unitB, sourceKind: 'historical_pdf', sourceRefId: docId }),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) throw new Error('attendu deux succès — pas de deadlock')

    // Invariant vérifiable indépendamment de l'ordre d'exécution réel (§2.4/P6-C : ENRICH ne
    // change jamais founding_kind/founding_reference) : le CBO A, s'il a fini par pointer vers
    // un Point, pointe vers un Point dont founding_kind reste cohérent avec CE QUE ce Point a
    // été fondé — jamais réécrit par l'autre unité.
    const cbo = await getCbo(cboId)
    if (cbo.tracked_point_id) {
      const p = await getPoint(cbo.tracked_point_id)
      expect(['cbo', 'trackable_condition']).toContain(p.founding_kind)
    }
    if (a.targetPointId) {
      const pa = await getPoint(a.targetPointId)
      expect(pa.founding_kind === 'cbo' || pa.founding_kind === 'trackable_condition').toBe(true)
    }
  })
})

describe('Témoin 13 — course Live Writer / RPC humaine (accept_trace_identity_candidate)', () => {
  // ZONE D'INCERTITUDE ASSUMÉE (non vérifiée par exécution réelle) : la migration 400 (Branch B,
  // lignes ~200-260 lues statiquement) sélectionne les candidats proposés à partir des siblings
  // actifs du thread SANS exclure un Point déjà accepté comme membership HARD sur ce même
  // thread — rien dans le SQL lu ne filtre "déjà membre" avant de proposer un nouveau candidat
  // pending pour ce même Point. Ce témoin vérifie donc le verdict NEEDS_HUMAN (garanti par la
  // Branch B, inconditionnelle), mais NE tranche PAS si un candidat redondant est reproposé —
  // c'est un risque à confirmer avant toute GO APPLY, signalé explicitement dans le rapport
  // HARD STOP plutôt que supposé silencieusement correct ou incorrect.
  it('candidat accepté par RPC humaine pendant qu\'une nouvelle réconciliation démarre sur le même thread', async () => {
    const threadId = randomUUID()
    const siblingPoint = await makePoint()
    await makeMember(siblingPoint, threadId)

    const u = unit({ threadId, outcomeV2: { kind: 'PENDING_TRACKABILITY' } })
    const first = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('attendu un succès')
    expect(first.writePattern).toBe('CREATE_CANDIDATES')
    expect(first.newCandidateIds.length).toBe(1)
    const candidateId = first.newCandidateIds[0]

    const accepted = await acceptTraceIdentityCandidate({ siteId, candidateId })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) throw new Error('attendu une acceptation réussie')
    expect(accepted.targetPointId).toBe(siblingPoint)

    // La membership HARD posée par l'humain existe désormais sur ce thread — le rejeu de la
    // même unité doit détecter que l'état live a changé (candidat plus 'pending' → pas de NOOP)
    // et revalider entièrement plutôt que de rejouer aveuglément l'ancien verdict.
    const replay = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error('attendu un succès')
    expect(replay.writePattern).not.toBe('NOOP')
    expect(replay.verdict).toBe('NEEDS_HUMAN')
  })
})

describe('Témoin 14 — rollback atomique après échec simulé (CBO_NOT_FOUND)', () => {
  it('CBO inexistant → RAISE EXCEPTION, 0 Point/membership/state/event/artifact créé', async () => {
    const bogusCboId = randomUUID()
    const u = unit({ outcomeV2: { kind: 'CONFIRMED', cboId: bogusCboId } })
    const unitKey = foundingReferenceOf(u)

    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('attendu un échec CBO_NOT_FOUND')
    expect(result.error).toBe('CBO_NOT_FOUND')

    const db = createAdminClient()
    const { count: pointCount } = await db
      .from('tracked_point')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('founding_kind', 'cbo')
      .eq('founding_reference', bogusCboId)
    expect(pointCount).toBe(0)

    const { count: memberCount } = await db
      .from('tracked_point_member')
      .select('id', { count: 'exact', head: true })
      .eq('subject_thread_id', u.threadId)
    expect(memberCount).toBe(0)

    const { count: stateCount } = await db
      .from('tracked_point_reconcile_state')
      .select('unit_key', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('unit_key', unitKey)
    expect(stateCount).toBe(0)

    const { count: eventCount } = await db
      .from('tracked_point_reconcile_event')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('unit_key', unitKey)
    expect(eventCount).toBe(0)
  })
})

describe('Témoin 15 — dix appels concurrents sur la même unité', () => {
  it('10 appels identiques en parallèle → 1 seul effet business, 9 rejeux propres', async () => {
    const u = unit({ outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } })

    const results = await Promise.all(
      Array.from({ length: 10 }, () => reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })),
    )
    for (const r of results) expect(r.ok).toBe(true)
    const okResults = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
    expect(okResults.length).toBe(10)

    const nonReplayed = okResults.filter((r) => !r.replayed)
    const replayed = okResults.filter((r) => r.replayed)
    expect(nonReplayed.length).toBe(1)
    expect(replayed.length).toBe(9)
    for (const r of replayed) expect(r.writePattern).toBe('NOOP')

    const targetPointId = okResults[0].targetPointId
    for (const r of okResults) expect(r.targetPointId).toBe(targetPointId)

    const db = createAdminClient()
    const { count } = await db
      .from('tracked_point')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('founding_kind', 'trackable_condition')
      .eq('founding_reference', foundingReferenceOf(u))
    expect(count).toBe(1)
  })
})

describe('Témoin 16 — candidats partiellement matérialisés (A et C existent, B manquant)', () => {
  it('une nouvelle tentative CREATE_CANDIDATES ne recrée que le candidat manquant, jamais A/C', async () => {
    const threadId = randomUUID()
    const pointA = await makePoint()
    const pointB = await makePoint()
    const pointC = await makePoint()
    await makeMember(pointA, threadId)
    await makeMember(pointB, threadId)
    await makeMember(pointC, threadId)

    // Simule une tentative antérieure interrompue : candidats pending pré-existants pour A et C
    // seulement (B jamais matérialisé), sans passer par le RPC (fixture directe).
    const candA = await makeCandidate({ candidate_point_id: pointA, subject_thread_id: threadId })
    const candC = await makeCandidate({ candidate_point_id: pointC, subject_thread_id: threadId })

    const u = unit({ threadId, outcomeV2: { kind: 'PENDING_TRACKABILITY' } })
    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.verdict).toBe('NEEDS_HUMAN')
    expect(result.writePattern).toBe('CREATE_CANDIDATES')

    // Seul B est nouvellement créé — A et C, déjà pending, ne sont ni dupliqués ni référencés
    // par CET événement (§2.6 : un artefact ne référence que ce que CETTE tentative a créé).
    expect(result.newCandidateIds.length).toBe(1)
    expect(result.newCandidateIds).not.toContain(candA)
    expect(result.newCandidateIds).not.toContain(candC)

    const db = createAdminClient()
    const { data: newCandRow } = await db
      .from('tracked_point_identity_candidate')
      .select('candidate_point_id')
      .eq('id', result.newCandidateIds[0])
      .single()
    expect((newCandRow as { candidate_point_id: string }).candidate_point_id).toBe(pointB)

    const artifacts = await countArtifacts(result.reconcileEventId)
    const candidateArtifacts = artifacts.filter((a) => a.artifact_kind === 'tracked_point_identity_candidate')
    expect(candidateArtifacts.length).toBe(1)
    expect(candidateArtifacts[0].artifact_id).toBe(result.newCandidateIds[0])

    // A et C restent inchangés (toujours 'pending', jamais touchés par cette tentative).
    const { data: untouchedRows } = await db
      .from('tracked_point_identity_candidate')
      .select('id, status')
      .in('id', [candA, candC])
    for (const row of (untouchedRows ?? []) as Array<{ id: string; status: string }>) {
      expect(row.status).toBe('pending')
    }
  })
})
