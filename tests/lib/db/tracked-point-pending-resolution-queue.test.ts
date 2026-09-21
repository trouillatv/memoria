// Test d'INTÉGRATION (vraie Supabase) — mandat Vincent P0 Needs-you (2026-09-22), soft-delete de
// document sur loadPendingResolutionQueue (lib/knowledge/tracked-point-pending-resolution-queue.ts).
//
// Même doctrine que trackability (tracked-point-pending-trackability-queue.ts) : une preuve
// résolue (tracked_point_pending_trace_evidence) référençant un document depuis soft-supprimé
// est retirée d'evidenceProposalIds, ce qui peut faire basculer targetingMode vers
// EVIDENCE_SCOPE_UNRESOLVED (actionable=false) si c'était la seule preuve.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { loadPendingResolutionQueue } from '@/lib/knowledge/tracked-point-pending-resolution-queue'

const TAG = `__test_p0needsyou_resolution_queue_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let docId: string
let runId: string
const extraDocumentIds: string[] = []
const extraRunIds: string[] = []
const pointIds: string[] = []
const candidateIds: string[] = []
const pendingTraceIds: string[] = []

async function makePoint(overrides: Record<string, unknown> = {}) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point')
    .insert({ site_id: siteId, label: `${TAG} point`, founding_kind: 'manual', seed_source: 'manual', ...overrides })
    .select('id')
    .single()
  if (error) throw error
  const id = (data as { id: string }).id
  pointIds.push(id)
  return id
}

async function makeCandidate(candidatePointId: string, subjectThreadId: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_identity_candidate')
    .insert({ site_id: siteId, candidate_point_id: candidatePointId, subject_thread_id: subjectThreadId, scope: 'thread', reason: 'test' })
    .select('id')
    .single()
  if (error) throw error
  const id = (data as { id: string }).id
  candidateIds.push(id)
  return id
}

async function makePendingTrace(threadId: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_pending_trace')
    .insert({ site_id: siteId, source_thread_id: threadId, kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM', reason: 'test' })
    .select('id')
    .single()
  if (error) throw error
  const id = (data as { id: string }).id
  pendingTraceIds.push(id)
  return id
}

async function makeProposal(threadId: string, label = `${TAG} active`) {
  const db = createAdminClient()
  const { data, error } = await db.from('document_extraction_proposal').insert({
    organization_id: orgId, extraction_run_id: runId, document_id: docId,
    proposal_family: 'observation', label, subject_thread_id: threadId,
  }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function resolveEvidence(pendingId: string, proposalIds: string[]) {
  const db = createAdminClient()
  const { error } = await db.rpc('resolve_pending_trace_evidence', {
    p_pending_trace_id: pendingId, p_proposal_ids: proposalIds, p_evidence_basis: 'exact_single_proposal',
  })
  if (error) throw error
}

async function makeSoftDeletedDocumentProposal(threadId: string, label = `${TAG} deleted-doc proposal`) {
  const db = createAdminClient()
  const { data: doc, error: docErr } = await db.from('documents').insert({
    organization_id: orgId, document_type: 'historical_visit_report', storage_path: `${TAG}/deleted-${randomUUID()}.pdf`, filename: 'deleted.pdf',
  }).select('id').single()
  if (docErr) throw docErr
  const deletedDocId = (doc as { id: string }).id
  extraDocumentIds.push(deletedDocId)

  const { data: run, error: runErr } = await db.from('document_extraction_run').insert({
    organization_id: orgId, document_id: deletedDocId, extractor_key: 'test',
  }).select('id').single()
  if (runErr) throw runErr
  const deletedRunId = (run as { id: string }).id
  extraRunIds.push(deletedRunId)

  const { data, error } = await db.from('document_extraction_proposal').insert({
    organization_id: orgId, extraction_run_id: deletedRunId, document_id: deletedDocId,
    proposal_family: 'observation', label, subject_thread_id: threadId,
  }).select('id').single()
  if (error) throw error
  const id = (data as { id: string }).id

  const { error: delErr } = await db.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', deletedDocId)
  if (delErr) throw delErr

  return id
}

beforeAll(async () => {
  const db = createAdminClient()

  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  docId = (await db.from('documents').insert({ organization_id: orgId, document_type: 'historical_visit_report', storage_path: `${TAG}/active.pdf`, filename: 'active.pdf' }).select('id').single()).data!.id as string
  runId = (await db.from('document_extraction_run').insert({ organization_id: orgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()
  if (candidateIds.length > 0) await db.from('tracked_point_identity_candidate').delete().in('id', candidateIds)
  if (pendingTraceIds.length > 0) await db.from('tracked_point_pending_trace').delete().in('id', pendingTraceIds)
  if (pointIds.length > 0) await db.from('tracked_point').delete().in('id', pointIds)
  await db.from('document_extraction_proposal').delete().eq('document_id', docId)
  if (extraDocumentIds.length > 0) await db.from('document_extraction_proposal').delete().in('document_id', extraDocumentIds)
  if (extraRunIds.length > 0) await db.from('document_extraction_run').delete().in('id', extraRunIds)
  if (extraDocumentIds.length > 0) await db.from('documents').delete().in('id', extraDocumentIds)
  await db.from('document_extraction_run').delete().eq('id', runId)
  await db.from('documents').delete().eq('id', docId)
  await db.from('sites').delete().eq('id', siteId)
  await db.from('clients').delete().eq('id', clientId)
})

describe('loadPendingResolutionQueue — soft-delete de document (mandat Vincent P0 Needs-you, 2026-09-22)', () => {
  it('bascule EVIDENCE_SCOPE_UNRESOLVED/actionable=false quand l\'unique preuve résolue vient d\'un document soft-supprimé', async () => {
    const threadId = randomUUID()
    const target = await makePoint()
    await makeCandidate(target, threadId)
    const pendingId = await makePendingTrace(threadId)
    const deletedProposalId = await makeSoftDeletedDocumentProposal(threadId)
    await resolveEvidence(pendingId, [deletedProposalId])

    const queue = await loadPendingResolutionQueue(siteId)
    const entry = queue.entries.find((e) => e.pendingTraceId === pendingId)
    expect(entry).toBeDefined()
    expect(entry?.evidenceProposalIds).toEqual([])
    expect(entry?.targetingMode).toBe('EVIDENCE_SCOPE_UNRESOLVED')
    expect(entry?.actionable).toBe(false)
  })

  it('garde KNOWN_SINGLE/actionable=true et ne retire que l\'id soft-supprimé quand une autre preuve résolue reste active', async () => {
    const threadId = randomUUID()
    const target = await makePoint()
    await makeCandidate(target, threadId)
    const pendingId = await makePendingTrace(threadId)
    const activeProposalId = await makeProposal(threadId)
    const deletedProposalId = await makeSoftDeletedDocumentProposal(threadId)
    await resolveEvidence(pendingId, [activeProposalId, deletedProposalId])

    const queue = await loadPendingResolutionQueue(siteId)
    const entry = queue.entries.find((e) => e.pendingTraceId === pendingId)
    expect(entry).toBeDefined()
    expect(entry?.evidenceProposalIds).toEqual([activeProposalId])
    expect(entry?.targetingMode).toBe('KNOWN_SINGLE')
    expect(entry?.actionable).toBe(true)
  })
})
