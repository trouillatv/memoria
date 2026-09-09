// P6 Live Writer — adaptateur historical_pdf (mandat Vincent, câblage inerte).
//
// Couvre le point 7 du mandat pour la partie "exécution" (le point 7 côté flag pur est déjà
// couvert par tracked-point-live-writer-flag.test.ts) : site autorisé → l'adaptateur tourne
// réellement, plusieurs UUID dans l'allowlist sont correctement acceptés, replay sans
// contournement, et sitePoints effectivement fourni aux unités trackable_condition (D1).
// Conventions reprises de tests/lib/db/tracked-point-live-writer.test.ts (TAG, beforeAll/afterAll
// org→client→site(s), children-before-parents en cleanup) — un document+run FRAIS par test ici
// (au lieu d'un run partagé) car le loader de l'adaptateur charge TOUT le run, pas une unité isolée.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { runTrackedPointLiveWriterForHistoricalRun } from '@/lib/db/tracked-point-live-writer-historical-adapter'

const TAG = `__test_p6_hist_adapter_${Math.floor(Date.now() / 1000)}__`
const ENV_KEY = 'TRACKED_POINT_LIVE_WRITER_SITE_IDS'

let orgId: string
let clientId: string
let siteId: string
let otherSiteId: string

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

async function makeProposal(
  runId: string,
  docId: string,
  threadId: string,
  overrides: Record<string, unknown> = {},
) {
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

async function makeCanonicalSubject(targetSiteId: string, label: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('canonical_subject')
    .insert({ site_id: targetSiteId, label })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function linkThreadIdentity(targetSiteId: string, threadId: string, canonicalSubjectId: string) {
  const db = createAdminClient()
  const { error } = await db
    .from('subject_thread_identity')
    .insert({ subject_thread_id: threadId, site_id: targetSiteId, canonical_subject_id: canonicalSubjectId })
  if (error) throw error
}

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
  otherSiteId = (await db.from('sites').insert({ name: `${TAG}site2`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()

  const { data: events } = await db
    .from('tracked_point_reconcile_event')
    .select('id')
    .in('site_id', [siteId, otherSiteId])
  const eventIds = ((events ?? []) as Array<{ id: string }>).map((e) => e.id)
  if (eventIds.length > 0) {
    await db.from('tracked_point_reconcile_artifact').delete().in('reconcile_event_id', eventIds)
  }
  await db.from('tracked_point_reconcile_event').delete().in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point_reconcile_state').delete().in('site_id', [siteId, otherSiteId])

  const { data: pts } = await db.from('tracked_point').select('id').in('site_id', [siteId, otherSiteId])
  const ptIds = ((pts ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (ptIds.length > 0) {
    await db.from('tracked_point_member').delete().in('tracked_point_id', ptIds)
    await db.from('tracked_point_identity_candidate').delete().in('candidate_point_id', ptIds)
  }
  await db.from('canonical_business_object').update({ tracked_point_id: null }).in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point').delete().in('site_id', [siteId, otherSiteId])
  await db.from('canonical_business_object').delete().in('site_id', [siteId, otherSiteId])
  await db.from('tracked_point_pending_trace').delete().in('site_id', [siteId, otherSiteId])
  await db.from('subject_thread_identity').delete().in('site_id', [siteId, otherSiteId])
  await db.from('canonical_subject').delete().in('site_id', [siteId, otherSiteId])

  if (createdRunIds.length > 0) {
    await db.from('document_extraction_proposal').delete().in('extraction_run_id', createdRunIds)
    await db.from('document_extraction_run').delete().in('id', createdRunIds)
  }
  if (createdDocIds.length > 0) {
    await db.from('documents').delete().in('id', createdDocIds)
  }
  await db.from('sites').delete().in('id', [siteId, otherSiteId])
  await db.from('clients').delete().eq('id', clientId)
})

describe('runTrackedPointLiveWriterForHistoricalRun — rollout (allowlist)', () => {
  const originalEnv = process.env[ENV_KEY]

  beforeEach(() => {
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = originalEnv
  })

  it('var absente → writer jamais appelé (null, aucune donnée chargée)', async () => {
    const { runId } = await makeDocAndRun()
    const result = await runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })
    expect(result).toBeNull()
  })

  it('var vide → writer jamais appelé', async () => {
    process.env[ENV_KEY] = ''
    const { runId } = await makeDocAndRun()
    const result = await runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })
    expect(result).toBeNull()
  })

  it('site absent de la liste → writer jamais appelé', async () => {
    process.env[ENV_KEY] = otherSiteId
    const { runId } = await makeDocAndRun()
    const result = await runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })
    expect(result).toBeNull()
  })

  it('configuration invalide (un token non-UUID) → fail-closed, même pour un site par ailleurs valide', async () => {
    process.env[ENV_KEY] = `${siteId},not-a-uuid`
    const { runId } = await makeDocAndRun()
    const result = await runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })
    expect(result).toBeNull()
  })

  it('plusieurs UUID dans la liste → le site présent passe le portail (run sans proposition → 0 unité, pas null)', async () => {
    process.env[ENV_KEY] = `${randomUUID()},${siteId}`
    const { runId } = await makeDocAndRun()
    const result = await runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })
    expect(result).not.toBeNull()
    expect(result).toEqual({ unitsProcessed: 0, verdictCounts: {}, refusals: 0 })
  })
})

