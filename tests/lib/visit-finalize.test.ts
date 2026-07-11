// PR #79 (corrections revue) — clôture DÉFINITIVE d'une visite.
//
// Règle produit vérifiée : « non trié = gardé en mémoire » — « Terminer la
// visite » est un vrai point final, PROUVÉ :
//   1. les captures encore « à trier » (captured) passent en kept, intent null,
//      updated_at posé ;
//   2. les tris EXPLICITES ne sont jamais écrasés ;
//   3. ended_at est posé ;
//   4. la visite quitte réellement « Reprendre mon travail » (les DEUX listes :
//      visites actives + tri restant) ;
//   5. idempotence : un second appel réussit sans rien réinitialiser ;
//   6. visite inconnue → ok:false (jamais de succès déclaré sans preuve).
//
// Test d'INTÉGRATION (vraie Supabase) — enregistré dans tests/integration-tests.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSite } from '@/lib/db/sites'
import {
  finalizeVisit,
  listActiveVisitsForUser,
  listPendingTriageForUser,
} from '@/lib/db/visits'

const TEST_TAG = '__test_visit_finalize__'

let adminId: string
let clientId: string
let siteId: string
const reportIds: string[] = []

async function ensureAdmin(): Promise<string> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!data) throw new Error('No admin user — seed needed before running this test')
  return data.id
}

async function createVisit(opts: { endedAt?: string | null }): Promise<string> {
  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('tenant_id, organization_id')
    .eq('id', siteId)
    .single()
  const { data, error } = await supabase
    .from('site_reports')
    .insert({
      type: 'site',
      site_id: siteId,
      status: 'draft',
      origin: 'spontaneous',
      started_at: new Date().toISOString(),
      ended_at: opts.endedAt ?? null,
      created_by: adminId,
      tenant_id: (site as { tenant_id: string | null } | null)?.tenant_id ?? null,
      organization_id: (site as { organization_id: string | null } | null)?.organization_id ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  reportIds.push(data.id as string)
  return data.id as string
}

async function addCapture(
  reportId: string,
  patch: { status?: string; triage_intent?: string | null } = {},
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_capture')
    .insert({
      report_id: reportId,
      site_id: siteId,
      kind: 'note',
      body: `${TEST_TAG} capture`,
      status: patch.status ?? 'captured',
      triage_intent: patch.triage_intent ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

async function captureRow(id: string): Promise<{ status: string; triage_intent: string | null; updated_at: string | null }> {
  const { data } = await createAdminClient()
    .from('visit_capture')
    .select('status, triage_intent, updated_at')
    .eq('id', id)
    .single()
  return data as { status: string; triage_intent: string | null; updated_at: string | null }
}

beforeAll(async () => {
  adminId = await ensureAdmin()
  const supabase = createAdminClient()
  const { data: client, error } = await supabase
    .from('clients')
    .insert({ name: `${TEST_TAG}_client_${Date.now()}` })
    .select('id')
    .single()
  if (error) throw error
  clientId = client.id as string
  siteId = await createSite({ client_id: clientId, contract_id: null, name: `${TEST_TAG}_site` })
})

afterAll(async () => {
  const supabase = createAdminClient()
  // Les captures suivent les reports (FK cascade).
  if (reportIds.length > 0) await supabase.from('site_reports').delete().in('id', reportIds)
  if (siteId) await supabase.from('sites').delete().eq('id', siteId)
  if (clientId) await supabase.from('clients').delete().eq('id', clientId)
})

// Base distante réelle : les listes « Reprendre mon travail » font plusieurs
// allers-retours réseau — timeout large, ces tests ne tournent pas en CI GitHub.
const T = 60_000

describe('finalizeVisit — la clôture est prouvée, jamais déclarée', () => {
  it('bascule les captures « à trier » en mémoire, pose ended_at, préserve les tris explicites', { timeout: T }, async () => {
    const reportId = await createVisit({ endedAt: null })
    const keptAction = await addCapture(reportId, { status: 'kept', triage_intent: 'action' })
    const keptMemoire = await addCapture(reportId, { status: 'kept', triage_intent: null })
    const untriaged = await addCapture(reportId, { status: 'captured' })

    // Avant : visite EN COURS (ended_at null) → présente dans les visites actives.
    const activeBefore = await listActiveVisitsForUser(adminId, 50)
    expect(activeBefore.some((v) => v.reportId === reportId)).toBe(true)

    const res = await finalizeVisit(reportId)
    expect(res.ok).toBe(true)

    // La capture non triée est gardée en mémoire, avec trace (updated_at).
    const u = await captureRow(untriaged)
    expect(u.status).toBe('kept')
    expect(u.triage_intent).toBeNull()
    expect(u.updated_at).not.toBeNull()

    // Les tris explicites ne sont PAS écrasés.
    expect((await captureRow(keptAction)).triage_intent).toBe('action')
    expect((await captureRow(keptMemoire)).status).toBe('kept')

    // ended_at est posé.
    const { data: rep } = await createAdminClient()
      .from('site_reports').select('ended_at').eq('id', reportId).single()
    expect((rep as { ended_at: string | null }).ended_at).not.toBeNull()

    // La visite a quitté « Reprendre mon travail » : ni active, ni tri restant.
    const activeAfter = await listActiveVisitsForUser(adminId, 50)
    expect(activeAfter.some((v) => v.reportId === reportId)).toBe(false)
    const triage = await listPendingTriageForUser(adminId, 50)
    expect(triage.some((t) => t.reportId === reportId)).toBe(false)
  })

  it('est idempotente : un second appel réussit sans réinitialiser les décisions', { timeout: T }, async () => {
    const reportId = await createVisit({ endedAt: null })
    const keptAction = await addCapture(reportId, { status: 'kept', triage_intent: 'action' })
    await addCapture(reportId, { status: 'captured' })

    expect((await finalizeVisit(reportId)).ok).toBe(true)
    const endedAfterFirst = (await createAdminClient()
      .from('site_reports').select('ended_at').eq('id', reportId).single()).data as { ended_at: string }

    expect((await finalizeVisit(reportId)).ok).toBe(true)

    // Rien n'a bougé : ended_at inchangé, tri explicite intact.
    const endedAfterSecond = (await createAdminClient()
      .from('site_reports').select('ended_at').eq('id', reportId).single()).data as { ended_at: string }
    expect(endedAfterSecond.ended_at).toBe(endedAfterFirst.ended_at)
    expect((await captureRow(keptAction)).triage_intent).toBe('action')
  })

  it('sort du « tri restant » une visite déjà terminée qui traînait avec une capture à trier', { timeout: T }, async () => {
    const reportId = await createVisit({ endedAt: new Date().toISOString() })
    await addCapture(reportId, { status: 'captured' })

    // Avant : c'est exactement le bug d'origine — terminée mais « à reprendre ».
    const before = await listPendingTriageForUser(adminId, 50)
    expect(before.some((t) => t.reportId === reportId)).toBe(true)

    expect((await finalizeVisit(reportId)).ok).toBe(true)

    const after = await listPendingTriageForUser(adminId, 50)
    expect(after.some((t) => t.reportId === reportId)).toBe(false)
  })

  it('refuse une visite inconnue : ok:false, jamais un succès sans preuve', async () => {
    const res = await finalizeVisit('00000000-0000-0000-0000-000000000000')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })
})
