// Sprint 2 — Mémoire des lieux : tests du helper getSiteResumeContext.
//
// Couvre :
//   1. Jamais venu sur ce site → daysSinceLastVisit = null + lastVisitAt = null
//   2. Dernier passage récent → daysSinceLastVisit calculé correctement
//   3. site_notes filtrées sur les 30 derniers jours (les vieilles écartées)
//   4. anomalies filtrées sur les 30 derniers jours
//   5. Site sans aucune mission → arrays vides, daysSinceLastVisit null

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import { createIntervention, getSiteResumeContext } from '@/lib/db/interventions'

const TEST_CLIENT_NAME = '__test_resume_ctx_client__'

let clientId: string
let siteId: string
let missionId: string
let adminUserId: string

// createSiteNote utilise createServerClient pour récupérer auth.uid().
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: globalThis.__RESUME_TEST_USER_ID__ ?? 'unset' } },
      })),
    },
  })),
}))

declare global {
  // eslint-disable-next-line no-var
  var __RESUME_TEST_USER_ID__: string | undefined
}

async function importCreateSiteNote() {
  const mod = await import('@/lib/db/sites')
  return mod.createSiteNote
}

async function setupTestData() {
  const supabase = createAdminClient()
  const { data: admin } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!admin) throw new Error('No admin user — seed needed')
  adminUserId = admin.id

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('name', TEST_CLIENT_NAME)
    .maybeSingle()
  if (existingClient) {
    clientId = existingClient.id
  } else {
    const { data, error } = await supabase
      .from('clients')
      .insert({ name: TEST_CLIENT_NAME })
      .select('id')
      .single()
    if (error) throw error
    clientId = data.id
  }

  siteId = await createSite({
    client_id: clientId,
    contract_id: null,
    name: 'Test Site Resume',
  })

  missionId = await createMission({
    site_id: siteId,
    name: 'Mission resume test',
    cadence: 'daily',
    created_by: null,
  })
}

async function cleanupChildren() {
  const supabase = createAdminClient()
  // Récup interventions du site → delete anomalies → delete interventions → delete notes.
  const { data: interventions } = await supabase
    .from('interventions')
    .select('id')
    .eq('mission_id', missionId)
  const intvIds = (interventions ?? []).map((i) => i.id)
  if (intvIds.length > 0) {
    await supabase.from('intervention_anomalies').delete().in('intervention_id', intvIds)
    await supabase.from('interventions').delete().in('id', intvIds)
  }
  await supabase.from('site_notes').delete().eq('site_id', siteId)
}

async function cleanupAll() {
  const supabase = createAdminClient()
  await cleanupChildren()
  await supabase.from('missions').delete().eq('id', missionId)
  await supabase.from('sites').delete().eq('id', siteId)
  await supabase.from('clients').delete().eq('id', clientId)
}

describe('getSiteResumeContext — Sprint 2 mémoire des lieux', () => {
  beforeAll(async () => {
    await setupTestData()
    globalThis.__RESUME_TEST_USER_ID__ = adminUserId
  })

  afterEach(async () => {
    await cleanupChildren()
  })

  afterAll(async () => {
    await cleanupAll()
    globalThis.__RESUME_TEST_USER_ID__ = undefined
  })

  it('user jamais venu sur ce site → daysSinceLastVisit = null', async () => {
    const ctx = await getSiteResumeContext(siteId, adminUserId)
    expect(ctx.daysSinceLastVisit).toBeNull()
    expect(ctx.lastVisitAt).toBeNull()
    expect(ctx.recentSiteNotes).toEqual([])
    expect(ctx.recentAnomalies).toEqual([])
  })

  it('dernier passage il y a 2 jours → daysSinceLastVisit = 2', async () => {
    // Crée une intervention completed avec executed_at = il y a 2 jours.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const supabase = createAdminClient()
    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: twoDaysAgo,
      team: [adminUserId],
      created_by: null,
    })
    await supabase
      .from('interventions')
      .update({ status: 'completed', executed_at: twoDaysAgo })
      .eq('id', intvId)

    const ctx = await getSiteResumeContext(siteId, adminUserId)
    expect(ctx.daysSinceLastVisit).toBe(2)
    // Comparaison en epoch ms pour tolérer le format ISO de Postgres
    // ("2026-05-11T01:48:12.75+00:00" vs ".750Z" stockés mais sémantiquement identiques).
    expect(ctx.lastVisitAt).not.toBeNull()
    expect(new Date(ctx.lastVisitAt!).getTime()).toBe(new Date(twoDaysAgo).getTime())
  })

  it('site_notes des 30 derniers jours filtrées (les vieilles écartées)', async () => {
    const createSiteNote = await importCreateSiteNote()
    // Note récente (auj.)
    const recent = await createSiteNote({
      siteId,
      body: 'Note récente — visible dans le contexte',
    })

    // Note ancienne (40 jours) — backdate via UPDATE direct.
    const old = await createSiteNote({ siteId, body: 'Note ancienne hors fenêtre' })
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    const supabase = createAdminClient()
    await supabase
      .from('site_notes')
      .update({ created_at: fortyDaysAgo })
      .eq('id', old.id)

    const ctx = await getSiteResumeContext(siteId, adminUserId)
    const ids = ctx.recentSiteNotes.map((n) => n.id)
    expect(ids).toContain(recent.id)
    expect(ids).not.toContain(old.id)
  })

  it('anomalies des 30 derniers jours filtrées', async () => {
    const supabase = createAdminClient()
    const nowIso = new Date().toISOString()

    // Une intervention + une anomalie récente + une ancienne.
    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: nowIso,
      team: [adminUserId],
      created_by: null,
    })

    const { data: recentAnom } = await supabase
      .from('intervention_anomalies')
      .insert({
        intervention_id: intvId,
        category: 'autre',
        category_other: 'Test anomalie récente',
        description: 'Description récente',
        status: 'open',
      })
      .select('id')
      .single()

    const { data: oldAnom } = await supabase
      .from('intervention_anomalies')
      .insert({
        intervention_id: intvId,
        category: 'autre',
        category_other: 'Test anomalie ancienne',
        description: 'Description ancienne',
        status: 'open',
      })
      .select('id')
      .single()

    // Backdate l'ancienne à 45 jours.
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
    await supabase
      .from('intervention_anomalies')
      .update({ created_at: fortyFiveDaysAgo })
      .eq('id', oldAnom!.id)

    const ctx = await getSiteResumeContext(siteId, adminUserId)
    const ids = ctx.recentAnomalies.map((a) => a.id)
    expect(ids).toContain(recentAnom!.id)
    expect(ids).not.toContain(oldAnom!.id)
  })
})
