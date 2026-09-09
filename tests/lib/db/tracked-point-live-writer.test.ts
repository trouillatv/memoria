// P6 Live Writer — matrice des 18 témoins d'intégration (design §5,
// docs/tracked-points/p6-live-writer-design.md — 16 témoins initiaux + 17/18 Round 2 D1/D4).
//
// Round 2 (renumérotation 399/400→400/401, voir supabase/migrations/400_...) : ce fichier est
// écrit contre les migrations 400/401, qui NE SONT PAS appliquées sur main dans ce lot (mandat
// NO GO APPLY). Voir le rapport HARD STOP Round 2 pour l'état réel d'exécution (DB jetable).
//
// Conventions reprises à l'identique de tests/lib/db/tracked-point-pending-resolution.test.ts
// (même TAG, même chaîne beforeAll/afterAll org→client→site(s)→document→run, mêmes helpers
// makePoint/makePendingTrace/makeCandidate, children-before-parents en afterAll).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileTrackedPointUnit, plannedPointPayload } from '@/lib/db/tracked-point-live-writer'
import { acceptTraceIdentityCandidate } from '@/lib/db/tracked-point-trace-acceptance'
import type { FoundingOutcomeV2, FoundingUnit } from '@/lib/knowledge/tracked-point-founding'
import { foundingReferenceOf, planPointForUnit } from '@/lib/knowledge/tracked-point-write-plan'
import { buildFingerprint } from '@/lib/knowledge/tracked-point-fingerprint'
import type { TrackedPointCandidate } from '@/lib/knowledge/tracked-point-membership-candidates'

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

    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId, sitePoints: [] })
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

    // Round 4 (BUG 1) : cette pending trace vient du contrat PLANIFIÉ (Branche B,
    // planPendingTraceForUnit) — jamais du fallback générique IDENTITY_UNRESOLVED, qui
    // n'existe que côté Branche A dégradée (p_planned_point non nul).
    const db = createAdminClient()
    const { data: pt } = await db.from('tracked_point_pending_trace').select('kind').eq('id', result.pendingTraceId as string).single()
    expect((pt as { kind: string }).kind).toBe('TRACKABILITY_UNDETERMINED')
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

    // Round 4 (BUG 1) : cible merged → dégradation Branche A, contrat = fallback générique
    // IDENTITY_UNRESOLVED (jamais un kind spécifique "merged" distinct — cf. tête de fichier
    // migration 401 et fallbackPendingTraceForUnit).
    expect(result.pendingTraceId).toBeTruthy()
    const { data: pt } = await db.from('tracked_point_pending_trace').select('kind, status').eq('id', result.pendingTraceId as string).single()
    expect((pt as { kind: string; status: string }).kind).toBe('IDENTITY_UNRESOLVED')
    expect((pt as { kind: string; status: string }).status).toBe('pending')

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

    // Round 4 (BUG 1) : cible CONFLICTED → même contrat fallback générique IDENTITY_UNRESOLVED
    // que la cible merged (Témoin 6) — la cause précise vit uniquement dans `reason`.
    expect(result.pendingTraceId).toBeTruthy()
    const db = createAdminClient()
    const { data: pt } = await db.from('tracked_point_pending_trace').select('kind, status').eq('id', result.pendingTraceId as string).single()
    expect((pt as { kind: string; status: string }).kind).toBe('IDENTITY_UNRESOLVED')
    expect((pt as { kind: string; status: string }).status).toBe('pending')
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
      sourceKind: 'historical_pdf', sourceRefId: docId, sitePoints: [],
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
  it('2 unités distinctes du même thread en parallèle → convergent vers UN SEUL Point, jamais deux', async () => {
    const threadId = randomUUID()
    const cboId = await makeCbo()
    const unitA = unit({ threadId, scope: 'proposal_set', proposalSetOf: 'cbo:x', outcomeV2: { kind: 'CONFIRMED', cboId } })
    const unitB = unit({ threadId, scope: 'thread', outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } })
    const unitBKey = foundingReferenceOf(unitB)
    expect(foundingReferenceOf(unitA)).not.toBe(unitBKey)

    const [a, b] = await Promise.all([
      reconcileTrackedPointUnit({ siteId, unit: unitA, sourceKind: 'historical_pdf', sourceRefId: docId }),
      reconcileTrackedPointUnit({ siteId, unit: unitB, sourceKind: 'historical_pdf', sourceRefId: docId, sitePoints: [] }),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) throw new Error('attendu deux succès — pas de deadlock')

    // Convergence réelle (pas seulement "pas d'erreur") : le verrou de domaine d'identité
    // (§2.8, niveau 1, clé = thread seul) sérialise les deux transactions sur ce thread — quel
    // que soit l'ordre réel d'exécution, les deux appels doivent désigner LA MÊME cible.
    expect(a.targetPointId).toBeTruthy()
    expect(a.targetPointId).toBe(b.targetPointId)

    // Le CBO de A doit être lié à cette même cible, jamais à un Point distinct de celui que B a
    // rejoint/fondé (P6-C : quel que soit l'ordre, l'unité arrivée en second ENRICHIT ou
    // ATTACH plutôt que de fonder un second Point concurrent).
    const cbo = await getCbo(cboId)
    expect(cbo.tracked_point_id).toBe(a.targetPointId)

    // Exactement UN Point matérialisé pour cette paire d'identités de fondation concurrentes —
    // jamais deux Points distincts (un fondé par A, un par B) qui auraient dû être fusionnés
    // manuellement après coup. Les deux ordres d'exécution valides ('A fonde puis B s'y
    // attache' / 'B fonde puis A l'enrichit') convergent tous deux vers un seul Point en base.
    const db = createAdminClient()
    const { data: rows } = await db
      .from('tracked_point')
      .select('id, founding_kind, founding_reference')
      .eq('site_id', siteId)
      .in('founding_reference', [cboId, unitBKey])
    const converged = ((rows ?? []) as Array<{ id: string; founding_kind: string; founding_reference: string | null }>).filter(
      (p) =>
        (p.founding_kind === 'cbo' && p.founding_reference === cboId) ||
        (p.founding_kind === 'trackable_condition' && p.founding_reference === unitBKey),
    )
    expect(converged.length).toBe(1)
    expect(converged[0].id).toBe(a.targetPointId)

    // Le geste retenu pour chaque unité doit correspondre à l'un des deux ordres valides —
    // jamais deux CREATE_* simultanés (ce qui prouverait exactement la course qu'on cherche à
    // exclure), et jamais autre chose qu'ATTACH_MEMBER/ENRICH_EXISTING_POINT côté "second arrivé".
    const patterns = [a.writePattern, b.writePattern].sort()
    const validOrder1 = ['ATTACH_MEMBER', 'CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK']
    const validOrder2 = ['CREATE_POINT_WITH_MEMBERSHIP', 'ENRICH_EXISTING_POINT']
    expect([validOrder1, validOrder2]).toContainEqual(patterns)
  })
})

