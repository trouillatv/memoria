// Test d'INTÉGRATION (vraie Supabase) — Phase 6E.2B, wrapper
// lib/db/tracked-point-trace-acceptance.ts + RPC accept_trace_identity_candidate (migration 393).
//
// Couvre les 7 scénarios exigés par Vincent : stale source (devenue Point↔Point) / target
// merged / cross-site / candidate rejected / candidate accepted (succès) / duplicate-rejeu
// (idempotence) / source non-safe (NEEDS_SCOPE_REFINEMENT). HARD STOP : ce test ne couvre QUE
// la primitive — aucune UI, aucun traitement en masse.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { acceptTraceIdentityCandidate } from '@/lib/db/tracked-point-trace-acceptance'

const TAG = `__test_6e2b_trace_acceptance_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let otherSiteId: string
const createdDocumentIds: string[] = []
const createdRunIds: string[] = []

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

async function makeDocumentAndRun() {
  const db = createAdminClient()
  const { data: doc, error: docErr } = await db
    .from('documents')
    .insert({ organization_id: orgId, document_type: 'historical_visit_report', storage_path: `${TAG}/x.pdf`, filename: 'x.pdf' })
    .select('id')
    .single()
  if (docErr) throw docErr
  const documentId = (doc as { id: string }).id

  const { data: run, error: runErr } = await db
    .from('document_extraction_run')
    .insert({ organization_id: orgId, document_id: documentId, extractor_key: 'test' })
    .select('id')
    .single()
  if (runErr) throw runErr
  const extractionRunId = (run as { id: string }).id

  createdDocumentIds.push(documentId)
  createdRunIds.push(extractionRunId)
  return { documentId, extractionRunId }
}

async function makeProposal(subjectThreadId: string, proposalFamily: string, documentId: string, extractionRunId: string) {
  const db = createAdminClient()
  const { error } = await db
    .from('document_extraction_proposal')
    .insert({
      organization_id: orgId, extraction_run_id: extractionRunId, document_id: documentId,
      proposal_family: proposalFamily, label: `${TAG} proposal`, subject_thread_id: subjectThreadId,
    })
  if (error) throw error
}

beforeAll(async () => {
  const db = createAdminClient()
  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

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

  const { data: site2, error: sErr2 } = await db
    .from('sites')
    .insert({ name: `${TAG}site2`, client_id: clientId, organization_id: orgId })
    .select('id').single()
  if (sErr2) throw sErr2
  otherSiteId = (site2 as { id: string }).id
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('tracked_point_identity_candidate').delete().eq('site_id', siteId)
  const { data: pts } = await db.from('tracked_point').select('id').in('site_id', [siteId, otherSiteId])
  const ptIds = ((pts ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (ptIds.length > 0) {
    await db.from('tracked_point_member').delete().in('tracked_point_id', ptIds)
  }
  await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point').delete().in('site_id', [siteId, otherSiteId])
  if (createdRunIds.length > 0) {
    await db.from('document_extraction_proposal').delete().in('extraction_run_id', createdRunIds)
    await db.from('document_extraction_run').delete().in('id', createdRunIds)
  }
  if (createdDocumentIds.length > 0) {
    await db.from('documents').delete().in('id', createdDocumentIds)
  }
  await db.from('sites').delete().in('id', [siteId, otherSiteId])
  await db.from('clients').delete().eq('id', clientId)
})

describe('acceptTraceIdentityCandidate', () => {
  it('INVALID_CANDIDATE_ID sur un id mal formé', async () => {
    const result = await acceptTraceIdentityCandidate({ siteId, candidateId: 'not-a-uuid' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_CANDIDATE_ID')
  })

  it('CANDIDATE_NOT_FOUND sur un id inexistant', async () => {
    const result = await acceptTraceIdentityCandidate({ siteId, candidateId: randomUUID() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('CANDIDATE_NOT_FOUND')
  })

  it('STALE_NOW_POINT_TO_POINT : source devenue fondatrice d\'un AUTRE point depuis la pose du candidat', async () => {
    const threadX = randomUUID()
    const target = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: target, subject_thread_id: threadX, scope: 'thread' })
    // La source devient fondatrice d'un point tiers APRÈS la création du candidat.
    await makePoint({ founding_kind: 'trackable_condition', founding_reference: threadX })

    const result = await acceptTraceIdentityCandidate({ siteId, candidateId: cand })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/STALE_NOW_POINT_TO_POINT/)
  })

  it('STALE_TARGET : target mergé entre la pose du candidat et l\'acceptation', async () => {
    const db = createAdminClient()
    const threadX = randomUUID()
    const { documentId, extractionRunId } = await makeDocumentAndRun()
    await makeProposal(threadX, 'observation', documentId, extractionRunId)
    const target = await makePoint()
    const mergedInto = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: target, subject_thread_id: threadX, scope: 'thread' })

    await db.from('tracked_point').update({ status: 'merged', merged_into_id: mergedInto }).eq('id', target)

    const result = await acceptTraceIdentityCandidate({ siteId, candidateId: cand })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/status=merged|STALE_TARGET/)

    await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('id', target)
  })

  it('SITE_MISMATCH cross-site : candidat d\'un autre site que celui demandé', async () => {
    const otherPoint = await makePoint({}, otherSiteId)
    const db = createAdminClient()
    const { data, error } = await db
      .from('tracked_point_identity_candidate')
      .insert({ site_id: otherSiteId, candidate_point_id: otherPoint, subject_thread_id: randomUUID(), scope: 'thread', reason: 'test' })
      .select('id').single()
    if (error) throw error
    const cand = (data as { id: string }).id

    const result = await acceptTraceIdentityCandidate({ siteId, candidateId: cand })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('SITE_MISMATCH')
  })

  it('candidate rejected : la RPC refuse explicitement (status ≠ pending)', async () => {
    const db = createAdminClient()
    const target = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: target, subject_thread_id: randomUUID(), scope: 'thread' })
    await db.from('tracked_point_identity_candidate').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', cand)

    const result = await acceptTraceIdentityCandidate({ siteId, candidateId: cand })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/pending/)
  })

  it('NEEDS_SCOPE_REFINEMENT : thread portant 2 proposal_family distinctes — abort avant la RPC', async () => {
    const threadX = randomUUID()
    const { documentId, extractionRunId } = await makeDocumentAndRun()
    await makeProposal(threadX, 'action', documentId, extractionRunId)
    await makeProposal(threadX, 'decision', documentId, extractionRunId)
    const target = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: target, subject_thread_id: threadX, scope: 'thread' })

    const result = await acceptTraceIdentityCandidate({ siteId, candidateId: cand })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/NEEDS_SCOPE_REFINEMENT/)
  })

  it('succès : SAFE_SINGLE_TRACE_THREAD → +1 membership HARD, candidate accepted ; rejeu → ALREADY_ASSOCIATED sans 2e écriture', async () => {
    const db = createAdminClient()
    const threadX = randomUUID()
    const { documentId, extractionRunId } = await makeDocumentAndRun()
    await makeProposal(threadX, 'observation', documentId, extractionRunId)
    const target = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: target, subject_thread_id: threadX, scope: 'thread' })

    const result = await acceptTraceIdentityCandidate({ siteId, candidateId: cand })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.alreadyAssociated).toBe(false)
    expect(result.targetPointId).toBe(target)
    expect(result.sourceThreadId).toBe(threadX)

    const { data: candRow } = await db.from('tracked_point_identity_candidate').select('status').eq('id', cand).single()
    expect((candRow as { status: string }).status).toBe('accepted')

    const { data: members } = await db
      .from('tracked_point_member')
      .select('id, status, scope, evidence_grade')
      .eq('tracked_point_id', target)
      .eq('subject_thread_id', threadX)
    expect(members).toHaveLength(1)
    expect((members as Array<{ status: string; scope: string; evidence_grade: string }>)[0].status).toBe('active')
    expect((members as Array<{ status: string; scope: string; evidence_grade: string }>)[0].scope).toBe('thread')
    expect((members as Array<{ status: string; scope: string; evidence_grade: string }>)[0].evidence_grade).toBe('HARD')

    // Rejeu (duplicate) : même candidate_id, déjà accepted → ALREADY_ASSOCIATED, 0 nouvelle ligne.
    const replay = await acceptTraceIdentityCandidate({ siteId, candidateId: cand })
    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error('attendu un succès idempotent')
    expect(replay.alreadyAssociated).toBe(true)
    expect(replay.targetPointId).toBe(target)

    const { data: membersAfterReplay } = await db
      .from('tracked_point_member')
      .select('id')
      .eq('tracked_point_id', target)
      .eq('subject_thread_id', threadX)
    expect(membersAfterReplay).toHaveLength(1)
  })
})
