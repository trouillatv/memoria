// Test d'INTÉGRATION (vraie Supabase) — Phase 6E.3B.2, wrapper
// lib/db/tracked-point-pending-trackability.ts + RPC confirm_pending_trackability (migration
// 395, déjà couverte au niveau RPC par tests/lib/db/tracked-point-confirm-trackability.test.ts)
// et read-model lib/knowledge/tracked-point-pending-trackability-queue.ts (arbitrage 6E.4A
// point 3 de Vincent : construire l'application layer manquante autour de la RPC déjà testée,
// 0 nouvelle logique métier).
//
// Ce fichier ne re-teste PAS les guards métier de la RPC (déjà prouvés) : il couvre uniquement
// ce que le wrapper ajoute (validation de format, SITE_MISMATCH, traduction des guards) et le
// nouveau read-model (entrées visibles/actionnables, exclusion STALE_ALREADY_TRACKED, dismiss
// réutilisé tel quel depuis tracked-point-pending-resolution.ts).
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { confirmPendingTrackability } from '@/lib/db/tracked-point-pending-trackability'
import { dismissPendingTrace, deferPendingTrace } from '@/lib/db/tracked-point-pending-resolution'
import { loadPendingTrackabilityQueue } from '@/lib/knowledge/tracked-point-pending-trackability-queue'

