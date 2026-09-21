// P0-B1 (mandat Vincent, 2026-09-21, suite audit P0-B) — filet de résilience pour
// reconcileSubjectThreads (lib/documents/subject-reconciliation.ts, étape 12 de
// lib/documents/extract-historical-pv.ts). Avant ce lot, un échec n'était que journalisé
// (console.error) : le run restait ready_for_review et les propositions concernées gardaient
// subject_thread_id = NULL indéfiniment, invisibles au resolver CBO. Ces tests protègent le
// filet de second niveau (subject_thread_reconcile_failure, migration 427) plutôt que la cause
// historique exacte de l'échec (non reproductible, cf. audit P0-B) : persistance, résolution,
// seuil de rejeu, idempotence.
//
// Conventions reprises de tests/lib/db/tracked-point-live-writer-mutation-adapter.test.ts
// (TAG, beforeAll/afterAll org→client→site, DB réelle via createAdminClient).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  upsertSubjectThreadReconcileFailure,
  resolveSubjectThreadReconcileFailureIfAny,
  replayPendingSubjectThreadReconcileFailures,
} from '@/lib/documents/subject-reconciliation'

const TAG = `__test_p0b1_subject_thread_failure_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string

const createdRunIds: string[] = []
const createdDocIds: string[] = []

async function makeDocAndRun(): Promise<string> {
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
    .insert({ organization_id: orgId, document_id: docId, extractor_key: 'test', target_site_id: siteId })
    .select('id')
    .single()
  if (run.error) throw run.error
  const runId = (run.data as { id: string }).id

  createdDocIds.push(docId)
  createdRunIds.push(runId)
  return runId
}

async function getFailure(runId: string) {
  const db = createAdminClient()
  const { data } = await db
    .from('subject_thread_reconcile_failure')
    .select('attempt_count, resolved_at, last_attempt_at, error')
    .eq('extraction_run_id', runId)
    .maybeSingle()
  return data as { attempt_count: number; resolved_at: string | null; last_attempt_at: string; error: string } | null
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

  await db.from('subject_thread_reconcile_failure').delete().eq('site_id', siteId)
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

describe('upsertSubjectThreadReconcileFailure', () => {
  it('persiste une nouvelle panne avec attempt_count=1', async () => {
    const runId = await makeDocAndRun()
    await upsertSubjectThreadReconcileFailure({ extractionRunId: runId, siteId, error: 'boom' })

    const row = await getFailure(runId)
    expect(row).not.toBeNull()
    expect(row?.attempt_count).toBe(1)
    expect(row?.resolved_at).toBeNull()
    expect(row?.error).toBe('boom')
  })

  it('un second appel sur le même run met à jour la même ligne (upsert), jamais un doublon', async () => {
    const runId = await makeDocAndRun()
    await upsertSubjectThreadReconcileFailure({ extractionRunId: runId, siteId, error: 'first' })
    await upsertSubjectThreadReconcileFailure({ extractionRunId: runId, siteId, error: 'second' })

    const db = createAdminClient()
    const { count } = await db
      .from('subject_thread_reconcile_failure')
      .select('id', { count: 'exact', head: true })
      .eq('extraction_run_id', runId)
    expect(count).toBe(1)

    const row = await getFailure(runId)
    expect(row?.attempt_count).toBe(2)
    expect(row?.error).toBe('second')
  })

  it('un nouvel échec après résolution rouvre la panne (resolved_at remis à null)', async () => {
    const runId = await makeDocAndRun()
    await upsertSubjectThreadReconcileFailure({ extractionRunId: runId, siteId, error: 'first' })
    await resolveSubjectThreadReconcileFailureIfAny(runId)
    expect((await getFailure(runId))?.resolved_at).not.toBeNull()

    await upsertSubjectThreadReconcileFailure({ extractionRunId: runId, siteId, error: 'again' })
    const row = await getFailure(runId)
    expect(row?.resolved_at).toBeNull()
    expect(row?.attempt_count).toBe(2)
  })
})

describe('resolveSubjectThreadReconcileFailureIfAny', () => {
  it('marque résolue une panne persistée', async () => {
    const runId = await makeDocAndRun()
    await upsertSubjectThreadReconcileFailure({ extractionRunId: runId, siteId, error: 'boom' })

    await resolveSubjectThreadReconcileFailureIfAny(runId)

    const row = await getFailure(runId)
    expect(row?.resolved_at).not.toBeNull()
  })

  it('aucune panne existante → no-op, jamais une erreur', async () => {
    const runId = await makeDocAndRun()
    await expect(resolveSubjectThreadReconcileFailureIfAny(runId)).resolves.toBeUndefined()
    expect(await getFailure(runId)).toBeNull()
  })
})

describe('replayPendingSubjectThreadReconcileFailures', () => {
  it('rejoue un run sans proposition orpheline (reconcileSubjectThreads no-op) → résolue, jamais une boucle infinie', async () => {
    const runId = await makeDocAndRun()
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await upsertSubjectThreadReconcileFailure({ extractionRunId: runId, siteId, error: 'boom' })
    // Recule artificiellement last_attempt_at pour dépasser le seuil de rejeu.
    const db = createAdminClient()
    await db.from('subject_thread_reconcile_failure').update({ last_attempt_at: old }).eq('extraction_run_id', runId)

    const outcome = await replayPendingSubjectThreadReconcileFailures(50, 15 * 60 * 1000)

    expect(outcome.found).toBeGreaterThanOrEqual(1)
    expect(outcome.resolved).toBeGreaterThanOrEqual(1)
    const row = await getFailure(runId)
    expect(row?.resolved_at).not.toBeNull()
  })

  it('une tentative trop récente (< seuil) n\'est pas rejouée — jamais concurrent avec un appel en vol', async () => {
    const runId = await makeDocAndRun()
    await upsertSubjectThreadReconcileFailure({ extractionRunId: runId, siteId, error: 'boom' })

    await replayPendingSubjectThreadReconcileFailures(50, 15 * 60 * 1000)

    const row = await getFailure(runId)
    expect(row?.resolved_at).toBeNull()
  })

  it('un run déjà résolu n\'est plus jamais resélectionné par un rejeu suivant', async () => {
    const runId = await makeDocAndRun()
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await upsertSubjectThreadReconcileFailure({ extractionRunId: runId, siteId, error: 'boom' })
    const db = createAdminClient()
    await db.from('subject_thread_reconcile_failure').update({ last_attempt_at: old }).eq('extraction_run_id', runId)

    await replayPendingSubjectThreadReconcileFailures(50, 15 * 60 * 1000)
    const attemptCountAfterResolve = (await getFailure(runId))?.attempt_count

    await replayPendingSubjectThreadReconcileFailures(50, 0)
    const untouched = await getFailure(runId)
    expect(untouched?.attempt_count).toBe(attemptCountAfterResolve)
    expect(untouched?.resolved_at).not.toBeNull()
  })
})
