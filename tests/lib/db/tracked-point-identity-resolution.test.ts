// Test d'INTÉGRATION (vraie Supabase) — fermeture humaine de IDENTITY_UNRESOLVED après rejet de
// tous les candidats (mandat Vincent), wrapper lib/db/tracked-point-identity-resolution.ts + RPC
// associate_identity_trace_to_point / create_point_from_identity_trace (migration 404).
//
// PRÉPARÉ, NON EXÉCUTÉ CE LOT — même convention que le Témoin 26 (tracked-point-trace-
// acceptance.test.ts) : la migration 404 est écrite mais explicitement NON appliquée cette
// session (mandat Vincent). Les deux RPC qu'il matérialise n'existent donc pas encore en base ;
// exécuter ce fichier avant l'application échouerait sur des erreurs Postgres "function does not
// exist", pas sur un vrai défaut du wrapper. À exécuter dès que la migration 404 est appliquée.
//
// Couvre les scénarios exigés par Vincent : dernier candidat rejeté → entrée encore visible
// (couvert côté pur par tests/lib/knowledge/tracked-point-trace-queue.test.ts, pas re-testé en
// intégration ici) ; association libre réussie → membership + pending resolved ; rejeu même
// cible → idempotent ; site différent → refusé ; création de Point → 1 Point PROVISIONAL + 1
// membership + pending resolved ; rejeu de création → pas de doublon ; aucun changement d'état
// métier non lié ne survient du seul fait de corriger l'identité.
//
// Micro-fix post-review (Vincent) : un candidat encore status='pending' sur le thread source doit
// refuser les deux gestes libres (CANDIDATES_STILL_PENDING, aucune écriture) ; une fois tous les
// candidats du thread rejetés, le comportement normal (succès) reste inchangé — non-régression.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { associateIdentityTraceToPoint, createPointFromIdentityTrace } from '@/lib/db/tracked-point-identity-resolution'

const TAG = `__test_p6_identity_unresolved_${Math.floor(Date.now() / 1000)}__`

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

async function makeCandidate(overrides: Record<string, unknown>, targetSiteId: string = siteId) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_identity_candidate')
    .insert({ site_id: targetSiteId, subject_thread_id: randomUUID(), scope: 'thread', reason: 'test', ...overrides })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function makePendingTrace(overrides: Record<string, unknown>, targetSiteId: string = siteId) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_pending_trace')
    .insert({ site_id: targetSiteId, source_thread_id: randomUUID(), kind: 'IDENTITY_UNRESOLVED', reason: 'test', ...overrides })
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

