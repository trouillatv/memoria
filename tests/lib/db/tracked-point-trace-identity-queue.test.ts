// Test d'INTÉGRATION (vraie Supabase) — mandat Vincent P0 Needs-you (2026-09-22), soft-delete de
// document sur loadTraceIdentityQueue (lib/knowledge/tracked-point-trace-queue.ts).
//
// Contrairement aux autres files (evidenceScope/trackability/resolution/consolidation), TRACE
// n'exclut JAMAIS une entrée source ni une cible sur la seule base du cycle de vie d'un document
// (cf. commentaire du fix, tracked-point-trace-queue.ts ligne ~393) : seule la métadonnée
// d'affichage (sourceDocumentFilename/sourceLabel/sourceExcerpt) issue d'une proposition portée
// par un document soft-supprimé est écartée — une autre proposition active du même thread prend
// le relais si elle existe.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { loadTraceIdentityQueue } from '@/lib/knowledge/tracked-point-trace-queue'

const TAG = `__test_p0needsyou_trace_identity_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let docId: string
let runId: string
const extraDocumentIds: string[] = []
const extraRunIds: string[] = []
const candidateIds: string[] = []
const pointIds: string[] = []

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

describe('loadTraceIdentityQueue — soft-delete de document (mandat Vincent P0 Needs-you, 2026-09-22)', () => {
  it('garde l\'entrée source et sa cible visibles quand l\'unique proposition porte sur un document soft-supprimé (métadonnée d\'affichage vidée, jamais la décision)', async () => {
    const threadId = randomUUID()
    const target = await makePoint()
    await makeCandidate(target, threadId)
    await makeSoftDeletedDocumentProposal(threadId)

    const queue = await loadTraceIdentityQueue(siteId)
    const entry = queue.entries.find((e) => e.sourceThreadId === threadId)
    expect(entry).toBeDefined()
    expect(entry?.targetCount).toBe(1)
    expect(entry?.targets[0].actionability).toBe('ACTIONABLE')
    expect(entry?.sourceDocumentFilename).toBeNull()
    expect(entry?.sourceLabel).toBeNull()
    expect(entry?.sourceExcerpt).toBeNull()
  })

  it('affiche la métadonnée de la proposition active restante, ignore celle du document soft-supprimé', async () => {
    const threadId = randomUUID()
    const target = await makePoint()
    await makeCandidate(target, threadId)
    await makeProposal(threadId, `${TAG} label actif`)
    await makeSoftDeletedDocumentProposal(threadId)

    const queue = await loadTraceIdentityQueue(siteId)
    const entry = queue.entries.find((e) => e.sourceThreadId === threadId)
    expect(entry).toBeDefined()
    expect(entry?.targetCount).toBe(1)
    expect(entry?.sourceDocumentFilename).toBe('active.pdf')
    expect(entry?.sourceLabel).toBe(`${TAG} label actif`)
  })
})
