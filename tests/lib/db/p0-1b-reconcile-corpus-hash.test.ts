// P0-1B — réédition CR sensible au contenu (mig 410).
//
// Avant ce lot, `canonical_reconciled_at` était un booléen pur : sa seule
// présence bloquait tout rejeu de `runCanonicalReconciliation`, même après une
// réédition du CR (force-regénération, ou abandon d'une capture qui régénère
// l'analyse). Ce test vérifie le point d'entrée réel (pas seulement la règle
// pure `decideReconcileLock`, déjà couverte par tests/knowledge/canonical-race-invariants.test.ts) :
//   1. premier passage → réconcilie, mémorise le corpus_hash ;
//   2. rejeu à contenu inchangé → idempotent (already_done) ;
//   3. rejeu après réédition (corpus_hash changé) → rejoue et met à jour l'empreinte.
//
// Test d'INTÉGRATION (vraie Supabase) — enregistré dans tests/integration-tests.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { runCanonicalReconciliation } from '@/lib/visits/debrief-analysis'

const TAG = `__test_p0_1b_corpus_hash_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let tenantId: string | null
const reportIds: string[] = []

async function createReport(corpusHash: string): Promise<string> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('site_reports')
    .insert({
      type: 'site',
      site_id: siteId,
      status: 'draft',
      origin: 'spontaneous',
      started_at: new Date().toISOString(),
      tenant_id: tenantId,
      organization_id: orgId,
      debrief_analysis: { corpus_hash: corpusHash, analysis_version: 1 },
    })
    .select('id')
    .single()
  if (error) throw error
  const id = (data as { id: string }).id
  reportIds.push(id)
  return id
}

async function readReconcileState(reportId: string) {
  const db = createAdminClient()
  const { data } = await db
    .from('site_reports')
    .select('canonical_reconciled_at, canonical_reconciled_corpus_hash')
    .eq('id', reportId)
    .single()
  return data as { canonical_reconciled_at: string | null; canonical_reconciled_corpus_hash: string | null }
}

beforeAll(async () => {
  const db = createAdminClient()

  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  clientId = (
    await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()
  ).data!.id as string

  const { data: site } = await db
    .from('sites')
    .insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId })
    .select('id, tenant_id')
    .single()
  siteId = (site as { id: string }).id
  tenantId = (site as { tenant_id: string | null }).tenant_id
})

afterAll(async () => {
  const db = createAdminClient()
  if (reportIds.length > 0) await db.from('site_reports').delete().in('id', reportIds)
  if (siteId) await db.from('sites').delete().eq('id', siteId)
  if (clientId) await db.from('clients').delete().eq('id', clientId)
})

describe('P0-1B — runCanonicalReconciliation rejoue seulement si le corpus_hash a changé', () => {
  it('premier passage : réconcilie et mémorise le corpus_hash', async () => {
    const reportId = await createReport('hash-v1')
    const outcome = await runCanonicalReconciliation({ reportId, siteId })
    expect(outcome).toBe('reconciled')
    const state = await readReconcileState(reportId)
    expect(state.canonical_reconciled_at).not.toBeNull()
    expect(state.canonical_reconciled_corpus_hash).toBe('hash-v1')
  })

  it('rejeu sans réédition (même corpus_hash) : idempotent, aucun nouveau run', async () => {
    const reportId = await createReport('hash-v1')
    const first = await runCanonicalReconciliation({ reportId, siteId })
    expect(first).toBe('reconciled')
    const second = await runCanonicalReconciliation({ reportId, siteId })
    expect(second).toBe('already_done')
  })

  it("réédition du CR (corpus_hash modifié après la première réconciliation) : le rejeu est autorisé et l'empreinte est mise à jour", async () => {
    const reportId = await createReport('hash-v1')
    const first = await runCanonicalReconciliation({ reportId, siteId })
    expect(first).toBe('reconciled')

    const db = createAdminClient()
    await db
      .from('site_reports')
      .update({ debrief_analysis: { corpus_hash: 'hash-v2', analysis_version: 2 } })
      .eq('id', reportId)

    const second = await runCanonicalReconciliation({ reportId, siteId })
    expect(second).toBe('reconciled')
    const state = await readReconcileState(reportId)
    expect(state.canonical_reconciled_corpus_hash).toBe('hash-v2')
  })
})