describe('runTrackedPointLiveWriterForHistoricalRun — site autorisé, exécution réelle', () => {
  const originalEnv = process.env[ENV_KEY]

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = originalEnv
  })

  it('unité PROVISIONAL (famille decision) → AUTO_CREATED, Point réellement matérialisé (sitePoints vide chargé sans erreur)', async () => {
    process.env[ENV_KEY] = siteId
    const { docId, runId } = await makeDocAndRun()
    const threadId = randomUUID()
    await makeProposal(runId, docId, threadId, { proposal_family: 'decision', label: `${TAG} decision unique` })

    const result = await runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })
    expect(result).not.toBeNull()
    expect(result?.unitsProcessed).toBe(1)
    expect(result?.refusals).toBe(0)
    expect(result?.verdictCounts.AUTO_CREATED).toBe(1)

    expect(await countActiveMembersOnThread(threadId)).toBe(1)
  })

  it('replay du même run → idempotent, ne fait apparaître aucun Point supplémentaire', async () => {
    process.env[ENV_KEY] = siteId
    const { docId, runId } = await makeDocAndRun()
    const threadId = randomUUID()
    await makeProposal(runId, docId, threadId, { proposal_family: 'decision', label: `${TAG} decision replay` })

    const first = await runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })
    expect(first?.verdictCounts.AUTO_CREATED).toBe(1)
    const membersAfterFirst = await countActiveMembersOnThread(threadId)
    expect(membersAfterFirst).toBe(1)

    const second = await runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })
    expect(second).not.toBeNull()
    expect(second?.unitsProcessed).toBe(1)
    expect(second?.refusals).toBe(0)

    // Rejeu : aucune duplication d'appartenance sur le thread, quel que soit le verdict renvoyé.
    expect(await countActiveMembersOnThread(threadId)).toBe(1)
  })

  it('D1 cross-thread : un Point actif déjà fondé sur le même sujet et même label → sitePoints le fait remonter, verdict dégradé (pas AUTO_CREATED)', async () => {
    process.env[ENV_KEY] = siteId
    const label = `${TAG} d1 sujet partagé`

    const subjectId = await makeCanonicalSubject(siteId, label)
    await makePoint({ label, canonical_subject_id: subjectId, founding_kind: 'trackable_condition', identity_status: 'PROVISIONAL' })

    const { docId, runId } = await makeDocAndRun()
    const threadId = randomUUID()
    await linkThreadIdentity(siteId, threadId, subjectId)
    await makeProposal(runId, docId, threadId, { proposal_family: 'decision', label })

    const result = await runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })
    expect(result).not.toBeNull()
    expect(result?.unitsProcessed).toBe(1)
    expect(result?.verdictCounts.AUTO_CREATED ?? 0).toBe(0)
  })

  it('erreur applicative (run inexistant) → l’adaptateur remonte null (document_id non résolu), ne masque rien silencieusement en amont du hook', async () => {
    process.env[ENV_KEY] = siteId
    const result = await runTrackedPointLiveWriterForHistoricalRun({ runId: randomUUID(), siteId })
    expect(result).toBeNull()
  })
})
