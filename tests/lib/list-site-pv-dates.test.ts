// GO Vincent 2026-09-22 (micro-contrôle avant merge dd340ab9) — preuve testée que
// listSitePvDates réduit `site_reports.started_at` (timestamptz) à la date civile
// NOUMÉA, jamais à la date calendaire UTC. Témoin explicite du cas qui a motivé le
// fix (lib/db/visits.ts) : un started_at tard le soir UTC dont le jour Nouméa (UTC+11)
// est déjà le lendemain.
//
// Test d'INTÉGRATION (vraie Supabase) — enregistré dans tests/integration-tests.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { listSitePvDates } from '@/lib/db/visits'

const TEST_TAG = '__test_list_site_pv_dates__'

let clientId: string
let siteId: string
const reportIds: string[] = []

beforeAll(async () => {
  const supabase = createAdminClient()
  const { data: org } = await supabase.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  const orgId = (org as { id: string }).id

  const { data: client, error } = await supabase
    .from('clients')
    .insert({ name: `${TEST_TAG}_client_${Date.now()}`, organization_id: orgId })
    .select('id')
    .single()
  if (error) throw error
  clientId = client.id as string

  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .insert({ name: `${TEST_TAG}_site`, client_id: clientId, organization_id: orgId })
    .select('id')
    .single()
  if (siteErr) throw siteErr
  siteId = (site as { id: string }).id
})

afterAll(async () => {
  const supabase = createAdminClient()
  if (reportIds.length > 0) await supabase.from('site_reports').delete().in('id', reportIds)
  if (siteId) await supabase.from('sites').delete().eq('id', siteId)
  if (clientId) await supabase.from('clients').delete().eq('id', clientId)
})

async function createReport(startedAt: string): Promise<string> {
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
      started_at: startedAt,
      tenant_id: (site as { tenant_id: string | null } | null)?.tenant_id ?? null,
      organization_id: (site as { organization_id: string | null } | null)?.organization_id ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  reportIds.push(data.id as string)
  return data.id as string
}

const T = 60_000

describe('listSitePvDates — réduction à la date civile Nouméa, jamais UTC', () => {
  it('un started_at tard le soir UTC dont le jour Nouméa (UTC+11) est déjà le lendemain', { timeout: T }, async () => {
    // 2026-09-20T21:30:00Z + 11h (Pacific/Noumea) = 2026-09-21T08:30 → jour métier 2026-09-21.
    await createReport('2026-09-20T21:30:00.000Z')

    const dates = await listSitePvDates(siteId)

    expect(dates).toContain('2026-09-21')
    expect(dates).not.toContain('2026-09-20')
  })
})
