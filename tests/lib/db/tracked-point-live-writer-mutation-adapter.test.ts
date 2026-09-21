// P0-A (mandat Vincent, root cause "mutation canonique tardive non signalée") — témoin du
// pattern SSI (thread 68bfc2f7-3c26-4a63-9f0b-cb59b74bddcc) : une mutation canonique
// (attachToCanonicalBusinessObject) qui rattache/crée un CBO doit remonter le thread réellement
// impacté dans le périmètre de réconciliation du Live Writer (critère #2), via le moteur
// EXISTANT (critère #1) — jamais `CBO.tracked_point_id IS NULL → création forcée d'un Point`.
//
// Le résultat attendu sur SSI n'est PAS "créer un nouveau Point" (critère #8) : un thread déjà
// membre actif d'un Point existant doit ENRICHIR ce Point (write_pattern ENRICH_EXISTING_POINT,
// migration 401 lignes 419-441), jamais fonder un quatrième quasi-doublon.
//
// Conventions reprises de tracked-point-live-writer-historical-adapter.test.ts (TAG,
// beforeAll/afterAll org→client→site, children-before-parents en cleanup).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  reconcileTrackedPointAfterCanonicalMutation,
  reconcileTrackedPointMutationBestEffort,
  replayPendingTrackedPointReconcileFailures,
} from '@/lib/db/tracked-point-live-writer-mutation-adapter'

