// Test d'INTÉGRATION (vraie Supabase) — Phase 6E.3C.1, productisation de la sélection humaine
// de portée de preuve (evidence scope) sur les pending traces unresolved.
//
// Geste modélisé : "dans ce thread, voici précisément les propositions qui constituent
// l'information dont MemorIA parle" — jamais "il faut suivre ceci", jamais "cela résout ce
// Point". resolvePendingEvidenceScope (lib/db/tracked-point-pending-evidence-scope.ts) est un
// wrapper au-dessus de la RPC resolve_pending_trace_evidence (migration 394, déjà pilotée en
// 6E.3B.1) : aucune migration 397, la RPC porte déjà l'écriture atomique et le trigger de garde
// de thread. Ce wrapper ajoute uniquement : status='pending' live (la RPC ignore cette colonne),
// rejet des doublons d'IDs (la RPC les déduplique en silence), et un code structuré
// EVIDENCE_ALREADY_RESOLVED_DIFFERENT_SCOPE (la RPC lève une exception libre non structurée).
//
// Couvre les 12 scénarios exigés par Vincent : validation d'entrée (vide/doublons/hors
// thread/inexistant), revalidation live (déjà résolue même jeu vs. jeu différent/dismissed),
// concurrence (exactement une résolution gagne), transition automatique et sans synchronisation
// manuelle vers les deux files déjà existantes (confirm_pending_trackability pour
// TRACKABILITY_UNDETERMINED ; loadPendingResolutionQueue pour RESOLUTION_WITHOUT_KNOWN_PROBLEM),
// et l'isolation absolue vis-à-vis de loadTrackedPointReadModel. Complète avec une couverture
// minimale du nouveau read-model loadEvidenceScopeQueue (lib/knowledge/tracked-point-evidence-
// scope-queue.ts).
//
// Zéro donnée réelle : uniquement des threads/propositions/pending traces synthétiques créés et
// nettoyés par ce fichier. 6E.3C.2 (1 pilote réel sur les 165) reste un HARD STOP séparé.
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'
import { loadPendingResolutionQueue } from '@/lib/knowledge/tracked-point-pending-resolution-queue'
import { loadEvidenceScopeQueue } from '@/lib/knowledge/tracked-point-evidence-scope-queue'
import { resolvePendingEvidenceScope } from '@/lib/db/tracked-point-pending-evidence-scope'