async function makeProposal(subjectThreadId: string, documentId: string, extractionRunId: string, label: string) {
  const db = createAdminClient()
  const { error } = await db
    .from('document_extraction_proposal')
    .insert({
      organization_id: orgId, extraction_run_id: extractionRunId, document_id: documentId,
      proposal_family: 'observation', label, subject_thread_id: subjectThreadId,
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
  await db.from('tracked_point_identity_candidate').delete().in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point_pending_trace').delete().in('site_id', [siteId, otherSiteId])
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

describe('associateIdentityTraceToPoint', () => {
  it('INVALID_PENDING_TRACE_ID sur un id mal formé', async () => {
    const target = await makePoint()
    const result = await associateIdentityTraceToPoint({ siteId, pendingTraceId: 'not-a-uuid', targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_PENDING_TRACE_ID')
  })

  it('PENDING_TRACE_NOT_FOUND sur un id inexistant', async () => {
    const target = await makePoint()
    const result = await associateIdentityTraceToPoint({ siteId, pendingTraceId: randomUUID(), targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('PENDING_TRACE_NOT_FOUND')
  })

  it('SITE_MISMATCH : pending trace d\'un autre site que celui demandé', async () => {
    const target = await makePoint({}, otherSiteId)
    const pendingId = await makePendingTrace({}, otherSiteId)
    const result = await associateIdentityTraceToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('SITE_MISMATCH')
  })

  it('ABORT : target d\'un site différent de la pending trace (cross-site réel, même appelant)', async () => {
    const target = await makePoint({}, otherSiteId)
    const pendingId = await makePendingTrace({}, siteId)
    const result = await associateIdentityTraceToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/ABORT|SITE_MISMATCH/)
  })

  it('CANDIDATES_STILL_PENDING : au moins un candidat pending sur le thread → association libre refusée, aucune écriture (micro-fix Vincent)', async () => {
    const db = createAdminClient()
    const threadX = randomUUID()
    const target = await makePoint()
    const candidateTarget = await makePoint()
    const pendingId = await makePendingTrace({ source_thread_id: threadX })
    await makeCandidate({ candidate_point_id: candidateTarget, subject_thread_id: threadX })

    const result = await associateIdentityTraceToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/CANDIDATES_STILL_PENDING/)

    const { data: pendingRow } = await db.from('tracked_point_pending_trace').select('status').eq('id', pendingId).single()
    expect((pendingRow as { status: string }).status).toBe('pending')

    const { data: members } = await db.from('tracked_point_member').select('id').eq('tracked_point_id', target).eq('subject_thread_id', threadX)
    expect(members ?? []).toHaveLength(0)
  })

  it('après rejet de tous les candidats du thread → association libre inchangée (succès normal, micro-fix non régressif)', async () => {
    const threadX = randomUUID()
    const target = await makePoint()
    const candidateTarget = await makePoint()
    const pendingId = await makePendingTrace({ source_thread_id: threadX })
    const candId = await makeCandidate({ candidate_point_id: candidateTarget, subject_thread_id: threadX })
    const db = createAdminClient()
    await db.from('tracked_point_identity_candidate').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', candId)

    const result = await associateIdentityTraceToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès : plus aucun candidat pending')
    expect(result.result).toBe('associated')
  })

  it('succès : association libre à un Point existant → +1 membership HARD, pending resolved ; rejeu même cible → idempotent', async () => {
    const db = createAdminClient()
    const threadX = randomUUID()
    const target = await makePoint()
    const pendingId = await makePendingTrace({ source_thread_id: threadX })

    const result = await associateIdentityTraceToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.result).toBe('associated')
    expect(result.membershipInserted).toBe(true)
    expect(result.targetPointId).toBe(target)
    expect(result.sourceThreadId).toBe(threadX)

    const { data: pendingRow } = await db
      .from('tracked_point_pending_trace')
      .select('status, target_point_id, resolved_at')
      .eq('id', pendingId)
      .single()
    const row = pendingRow as { status: string; target_point_id: string; resolved_at: string | null }
    expect(row.status).toBe('resolved')
    expect(row.target_point_id).toBe(target)
    expect(row.resolved_at).toBeTruthy()

    const { data: members } = await db
      .from('tracked_point_member')
      .select('id, status, scope, evidence_grade, resolution_source')
      .eq('tracked_point_id', target)
      .eq('subject_thread_id', threadX)
    expect(members).toHaveLength(1)
    const m = (members as Array<{ status: string; scope: string; evidence_grade: string; resolution_source: string }>)[0]
    expect(m.status).toBe('active')
    expect(m.scope).toBe('thread')
    expect(m.evidence_grade).toBe('HARD')

    // Rejeu même cible : idempotent, 0 nouvelle membership.
    const replay = await associateIdentityTraceToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error('attendu un succès idempotent')
    expect(replay.result).toBe('already_resolved')
    expect(replay.membershipInserted).toBe(false)

    const { data: membersAfterReplay } = await db
      .from('tracked_point_member')
      .select('id')
      .eq('tracked_point_id', target)
      .eq('subject_thread_id', threadX)
    expect(membersAfterReplay).toHaveLength(1)
  })

  it('TARGET_MISMATCH : rejeu sur une cible différente de celle déjà résolue est refusé explicitement, jamais silencieux', async () => {
    const target = await makePoint()
    const otherTarget = await makePoint()
    const pendingId = await makePendingTrace({})

    const first = await associateIdentityTraceToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(first.ok).toBe(true)

    const result = await associateIdentityTraceToPoint({ siteId, pendingTraceId: pendingId, targetPointId: otherTarget })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/TARGET_MISMATCH/)
  })

  it('n\'affecte aucun autre Point/pending trace du site (aucun changement d\'état métier non lié)', async () => {
    const db = createAdminClient()
    const target = await makePoint()
    const untouchedPoint = await makePoint()
    const untouchedPending = await makePendingTrace({})
    const pendingId = await makePendingTrace({})

    const result = await associateIdentityTraceToPoint({ siteId, pendingTraceId: pendingId, targetPointId: target })
    expect(result.ok).toBe(true)

    const { data: untouchedPointRow } = await db.from('tracked_point').select('status').eq('id', untouchedPoint).single()
    expect((untouchedPointRow as { status: string }).status).toBe('active')

    const { data: untouchedPendingRow } = await db
      .from('tracked_point_pending_trace')
      .select('status, target_point_id')
      .eq('id', untouchedPending)
      .single()
    const row = untouchedPendingRow as { status: string; target_point_id: string | null }
    expect(row.status).toBe('pending')
    expect(row.target_point_id).toBeNull()
  })
})

describe('createPointFromIdentityTrace', () => {
  it('INVALID_PENDING_TRACE_ID sur un id mal formé', async () => {
    const result = await createPointFromIdentityTrace({ siteId, pendingTraceId: 'not-a-uuid' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_PENDING_TRACE_ID')
  })

  it('PENDING_TRACE_NOT_FOUND sur un id inexistant', async () => {
    const result = await createPointFromIdentityTrace({ siteId, pendingTraceId: randomUUID() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('PENDING_TRACE_NOT_FOUND')
  })

  it('SITE_MISMATCH : pending trace d\'un autre site', async () => {
    const pendingId = await makePendingTrace({}, otherSiteId)
    const result = await createPointFromIdentityTrace({ siteId, pendingTraceId: pendingId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('SITE_MISMATCH')
  })

  it('CANDIDATES_STILL_PENDING : au moins un candidat pending sur le thread → création libre refusée, aucun Point créé (micro-fix Vincent)', async () => {
    const db = createAdminClient()
    const threadX = randomUUID()
    const { documentId, extractionRunId } = await makeDocumentAndRun()
    await makeProposal(threadX, documentId, extractionRunId, `${TAG} label candidates-still-pending`)
    const candidateTarget = await makePoint()
    const pendingId = await makePendingTrace({ source_thread_id: threadX })
    await makeCandidate({ candidate_point_id: candidateTarget, subject_thread_id: threadX })

    const result = await createPointFromIdentityTrace({ siteId, pendingTraceId: pendingId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/CANDIDATES_STILL_PENDING/)

    const { data: pendingRow } = await db.from('tracked_point_pending_trace').select('status').eq('id', pendingId).single()
    expect((pendingRow as { status: string }).status).toBe('pending')

    const { data: pointsCreated } = await db.from('tracked_point').select('id').eq('founding_kind', 'manual').eq('founding_reference', pendingId)
    expect(pointsCreated ?? []).toHaveLength(0)
  })

  it('après rejet de tous les candidats du thread → création libre inchangée (succès normal, micro-fix non régressif)', async () => {
    const db = createAdminClient()
    const threadX = randomUUID()
    const { documentId, extractionRunId } = await makeDocumentAndRun()
    await makeProposal(threadX, documentId, extractionRunId, `${TAG} label rejected-candidate`)
    const candidateTarget = await makePoint()
    const pendingId = await makePendingTrace({ source_thread_id: threadX })
    const candId = await makeCandidate({ candidate_point_id: candidateTarget, subject_thread_id: threadX })
    await db.from('tracked_point_identity_candidate').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', candId)

    const result = await createPointFromIdentityTrace({ siteId, pendingTraceId: pendingId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès : plus aucun candidat pending')
    expect(result.result).toBe('created')
  })

  it('succès : crée exactement 1 Point PROVISIONAL + 1 membership HARD, pending resolved ; rejeu → pas de doublon', async () => {
    const db = createAdminClient()
    const threadX = randomUUID()
    const { documentId, extractionRunId } = await makeDocumentAndRun()
    await makeProposal(threadX, documentId, extractionRunId, `${TAG} label`)
    const pendingId = await makePendingTrace({ source_thread_id: threadX })

    const result = await createPointFromIdentityTrace({ siteId, pendingTraceId: pendingId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.result).toBe('created')
    expect(result.pointCreated).toBe(true)
    expect(result.membershipInserted).toBe(true)
    const newPointId = result.targetPointId

    const { data: pointRow } = await db
      .from('tracked_point')
      .select('id, status, identity_status, founding_kind, founding_source, founding_reference')
      .eq('id', newPointId)
      .single()
    const p = pointRow as { status: string; identity_status: string; founding_kind: string; founding_reference: string }
    expect(p.status).toBe('active')
    expect(p.identity_status).toBe('PROVISIONAL')
    expect(p.founding_kind).toBe('manual')
    expect(p.founding_reference).toBe(pendingId)

    const { data: members } = await db
      .from('tracked_point_member')
      .select('id, status, scope, evidence_grade')
      .eq('tracked_point_id', newPointId)
      .eq('subject_thread_id', threadX)
    expect(members).toHaveLength(1)

    const { data: pendingRow } = await db
      .from('tracked_point_pending_trace')
      .select('status, target_point_id')
      .eq('id', pendingId)
      .single()
    const pr = pendingRow as { status: string; target_point_id: string }
    expect(pr.status).toBe('resolved')
    expect(pr.target_point_id).toBe(newPointId)

    // Rejeu : déjà résolu → idempotent, 0 nouveau Point créé.
    const replay = await createPointFromIdentityTrace({ siteId, pendingTraceId: pendingId })
    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error('attendu un succès idempotent')
    expect(replay.result).toBe('already_resolved')
    expect(replay.pointCreated).toBe(false)
    expect(replay.targetPointId).toBe(newPointId)

    const { data: pointsAfterReplay } = await db
      .from('tracked_point')
      .select('id')
      .eq('founding_kind', 'manual')
      .eq('founding_reference', pendingId)
    expect(pointsAfterReplay).toHaveLength(1)
  })

  it('LABEL_SOURCE_MISSING : aucune proposition sur le thread → refusé explicitement, aucun Point créé', async () => {
    const db = createAdminClient()
    const pendingId = await makePendingTrace({})

    const result = await createPointFromIdentityTrace({ siteId, pendingTraceId: pendingId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/LABEL_SOURCE_MISSING/)

    const { data: pointsCreated } = await db
      .from('tracked_point')
      .select('id')
      .eq('founding_kind', 'manual')
      .eq('founding_reference', pendingId)
    expect(pointsCreated ?? []).toHaveLength(0)
  })

  it('n\'affecte aucun autre Point/pending trace du site (aucun changement d\'état métier non lié)', async () => {
    const db = createAdminClient()
    const threadX = randomUUID()
    const { documentId, extractionRunId } = await makeDocumentAndRun()
    await makeProposal(threadX, documentId, extractionRunId, `${TAG} label 2`)
    const untouchedPoint = await makePoint()
    const untouchedPending = await makePendingTrace({})
    const pendingId = await makePendingTrace({ source_thread_id: threadX })

    const result = await createPointFromIdentityTrace({ siteId, pendingTraceId: pendingId })
    expect(result.ok).toBe(true)

    const { data: untouchedPointRow } = await db.from('tracked_point').select('status').eq('id', untouchedPoint).single()
    expect((untouchedPointRow as { status: string }).status).toBe('active')

    const { data: untouchedPendingRow } = await db
      .from('tracked_point_pending_trace')
      .select('status, target_point_id')
      .eq('id', untouchedPending)
      .single()
    const row = untouchedPendingRow as { status: string; target_point_id: string | null }
    expect(row.status).toBe('pending')
    expect(row.target_point_id).toBeNull()
  })
})