const TAG = `__test_p6_mutation_adapter_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string

const createdRunIds: string[] = []
const createdDocIds: string[] = []

async function makeDocAndRun(): Promise<{ docId: string; runId: string }> {
  const db = createAdminClient()
  const doc = await db
    .from('documents')
    .insert({
      organization_id: orgId,
      document_type: 'historical_visit_report',
      storage_path: `${TAG}/${randomUUID()}.pdf`,
      filename: 'x.pdf',
    })
    .select('id')
    .single()
  if (doc.error) throw doc.error
  const docId = (doc.data as { id: string }).id

  const run = await db
    .from('document_extraction_run')
    .insert({ organization_id: orgId, document_id: docId, extractor_key: 'test' })
    .select('id')
    .single()
  if (run.error) throw run.error
  const runId = (run.data as { id: string }).id

  createdDocIds.push(docId)
  createdRunIds.push(runId)
  return { docId, runId }
}

async function makeProposal(runId: string, docId: string, threadId: string, overrides: Record<string, unknown> = {}) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('document_extraction_proposal')
    .insert({
      organization_id: orgId,
      extraction_run_id: runId,
      document_id: docId,
      proposal_family: 'decision',
      label: `${TAG} proposal`,
      subject_thread_id: threadId,
      ...overrides,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function makeMaterialization(proposalId: string, entityType: string, entityId: string) {
  const db = createAdminClient()
  const { error } = await db.from('document_proposal_materialization').insert({
    organization_id: orgId,
    proposal_id: proposalId,
    target_entity_type: entityType,
    target_entity_id: entityId,
  })
  if (error) throw error
}

async function makeCanonicalSubject(label: string) {
  const db = createAdminClient()
  const { data, error } = await db.from('canonical_subject').insert({ site_id: siteId, label }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function makePoint(overrides: Record<string, unknown> = {}) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point')
    .insert({ site_id: siteId, label: `${TAG} point`, founding_kind: 'manual', seed_source: 'manual', ...overrides })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function linkActiveMemberThread(pointId: string, threadId: string) {
  const db = createAdminClient()
  const { error } = await db.from('tracked_point_member').insert({ tracked_point_id: pointId, subject_thread_id: threadId })
  if (error) throw error
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

async function makeCbo(entityType: string, entityId: string, overrides: Record<string, unknown> = {}) {
  const db = createAdminClient()
  const cbo = await db
    .from('canonical_business_object')
    .insert({ site_id: siteId, object_type: entityType, label: `${TAG} cbo`, ...overrides })
    .select('id')
    .single()
  if (cbo.error) throw cbo.error
  const cboId = (cbo.data as { id: string }).id

  const member = await db
    .from('canonical_business_object_member')
    .insert({ canonical_business_object_id: cboId, member_entity_type: entityType, member_entity_id: entityId })
  if (member.error) throw member.error

  return cboId
}

async function getCboTrackedPointId(cboId: string) {
  const db = createAdminClient()
  const { data } = await db.from('canonical_business_object').select('tracked_point_id').eq('id', cboId).maybeSingle()
  return (data as { tracked_point_id: string | null } | null)?.tracked_point_id ?? null
}

async function getReconcileEvents(sourceRefId: string) {
  const db = createAdminClient()
  const { data } = await db
    .from('tracked_point_reconcile_event')
    .select('verdict, write_pattern, target_point_id, source_kind, replayed')
    .eq('source_ref_id', sourceRefId)
    .order('occurred_at', { ascending: true })
  return (data ?? []) as Array<{
    verdict: string
    write_pattern: string
    target_point_id: string | null
    source_kind: string
    replayed: boolean
  }>
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

  const { data: events } = await db.from('tracked_point_reconcile_event').select('id').eq('site_id', siteId)
  const eventIds = ((events ?? []) as Array<{ id: string }>).map((e) => e.id)
  if (eventIds.length > 0) {
    await db.from('tracked_point_reconcile_artifact').delete().in('reconcile_event_id', eventIds)
  }
  await db.from('tracked_point_reconcile_event').delete().eq('site_id', siteId)
  await db.from('tracked_point_reconcile_state').delete().eq('site_id', siteId)

  const { data: pts } = await db.from('tracked_point').select('id').eq('site_id', siteId)
  const ptIds = ((pts ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (ptIds.length > 0) {
    await db.from('tracked_point_member').delete().in('tracked_point_id', ptIds)
    await db.from('tracked_point_identity_candidate').delete().in('candidate_point_id', ptIds)
  }
  await db.from('canonical_business_object').update({ tracked_point_id: null }).eq('site_id', siteId)
  await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('site_id', siteId)
  await db.from('tracked_point').delete().eq('site_id', siteId)

  const { data: cbos } = await db.from('canonical_business_object').select('id').eq('site_id', siteId)
  const cboIds = ((cbos ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (cboIds.length > 0) {
    await db.from('canonical_business_object_member').delete().in('canonical_business_object_id', cboIds)
  }
  await db.from('tracked_point_reconcile_failure').delete().eq('site_id', siteId)
  await db.from('canonical_business_object').delete().eq('site_id', siteId)
  await db.from('tracked_point_pending_trace').delete().eq('site_id', siteId)
  await db.from('canonical_subject').delete().eq('site_id', siteId)

  if (createdRunIds.length > 0) {
    await db.from('document_extraction_proposal').delete().in('extraction_run_id', createdRunIds)
    await db.from('document_extraction_run').delete().in('id', createdRunIds)
  }
  if (createdDocIds.length > 0) {
    await db.from('documents').delete().in('id', createdDocIds)
  }
  await db.from('sites').delete().eq('id', siteId)
  await db.from('clients').delete().eq('id', clientId)
})

describe('reconcileTrackedPointAfterCanonicalMutation — entité sans provenance PV', () => {
  it('entité créée manuellement (aucune document_proposal_materialization) → skipped_no_thread, jamais une erreur', async () => {
    const entityId = randomUUID()
    const cboId = await makeCbo('site_action', entityId)

    const result = await reconcileTrackedPointAfterCanonicalMutation({
      siteId,
      entityType: 'site_action',
      entityId,
      canonicalBusinessObjectId: cboId,
    })

    expect(result).toEqual({ kind: 'skipped_no_thread' })
    expect(await getCboTrackedPointId(cboId)).toBeNull()
  })
})

describe('reconcileTrackedPointAfterCanonicalMutation — pattern SSI (thread déjà membre actif d’un Point existant)', () => {
  it('1 sibling actif sur le thread → AUTO_LINKED/ENRICH_EXISTING_POINT, jamais un 4e quasi-doublon (critères #7/#8)', async () => {
    const label = `${TAG} ssi pattern`
    const subjectId = await makeCanonicalSubject(label)
    const pointId = await makePoint({ label, canonical_subject_id: subjectId, founding_kind: 'trackable_condition', identity_status: 'PROVISIONAL' })

    const { docId, runId } = await makeDocAndRun()
    const threadId = randomUUID()
    const proposalId = await makeProposal(runId, docId, threadId, { label })
    await linkActiveMemberThread(pointId, threadId)

    const entityId = randomUUID()
    await makeMaterialization(proposalId, 'site_action', entityId)
    const cboId = await makeCbo('site_action', entityId, { canonical_subject_id: subjectId, label })

    const result = await reconcileTrackedPointAfterCanonicalMutation({
      siteId,
      entityType: 'site_action',
      entityId,
      canonicalBusinessObjectId: cboId,
    })

    expect(result.kind).toBe('reconciled')
    if (result.kind !== 'reconciled') throw new Error('unreachable')
    expect(result.threadId).toBe(threadId)
    expect(result.unitsProcessed).toBe(1)
    expect(result.refusals).toBe(0)
    expect(result.verdictCounts.AUTO_LINKED).toBe(1)
    expect(result.verdictCounts.AUTO_CREATED ?? 0).toBe(0)

    // Pas de doublon : le thread reste à exactement 1 membre actif (ENRICH_EXISTING_POINT
    // n'insère jamais de tracked_point_member, migration 401 ligne 757-759).
    expect(await countActiveMembersOnThread(threadId)).toBe(1)
    // Le CBO est désormais rattaché au Point PRÉEXISTANT — aucun nouveau Point fondé.
    expect(await getCboTrackedPointId(cboId)).toBe(pointId)

    const events = await getReconcileEvents(cboId)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      verdict: 'AUTO_LINKED',
      write_pattern: 'ENRICH_EXISTING_POINT',
      target_point_id: pointId,
      source_kind: 'canonical_mutation',
      replayed: false,
    })
  })

  it('rejeu de la même mutation → idempotent, aucun doublon (critères #3/#4)', async () => {
    const label = `${TAG} ssi replay`
    // Deux appels reconcile (2 RPC + plusieurs inserts de fixture) contre la vraie base :
    // au-delà du testTimeout par défaut (5000ms) sous charge réseau normale.
    const subjectId = await makeCanonicalSubject(label)
    const pointId = await makePoint({ label, canonical_subject_id: subjectId, founding_kind: 'trackable_condition', identity_status: 'PROVISIONAL' })

    const { docId, runId } = await makeDocAndRun()
    const threadId = randomUUID()
    const proposalId = await makeProposal(runId, docId, threadId, { label })
    await linkActiveMemberThread(pointId, threadId)

    const entityId = randomUUID()
    await makeMaterialization(proposalId, 'site_action', entityId)
    const cboId = await makeCbo('site_action', entityId, { canonical_subject_id: subjectId, label })

    const params = { siteId, entityType: 'site_action' as const, entityId, canonicalBusinessObjectId: cboId }
    const first = await reconcileTrackedPointAfterCanonicalMutation(params)
    expect(first.kind).toBe('reconciled')
    if (first.kind !== 'reconciled') throw new Error('unreachable')
    expect(first.verdictCounts.AUTO_LINKED).toBe(1)

    const second = await reconcileTrackedPointAfterCanonicalMutation(params)
    expect(second.kind).toBe('reconciled')
    if (second.kind !== 'reconciled') throw new Error('unreachable')
    expect(second.refusals).toBe(0)

    expect(await countActiveMembersOnThread(threadId)).toBe(1)
    expect(await getCboTrackedPointId(cboId)).toBe(pointId)

    const events = await getReconcileEvents(cboId)
    expect(events).toHaveLength(2)
    expect(events[1].write_pattern).toBe('NOOP')
    expect(events[1].replayed).toBe(true)
    expect(events[1].target_point_id).toBe(pointId)
  }, 15000)
})

describe('reconcileTrackedPointAfterCanonicalMutation — 0 sibling sur le thread', () => {
  it('aucun Point déjà rattaché à ce thread → AUTO_CREATED (le moteur n’enrichit pas à l’aveugle)', async () => {
    const label = `${TAG} aucun sibling`
    const subjectId = await makeCanonicalSubject(label)

    const { docId, runId } = await makeDocAndRun()
    const threadId = randomUUID()
    const proposalId = await makeProposal(runId, docId, threadId, { label })

    const entityId = randomUUID()
    await makeMaterialization(proposalId, 'site_action', entityId)
    const cboId = await makeCbo('site_action', entityId, { canonical_subject_id: subjectId, label })

    const result = await reconcileTrackedPointAfterCanonicalMutation({
      siteId,
      entityType: 'site_action',
      entityId,
      canonicalBusinessObjectId: cboId,
    })

    expect(result.kind).toBe('reconciled')
    if (result.kind !== 'reconciled') throw new Error('unreachable')
    expect(result.verdictCounts.AUTO_CREATED).toBe(1)

    const newPointId = await getCboTrackedPointId(cboId)
    expect(newPointId).not.toBeNull()

    const events = await getReconcileEvents(cboId)
    expect(events[0]).toMatchObject({
      verdict: 'AUTO_CREATED',
      write_pattern: 'CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK',
      source_kind: 'canonical_mutation',
    })
  })
})

// P0-A (suite REVIEW Vincent 2026-09-21) — "best-effort" ne persistait rien en cas d'échec
// (scénario (c) confirmé par l'audit). Ces tests protègent le filet de second niveau
// (tracked_point_reconcile_failure, migration 426) plutôt que d'engineerer artificiellement un
// refus RPC : la mécanique réelle à garantir est persistance/résolution/seuil de rejeu.
describe('tracked_point_reconcile_failure — filet de second niveau', () => {
  async function insertFailure(entityId: string, cboId: string, lastAttemptAt: string) {
    const db = createAdminClient()
    const { error } = await db.from('tracked_point_reconcile_failure').insert({
      site_id: siteId,
      entity_type: 'site_action',
      entity_id: entityId,
      canonical_business_object_id: cboId,
      error: 'refus RPC simulé pour le test',
      last_attempt_at: lastAttemptAt,
    })
    if (error) throw error
  }

  async function getFailure(entityId: string) {
    const db = createAdminClient()
    const { data } = await db
      .from('tracked_point_reconcile_failure')
      .select('resolved_at, attempt_count')
      .eq('entity_id', entityId)
      .maybeSingle()
    return data as { resolved_at: string | null; attempt_count: number } | null
  }

  it('rejeu d\'une entité sans provenance PV (skipped_no_thread) → résolue, jamais une boucle infinie', async () => {
    const entityId = randomUUID()
    const cboId = await makeCbo('site_action', entityId)
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await insertFailure(entityId, cboId, old)

    const outcome = await replayPendingTrackedPointReconcileFailures(50, 15 * 60 * 1000)

    expect(outcome.found).toBeGreaterThanOrEqual(1)
    expect(outcome.resolved).toBeGreaterThanOrEqual(1)
    const row = await getFailure(entityId)
    expect(row?.resolved_at).not.toBeNull()
  })

  it('une tentative trop récente (< seuil) n\'est pas rejouée — jamais concurrent avec un best-effort en vol', async () => {
    const entityId = randomUUID()
    const cboId = await makeCbo('site_action', entityId)
    const recent = new Date().toISOString()
    await insertFailure(entityId, cboId, recent)

    await replayPendingTrackedPointReconcileFailures(50, 15 * 60 * 1000)

    const row = await getFailure(entityId)
    expect(row?.resolved_at).toBeNull()
  })

  it('reconcileTrackedPointMutationBestEffort en succès ne laisse aucune trace d\'échec résiduelle', async () => {
    const entityId = randomUUID()
    const cboId = await makeCbo('site_action', entityId)

    await reconcileTrackedPointMutationBestEffort({
      siteId,
      entityType: 'site_action',
      entityId,
      canonicalBusinessObjectId: cboId,
    })

    const row = await getFailure(entityId)
    expect(row).toBeNull()
  })
})