const TAG = `__test_6e3c1_evidence_scope_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let otherSiteId: string
let docId: string
let runId: string
let adminUserId: string
const pendingTraceIds: string[] = []
const proposalIds: string[] = []

async function makePendingTrace(threadId: string, kind = 'RESOLUTION_WITHOUT_KNOWN_PROBLEM', targetSiteId: string = siteId) {
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
  await db.from('tracked_point_pending_trace_evidence').delete().in('pending_trace_id', pendingTraceIds.length > 0 ? pendingTraceIds : [randomUUID()])
  await db.from('tracked_point_pending_trace').delete().in('site_id', [siteId, otherSiteId])
  await db.from('document_extraction_proposal').delete().eq('document_id', docId)
  await db.from('document_extraction_run').delete().eq('id', runId)
  await db.from('documents').delete().eq('id', docId)
  if (otherSiteId) await db.from('sites').delete().eq('id', otherSiteId)
  if (siteId) await db.from('sites').delete().eq('id', siteId)
  if (clientId) await db.from('clients').delete().eq('id', clientId)
})

describe('resolvePendingEvidenceScope — validation d\'entrée', () => {
  it('rejette une liste de propositions vide (INVALID_PROPOSAL_IDS_EMPTY)', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [] })
    expect(result).toEqual({ ok: false, error: 'INVALID_PROPOSAL_IDS_EMPTY' })
  })

  it('rejette des IDs de proposition dupliqués (INVALID_PROPOSAL_IDS_DUPLICATE)', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1, p1] })
    expect(result).toEqual({ ok: false, error: 'INVALID_PROPOSAL_IDS_DUPLICATE' })

    const { count } = await createAdminClient().from('tracked_point_pending_trace_evidence')
      .select('*', { count: 'exact', head: true }).eq('pending_trace_id', pendingId)
    expect(count).toBe(0)
  })

  it('rejette un pendingTraceId au format invalide', async () => {
    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: 'not-a-uuid', proposalIds: [randomUUID()] })
    expect(result).toEqual({ ok: false, error: 'INVALID_PENDING_TRACE_ID' })
  })

  it('rejette un proposalId au format invalide', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: ['not-a-uuid'] })
    expect(result).toEqual({ ok: false, error: 'INVALID_PROPOSAL_IDS_FORMAT' })
  })

  it('rejette une pending trace introuvable', async () => {
    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: randomUUID(), proposalIds: [randomUUID()] })
    expect(result).toEqual({ ok: false, error: 'PENDING_TRACE_NOT_FOUND' })
  })
})

describe('resolvePendingEvidenceScope — revalidation live', () => {
  it('rejette un site différent de celui de la pending trace (SITE_MISMATCH)', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId, 'RESOLUTION_WITHOUT_KNOWN_PROBLEM', otherSiteId)
    const p1 = await makeProposal(threadId)
    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1] })
    expect(result).toEqual({ ok: false, error: 'SITE_MISMATCH' })
  })

  it('rejette une proposition hors du thread source (PROPOSAL_NOT_IN_THREAD)', async () => {
    const threadA = randomUUID()
    const threadB = randomUUID()
    const pendingId = await makePendingTrace(threadA)
    const otherProposalId = await makeProposal(threadB)
    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [otherProposalId] })
    expect(result).toEqual({ ok: false, error: 'PROPOSAL_NOT_IN_THREAD' })

    const { data: after } = await createAdminClient().from('tracked_point_pending_trace').select('evidence_status').eq('id', pendingId).single()
    expect((after as { evidence_status: string }).evidence_status).toBe('unresolved')
  })

  it('rejette une proposition inexistante (PROPOSAL_NOT_FOUND)', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [randomUUID()] })
    expect(result).toEqual({ ok: false, error: 'PROPOSAL_NOT_FOUND' })
  })

  it('rejette une pending trace dismissed (INVALID_STATUS) — la RPC 394 ignore cette colonne', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)

    const { error: dismissErr } = await db.from('tracked_point_pending_trace')
      .update({ status: 'dismissed', resolved_at: new Date().toISOString(), resolved_by: adminUserId })
      .eq('id', pendingId)
    expect(dismissErr).toBeNull()

    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1] })
    expect(result).toEqual({ ok: false, error: 'INVALID_STATUS' })

    const { data: after } = await db.from('tracked_point_pending_trace').select('evidence_status').eq('id', pendingId).single()
    expect((after as { evidence_status: string }).evidence_status).toBe('unresolved')
  })
})

describe('resolvePendingEvidenceScope — chemin nominal', () => {
  it('1 proposition sélectionnée → resolved / human_selected / 1 ligne d\'evidence', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)

    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1] })
    expect(result).toEqual({
      ok: true, result: 'resolved', pendingTraceId: pendingId, sourceThreadId: threadId,
      evidenceBasis: 'human_selected', evidenceCount: 1,
    })

    const db = createAdminClient()
    const { data: parent } = await db.from('tracked_point_pending_trace').select('evidence_status,evidence_basis').eq('id', pendingId).single()
    expect(parent).toEqual({ evidence_status: 'resolved', evidence_basis: 'human_selected' })

    const { data: evidence } = await db.from('tracked_point_pending_trace_evidence').select('proposal_id').eq('pending_trace_id', pendingId)
    expect((evidence as { proposal_id: string }[]).map((r) => r.proposal_id)).toEqual([p1])
  })

  it('3 propositions sélectionnées → resolved / human_selected / 3 lignes d\'evidence', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId, `${TAG} p1`)
    const p2 = await makeProposal(threadId, `${TAG} p2`)
    const p3 = await makeProposal(threadId, `${TAG} p3`)

    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1, p2, p3] })
    expect(result.ok).toBe(true)
    expect((result as { evidenceCount: number }).evidenceCount).toBe(3)

    const db = createAdminClient()
    const { data: evidence } = await db.from('tracked_point_pending_trace_evidence').select('proposal_id').eq('pending_trace_id', pendingId)
    expect((evidence as { proposal_id: string }[]).map((r) => r.proposal_id).sort()).toEqual([p1, p2, p3].sort())
  })

  it('rejeu identique (même sélection) → already_resolved, aucune nouvelle ligne', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId, `${TAG} p1`)
    const p2 = await makeProposal(threadId, `${TAG} p2`)

    const first = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1, p2] })
    expect(first).toEqual(expect.objectContaining({ ok: true, result: 'resolved', evidenceCount: 2 }))

    const replay = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p2, p1] })
    expect(replay).toEqual({
      ok: true, result: 'already_resolved', pendingTraceId: pendingId, sourceThreadId: threadId,
      evidenceBasis: 'human_selected', evidenceCount: 2,
    })

    const { count } = await createAdminClient().from('tracked_point_pending_trace_evidence')
      .select('*', { count: 'exact', head: true }).eq('pending_trace_id', pendingId)
    expect(count).toBe(2)
  })

  it('scope différent sur une pending déjà résolue (human_selected) → EVIDENCE_ALREADY_RESOLVED_DIFFERENT_SCOPE, aucune écriture', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId, `${TAG} p1`)
    const p2 = await makeProposal(threadId, `${TAG} p2`)

    const first = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1] })
    expect(first).toEqual(expect.objectContaining({ ok: true, result: 'resolved' }))

    const second = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p2] })
    expect(second).toEqual({ ok: false, error: 'EVIDENCE_ALREADY_RESOLVED_DIFFERENT_SCOPE' })

    const db = createAdminClient()
    const { data: evidence } = await db.from('tracked_point_pending_trace_evidence').select('proposal_id').eq('pending_trace_id', pendingId)
    expect((evidence as { proposal_id: string }[]).map((r) => r.proposal_id)).toEqual([p1])
  })

  it('un même jeu de propositions déjà résolu par un basis différent (backfill 394) reste EVIDENCE_ALREADY_RESOLVED_DIFFERENT_SCOPE', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)

    const { error: backfillErr } = await db.rpc('resolve_pending_trace_evidence', {
      p_pending_trace_id: pendingId, p_proposal_ids: [p1], p_evidence_basis: 'exact_single_proposal',
    })
    expect(backfillErr).toBeNull()

    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1] })
    expect(result).toEqual({ ok: false, error: 'EVIDENCE_ALREADY_RESOLVED_DIFFERENT_SCOPE' })
  })
})

describe('resolvePendingEvidenceScope — concurrence', () => {
  it('deux appels simultanés sur la même pending trace → exactement une résolution gagne, 1 seule ligne d\'evidence', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)

    const [r1, r2] = await Promise.allSettled([
      resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1] }),
      resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1] }),
    ])

    expect(r1.status).toBe('fulfilled')
    expect(r2.status).toBe('fulfilled')
    const results = [r1, r2].map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof resolvePendingEvidenceScope>>>).value)
    expect(results.every((r) => r.ok)).toBe(true)
    const outcomes = results.map((r) => (r as { result: string }).result).sort()
    expect(outcomes).toEqual(['already_resolved', 'resolved'])

    const { count } = await createAdminClient().from('tracked_point_pending_trace_evidence')
      .select('*', { count: 'exact', head: true }).eq('pending_trace_id', pendingId)
    expect(count).toBe(1)
  })
})

describe('resolvePendingEvidenceScope — transition automatique vers les files existantes', () => {
  it('TRACKABILITY_UNDETERMINED : EVIDENCE_SCOPE_UNRESOLVED avant résolution, confirm_pending_trackability réussit après', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId, 'TRACKABILITY_UNDETERMINED')
    const p1 = await makeProposal(threadId)

    const before = await db.rpc('confirm_pending_trackability', { p_pending_trace_id: pendingId })
    expect(before.error).not.toBeNull()
    expect(String(before.error?.message)).toMatch(/EVIDENCE_SCOPE_UNRESOLVED/)

    const scopeResult = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1] })
    expect(scopeResult).toEqual(expect.objectContaining({ ok: true, result: 'resolved' }))

    const after = await db.rpc('confirm_pending_trackability', { p_pending_trace_id: pendingId })
    expect(after.error).toBeNull()
    expect((after.data as { result: string; pointCreated: boolean }).result).toBe('confirmed')
    expect((after.data as { pointCreated: boolean }).pointCreated).toBe(true)

    // Nettoyage du Point fondé par ce pilote synthétique — hors du périmètre des pending traces.
    const newPointId = (after.data as { targetPointId: string }).targetPointId
    await db.from('tracked_point_member').delete().eq('tracked_point_id', newPointId)
    await db.from('tracked_point').delete().eq('id', newPointId)
  })

  it('RESOLUTION_WITHOUT_KNOWN_PROBLEM : EVIDENCE_SCOPE_UNRESOLVED/non actionnable avant résolution, calculé/actionnable après', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId, 'RESOLUTION_WITHOUT_KNOWN_PROBLEM')
    const p1 = await makeProposal(threadId)

    const before = await loadPendingResolutionQueue(siteId)
    const beforeEntry = before.entries.find((e) => e.pendingTraceId === pendingId)
    expect(beforeEntry).toBeDefined()
    expect(beforeEntry?.targetingMode).toBe('EVIDENCE_SCOPE_UNRESOLVED')
    expect(beforeEntry?.actionable).toBe(false)

    const scopeResult = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1] })
    expect(scopeResult).toEqual(expect.objectContaining({ ok: true, result: 'resolved' }))

    const after = await loadPendingResolutionQueue(siteId)
    const afterEntry = after.entries.find((e) => e.pendingTraceId === pendingId)
    expect(afterEntry).toBeDefined()
    expect(afterEntry?.targetingMode).not.toBe('EVIDENCE_SCOPE_UNRESOLVED')
    expect(afterEntry?.actionable).toBe(true)
    expect(afterEntry?.evidenceProposalIds).toEqual([p1])
  })
})

describe('resolvePendingEvidenceScope — isolation absolue', () => {
  it('ne change jamais loadTrackedPointReadModel (aucun Point/membership/candidat touché)', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)

    const before = await loadTrackedPointReadModel(siteId)
    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1] })
    expect(result.ok).toBe(true)
    const after = await loadTrackedPointReadModel(siteId)

    expect(after).toEqual(before)
  })

  it('ne change jamais le nombre de tracked_point_member ni de tracked_point_identity_candidate du site', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId)
    const p1 = await makeProposal(threadId)
    const p2 = await makeProposal(threadId, `${TAG} p2`)

    const countMembers = async () => {
      const { data } = await db.from('tracked_point_member').select('id, tracked_point:tracked_point_id(site_id)')
      return (data ?? []).filter((r) => {
        const tp = r.tracked_point as unknown as { site_id: string } | { site_id: string }[] | null
        const tpSiteId = Array.isArray(tp) ? tp[0]?.site_id : tp?.site_id
        return tpSiteId === siteId
      }).length
    }
    const countCandidates = async () => {
      const { count } = await db.from('tracked_point_identity_candidate').select('*', { count: 'exact', head: true }).eq('site_id', siteId)
      return count ?? 0
    }

    const membersBefore = await countMembers()
    const candidatesBefore = await countCandidates()

    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1, p2] })
    expect(result.ok).toBe(true)

    expect(await countMembers()).toBe(membersBefore)
    expect(await countCandidates()).toBe(candidatesBefore)
  })
})

describe('loadEvidenceScopeQueue — read-model de sélection (6E.3C.1)', () => {
  it('expose exactement les propositions du thread source d\'une pending trace unresolved, jamais celles d\'un autre thread', async () => {
    const threadA = randomUUID()
    const threadB = randomUUID()
    const pendingId = await makePendingTrace(threadA, 'RESOLUTION_WITHOUT_KNOWN_PROBLEM')
    const pA1 = await makeProposal(threadA, `${TAG} a1`)
    const pA2 = await makeProposal(threadA, `${TAG} a2`)
    await makeProposal(threadB, `${TAG} b1`)

    const queue = await loadEvidenceScopeQueue(siteId)
    const entry = queue.entries.find((e) => e.pendingTraceId === pendingId)
    expect(entry).toBeDefined()
    expect(entry?.kind).toBe('RESOLUTION_WITHOUT_KNOWN_PROBLEM')
    expect(entry?.sourceThreadId).toBe(threadA)
    expect(entry?.proposalCount).toBe(2)
    expect(entry?.proposals.map((p) => p.proposalId).sort()).toEqual([pA1, pA2].sort())
    expect(entry?.proposals.every((p) => p.alreadySelected === false)).toBe(true)
  })

  it('exclut une pending trace dès que son evidence_status devient resolved', async () => {
    const threadId = randomUUID()
    const pendingId = await makePendingTrace(threadId, 'RESOLUTION_WITHOUT_KNOWN_PROBLEM')
    const p1 = await makeProposal(threadId)

    const before = await loadEvidenceScopeQueue(siteId)
    expect(before.entries.some((e) => e.pendingTraceId === pendingId)).toBe(true)

    const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId: pendingId, proposalIds: [p1] })
    expect(result.ok).toBe(true)

    const after = await loadEvidenceScopeQueue(siteId)
    expect(after.entries.some((e) => e.pendingTraceId === pendingId)).toBe(false)
  })
})
