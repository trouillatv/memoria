// Test d'INTÉGRATION (vraie Supabase) — Phase 6E.3B.1, migration 394.
//
// Vérifie les invariants de PENDING EVIDENCE PERSISTENCE, couche de provenance
// pure (jamais un mécanisme d'identité) qui fige à la résolution un jeu EXACT
// de proposal_id — jamais une référence dynamique « tout le thread » — pour
// chaque tracked_point_pending_trace :
//   1. resolved + 0 ligne d'evidence → refusé (trigger différé, cohérence
//      parent→enfant) ;
//   2. unresolved + evidence présente → refusé (trigger différé, cohérence
//      enfant→parent) ;
//   3. lien proposal dupliqué → refusé par la PK composite ;
//   4. proposition d'un AUTRE thread que celui de la pending trace → refusée
//      immédiatement par le trigger de garde (BEFORE INSERT), y compris à
//      travers le writer RPC resolve_pending_trace_evidence ;
//   5. chemin nominal du writer : résout avec exactement les propositions
//      demandées, idempotent sur rejeu identique ;
//   6. isolation : ni l'ajout d'une pending trace, ni sa résolution via le
//      writer RPC, ne change JAMAIS loadTrackedPointReadModel — seul un vrai
//      tracked_point_member HARD fait évoluer la projection (cf. migration
//      388/389, doctrine héritée de tracked-point-pending-trace-constraints).
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'

