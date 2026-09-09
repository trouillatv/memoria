// Test d'INTÉGRATION (vraie Supabase) — Phase 6E.3B.3C, wrapper
// lib/db/tracked-point-pending-resolution.ts + RPC associate_pending_resolution_to_point
// (migration 396, pilotée réellement une fois en 6E.3B.3B, jamais rejouée en réel ici).
//
// HARD STOP du mandat : aucun deuxième pending réel n'est associé dans ce lot — toute donnée
// ici est synthétique (${TAG}), jamais une ligne réelle du corpus.
//
// Couvre les 10 scénarios minimum exigés par Vincent (point 9) : cible via candidate ; cible
// humaine sans candidate (HUMAN_SELECTED_TARGET) ; plusieurs candidates (Point 5, un seul
// accepté, les autres intouchés) ; target merged ; target cross-site (ABORT) ; target
// conflicted ; evidence unresolved ; pending déjà resolved (idempotence + TARGET_MISMATCH) ;
// dismiss pending ; plus l'invariant central : l'absence d'identity_candidate n'empêche jamais
// un choix humain explicite d'un Point actif du même site.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import {
  associatePendingResolutionToPoint,
  dismissPendingTrace,
  deferPendingTrace,
} from '@/lib/db/tracked-point-pending-resolution'