describe('Témoin 13 — course Live Writer / RPC humaine (accept_trace_identity_candidate)', () => {
  // BUG 2 (Round 3, Vincent — "c'est précisément le témoin 13") : une membership HARD posée par
  // accept_trace_identity_candidate (scope='thread', evidence_grade='HARD',
  // resolution_source='manual') est une vérité terminale humaine. La réconciliation qui rejoue
  // APRÈS cette acceptation doit converger DIRECTEMENT vers ce Point (AUTO_LINKED/ATTACH_MEMBER),
  // jamais reproposer un candidat redondant ni rouvrir l'arbitrage (migration 401,
  // v_accepted_target_id, revérifié sous verrou dans les trois branches consommatrices :
  // CBO-reverse, trackable_condition, Branche B).
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

    const db = createAdminClient()
    const { data: candRow } = await db
      .from('tracked_point_identity_candidate')
      .select('candidate_point_id')
      .eq('id', candidateId)
      .single()
    expect((candRow as { candidate_point_id: string }).candidate_point_id).toBe(siblingPoint)

    const accepted = await acceptTraceIdentityCandidate({ siteId, candidateId })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) throw new Error('attendu une acceptation réussie')
    expect(accepted.targetPointId).toBe(siblingPoint)

    // État live juste après l'acceptation humaine, AVANT le rejeu — sert de référence pour
    // prouver que le rejeu ne produit strictement AUCUNE écriture nouvelle (convergence pure).
    const { count: candidateCountBefore } = await db
      .from('tracked_point_identity_candidate')
      .select('id', { count: 'exact', head: true })
      .eq('subject_thread_id', threadId)
    const { count: pendingCountBefore } = await db
      .from('tracked_point_pending_trace')
      .select('id', { count: 'exact', head: true })
      .eq('source_thread_id', threadId)
    const memberCountBefore = await countMembersOnThread(threadId)

    // La membership HARD posée par l'humain est désormais la vérité terminale de ce thread — le
    // rejeu de la même unité doit converger directement vers ce Point, sans reproposer de
    // candidat ni rouvrir l'arbitrage.
    const replay = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error('attendu un succès')
    expect(replay.verdict).toBe('AUTO_LINKED')
    expect(replay.writePattern).toBe('ATTACH_MEMBER')
    expect(replay.targetPointId).toBe(siblingPoint)
    expect(replay.newCandidateIds).toEqual([])

    const { count: candidateCountAfter } = await db
      .from('tracked_point_identity_candidate')
      .select('id', { count: 'exact', head: true })
      .eq('subject_thread_id', threadId)
    const { count: pendingCountAfter } = await db
      .from('tracked_point_pending_trace')
      .select('id', { count: 'exact', head: true })
      .eq('source_thread_id', threadId)
    const memberCountAfter = await countMembersOnThread(threadId)
    expect(candidateCountAfter).toBe(candidateCountBefore)
    expect(pendingCountAfter).toBe(pendingCountBefore)
    expect(memberCountAfter).toBe(memberCountBefore)
  })
})