const TAG = `__test_6e3b2_pending_trackability_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let otherSiteId: string
let adminUserId: string
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

async function resolveEvidence(pendingId: string, proposalIds: string[]) {
  const db = createAdminClient()
  const { error } = await db.rpc('resolve_pending_trace_evidence', {
    p_pending_trace_id: pendingId, p_proposal_ids: proposalIds, p_evidence_basis: 'exact_single_proposal',
  })
  if (error) throw error
}

beforeAll(async () => {
  const db = createAdminClient()

  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  const { data: admin } = await db.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  if (!admin) throw new Error('Aucun admin — seed requis')
  adminUserId = (admin as { id: string }).id

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
  await db.from('document_extraction_proposal').delete().eq('document_id', docId)
  await db.from('document_extraction_run').delete().eq('id', runId)
  await db.from('documents').delete().eq('id', docId)
  await db.from('sites').delete().in('id', [siteId, otherSiteId])
  await db.from('clients').delete().eq('id', clientId)
})

describe('confirmPendingTrackability — validation d\'entrée et autorisation', () => {
  it('INVALID_PENDING_TRACE_ID sur un id mal formé', async () => {
    const result = await confirmPendingTrackability({ siteId, pendingTraceId: 'not-a-uuid' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_PENDING_TRACE_ID')
  })

  it('PENDING_TRACE_NOT_FOUND sur un id inexistant', async () => {
    const result = await confirmPendingTrackability({ siteId, pendingTraceId: randomUUID() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('PENDING_TRACE_NOT_FOUND')
  })

  it('SITE_MISMATCH : la pending trace appartient à un autre site que celui autorisé', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId, 'TRACKABILITY_UNDETERMINED', otherSiteId)
    const result = await confirmPendingTrackability({ siteId, pendingTraceId: pendingId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('SITE_MISMATCH')
  })
})

describe('confirmPendingTrackability — traduction des guards portés par la RPC (395)', () => {
  it('EVIDENCE_SCOPE_UNRESOLVED passe telle quelle', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const result = await confirmPendingTrackability({ siteId, pendingTraceId: pendingId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('EVIDENCE_SCOPE_UNRESOLVED')
  })

  it('INVALID_KIND passe telle quelle (RESOLUTION_WITHOUT_KNOWN_PROBLEM hors périmètre)', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId, 'RESOLUTION_WITHOUT_KNOWN_PROBLEM')
    const result = await confirmPendingTrackability({ siteId, pendingTraceId: pendingId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_KIND')
  })
})

describe('confirmPendingTrackability — chemin nominal + idempotence (au niveau wrapper)', () => {
  it('succès : Point PROVISIONAL créé, pending → resolved ; rejeu → already_resolved', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId, `${TAG} label attendu`)
    await resolveEvidence(pendingId, [p1])

    const result = await confirmPendingTrackability({ siteId, pendingTraceId: pendingId })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('attendu un succès')
    expect(result.result).toBe('confirmed')
    expect(result.pointCreated).toBe(true)
    expect(result.membershipInserted).toBe(true)
    expect(result.label).toBe(`${TAG} label attendu`)

    const replay = await confirmPendingTrackability({ siteId, pendingTraceId: pendingId })
    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error('attendu un succès idempotent')
    expect(replay.result).toBe('already_resolved')
    expect(replay.targetPointId).toBe(result.targetPointId)
    expect(replay.pointCreated).toBe(false)
    expect(replay.membershipInserted).toBe(false)

    const { count: pointCount } = await db.from('tracked_point').select('*', { count: 'exact', head: true }).eq('founding_reference', pendingId)
    expect(pointCount).toBe(1)
  })
})

describe('loadPendingTrackabilityQueue — read-model de file (6E.3B.2)', () => {
  it('expose une entrée non actionnable (evidence_status unresolved), jamais filtrée', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    await makeProposal(threadId, `${TAG} source`)

    const queue = await loadPendingTrackabilityQueue(siteId)
    const entry = queue.entries.find((e) => e.pendingTraceId === pendingId)
    expect(entry).toBeDefined()
    expect(entry?.evidenceStatus).toBe('unresolved')
    expect(entry?.actionable).toBe(false)
  })

  it('devient actionnable dès que resolvePendingEvidenceScope a figé la portée de preuve', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)

    const before = await loadPendingTrackabilityQueue(siteId)
    expect(before.entries.find((e) => e.pendingTraceId === pendingId)?.actionable).toBe(false)

    await resolveEvidence(pendingId, [p1])

    const after = await loadPendingTrackabilityQueue(siteId)
    const entry = after.entries.find((e) => e.pendingTraceId === pendingId)
    expect(entry?.actionable).toBe(true)
    expect(entry?.evidenceProposalIds).toEqual([p1])
  })

  it('exclut une pending trace STALE_ALREADY_TRACKED (thread déjà membre HARD actif d\'un autre Point) et la trace dans excludedAlreadyTracked', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])

    const otherPoint = (await db.from('tracked_point').insert({ site_id: siteId, label: `${TAG} autre point`, founding_kind: 'manual', seed_source: 'manual' }).select('id').single()).data!.id as string
    await db.from('tracked_point_member').insert({ tracked_point_id: otherPoint, subject_thread_id: threadId, scope: 'thread', resolution_source: 'manual' })

    const queue = await loadPendingTrackabilityQueue(siteId)
    expect(queue.entries.some((e) => e.pendingTraceId === pendingId)).toBe(false)
    expect(queue.excludedAlreadyTracked).toContain(pendingId)

    await db.from('tracked_point_member').delete().eq('tracked_point_id', otherPoint)
    await db.from('tracked_point').delete().eq('id', otherPoint)
  })

  it('disparaît de la file dès que confirmPendingTrackability l\'a résolue', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    await resolveEvidence(pendingId, [p1])

    const before = await loadPendingTrackabilityQueue(siteId)
    expect(before.entries.some((e) => e.pendingTraceId === pendingId)).toBe(true)

    const confirmed = await confirmPendingTrackability({ siteId, pendingTraceId: pendingId })
    expect(confirmed.ok).toBe(true)

    const after = await loadPendingTrackabilityQueue(siteId)
    expect(after.entries.some((e) => e.pendingTraceId === pendingId)).toBe(false)
  })
})

describe('dismissPendingTrace réutilisé tel quel pour le geste "Non" (aucune nouvelle fonction dismiss)', () => {
  it('succès : pending TRACKABILITY_UNDETERMINED → dismissed, disparaît de la file', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)

    const before = await loadPendingTrackabilityQueue(siteId)
    expect(before.entries.some((e) => e.pendingTraceId === pendingId)).toBe(true)

    const result = await dismissPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId })
    expect(result.ok).toBe(true)

    const after = await loadPendingTrackabilityQueue(siteId)
    expect(after.entries.some((e) => e.pendingTraceId === pendingId)).toBe(false)
  })
})

// Phase 6E.8A — report temporel. NON EXÉCUTABLE tant que la migration 399
// (deferred_until/deferred_at/deferred_by) n'est pas appliquée à la base réelle : écrit pour
// figer le contrat attendu du prédicat de visibilité partagé (pendingTraceVisibleFilter), une
// fois câblé dans loadPendingTrackabilityQueue.
describe('deferPendingTrace — visibilité de file (prédicat partagé pendingTraceVisibleFilter)', () => {
  it('une trace reportée dans le futur disparaît de la file, sans être dismissed/resolved', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)

    const before = await loadPendingTrackabilityQueue(siteId)
    expect(before.entries.some((e) => e.pendingTraceId === pendingId)).toBe(true)

    const deferred = await deferPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId, durationDays: 7 })
    expect(deferred.ok).toBe(true)

    const after = await loadPendingTrackabilityQueue(siteId)
    expect(after.entries.some((e) => e.pendingTraceId === pendingId)).toBe(false)
    // Toujours 'pending' — un report cache seulement, n'abandonne jamais (à la différence de
    // dismiss juste au-dessus, qui retire définitivement de la file).
    const db = createAdminClient()
    const { data: row } = await db.from('tracked_point_pending_trace').select('status').eq('id', pendingId).single()
    expect((row as { status: string }).status).toBe('pending')
  })

  it('une trace dont le report est déjà expiré reste visible dans la file', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)

    const deferred = await deferPendingTrace({ siteId, pendingTraceId: pendingId, actorUserId: adminUserId, durationDays: 1 })
    expect(deferred.ok).toBe(true)

    // Simule l'écoulement du temps : recule l'échéance dans le passé, exactement ce que la
    // relecture naturelle de la file doit voir sans cron ni polling (mandat Vincent 6E.8A).
    const past = new Date(Date.now() - 60_000).toISOString()
    await db.from('tracked_point_pending_trace').update({ deferred_until: past }).eq('id', pendingId)

    const after = await loadPendingTrackabilityQueue(siteId)
    expect(after.entries.some((e) => e.pendingTraceId === pendingId)).toBe(true)
  })
})