const TAG = `__test_6e3b3c_pending_resolution_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let otherSiteId: string
let adminUserId: string
let docId: string
let runId: string

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

async function makePendingTrace(threadId: string, targetSiteId: string = siteId) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_pending_trace')
    .insert({ site_id: targetSiteId, source_thread_id: threadId, kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM', reason: 'test' })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function makeProposal(threadId: string, label = `${TAG} proposal`) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('document_extraction_proposal')
    .insert({
      organization_id: orgId, extraction_run_id: runId, document_id: docId,
      proposal_family: 'observation', label, subject_thread_id: threadId,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function resolveEvidence(pendingId: string, proposalIds: string[], basis: 'exact_single_proposal' | 'whole_thread_proven_safe' = 'exact_single_proposal') {
  const db = createAdminClient()
  const { error } = await db.rpc('resolve_pending_trace_evidence', {
    p_pending_trace_id: pendingId, p_proposal_ids: proposalIds, p_evidence_basis: basis,
  })
  if (error) throw error
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

  const { data: admin } = await db.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  if (!admin) throw new Error('Aucun user admin — seed requis')
  adminUserId = (admin as { id: string }).id
})

afterAll(async () => {
  const db = createAdminClient()
  const { data: pts } = await db.from('tracked_point').select('id').in('site_id', [siteId, otherSiteId])
  const ptIds = ((pts ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (ptIds.length > 0) {
    await db.from('tracked_point_member').delete().in('tracked_point_id', ptIds)
    await db.from('tracked_point_identity_candidate').delete().in('candidate_point_id', ptIds)
  }
  await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point').delete().in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point_pending_trace').delete().in('site_id', [siteId, otherSiteId])
  await db.from('document_extraction_proposal').delete().eq('document_id', docId)
  await db.from('document_extraction_run').delete().eq('id', runId)
  await db.from('documents').delete().eq('id', docId)
  await db.from('sites').delete().in('id', [siteId, otherSiteId])
  await db.from('clients').delete().eq('id', clientId)
})

describe('associatePendingResolutionToPoint — validation d\'entrée et autorisation', () => {
  it('INVALID_PENDING_TRACE_ID sur un id mal formé', async () => {
    const target = await makePoint()
    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: 'not-a-uuid', targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_PENDING_TRACE_ID')
  })

  it('INVALID_TARGET_POINT_ID sur un id mal formé', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: 'not-a-uuid' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_TARGET_POINT_ID')
  })

  it('INVALID_CANDIDATE_ID sur un id mal formé', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const target = await makePoint()
    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target, candidateId: 'not-a-uuid' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_CANDIDATE_ID')
  })

  it('PENDING_TRACE_NOT_FOUND sur un id inexistant', async () => {
    const target = await makePoint()
    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: randomUUID(), targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('PENDING_TRACE_NOT_FOUND')
  })

  it('SITE_MISMATCH : la pending trace appartient à un autre site que celui autorisé', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId, otherSiteId)
    const target = await makePoint({}, otherSiteId)
    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('SITE_MISMATCH')
  })
})

describe('associatePendingResolutionToPoint — revalidation live (RPC 396)', () => {
  it('EVIDENCE_SCOPE_UNRESOLVED : evidence non figée par 394', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const target = await makePoint()

    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('EVIDENCE_SCOPE_UNRESOLVED')
  })

  it('STALE_TARGET : target mergé', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])
    const target = await makePoint()
    const mergedInto = await makePoint()
    await db.from('tracked_point').update({ status: 'merged', merged_into_id: mergedInto }).eq('id', target)

    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/STALE_TARGET/)

    await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('id', target)
  })

  it('ABORT : target d\'un autre site que la pending trace (cross-site, jamais suivi)', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])
    const target = await makePoint({}, otherSiteId)

    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/ABORT/)
  })

  it('TARGET_CONFLICTED : target identity_status=CONFLICTED', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])
    const target = await makePoint({ identity_status: 'CONFLICTED' })

    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/TARGET_CONFLICTED/)
  })
})

describe('associatePendingResolutionToPoint — HUMAN_SELECTED_TARGET (candidateId omis, invariant central)', () => {
  it('succès sans candidat : +1 membership HARD proposal_set, 0 identity_candidate créé, pending → resolved', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])
    const target = await makePoint()

    // Aucun identity_candidate n'existe pour ce thread — la seule voie possible ici est le
    // choix humain explicite d'un Point actif du même site, sans passer par un candidat.
    const { count: candidateCountBefore } = await db
      .from('tracked_point_identity_candidate')
      .select('id', { count: 'exact', head: true })
      .eq('subject_thread_id', threadId)
    expect(candidateCountBefore).toBe(0)

    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.result).toBe('associated')
    expect(result.targetPointId).toBe(target)
    expect(result.membershipInserted).toBe(true)
    expect(result.candidateAccepted).toBe(false)

    const { data: pendingRow } = await db.from('tracked_point_pending_trace').select('status, target_point_id').eq('id', pendingId).single()
    expect((pendingRow as { status: string }).status).toBe('resolved')
    expect((pendingRow as { target_point_id: string }).target_point_id).toBe(target)

    const { data: memberRow } = await db.from('tracked_point_member').select('scope, evidence_grade, status, proposal_ids').eq('id', result.memberId).single()
    const member = memberRow as { scope: string; evidence_grade: string; status: string; proposal_ids: string[] }
    expect(member.scope).toBe('proposal_set')
    expect(member.evidence_grade).toBe('HARD')
    expect(member.status).toBe('active')
    expect(member.proposal_ids).toEqual([p1])

    // 0 identity_candidate créé par ce mode — la doctrine "HUMAN_SELECTED_TARGET n'invente
    // jamais de ligne candidate" est vérifiée après coup, pas seulement avant.
    const { count: candidateCountAfter } = await db
      .from('tracked_point_identity_candidate')
      .select('id', { count: 'exact', head: true })
      .eq('subject_thread_id', threadId)
    expect(candidateCountAfter).toBe(0)
  })

  it('idempotence : rejeu identique → already_resolved, 0 nouvelle membership', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])
    const target = await makePoint()

    const first = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(first.ok).toBe(true)

    const replay = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error('attendu un succès idempotent')
    expect(replay.result).toBe('already_resolved')
    expect(replay.membershipInserted).toBe(false)

    const { count: memberCount } = await db
      .from('tracked_point_member')
      .select('id', { count: 'exact', head: true })
      .eq('subject_thread_id', threadId)
      .eq('status', 'active')
    expect(memberCount).toBe(1)
  })

  it('TARGET_MISMATCH : pending déjà resolved, rejeu avec une AUTRE cible refusé (jamais de réassignation silencieuse)', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])
    const target = await makePoint()
    const otherTarget = await makePoint()

    const first = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(first.ok).toBe(true)

    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: otherTarget })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/TARGET_MISMATCH/)
  })
})

describe('associatePendingResolutionToPoint — KNOWN_CANDIDATE_TARGET (candidateId fourni)', () => {
  it('succès avec candidat : membership HARD + candidat accepted', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])
    const target = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: target, subject_thread_id: threadId })

    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target, candidateId: cand })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.candidateAccepted).toBe(true)

    const { data: candRow } = await db.from('tracked_point_identity_candidate').select('status').eq('id', cand).single()
    expect((candRow as { status: string }).status).toBe('accepted')
  })

  it('plusieurs candidates (Point 5) : accepter l\'un laisse les autres intouchés', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])
    const targetA = await makePoint()
    const targetB = await makePoint()
    const targetC = await makePoint()
    const candA = await makeCandidate({ candidate_point_id: targetA, subject_thread_id: threadId })
    const candB = await makeCandidate({ candidate_point_id: targetB, subject_thread_id: threadId })
    const candC = await makeCandidate({ candidate_point_id: targetC, subject_thread_id: threadId })

    const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: targetB, candidateId: candB })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.targetPointId).toBe(targetB)

    const { data: rows } = await db
      .from('tracked_point_identity_candidate')
      .select('id, status')
      .in('id', [candA, candB, candC])
    const byId = new Map((rows as Array<{ id: string; status: string }>).map((r) => [r.id, r.status]))
    expect(byId.get(candA)).toBe('pending')
    expect(byId.get(candB)).toBe('accepted')
    expect(byId.get(candC)).toBe('pending')

    // La pending trace résolue vers targetB : le thread est désormais membre HARD actif
    // d'un Point différent de targetA/targetC — une association ultérieure vers ces
    // cibles serait STALE_ALREADY_CONSUMED (guard 15), jamais reproduite ici (HARD STOP).
    const { data: pendingRow } = await db.from('tracked_point_pending_trace').select('target_point_id').eq('id', pendingId).single()
    expect((pendingRow as { target_point_id: string }).target_point_id).toBe(targetB)
  })
})

describe('dismissPendingTrace', () => {
  it('INVALID_PENDING_TRACE_ID sur un id mal formé', async () => {
    const result = await dismissPendingTrace({ siteId, pendingTraceId: 'not-a-uuid', actorUserId: adminUserId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_PENDING_TRACE_ID')
  })

  it('PENDING_TRACE_NOT_FOUND sur un id inexistant', async () => {
    const result = await dismissPendingTrace({ siteId, pendingTraceId: randomUUID(), actorUserId: adminUserId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('PENDING_TRACE_NOT_FOUND')
  })

  it('SITE_MISMATCH : la pending trace appartient à un autre site', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId, otherSiteId)
    const result = await dismissPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('SITE_MISMATCH')
  })

  it('succès : pending → dismissed, aucun Point/membership créé', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)

    const result = await dismissPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.alreadyDismissed).toBe(false)

    const { data: pendingRow } = await db.from('tracked_point_pending_trace').select('status, resolved_at, target_point_id').eq('id', pendingId).single()
    const row = pendingRow as { status: string; resolved_at: string | null; target_point_id: string | null }
    expect(row.status).toBe('dismissed')
    expect(row.resolved_at).toBeTruthy()
    expect(row.target_point_id).toBeNull()

    const { count: memberCount } = await db
      .from('tracked_point_member')
      .select('id', { count: 'exact', head: true })
      .eq('subject_thread_id', threadId)
    expect(memberCount).toBe(0)
  })

  it('idempotence : dismiss d\'une trace déjà dismissed renvoie alreadyDismissed=true', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const first = await dismissPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId })
    expect(first.ok).toBe(true)

    const second = await dismissPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('attendu un succès idempotent')
    expect(second.alreadyDismissed).toBe(true)
  })

  it('ALREADY_RESOLVED : dismiss d\'une pending trace déjà résolue vers un Point est refusé', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])
    const target = await makePoint()
    const associated = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(associated.ok).toBe(true)

    const result = await dismissPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/ALREADY_RESOLVED/)
  })
})

// Phase 6E.8A — report temporel ("Me le redemander…"). NON EXÉCUTABLE tant que la migration
// 399 (deferred_until/deferred_at/deferred_by) n'est pas appliquée à la base réelle : écrit
// maintenant pour figer le contrat attendu, exécuté seulement après le GO migration de
// Vincent. Mêmes fixtures/conventions que describe('dismissPendingTrace', ...) ci-dessus.
describe('deferPendingTrace', () => {
  it('INVALID_PENDING_TRACE_ID sur un id mal formé', async () => {
    const result = await deferPendingTrace({ siteId, pendingTraceId: 'not-a-uuid', actorUserId: adminUserId, durationDays: 7 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_PENDING_TRACE_ID')
  })

  it('INVALID_DURATION sur une durée hors des 3 valeurs fixes autorisées', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    // @ts-expect-error — durée hors du type DeferDurationDays, exactement le cas que le guard
    // runtime doit intercepter (jamais une confiance aveugle dans le typage côté appelant).
    const result = await deferPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId, durationDays: 3 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_DURATION')
  })

  it('PENDING_TRACE_NOT_FOUND sur un id inexistant', async () => {
    const result = await deferPendingTrace({ siteId, pendingTraceId: randomUUID(), actorUserId: adminUserId, durationDays: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('PENDING_TRACE_NOT_FOUND')
  })

  it('SITE_MISMATCH : la pending trace appartient à un autre site', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId, otherSiteId)
    const result = await deferPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId, durationDays: 7 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('SITE_MISMATCH')
  })

  it('succès : status reste pending, deferred_until/deferred_at/deferred_by corrects, resolved_at/target_point_id intouchés', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)

    const before = Date.now()
    const result = await deferPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId, durationDays: 7 })
    const after = Date.now()
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')

    const { data: row } = await db
      .from('tracked_point_pending_trace')
      .select('status, deferred_until, deferred_at, deferred_by, resolved_at, resolved_by, target_point_id')
      .eq('id', pendingId)
      .single()
    const trace = row as {
      status: string
      deferred_until: string
      deferred_at: string
      deferred_by: string
      resolved_at: string | null
      resolved_by: string | null
      target_point_id: string | null
    }

    // Un report n'est jamais un abandon : status reste 'pending' (mandat Vincent 6E.8, verdict
    // ASK_LATER_MODEL_MISSING — pas de nouvelle valeur de status).
    expect(trace.status).toBe('pending')
    expect(trace.deferred_by).toBe(adminUserId)
    // Comparaison par instant, pas par égalité de chaîne : result.deferredUntil vient de
    // Date.toISOString() (suffixe Z) alors que trace.deferred_until vient de Postgres
    // timestamptz (suffixe +00:00) — même instant, sérialisations différentes.
    expect(new Date(result.deferredUntil).getTime()).toBe(new Date(trace.deferred_until).getTime())

    const deferredUntilMs = new Date(trace.deferred_until).getTime()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    expect(deferredUntilMs).toBeGreaterThanOrEqual(before + sevenDaysMs - 5000)
    expect(deferredUntilMs).toBeLessThanOrEqual(after + sevenDaysMs + 5000)

    // Un report ne touche jamais les colonnes du cycle de vie résolution/dismiss.
    expect(trace.resolved_at).toBeNull()
    expect(trace.resolved_by).toBeNull()
    expect(trace.target_point_id).toBeNull()
  })

  it('rejeu non cumulatif : un second report avec une autre durée remplace l\'échéance, ne l\'additionne jamais', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)

    const first = await deferPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId, durationDays: 30 })
    expect(first.ok).toBe(true)

    const second = await deferPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId, durationDays: 1 })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('attendu un succès')

    const { data: row } = await db.from('tracked_point_pending_trace').select('deferred_until').eq('id', pendingId).single()
    const deferredUntilMs = new Date((row as { deferred_until: string }).deferred_until).getTime()
    const oneDayFromNowMs = Date.now() + 24 * 60 * 60 * 1000
    // La deuxième échéance (1 jour) doit avoir REMPLACÉ la première (30 jours), jamais s'y
    // ajouter : si elle s'était cumulée, l'échéance serait ~31 jours dans le futur.
    expect(deferredUntilMs).toBeLessThan(oneDayFromNowMs + 5000)
  })

  it('ALREADY_DISMISSED : report d\'une pending trace déjà écartée est refusé', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const dismissed = await dismissPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId })
    expect(dismissed.ok).toBe(true)

    const result = await deferPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId, durationDays: 7 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/ALREADY_DISMISSED/)
  })

  it('ALREADY_RESOLVED : report d\'une pending trace déjà résolue vers un Point est refusé', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])
    const target = await makePoint()
    const associated = await associatePendingResolutionToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(associated.ok).toBe(true)

    const result = await deferPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId, durationDays: 7 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/ALREADY_RESOLVED/)
  })

  it('interaction : dismissPendingTrace fonctionne normalement sur une trace précédemment reportée mais encore pending', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)

    const deferred = await deferPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId, durationDays: 1 })
    expect(deferred.ok).toBe(true)

    const dismissed = await dismissPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId })
    expect(dismissed.ok).toBe(true)
    if (!dismissed.ok) throw new Error('attendu un succès')
    expect(dismissed.alreadyDismissed).toBe(false)

    const { data: row } = await db.from('tracked_point_pending_trace').select('status').eq('id', pendingId).single()
    expect((row as { status: string }).status).toBe('dismissed')
  })
})