describe('Témoin 14 — rollback atomique après échec forcé APRÈS INSERT tracked_point (harness test-only)', () => {
  it('échec injecté par test_only.fn_reconcile_tracked_point_unit_with_failpoint après INSERT Point → 0 Point/membership/CBO/state/event/artifact survivant', async () => {
    const cboId = await makeCbo()
    const u = unit({ outcomeV2: { kind: 'CONFIRMED', cboId } })
    const unitKey = foundingReferenceOf(u)
    const plannedPoint = planPointForUnit(u, { cboLabel: 'CBO témoin 14' })
    if (!plannedPoint) throw new Error('attendu un plan de Point pour ce plan (setup du témoin)')
    const { snapshot, fingerprint } = buildFingerprint(u)

    const db = createAdminClient()
    // Le harness (supabase/testing/p6_test_failpoint_harness.sql) vit dans le schéma
    // test_only, exposé UNIQUEMENT sur la base jetable où ce témoin s'exécute — jamais sur la
    // cible réelle (mandat Vincent, cf. tête du fichier harness : pas de paramètre RPC prod).
    const { error } = await db.schema('test_only').rpc('fn_reconcile_tracked_point_unit_with_failpoint', {
      p_site_id: siteId,
      p_unit_key: unitKey,
      p_thread_id: u.threadId,
      p_scope: u.scope,
      p_input_snapshot: snapshot,
      p_input_fingerprint: fingerprint,
      p_source_kind: 'historical_pdf',
      p_source_ref_id: docId,
      p_planned_point: plannedPointPayload(plannedPoint),
      p_planned_pending_trace: null,
      p_cross_thread_candidate_point_ids: [],
    })

    expect(error).toBeTruthy()
    expect(error?.message ?? '').toContain('TEST_INDUCED_FAILURE_AFTER_POINT_INSERT')

    const { count: pointCount } = await db
      .from('tracked_point')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('founding_kind', 'cbo')
      .eq('founding_reference', cboId)
    expect(pointCount).toBe(0)

    const { count: memberCount } = await db
      .from('tracked_point_member')
      .select('id', { count: 'exact', head: true })
      .eq('subject_thread_id', u.threadId)
    expect(memberCount).toBe(0)

    const cbo = await getCbo(cboId)
    expect(cbo.tracked_point_id).toBeNull()

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
      Array.from({ length: 10 }, () => reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId, sitePoints: [] })),
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

describe('Témoin 17 — D1/D3 : candidat cross-thread unique, jamais un auto-rattachement', () => {
  it('Point actif matché par le moteur de voisinage Phase 4 hors de ce thread → NEEDS_HUMAN/CREATE_CANDIDATES, jamais AUTO_LINKED', async () => {
    const sharedLabel = `${TAG} sprinkler concurrent`
    const existingPointId = await makePoint({ label: sharedLabel })
    const sitePoints: TrackedPointCandidate[] = [
      { pointId: existingPointId, label: sharedLabel, ownerSubjectId: null, ownerSubjectLabel: null, memberLabels: [] },
    ]

    const u = unit({ threadLabel: sharedLabel, outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } })
    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId, sitePoints })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')

    expect(result.verdict).toBe('NEEDS_HUMAN')
    expect(result.writePattern).toBe('CREATE_CANDIDATES')
    expect(result.targetPointId).toBeNull()
    expect(result.newCandidateIds.length).toBe(1)

    const db = createAdminClient()
    const { data: candRow } = await db
      .from('tracked_point_identity_candidate')
      .select('candidate_point_id')
      .eq('id', result.newCandidateIds[0])
      .single()
    expect((candRow as { candidate_point_id: string }).candidate_point_id).toBe(existingPointId)

    expect(await countMembersOnThread(u.threadId)).toBe(0)

    const { count: newPointCount } = await db
      .from('tracked_point')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('founding_kind', 'trackable_condition')
      .eq('founding_reference', foundingReferenceOf(u))
    expect(newPointCount).toBe(0)

    // Round 4 (BUG 1) : ce scénario est exactement celui du fallback générique — 0 cible
    // thread-scoped, signal cross-thread D1 unique → dégradation Branche A, contrat =
    // fallback IDENTITY_UNRESOLVED (jamais TRACKABILITY_UNDETERMINED, réservé à la Branche B).
    expect(result.pendingTraceId).toBeTruthy()
    const { data: pt } = await db.from('tracked_point_pending_trace').select('kind, status').eq('id', result.pendingTraceId as string).single()
    expect((pt as { kind: string; status: string }).kind).toBe('IDENTITY_UNRESOLVED')
    expect((pt as { kind: string; status: string }).status).toBe('pending')
  })
})

