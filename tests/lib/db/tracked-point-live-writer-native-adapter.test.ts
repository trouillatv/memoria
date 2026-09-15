// P6 Live Writer — adaptateur natif (field_visit/meeting), chemin CONFIRMED uniquement
// (P0-1A-1, mandat Vincent 2026-09-15).
//
// Contrairement à l'adaptateur historical_pdf (proposals + buildFoundingUnits complet), ce
// module ne traite QUE le rattachement à un CBO déjà résolu à exactement 1 : les fixtures
// écrivent donc directement canonical_subject_occurrence + canonical_business_object, sans
// passer par le pipeline d'extraction. Conventions de fixtures reprises de
// tracked-point-live-writer-historical-adapter.test.ts (TAG, beforeAll/afterAll org→client→site,
// children-before-parents en cleanup).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { runTrackedPointLiveWriterForNativeReport } from '@/lib/db/tracked-point-live-writer-native-adapter'

const TAG = `__test_p6_native_adapter_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string

const createdSubjectIds: string[] = []
const createdCboIds: string[] = []

async function makeSubject(label: string, mergedInto: string | null = null) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('canonical_subject')
    .insert({ site_id: siteId, label, merged_into: mergedInto })
    .select('id')
    .single()
  if (error) throw error
  const id = (data as { id: string }).id
  createdSubjectIds.push(id)
  return id
}

async function makeCbo(canonicalSubjectId: string | null, label: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('canonical_business_object')
    .insert({ site_id: siteId, object_type: 'site_reserve', label, canonical_subject_id: canonicalSubjectId })
    .select('id')
    .single()
  if (error) throw error
  const id = (data as { id: string }).id
  createdCboIds.push(id)
  return id
}

async function makeOccurrence(
  canonicalSubjectId: string,
  reportId: string,
  sourceKind: 'field_visit' | 'meeting' = 'field_visit',
  sourceProposalId: string | null = null,
) {
  const db = createAdminClient()
  const { error } = await db.from('canonical_subject_occurrence').insert({
    canonical_subject_id: canonicalSubjectId,
    site_id: siteId,
    source_kind: sourceKind,
    source_ref_id: reportId,
    source_proposal_id: sourceProposalId,
    label: `${TAG} occurrence`,
    effective_date: new Date().toISOString().slice(0, 10),
  })
  if (error) throw error
}

async function makeSiteKnowledgeProposal(kind: string, title = `${TAG} proposition native`) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('site_knowledge_proposals')
    .insert({ organization_id: orgId, site_id: siteId, kind, title, dedupe_key: `${TAG}-${randomUUID()}` })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function countPendingTraces(threadId: string, kind = 'TRACKABILITY_UNDETERMINED') {
  const db = createAdminClient()
  const { count } = await db
    .from('tracked_point_pending_trace')
    .select('id', { count: 'exact', head: true })
    .eq('source_thread_id', threadId)
    .eq('kind', kind)
  return count ?? 0
}

async function countActiveMembersOnThread(threadId: string) {
  const db = createAdminClient()
  const { count } = await db
    .from('tracked_point_member')
    .select('id', { count: 'exact', head: true })
    .eq('subject_thread_id', threadId)
    .eq('status', 'active')
  return count ?? 0
}

beforeAll(async () => {
  const db = createAdminClient()

  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()

  const { data: events } = await db
    .from('tracked_point_reconcile_event')
    .select('id')
    .eq('site_id', siteId)
  const eventIds = ((events ?? []) as Array<{ id: string }>).map((e) => e.id)
  if (eventIds.length > 0) {
    await db.from('tracked_point_reconcile_artifact').delete().in('reconcile_event_id', eventIds)
  }
  await db.from('tracked_point_reconcile_event').delete().eq('site_id', siteId)
  await db.from('tracked_point_reconcile_state').delete().eq('site_id', siteId)

  // Cascade sur tracked_point_pending_trace_evidence (mig 394 ON DELETE CASCADE) — doit précéder
  // la suppression des site_knowledge_proposals (native_proposal_id est ON DELETE RESTRICT).
  await db.from('tracked_point_pending_trace').delete().eq('site_id', siteId)
  await db.from('site_knowledge_proposals').delete().eq('site_id', siteId)

  const { data: pts } = await db.from('tracked_point').select('id').eq('site_id', siteId)
  const ptIds = ((pts ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (ptIds.length > 0) {
    await db.from('tracked_point_member').delete().in('tracked_point_id', ptIds)
    await db.from('tracked_point_identity_candidate').delete().in('candidate_point_id', ptIds)
  }
  await db.from('canonical_business_object').update({ tracked_point_id: null }).eq('site_id', siteId)
  await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('site_id', siteId)
  await db.from('tracked_point').delete().eq('site_id', siteId)

  if (createdCboIds.length > 0) {
    await db.from('canonical_business_object').delete().in('id', createdCboIds)
  }
  await db.from('canonical_subject_occurrence').delete().eq('site_id', siteId)
  if (createdSubjectIds.length > 0) {
    await db.from('canonical_subject').delete().in('id', createdSubjectIds)
  }

  await db.from('sites').delete().eq('id', siteId)
  await db.from('clients').delete().eq('id', clientId)
})

describe('runTrackedPointLiveWriterForNativeReport — aucune occurrence', () => {
  it('aucune occurrence pour ce rapport → 0 unité, pas null', async () => {
    const result = await runTrackedPointLiveWriterForNativeReport({ reportId: randomUUID(), siteId })
    expect(result).toEqual({ unitsProcessed: 0, verdictCounts: {}, refusals: 0, skippedNotConfirmed: 0 })
  })
})

describe('runTrackedPointLiveWriterForNativeReport — chemin CONFIRMED uniquement', () => {
  it('sujet sans aucun CBO → ignoré (skippedNotConfirmed), aucun appel RPC', async () => {
    const reportId = randomUUID()
    const subjectId = await makeSubject(`${TAG} sujet sans cbo`)
    await makeOccurrence(subjectId, reportId)

    const result = await runTrackedPointLiveWriterForNativeReport({ reportId, siteId })
    expect(result).toEqual({ unitsProcessed: 0, verdictCounts: {}, refusals: 0, skippedNotConfirmed: 1 })
  })

  it('sujet avec deux CBO (ambigu) → ignoré, jamais de choix au hasard', async () => {
    const reportId = randomUUID()
    const subjectId = await makeSubject(`${TAG} sujet ambigu`)
    await makeCbo(subjectId, `${TAG} cbo A`)
    await makeCbo(subjectId, `${TAG} cbo B`)
    await makeOccurrence(subjectId, reportId)

    const result = await runTrackedPointLiveWriterForNativeReport({ reportId, siteId })
    expect(result).toEqual({ unitsProcessed: 0, verdictCounts: {}, refusals: 0, skippedNotConfirmed: 1 })
  })

  it('sujet avec exactement un CBO → rattachement réel, Point matérialisé (AUTO_CREATED)', async () => {
    const reportId = randomUUID()
    const subjectId = await makeSubject(`${TAG} sujet confirmé unique`)
    await makeCbo(subjectId, `${TAG} cbo unique`)
    await makeOccurrence(subjectId, reportId)

    const result = await runTrackedPointLiveWriterForNativeReport({ reportId, siteId })
    expect(result).not.toBeNull()
    expect(result?.unitsProcessed).toBe(1)
    expect(result?.refusals).toBe(0)
    expect(result?.skippedNotConfirmed).toBe(0)
    expect(result?.verdictCounts.AUTO_CREATED).toBe(1)

    expect(await countActiveMembersOnThread(subjectId)).toBe(1)
  })

  it('replay du même rapport → idempotent, aucune duplication d’appartenance', async () => {
    const reportId = randomUUID()
    const subjectId = await makeSubject(`${TAG} sujet confirmé replay`)
    await makeCbo(subjectId, `${TAG} cbo replay`)
    await makeOccurrence(subjectId, reportId)

    const first = await runTrackedPointLiveWriterForNativeReport({ reportId, siteId })
    expect(first?.verdictCounts.AUTO_CREATED).toBe(1)
    expect(await countActiveMembersOnThread(subjectId)).toBe(1)

    const second = await runTrackedPointLiveWriterForNativeReport({ reportId, siteId })
    expect(second?.unitsProcessed).toBe(1)
    expect(second?.refusals).toBe(0)
    expect(await countActiveMembersOnThread(subjectId)).toBe(1)
  })

  it('occurrence sur un sujet fusionné (merged_into) → résolu à la racine avant recherche du CBO', async () => {
    const reportId = randomUUID()
    const rootId = await makeSubject(`${TAG} sujet racine post-fusion`)
    const mergedId = await makeSubject(`${TAG} sujet fusionné`, rootId)
    await makeCbo(rootId, `${TAG} cbo racine`)
    // L'occurrence pointe encore vers l'ancien sujet (merged_into), comme un writer qui n'a
    // pas encore rejoué la projection — le module doit remonter à la racine lui-même.
    await makeOccurrence(mergedId, reportId)

    const result = await runTrackedPointLiveWriterForNativeReport({ reportId, siteId })
    expect(result?.unitsProcessed).toBe(1)
    expect(result?.skippedNotConfirmed).toBe(0)
    expect(result?.verdictCounts.AUTO_CREATED).toBe(1)
    expect(await countActiveMembersOnThread(rootId)).toBe(1)
  })
})

describe('runTrackedPointLiveWriterForNativeReport — chemin PENDING_TRACKABILITY (P0-1A-2b)', () => {
  it('sujet sans CBO + preuve native non-stakeholder → NEEDS_HUMAN, pending trace TRACKABILITY_UNDETERMINED créée', async () => {
    const reportId = randomUUID()
    const subjectId = await makeSubject(`${TAG} sujet 0 cbo avec preuve`)
    const proposalId = await makeSiteKnowledgeProposal('knowledge')
    await makeOccurrence(subjectId, reportId, 'field_visit', proposalId)

    const result = await runTrackedPointLiveWriterForNativeReport({ reportId, siteId })
    expect(result).not.toBeNull()
    expect(result?.unitsProcessed).toBe(1)
    expect(result?.refusals).toBe(0)
    expect(result?.skippedNotConfirmed).toBe(0)
    expect(result?.verdictCounts.NEEDS_HUMAN).toBe(1)

    expect(await countPendingTraces(subjectId)).toBe(1)
    // Aucun Point ne doit être créé par ce chemin : la fondation attend le geste humain.
    expect(await countActiveMembersOnThread(subjectId)).toBe(0)
  })

  it('sujet sans CBO + preuve native uniquement stakeholder → toujours ignoré (hors périmètre par construction)', async () => {
    const reportId = randomUUID()
    const subjectId = await makeSubject(`${TAG} sujet 0 cbo preuve stakeholder`)
    const proposalId = await makeSiteKnowledgeProposal('stakeholder')
    await makeOccurrence(subjectId, reportId, 'field_visit', proposalId)

    const result = await runTrackedPointLiveWriterForNativeReport({ reportId, siteId })
    expect(result).toEqual({ unitsProcessed: 0, verdictCounts: {}, refusals: 0, skippedNotConfirmed: 1 })
    expect(await countPendingTraces(subjectId)).toBe(0)
  })

  it('replay du même rapport PENDING_TRACKABILITY → idempotent, une seule pending trace', async () => {
    const reportId = randomUUID()
    const subjectId = await makeSubject(`${TAG} sujet 0 cbo replay`)
    const proposalId = await makeSiteKnowledgeProposal('knowledge')
    await makeOccurrence(subjectId, reportId, 'field_visit', proposalId)

    const first = await runTrackedPointLiveWriterForNativeReport({ reportId, siteId })
    expect(first?.verdictCounts.NEEDS_HUMAN).toBe(1)
    expect(await countPendingTraces(subjectId)).toBe(1)

    const second = await runTrackedPointLiveWriterForNativeReport({ reportId, siteId })
    expect(second?.unitsProcessed).toBe(1)
    expect(second?.refusals).toBe(0)
    expect(await countPendingTraces(subjectId)).toBe(1)
  })
})
