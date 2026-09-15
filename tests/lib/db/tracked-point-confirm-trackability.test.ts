// Test d'INTÉGRATION (vraie Supabase) — Phase 6E.3B.2, migration 395,
// RPC confirm_pending_trackability.
//
// Couvre les guards exigés par Vincent : INVALID_KIND (RESOLUTION_WITHOUT_KNOWN_PROBLEM
// hors périmètre) / INVALID_STATUS (dismissed) / EVIDENCE_SCOPE_UNRESOLVED (evidence non
// figée par 394) / STALE_ALREADY_TRACKED (thread déjà fondateur/membre HARD d'un autre
// Point) / ABORT (cross-site défensif) ; le chemin nominal (Point PROVISIONAL/manual +
// membership HARD proposal_set exacte) ; le rejeu idempotent (ALREADY_RESOLVED, même
// Point, 0 nouvelle écriture) ; la preuve de concurrence explicitement demandée (deux
// appels simultanés sur LE MÊME pending_trace_id ne peuvent jamais fonder 2 Points) ; et
// la non-contamination du read-model (un Point préexistant sur le même site n'est jamais
// affecté par la confirmation d'un autre).
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'

const TAG = `__test_6e3b2_confirm_trackability_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let otherSiteId: string
let docId: string
let runId: string
const pendingTraceIds: string[] = []

async function makePendingTrace(threadId: string, kind = 'TRACKABILITY_UNDETERMINED', targetSiteId: string = siteId) {
  const db = createAdminClient()
  const { data, error } = await db.from('tracked_point_pending_trace').insert({
    site_id: targetSiteId, source_thread_id: threadId, kind, reason: 'x',
  }).select('id').single()
  if (error) throw error
  const id = (data as { id: string }).id
  pendingTraceIds.push(id)
  return id
}

async function makeProposal(threadId: string, label = `${TAG} proposal`) {
  const db = createAdminClient()
  const { data, error } = await db.from('document_extraction_proposal').insert({
    organization_id: orgId, extraction_run_id: runId, document_id: docId,
    proposal_family: 'observation', label, subject_thread_id: threadId,
  }).select('id').single()
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

async function confirmTrackability(pendingId: string) {
  const db = createAdminClient()
  return db.rpc('confirm_pending_trackability', { p_pending_trace_id: pendingId })
}

async function makeNativeProposal(canonicalSubjectId: string, title = `${TAG} native proposal`, kind = 'knowledge') {
  const db = createAdminClient()
  const { data, error } = await db.from('site_knowledge_proposals').insert({
    organization_id: orgId, site_id: siteId, kind, title,
    dedupe_key: `${TAG}-${randomUUID()}`, canonical_subject_id: canonicalSubjectId,
  }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function resolveNativeEvidence(pendingId: string, nativeProposalIds: string[], basis: 'exact_single_proposal' | 'whole_thread_proven_safe' = 'exact_single_proposal') {
  const db = createAdminClient()
  const { error } = await db.rpc('resolve_pending_trace_evidence', {
    p_pending_trace_id: pendingId, p_proposal_ids: [], p_evidence_basis: basis, p_native_proposal_ids: nativeProposalIds,
  })
  if (error) throw error
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
  const { data: pts } = await db.from('tracked_point').select('id').in('site_id', [siteId, otherSiteId])
  const ptIds = ((pts ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (ptIds.length > 0) await db.from('tracked_point_member').delete().in('tracked_point_id', ptIds)
  await db.from('tracked_point').delete().in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point_pending_trace').delete().in('site_id', [siteId, otherSiteId])
  await db.from('subject_thread_identity').delete().eq('site_id', otherSiteId)
  await db.from('document_extraction_proposal').delete().eq('document_id', docId)
  await db.from('document_extraction_run').delete().eq('id', runId)
  await db.from('documents').delete().eq('id', docId)
  await db.from('sites').delete().in('id', [siteId, otherSiteId])
  await db.from('clients').delete().eq('id', clientId)
})

describe('confirm_pending_trackability — guards (migration 395)', () => {
  it('INVALID_KIND : RESOLUTION_WITHOUT_KNOWN_PROBLEM ne fonde jamais son propre Point (hors périmètre 6E.3B.2)', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId, 'RESOLUTION_WITHOUT_KNOWN_PROBLEM')

    const { error } = await confirmTrackability(pendingId)
    expect(error).not.toBeNull()
    expect(String(error?.message)).toMatch(/INVALID_KIND/)
  })

  it('INVALID_STATUS : une pending trace dismissed n\'est jamais reconfirmable', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    await db.from('tracked_point_pending_trace').update({ status: 'dismissed', resolved_at: new Date().toISOString() }).eq('id', pendingId)

    const { error } = await confirmTrackability(pendingId)
    expect(error).not.toBeNull()
    expect(String(error?.message)).toMatch(/INVALID_STATUS/)
  })

  it('EVIDENCE_SCOPE_UNRESOLVED : evidence non figée par 394', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)

    const { error } = await confirmTrackability(pendingId)
    expect(error).not.toBeNull()
    expect(String(error?.message)).toMatch(/EVIDENCE_SCOPE_UNRESOLVED/)
  })

  it('STALE_ALREADY_TRACKED : le thread source est déjà membre HARD actif d\'un autre Point', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])

    const otherPoint = (await db.from('tracked_point').insert({ site_id: siteId, label: `${TAG} autre point`, founding_kind: 'manual', seed_source: 'manual' }).select('id').single()).data!.id as string
    await db.from('tracked_point_member').insert({ tracked_point_id: otherPoint, subject_thread_id: threadId, scope: 'thread', resolution_source: 'manual' })

    const { error } = await confirmTrackability(pendingId)
    expect(error).not.toBeNull()
    expect(String(error?.message)).toMatch(/STALE_ALREADY_TRACKED/)
  })

  it('ABORT : subject_thread_identity du thread pointe vers un autre site que le pending', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId, 'TRACKABILITY_UNDETERMINED', siteId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])

    const otherSubjectId = (await db.from('canonical_subject').insert({ site_id: otherSiteId, label: `${TAG} sujet autre site` }).select('id').single()).data!.id as string
    await db.from('subject_thread_identity').insert({ subject_thread_id: threadId, site_id: otherSiteId, canonical_subject_id: otherSubjectId, source: 'manual' })

    const { error } = await confirmTrackability(pendingId)
    expect(error).not.toBeNull()
    expect(String(error?.message)).toMatch(/ABORT/)

    await db.from('subject_thread_identity').delete().eq('subject_thread_id', threadId)
  })
})

describe('confirm_pending_trackability — chemin nominal + idempotence', () => {
  it('succès : +1 Point PROVISIONAL/manual, +1 membership HARD proposal_set, pending → resolved ; rejeu → already_resolved, 0 nouvelle écriture', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const subjectId = (await db.from('canonical_subject').insert({ site_id: siteId, label: `${TAG} sujet` }).select('id').single()).data!.id as string
    await db.from('subject_thread_identity').insert({ subject_thread_id: threadId, site_id: siteId, canonical_subject_id: subjectId, source: 'manual' })

    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId, `${TAG} label attendu`)
    await resolveEvidence(pendingId, [p1])

    const { data, error } = await confirmTrackability(pendingId)
    expect(error).toBeNull()
    const result = data as { result: string; targetPointId: string; memberId: string; label: string; pointCreated: boolean; membershipInserted: boolean }
    expect(result.result).toBe('confirmed')
    expect(result.pointCreated).toBe(true)
    expect(result.membershipInserted).toBe(true)
    expect(result.label).toBe(`${TAG} label attendu`)

    const { data: pointRow } = await db.from('tracked_point').select('*').eq('id', result.targetPointId).single()
    const point = pointRow as { identity_status: string; founding_kind: string; founding_source: string; founding_reference: string; status: string; canonical_subject_id: string }
    expect(point.identity_status).toBe('PROVISIONAL')
    expect(point.founding_kind).toBe('manual')
    expect(point.founding_source).toBe('human_confirmed_pending_trackability')
    expect(point.founding_reference).toBe(pendingId)
    expect(point.status).toBe('active')
    expect(point.canonical_subject_id).toBe(subjectId)

    const { data: memberRow } = await db.from('tracked_point_member').select('*').eq('id', result.memberId).single()
    const member = memberRow as { scope: string; proposal_ids: string[]; status: string; evidence_grade: string; subject_thread_id: string }
    expect(member.scope).toBe('proposal_set')
    expect(member.proposal_ids).toEqual([p1])
    expect(member.status).toBe('active')
    expect(member.evidence_grade).toBe('HARD')
    expect(member.subject_thread_id).toBe(threadId)

    const { data: pendingRow } = await db.from('tracked_point_pending_trace').select('status, target_point_id').eq('id', pendingId).single()
    expect((pendingRow as { status: string }).status).toBe('resolved')
    expect((pendingRow as { target_point_id: string }).target_point_id).toBe(result.targetPointId)

    // Rejeu — idempotent, même Point, 0 nouvelle écriture.
    const replay = await confirmTrackability(pendingId)
    expect(replay.error).toBeNull()
    const replayResult = replay.data as { result: string; targetPointId: string; pointCreated: boolean; membershipInserted: boolean }
    expect(replayResult.result).toBe('already_resolved')
    expect(replayResult.targetPointId).toBe(result.targetPointId)
    expect(replayResult.pointCreated).toBe(false)
    expect(replayResult.membershipInserted).toBe(false)

    const { count: pointCount } = await db.from('tracked_point').select('*', { count: 'exact', head: true }).eq('founding_reference', pendingId)
    expect(pointCount).toBe(1)
    const { count: memberCount } = await db.from('tracked_point_member').select('*', { count: 'exact', head: true }).eq('subject_thread_id', threadId).eq('status', 'active')
    expect(memberCount).toBe(1)
  })

  it('non-contamination : confirmer une pending trace ne modifie jamais un Point préexistant sur le même site', async () => {
    const db = createAdminClient()
    const untouchedPoint = (await db.from('tracked_point').insert({ site_id: siteId, label: `${TAG} intouché`, founding_kind: 'manual', seed_source: 'manual' }).select('id').single()).data!.id as string
    const untouchedThread = randomUUID()
    await db.from('tracked_point_member').insert({ tracked_point_id: untouchedPoint, subject_thread_id: untouchedThread, scope: 'thread', resolution_source: 'manual' })

    const before = await loadTrackedPointReadModel(siteId)
    const beforeUntouched = before.points.find((p) => p.id === untouchedPoint)

    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])
    const { error } = await confirmTrackability(pendingId)
    expect(error).toBeNull()

    const after = await loadTrackedPointReadModel(siteId)
    const afterUntouched = after.points.find((p) => p.id === untouchedPoint)
    expect(afterUntouched).toEqual(beforeUntouched)
  })
})

describe('confirm_pending_trackability — famille NATIVE (migration 408+409, P0-1A-2a + P0-1A-2a.1)', () => {
  it('succès (evidence NATIVE uniquement) : +1 Point PROVISIONAL/manual, canonical_subject_id = racine native, label sourcé depuis site_knowledge_proposals.title', async () => {
    const db = createAdminClient()
    // Convention du natif (cf. tête de migration 408) : le "thread" est directement le
    // canonical_subject résolu à sa racine — aucun subject_thread_identity, réservé à
    // l'historique. Depuis la migration 409 (P0-1A-2a.1), canonical_subject_id sur le
    // Point est dérivé de cette même racine native (jamais NULL par construction dès
    // lors qu'une evidence native a résolu la pending trace) : la mémoire native rejoint
    // la mémoire longitudinale sans orphelinage.
    const rootId = (await db.from('canonical_subject').insert({ site_id: siteId, label: `${TAG} sujet natif` }).select('id').single()).data!.id as string

    const pendingId = await makePendingTrace(rootId)
    const n1 = await makeNativeProposal(rootId, `${TAG} label natif attendu`)
    await resolveNativeEvidence(pendingId, [n1])

    const { data, error } = await confirmTrackability(pendingId)
    expect(error).toBeNull()
    const result = data as { result: string; targetPointId: string; memberId: string; label: string; canonicalSubjectId: string | null; pointCreated: boolean; membershipInserted: boolean }
    expect(result.result).toBe('confirmed')
    expect(result.pointCreated).toBe(true)
    expect(result.membershipInserted).toBe(true)
    expect(result.label).toBe(`${TAG} label natif attendu`)
    expect(result.canonicalSubjectId).toBe(rootId)

    const { data: pointRow } = await db.from('tracked_point').select('*').eq('id', result.targetPointId).single()
    const point = pointRow as { identity_status: string; founding_kind: string; founding_source: string; founding_reference: string; status: string; canonical_subject_id: string | null }
    expect(point.identity_status).toBe('PROVISIONAL')
    expect(point.founding_kind).toBe('manual')
    expect(point.founding_source).toBe('human_confirmed_pending_trackability')
    expect(point.founding_reference).toBe(pendingId)
    expect(point.status).toBe('active')
    expect(point.canonical_subject_id).toBe(rootId)

    const { data: memberRow } = await db.from('tracked_point_member').select('*').eq('id', result.memberId).single()
    const member = memberRow as { scope: string; proposal_ids: string[]; status: string; evidence_grade: string; subject_thread_id: string }
    expect(member.scope).toBe('proposal_set')
    expect(member.proposal_ids).toEqual([n1])
    expect(member.status).toBe('active')
    expect(member.evidence_grade).toBe('HARD')
    expect(member.subject_thread_id).toBe(rootId)
  })

  it('suit la racine merged_into : la proposition référence le sujet pré-fusion, canonical_subject_id du Point = la racine, jamais le sujet brut', async () => {
    const db = createAdminClient()
    const rootId = (await db.from('canonical_subject').insert({ site_id: siteId, label: `${TAG} sujet racine (post-fusion)` }).select('id').single()).data!.id as string
    const mergedLeafId = (await db.from('canonical_subject').insert({ site_id: siteId, label: `${TAG} sujet fusionné (pré-fusion)`, merged_into: rootId }).select('id').single()).data!.id as string

    const pendingId = await makePendingTrace(rootId)
    const n1 = await makeNativeProposal(mergedLeafId, `${TAG} label sujet fusionné`)
    await resolveNativeEvidence(pendingId, [n1])

    const { data, error } = await confirmTrackability(pendingId)
    expect(error).toBeNull()
    const result = data as { canonicalSubjectId: string | null; targetPointId: string }
    expect(result.canonicalSubjectId).toBe(rootId)
    expect(result.canonicalSubjectId).not.toBe(mergedLeafId)

    const { data: pointRow } = await db.from('tracked_point').select('canonical_subject_id').eq('id', result.targetPointId).single()
    expect((pointRow as { canonical_subject_id: string | null }).canonical_subject_id).toBe(rootId)
  })

  it('replay idempotent : rejeu d\'une confirmation native ne recalcule jamais canonical_subject_id', async () => {
    const db = createAdminClient()
    const rootId = (await db.from('canonical_subject').insert({ site_id: siteId, label: `${TAG} sujet natif replay` }).select('id').single()).data!.id as string

    const pendingId = await makePendingTrace(rootId)
    const n1 = await makeNativeProposal(rootId)
    await resolveNativeEvidence(pendingId, [n1])

    const first = await confirmTrackability(pendingId)
    expect(first.error).toBeNull()
    const firstResult = first.data as { targetPointId: string; canonicalSubjectId: string | null }

    const replay = await confirmTrackability(pendingId)
    expect(replay.error).toBeNull()
    const replayResult = replay.data as { result: string; targetPointId: string; pointCreated: boolean }
    expect(replayResult.result).toBe('already_resolved')
    expect(replayResult.targetPointId).toBe(firstResult.targetPointId)
    expect(replayResult.pointCreated).toBe(false)

    const { data: pointRow } = await db.from('tracked_point').select('canonical_subject_id').eq('id', firstResult.targetPointId).single()
    expect((pointRow as { canonical_subject_id: string | null }).canonical_subject_id).toBe(rootId)
  })

  it('n\'affecte jamais une confirmation historique : canonical_subject_id reste dérivé de subject_thread_identity quand aucune evidence native n\'est présente', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const subjectId = (await db.from('canonical_subject').insert({ site_id: siteId, label: `${TAG} sujet historique non-affecte` }).select('id').single()).data!.id as string
    await db.from('subject_thread_identity').insert({ subject_thread_id: threadId, site_id: siteId, canonical_subject_id: subjectId, source: 'manual' })

    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])

    const { data, error } = await confirmTrackability(pendingId)
    expect(error).toBeNull()
    const result = data as { canonicalSubjectId: string | null }
    expect(result.canonicalSubjectId).toBe(subjectId)
  })
})

describe('confirm_pending_trackability — concurrence (exigence explicite Vincent)', () => {
  it('deux appels simultanés sur le MÊME pending_trace_id ne peuvent jamais fonder 2 Points', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])

    const [r1, r2] = await Promise.allSettled([confirmTrackability(pendingId), confirmTrackability(pendingId)])

    type ConfirmResult = { result: string; targetPointId: string }
    const outcomes = [r1, r2].map((r) => {
      if (r.status === 'rejected') return { ok: false, data: null as ConfirmResult | null }
      return { ok: r.value.error === null, data: r.value.data as ConfirmResult | null, error: r.value.error }
    })

    const succeeded = outcomes.filter((o) => o.ok)
    expect(succeeded.length).toBeGreaterThanOrEqual(1)

    const targetPointIds = new Set(succeeded.map((o) => o.data!.targetPointId))
    expect(targetPointIds.size).toBe(1)

    const results = succeeded.map((o) => o.data!.result)
    expect(results.filter((r) => r === 'confirmed').length).toBeLessThanOrEqual(1)

    const { count: pointCount } = await db.from('tracked_point').select('*', { count: 'exact', head: true }).eq('founding_reference', pendingId)
    expect(pointCount).toBe(1)
    const { count: memberCount } = await db.from('tracked_point_member').select('*', { count: 'exact', head: true }).eq('subject_thread_id', threadId).eq('status', 'active')
    expect(memberCount).toBe(1)
  })
})
