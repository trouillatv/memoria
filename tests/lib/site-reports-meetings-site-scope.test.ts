import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

// Onglet « Réunions » du chantier (mandat Vincent 2026-10-02) : listMeetings({siteId})
// doit réutiliser le cockpit /meetings existant avec un simple filtre site_id, sans
// dupliquer la logique métier. Ce test protège le seul risque réel introduit par ce
// filtre : qu'une réunion d'un AUTRE chantier fuite dans la liste d'un chantier donné.

let orgIds: string[] = []
vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: async () => orgIds,
}))

const { listMeetings } = await import('@/lib/db/site-reports')

const TEST_SITE_A_NAME = '__test_meetings_scope_site_a__'
const TEST_SITE_B_NAME = '__test_meetings_scope_site_b__'

let organizationId: string
let tenantId: string
let siteAId: string
let siteBId: string
let reportAId: string
let reportBId: string

beforeAll(async () => {
  const supabase = createAdminClient()
  const { data: anySite, error } = await supabase
    .from('sites')
    .select('organization_id, tenant_id')
    .limit(1)
    .single()
  if (error || !anySite) throw new Error('Aucun chantier existant pour dériver organization_id/tenant_id de test')
  organizationId = (anySite as { organization_id: string }).organization_id
  tenantId = (anySite as { tenant_id: string }).tenant_id

  const { data: siteA, error: errA } = await supabase
    .from('sites')
    .insert({ name: TEST_SITE_A_NAME, client_id: null, contract_id: null, organization_id: organizationId, tenant_id: tenantId })
    .select('id')
    .single()
  if (errA) throw errA
  siteAId = (siteA as { id: string }).id

  const { data: siteB, error: errB } = await supabase
    .from('sites')
    .insert({ name: TEST_SITE_B_NAME, client_id: null, contract_id: null, organization_id: organizationId, tenant_id: tenantId })
    .select('id')
    .single()
  if (errB) throw errB
  siteBId = (siteB as { id: string }).id

  const { data: reportA, error: errRA } = await supabase
    .from('site_reports')
    .insert({
      type: 'site',
      site_id: siteAId,
      tenant_id: tenantId,
      organization_id: organizationId,
      status: 'proposed',
      title: '__test_meeting_site_a__',
    })
    .select('id')
    .single()
  if (errRA) throw errRA
  reportAId = (reportA as { id: string }).id

  const { data: reportB, error: errRB } = await supabase
    .from('site_reports')
    .insert({
      type: 'site',
      site_id: siteBId,
      tenant_id: tenantId,
      organization_id: organizationId,
      status: 'failed',
      title: '__test_meeting_site_b__',
    })
    .select('id')
    .single()
  if (errRB) throw errRB
  reportBId = (reportB as { id: string }).id

  orgIds = [organizationId]
})

afterAll(async () => {
  const supabase = createAdminClient()
  await supabase.from('site_reports').delete().in('id', [reportAId, reportBId].filter(Boolean))
  await supabase.from('sites').delete().in('id', [siteAId, siteBId].filter(Boolean))
})

describe('listMeetings({ siteId }) — filtre chantier, même périmètre que listReportsBySite', () => {
  it('ne renvoie que les réunions du chantier demandé (site_id direct)', async () => {
    const rowsA = await listMeetings({ siteId: siteAId })
    expect(rowsA.map((r) => r.id)).toContain(reportAId)
    expect(rowsA.map((r) => r.id)).not.toContain(reportBId)
  })

  it('exclut une réunion appartenant à un AUTRE chantier', async () => {
    const rowsB = await listMeetings({ siteId: siteBId })
    expect(rowsB.map((r) => r.id)).toContain(reportBId)
    expect(rowsB.map((r) => r.id)).not.toContain(reportAId)
  })

  it('sans siteId, la réunion est présente côté liste globale (même population)', async () => {
    const all = await listMeetings()
    const ids = all.map((r) => r.id)
    expect(ids).toContain(reportAId)
    expect(ids).toContain(reportBId)
  })

  it('le statut réel est préservé (failed → badge, pas de valeur inventée)', async () => {
    const rowsB = await listMeetings({ siteId: siteBId })
    const row = rowsB.find((r) => r.id === reportBId)
    expect(row?.status).toBe('failed')
  })
})