describe('Témoin 18 — D4 : IGNORE_NOT_TRACKABLE (1re tentative) vs NOOP (rejeu compatible)', () => {
  it('rien à fonder ni à faire arbitrer → 1re tentative IGNORE_NOT_TRACKABLE, rejeu compatible NOOP', async () => {
    const u = unit({ outcomeV2: { kind: 'NO_POINT_EMPTY_THREAD' } })

    const first = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('attendu un succès')
    expect(first.verdict).toBe('IGNORED_NOT_TRACKABLE')
    expect(first.writePattern).toBe('IGNORE_NOT_TRACKABLE')
    expect(first.replayed).toBe(false)
    expect(first.targetPointId).toBeNull()
    expect(first.pendingTraceId).toBeNull()
    expect(first.newCandidateIds).toEqual([])

    expect(await countMembersOnThread(u.threadId)).toBe(0)

    const replay = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error('attendu un succès')
    expect(replay.writePattern).toBe('NOOP')
    expect(replay.replayed).toBe(true)
    expect(replay.verdict).toBe('IGNORED_NOT_TRACKABLE')
    expect(replay.targetPointId).toBeNull()
  })
})

describe('Témoin 19 — BUG 3b : refus explicite quand sitePoints est omis pour une unité trackable_condition', () => {
  it('unité éligible à l\'auto-création PROVISIONAL sans sitePoints → MISSING_SITE_POINTS, aucun appel RPC, aucune écriture', async () => {
    const u = unit({ outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } })

    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('attendu un refus')
    expect(result.error).toBe('MISSING_SITE_POINTS')

    // Le refus intervient AVANT tout appel RPC (garde purement TS) — aucun Point ne doit exister.
    const { count } = await createAdminClient()
      .from('tracked_point')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('founding_kind', 'trackable_condition')
      .eq('founding_reference', foundingReferenceOf(u))
    expect(count).toBe(0)
  })
})

