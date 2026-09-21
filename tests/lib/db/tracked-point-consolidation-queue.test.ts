// Test d'INTÉGRATION (vraie Supabase) — mandat Vincent P0 Needs-you (2026-09-22), soft-delete de
// document sur loadConsolidationQueue (lib/knowledge/tracked-point-consolidation-queue.ts).
//
// La paire de Points elle-même n'est JAMAIS exclue par le cycle de vie d'un document (seule sa
// propre logique — STALE_PAIR/ALREADY_CONSOLIDATED côté RPC — peut la retirer) : ce test couvre
// uniquement l'amputation de la liste de preuves (proofs/proofCount) d'un côté de la paire quand
// la preuve retenue est portée par un document soft-supprimé (loadPointProofsByPointId).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { loadConsolidationQueue } from '@/lib/knowledge/tracked-point-consolidation-queue'

const TAG = `__test_p0needsyou_consolidation_queue_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let docId: string
let runId: string
const extraDocumentIds: string[] = []
const extraRunIds: string[] = []
const pointIds: string[] = []
const candidateIds: string[] = []

function pairIdOf(a: string, b: string): string {
  return [a, b].sort().join('~')
}

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

async function makeHardMember(trackedPointId: string, subjectThreadId: string) {
  const db = createAdminClient()
  const { error } = await db.from('tracked_point_member').insert({
    tracked_point_id: trackedPointId, subject_thread_id: subjectThreadId, scope: 'thread',
    status: 'active', evidence_grade: 'HARD', resolution_source: 'manual',
  })
  if (error) throw error
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
  if (pointIds.length > 0) {
    await db.from('tracked_point_member').delete().in('tracked_point_id', pointIds)
    await db.from('tracked_point').delete().in('id', pointIds)
  }
  await db.from('document_extraction_proposal').delete().eq('document_id', docId)
  if (extraDocumentIds.length > 0) await db.from('document_extraction_proposal').delete().in('document_id', extraDocumentIds)
  if (extraRunIds.length > 0) await db.from('document_extraction_run').delete().in('id', extraRunIds)
  if (extraDocumentIds.length > 0) await db.from('documents').delete().in('id', extraDocumentIds)
  await db.from('document_extraction_run').delete().eq('id', runId)
  await db.from('documents').delete().eq('id', docId)
  await db.from('sites').delete().eq('id', siteId)
  await db.from('clients').delete().eq('id', clientId)
})

describe('loadConsolidationQueue — soft-delete de document (mandat Vincent P0 Needs-you, 2026-09-22)', () => {
  it('garde la paire mais amène proofs=[] côté A quand son unique preuve porte sur un document soft-supprimé', async () => {
    const threadX = randomUUID()
    const proofThreadId = randomUUID()
    const a = await makePoint()
    const b = await makePoint({ founding_kind: 'trackable_condition', founding_reference: threadX })
    await makeCandidate(a, threadX)
    await makeHardMember(a, proofThreadId)
    await makeSoftDeletedDocumentProposal(proofThreadId)

    const queue = await loadConsolidationQueue(siteId)
    const entry = queue.entries.find((e) => e.pairId === pairIdOf(a, b))
    expect(entry).toBeDefined()
    const sideA = entry?.pointA.id === a ? entry?.pointA : entry?.pointB
    expect(sideA?.proofs).toEqual([])
    expect(sideA?.proofCount).toBe(0)
  })

  it('garde la preuve active et exclut seulement celle du document soft-supprimé', async () => {
    const threadX = randomUUID()
    const proofThreadId = randomUUID()
    const a = await makePoint()
    const b = await makePoint({ founding_kind: 'trackable_condition', founding_reference: threadX })
    await makeCandidate(a, threadX)
    await makeHardMember(a, proofThreadId)
    const activeProposalId = await makeProposal(proofThreadId)
    await makeSoftDeletedDocumentProposal(proofThreadId)

    const queue = await loadConsolidationQueue(siteId)
    const entry = queue.entries.find((e) => e.pairId === pairIdOf(a, b))
    expect(entry).toBeDefined()
    const sideA = entry?.pointA.id === a ? entry?.pointA : entry?.pointB
    expect(sideA?.proofCount).toBe(1)
    expect(sideA?.proofs.map((p) => p.proposalId)).toEqual([activeProposalId])
  })
})