const TAG = `__test_6e3b1_pending_evidence_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let pointId: string
let docId: string
let runId: string
const proposalIds: string[] = []
const pendingTraceIds: string[] = []

async function makePendingTrace(threadId: string, kind = 'TRACKABILITY_UNDETERMINED', reason = 'x') {
  const db = createAdminClient()
  const { data, error } = await db.from('tracked_point_pending_trace').insert({
    site_id: siteId, source_thread_id: threadId, kind, reason,
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
    proposal_family: 'knowledge_fact', label, subject_thread_id: threadId,
  }).select('id').single()
  if (error) throw error
  const id = (data as { id: string }).id
  proposalIds.push(id)
  return id
}

beforeAll(async () => {
  const db = createAdminClient()

  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  pointId = (await db.from('tracked_point').insert({ site_id: siteId, label: `${TAG} Point`, founding_kind: 'manual', seed_source: 'manual' }).select('id').single()).data!.id as string
  docId = (await db.from('documents').insert({ organization_id: orgId, document_type: 'historical_visit_report', storage_path: `${TAG}/x.pdf`, filename: 'x.pdf' }).select('id').single()).data!.id as string
  runId = (await db.from('document_extraction_run').insert({ organization_id: orgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('tracked_point_pending_trace').delete().eq('site_id', siteId)
  await db.from('document_extraction_proposal').delete().eq('document_id', docId)
  await db.from('document_extraction_run').delete().eq('id', runId)
  await db.from('documents').delete().eq('id', docId)
  await db.from('tracked_point_member').delete().eq('tracked_point_id', pointId)
  await db.from('tracked_point').delete().eq('site_id', siteId)
  if (siteId) await db.from('sites').delete().eq('id', siteId)
  if (clientId) await db.from('clients').delete().eq('id', clientId)
})

describe('tracked_point_pending_trace_evidence — invariants (migration 394)', () => {
  it('rejette resolved + 0 ligne evidence (cohérence différée parent→enfant)', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)

    const { error } = await db.from('tracked_point_pending_trace')
      .update({ evidence_status: 'resolved', evidence_basis: 'exact_single_proposal' })
      .eq('id', pendingId)
    expect(error).not.toBeNull()

    const { data: after } = await db.from('tracked_point_pending_trace').select('evidence_status,evidence_basis').eq('id', pendingId).single()
    expect((after as { evidence_status: string }).evidence_status).toBe('unresolved')
  })

  it('rejette unresolved + evidence présente (cohérence différée enfant→parent)', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const proposalId = await makeProposal(threadId)

    const { error } = await db.from('tracked_point_pending_trace_evidence')
      .insert({ pending_trace_id: pendingId, proposal_id: proposalId })
    expect(error).not.toBeNull()

    const { count } = await db.from('tracked_point_pending_trace_evidence')
      .select('*', { count: 'exact', head: true }).eq('pending_trace_id', pendingId)
    expect(count).toBe(0)
  })

  it('rejette un lien proposal dupliqué (PK composite)', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const proposalId = await makeProposal(threadId)

    const { data: rpcData, error: rpcErr } = await db.rpc('resolve_pending_trace_evidence', {
      p_pending_trace_id: pendingId, p_proposal_ids: [proposalId], p_evidence_basis: 'exact_single_proposal',
    })
    expect(rpcErr).toBeNull()
    expect((rpcData as { result: string }).result).toBe('resolved')

    const { error: dupErr } = await db.from('tracked_point_pending_trace_evidence')
      .insert({ pending_trace_id: pendingId, proposal_id: proposalId })
    expect(dupErr).not.toBeNull()

    const { count } = await db.from('tracked_point_pending_trace_evidence')
      .select('*', { count: 'exact', head: true }).eq('pending_trace_id', pendingId)
    expect(count).toBe(1)
  })

  it('rejette une proposition d\'un AUTRE thread que celui de la pending trace (garde immédiate, via le writer RPC)', async () => {
    const db = createAdminClient()
    const threadA = randomUUID()
    const threadB = randomUUID()
    const pendingId = await makePendingTrace(threadA)
    const otherProposalId = await makeProposal(threadB)

    const { error } = await db.rpc('resolve_pending_trace_evidence', {
      p_pending_trace_id: pendingId, p_proposal_ids: [otherProposalId], p_evidence_basis: 'exact_single_proposal',
    })
    expect(error).not.toBeNull()
    expect(String(error?.message)).toMatch(/n'appartient pas au thread/)

    const { data: after } = await db.from('tracked_point_pending_trace').select('evidence_status').eq('id', pendingId).single()
    expect((after as { evidence_status: string }).evidence_status).toBe('unresolved')
  })

  it('rejette également l\'insertion directe (hors RPC) d\'une preuve d\'un autre thread', async () => {
    const db = createAdminClient()
    const threadA = randomUUID()
    const threadB = randomUUID()
    const pendingId = await makePendingTrace(threadA)
    const otherProposalId = await makeProposal(threadB)

    const { error } = await db.from('tracked_point_pending_trace_evidence')
      .insert({ pending_trace_id: pendingId, proposal_id: otherProposalId })
    expect(error).not.toBeNull()
    expect(String(error?.message)).toMatch(/n'appartient pas au thread/)
  })

  it('writer resolve_pending_trace_evidence : chemin nominal, fige exactement les propositions demandées, idempotent au rejeu', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId, `${TAG} p1`)
    const p2 = await makeProposal(threadId, `${TAG} p2`)

    const { data: rpcData, error: rpcErr } = await db.rpc('resolve_pending_trace_evidence', {
      p_pending_trace_id: pendingId, p_proposal_ids: [p1, p2], p_evidence_basis: 'whole_thread_proven_safe',
    })
    expect(rpcErr).toBeNull()
    expect((rpcData as { result: string; evidenceCount: number }).result).toBe('resolved')
    expect((rpcData as { evidenceCount: number }).evidenceCount).toBe(2)

    const { data: parent } = await db.from('tracked_point_pending_trace').select('evidence_status,evidence_basis').eq('id', pendingId).single()
    expect((parent as { evidence_status: string }).evidence_status).toBe('resolved')
    expect((parent as { evidence_basis: string }).evidence_basis).toBe('whole_thread_proven_safe')

    const { data: evidence } = await db.from('tracked_point_pending_trace_evidence').select('proposal_id').eq('pending_trace_id', pendingId)
    const evidenceIds = (evidence as { proposal_id: string }[]).map((r) => r.proposal_id).sort()
    expect(evidenceIds).toEqual([p1, p2].sort())

    // Rejeu identique (même basis, même jeu de propositions) — idempotent, pas d'erreur.
    const { data: replay, error: replayErr } = await db.rpc('resolve_pending_trace_evidence', {
      p_pending_trace_id: pendingId, p_proposal_ids: [p1, p2], p_evidence_basis: 'whole_thread_proven_safe',
    })
    expect(replayErr).toBeNull()
    expect((replay as { result: string }).result).toBe('already_resolved')

    const { count } = await db.from('tracked_point_pending_trace_evidence')
      .select('*', { count: 'exact', head: true }).eq('pending_trace_id', pendingId)
    expect(count).toBe(2)
  })

  it('refuse de re-résoudre une pending trace déjà résolue avec un jeu de preuves différent', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    const p2 = await makeProposal(threadId)

    const first = await db.rpc('resolve_pending_trace_evidence', {
      p_pending_trace_id: pendingId, p_proposal_ids: [p1], p_evidence_basis: 'exact_single_proposal',
    })
    expect(first.error).toBeNull()

    const second = await db.rpc('resolve_pending_trace_evidence', {
      p_pending_trace_id: pendingId, p_proposal_ids: [p2], p_evidence_basis: 'exact_single_proposal',
    })
    expect(second.error).not.toBeNull()

    const { count } = await db.from('tracked_point_pending_trace_evidence')
      .select('*', { count: 'exact', head: true }).eq('pending_trace_id', pendingId)
    expect(count).toBe(1)
  })
})

describe('tracked_point_pending_trace_evidence — isolation vis-à-vis du read-model du Point (6E.3B.1)', () => {
  it('insérer une pending trace unresolved ne change jamais loadTrackedPointReadModel', async () => {
    const before = await loadTrackedPointReadModel(siteId)
    const threadId = randomUUID()
    await makePendingTrace(threadId)
    const after = await loadTrackedPointReadModel(siteId)
    expect(after).toEqual(before)
  })

  it('résoudre une pending trace via le writer RPC (evidence persistée) ne change jamais loadTrackedPointReadModel', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const proposalId = await makeProposal(threadId)

    const before = await loadTrackedPointReadModel(siteId)

    const { error } = await db.rpc('resolve_pending_trace_evidence', {
      p_pending_trace_id: pendingId, p_proposal_ids: [proposalId], p_evidence_basis: 'exact_single_proposal',
    })
    expect(error).toBeNull()

    const after = await loadTrackedPointReadModel(siteId)
    expect(after).toEqual(before)
  })

  it('contraste : seul un vrai tracked_point_member HARD fait évoluer la projection', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const before = await loadTrackedPointReadModel(siteId)

    const { error: memberErr } = await db.from('tracked_point_member').insert({
      tracked_point_id: pointId, subject_thread_id: threadId, scope: 'thread',
      resolution_source: 'manual',
    })
    expect(memberErr).toBeNull()

    const after = await loadTrackedPointReadModel(siteId)
    expect(after).not.toEqual(before)
    const point = after.points.find((p) => p.id === pointId)
    expect(point?.hardMemberThreadIds).toContain(threadId)

    await db.from('tracked_point_member').delete().eq('tracked_point_id', pointId).eq('subject_thread_id', threadId)
  })
})