describe('Témoin 20 — BUG 3a : le scan de siblings exclut un sibling CONFLICTED sous le nouveau motif verrouillé', () => {
  // Preuve du filtre appliqué APRÈS acquisition du verrou (FOR UPDATE OF tp sur la sous-requête,
  // puis WHERE sub.status='active' AND sub.identity_status<>'CONFLICTED' dans la requête externe,
  // migration 401 Round 3) — pas une preuve de course concurrente réelle (qui exigerait un
  // harness dédié type témoin 14, hors périmètre de ce lot).
  it('3 siblings actifs sur le même thread dont un CONFLICTED → seuls les 2 valides deviennent candidats', async () => {
    const threadId = randomUUID()
    const pointA = await makePoint()
    const pointB = await makePoint()
    const pointC = await makePoint({ identity_status: 'CONFLICTED' })
    await makeMember(pointA, threadId)
    await makeMember(pointB, threadId)
    await makeMember(pointC, threadId)

    const u = unit({ threadId, outcomeV2: { kind: 'PENDING_TRACKABILITY' } })
    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.verdict).toBe('NEEDS_HUMAN')
    expect(result.writePattern).toBe('CREATE_CANDIDATES')
    expect(result.newCandidateIds.length).toBe(2)

    const db = createAdminClient()
    const { data: candRows } = await db
      .from('tracked_point_identity_candidate')
      .select('candidate_point_id')
      .in('id', result.newCandidateIds)
    const candidatePointIds = ((candRows ?? []) as Array<{ candidate_point_id: string }>).map((c) => c.candidate_point_id).sort()
    expect(candidatePointIds).toEqual([pointA, pointB].sort())
    expect(candidatePointIds).not.toContain(pointC)
  })
})

describe('Témoin 21 — Round 4 (BUG 1) : dédup IDENTITY_UNRESOLVED cross-unité + artefacts scopés à la tentative', () => {
  it('deux unités distinctes dégradées vers la même cible merged sur le même thread → 1 seule pending trace, réutilisée sans nouvel artefact', async () => {
    const threadId = randomUUID()
    const mergedInto = await makePoint()
    const target = await makePoint()
    const db = createAdminClient()
    await db.from('tracked_point').update({ status: 'merged', merged_into_id: mergedInto }).eq('id', target)

    // Deux CBO distincts, tous deux déjà liés à la même cible merged, portés par deux unités de
    // unit_key différentes (scope='proposal_set', même convention que le témoin 12) mais du MÊME
    // thread — la dégradation Branche A ne peut donc pas passer par le court-circuit NOOP de
    // l'étape 4 (clé = unit_key), et exerce réellement le SELECT ... FOR UPDATE de la primitive
    // commune (étape 7.5, migration 401).
    const cboA = await makeCbo({ tracked_point_id: target })
    const cboB = await makeCbo({ tracked_point_id: target })
    const unitA = unit({ threadId, scope: 'proposal_set', proposalSetOf: 'cbo:A', outcomeV2: { kind: 'CONFIRMED', cboId: cboA } })
    const unitB = unit({ threadId, scope: 'proposal_set', proposalSetOf: 'cbo:B', outcomeV2: { kind: 'CONFIRMED', cboId: cboB } })
    expect(foundingReferenceOf(unitA)).not.toBe(foundingReferenceOf(unitB))

    const resultA = await reconcileTrackedPointUnit({ siteId, unit: unitA, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(resultA.ok).toBe(true)
    if (!resultA.ok) throw new Error('attendu un succès')
    expect(resultA.writePattern).toBe('CREATE_PENDING_TRACE')
    expect(resultA.replayed).toBe(false)
    expect(resultA.pendingTraceId).toBeTruthy()

    const resultB = await reconcileTrackedPointUnit({ siteId, unit: unitB, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(resultB.ok).toBe(true)
    if (!resultB.ok) throw new Error('attendu un succès')
    expect(resultB.writePattern).toBe('CREATE_PENDING_TRACE')
    expect(resultB.replayed).toBe(false) // unit_key différent de A : pas un rejeu, une vraie 2e tentative

    // Dédup : la primitive commune retrouve la trace pending IDENTITY_UNRESOLVED déjà posée par
    // A (SELECT ... FOR UPDATE avant INSERT, clé = source_thread_id+kind) plutôt que d'en créer
    // une seconde — même garantie que Witness 16 pour les candidats, généralisée aux pending traces.
    expect(resultB.pendingTraceId).toBe(resultA.pendingTraceId)

    const { count: pendingCount } = await db
      .from('tracked_point_pending_trace')
      .select('id', { count: 'exact', head: true })
      .eq('source_thread_id', threadId)
      .eq('kind', 'IDENTITY_UNRESOLVED')
    expect(pendingCount).toBe(1)

    // Artefacts scopés à la tentative (§2.6) : l'événement A référence la pending trace qu'IL a
    // créée ; l'événement B, qui l'a seulement réutilisée, ne doit référencer aucun artefact
    // tracked_point_pending_trace (v_pending_created=false pour cette tentative).
    const artifactsA = await countArtifacts(resultA.reconcileEventId)
    expect(artifactsA.filter((a) => a.artifact_kind === 'tracked_point_pending_trace')).toEqual([
      { artifact_kind: 'tracked_point_pending_trace', artifact_id: resultA.pendingTraceId },
    ])

    const artifactsB = await countArtifacts(resultB.reconcileEventId)
    expect(artifactsB.filter((a) => a.artifact_kind === 'tracked_point_pending_trace')).toEqual([])

    await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('id', target)
  })
})

describe('Témoin 22 — Round 4 (BUG 1) : le fallback ne se matérialise jamais sur le chemin nominal', () => {
  it('CBO frais sans concurrence → AUTO_CREATED, 0 pending trace créée malgré le fallback toujours calculé côté TS', async () => {
    const threadId = randomUUID()
    const cboId = await makeCbo()
    const u = unit({ threadId, outcomeV2: { kind: 'CONFIRMED', cboId } })

    const result = await reconcileTrackedPointUnit({ siteId, unit: u, sourceKind: 'historical_pdf', sourceRefId: docId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.verdict).toBe('AUTO_CREATED')
    expect(result.writePattern).toBe('CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK')
    expect(result.pendingTraceId).toBeNull()

    // reconcileTrackedPointUnit calcule TOUJOURS fallbackPendingTraceForUnit dès qu'un
    // plannedPoint existe (tracked-point-live-writer.ts) et le transmet en p_fallback_pending_trace
    // — la preuve que ce round n'introduit aucune écriture parasite passe par la DB, pas par le
    // simple typage du retour : cette revalidation live confirme le plan (ATTACH_MEMBER/CREATE_*
    // nominal), donc la primitive commune (étape 7.5) n'est jamais atteinte pour ce thread.
    const db = createAdminClient()
    const { count } = await db
      .from('tracked_point_pending_trace')
      .select('id', { count: 'exact', head: true })
      .eq('source_thread_id', threadId)
    expect(count).toBe(0)
  })
})

describe('Témoin 23 — Round 4 (BUG 1) : MISSING_PENDING_CONTRACT si write_pattern dégradé atteint sans contrat exploitable', () => {
  it('appel RPC direct avec p_fallback_pending_trace omis sur une cible merged → RAISE explicite, aucune trace insérée', async () => {
    const mergedInto = await makePoint()
    const target = await makePoint()
    const db = createAdminClient()
    await db.from('tracked_point').update({ status: 'merged', merged_into_id: mergedInto }).eq('id', target)
    const cboId = await makeCbo({ tracked_point_id: target })
    const u = unit({ outcomeV2: { kind: 'CONFIRMED', cboId } })
    const unitKey = foundingReferenceOf(u)
    const plannedPoint = planPointForUnit(u, { cboLabel: 'CBO témoin 23' })
    if (!plannedPoint) throw new Error('attendu un plan de Point pour ce plan (setup du témoin)')
    const { snapshot, fingerprint } = buildFingerprint(u)

    // Appel RPC direct (contourne le wrapper, qui calcule TOUJOURS fallbackPendingTraceForUnit
    // dès qu'un plannedPoint existe) : reproduit l'état qu'un appelant bugué produirait en
    // omettant p_fallback_pending_trace (DEFAULT NULL) sur exactement le scénario dégradé du
    // Témoin 6 — write_pattern atteint CREATE_PENDING_TRACE mais v_pending_contract reste NULL.
    const { error } = await db.rpc('fn_reconcile_tracked_point_unit', {
      p_site_id: siteId,
      p_unit_key: unitKey,
      p_thread_id: u.threadId,
      p_scope: u.scope,
      p_input_snapshot: snapshot,
      p_input_fingerprint: fingerprint,
      p_source_kind: 'historical_pdf',
      p_source_ref_id: docId,
      p_planned_point: plannedPointPayload(plannedPoint),
      p_planned_pending_trace: null,
      p_cross_thread_candidate_point_ids: [],
    })

    expect(error).toBeTruthy()
    expect(error?.message ?? '').toContain('MISSING_PENDING_CONTRACT')

    const { count: pendingCount } = await db
      .from('tracked_point_pending_trace')
      .select('id', { count: 'exact', head: true })
      .eq('source_thread_id', u.threadId)
    expect(pendingCount).toBe(0)

    const { count: eventCount } = await db
      .from('tracked_point_reconcile_event')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('unit_key', unitKey)
    expect(eventCount).toBe(0)

    await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('id', target)
  })
})
