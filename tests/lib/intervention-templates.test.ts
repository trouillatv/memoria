import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import { createIntervention } from '@/lib/db/interventions'

// Slice 6.0 — Migration DB intervention_templates.
// Tests directs (DB réelle, createAdminClient) sur les contraintes critiques :
// CHECK weekly/monthly/slots, UNIQUE partial, defaults, cascade ON DELETE mission.

const TEST_TENDER_TITLE = '__test_recurrence_phase6_tender__'
const TEST_CLIENT_NAME = '__test_recurrence_phase6_client__'

let tenderId: string
let contractId: string
let clientId: string
let siteId: string
let missionId: string

async function setupTestData() {
  const supabase = createAdminClient()
  const { data: admin } = await supabase.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  if (!admin) throw new Error('No admin user')

  // Tender (idempotent)
  const { data: existingTender } = await supabase.from('tenders').select('id').eq('title', TEST_TENDER_TITLE).maybeSingle()
  if (existingTender) {
    tenderId = existingTender.id
  } else {
    const { data, error } = await supabase.from('tenders').insert({
      title: TEST_TENDER_TITLE, status: 'ready', created_by: admin.id,
    }).select('id').single()
    if (error) throw error
    tenderId = data.id
  }

  // Client (idempotent)
  const { data: existingClient } = await supabase.from('clients').select('id').eq('name', TEST_CLIENT_NAME).maybeSingle()
  if (existingClient) {
    clientId = existingClient.id
  } else {
    const { data, error } = await supabase.from('clients').insert({ name: TEST_CLIENT_NAME }).select('id').single()
    if (error) throw error
    clientId = data.id
  }

  // Contract (one per run is fine)
  contractId = await createContract({
    tender_id: tenderId,
    name: '__test_contract_phase6__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  // Site + mission (réutilisés par tous les tests via afterEach qui ne nettoie que les templates)
  siteId = await createSite({ client_id: clientId, contract_id: contractId, name: 'Test Site Récurrence' })
  missionId = await createMission({
    site_id: siteId,
    name: 'Bionettoyage quotidien — test',
    cadence: 'daily',
    created_by: null,
  })
}

async function cleanupTemplates() {
  const supabase = createAdminClient()
  // Templates de notre mission de test (cascade côté DB sur intervention_templates → SET NULL sur interventions)
  await supabase.from('intervention_templates').delete().eq('mission_id', missionId)
  // Nettoyer les interventions de la mission de test pour éviter les conflits UNIQUE entre tests
  await supabase.from('interventions').delete().eq('mission_id', missionId)
}

async function cleanupAll() {
  const supabase = createAdminClient()
  // Drop missions + sites de notre client de test → cascade interventions/templates
  const { data: sites } = await supabase.from('sites').select('id').eq('client_id', clientId)
  if (sites && sites.length > 0) {
    await supabase.from('missions').delete().in('site_id', sites.map((s) => s.id))
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
}

describe('intervention_templates DB — Slice 6.0', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterEach(async () => {
    await cleanupTemplates()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  it('insère un template daily avec slots [morning,evening] et le récupère', async () => {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('intervention_templates')
      .insert({
        mission_id: missionId,
        title: 'Bionettoyage 2x/jour',
        description: 'Matin et soir, tous les jours',
        frequency: 'daily',
        slots: ['morning', 'evening'],
        starts_on: '2026-05-12',
      })
      .select('*')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.frequency).toBe('daily')
    expect(data!.slots).toEqual(['morning', 'evening'])
    expect(data!.active).toBe(true)         // default active=true
    expect(data!.deleted_at).toBeNull()     // default null
    expect(data!.day_of_week).toBeNull()
    expect(data!.day_of_month).toBeNull()
  })

  it('rejette un template weekly sans day_of_week (chk_weekly_dow)', async () => {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('intervention_templates')
      .insert({
        mission_id: missionId,
        title: 'Weekly sans jour',
        frequency: 'weekly',
        day_of_week: null,
        starts_on: '2026-05-12',
      })

    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/chk_weekly_dow|check/)
  })

  it('rejette un template monthly sans day_of_month (chk_monthly_dom)', async () => {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('intervention_templates')
      .insert({
        mission_id: missionId,
        title: 'Monthly sans quantième',
        frequency: 'monthly',
        day_of_month: null,
        starts_on: '2026-05-12',
      })

    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/chk_monthly_dom|check/)
  })

  it('rejette un template avec slots invalides ["lunch"] (chk_slots_values)', async () => {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('intervention_templates')
      .insert({
        mission_id: missionId,
        title: 'Slot invalide',
        frequency: 'daily',
        slots: ['lunch'],
        starts_on: '2026-05-12',
      })

    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/chk_slots_values|check/)
  })

  it('rejette ends_on antérieur à starts_on (chk_ends_after_starts)', async () => {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('intervention_templates')
      .insert({
        mission_id: missionId,
        title: 'Dates incohérentes',
        frequency: 'daily',
        starts_on: '2026-05-12',
        ends_on: '2026-05-01',
      })

    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/chk_ends_after_starts|check/)
  })

  it('UNIQUE (template_id, scheduled_for, slot) — la 2e intervention identique échoue', async () => {
    const supabase = createAdminClient()
    // Créer un template valide
    const { data: tpl, error: tplErr } = await supabase
      .from('intervention_templates')
      .insert({
        mission_id: missionId,
        title: 'Template UNIQUE test',
        frequency: 'daily',
        slots: ['morning'],
        starts_on: '2026-05-12',
      })
      .select('id')
      .single()
    expect(tplErr).toBeNull()
    const templateId = tpl!.id

    // 1er INSERT : OK
    const { error: e1 } = await supabase
      .from('interventions')
      .insert({
        mission_id: missionId,
        scheduled_at: '2026-05-13T08:00:00.000Z',
        template_id: templateId,
        scheduled_for: '2026-05-13',
        slot: 'morning',
      })
    expect(e1).toBeNull()

    // 2e INSERT identique : ERROR UNIQUE
    const { error: e2 } = await supabase
      .from('interventions')
      .insert({
        mission_id: missionId,
        scheduled_at: '2026-05-13T08:30:00.000Z',
        template_id: templateId,
        scheduled_for: '2026-05-13',
        slot: 'morning',
      })
    expect(e2).not.toBeNull()
    expect(e2!.message.toLowerCase()).toMatch(/duplicate|unique|idx_interventions_template_unique/)
  })

  it('DELETE mission → cascade supprime les templates rattachés', async () => {
    const supabase = createAdminClient()
    // Créer une mission éphémère + un template
    const ephemeralMissionId = await createMission({
      site_id: siteId,
      name: 'Mission éphémère cascade test',
      cadence: 'daily',
      created_by: null,
    })
    const { data: tpl, error: tplErr } = await supabase
      .from('intervention_templates')
      .insert({
        mission_id: ephemeralMissionId,
        title: 'À détruire en cascade',
        frequency: 'daily',
        starts_on: '2026-05-12',
      })
      .select('id')
      .single()
    expect(tplErr).toBeNull()
    const templateId = tpl!.id

    // Hard delete la mission
    const { error: delErr } = await supabase.from('missions').delete().eq('id', ephemeralMissionId)
    expect(delErr).toBeNull()

    // Le template doit avoir été supprimé en cascade
    const { data: still } = await supabase
      .from('intervention_templates')
      .select('id')
      .eq('id', templateId)
      .maybeSingle()
    expect(still).toBeNull()
  })

  it('Intervention parent existant + template UNIQUE — coexistence one-shot manuel (template_id NULL) sans conflit', async () => {
    const supabase = createAdminClient()
    // Deux interventions one-shot (template_id null) avec mêmes scheduled_for et slot
    // ne doivent PAS déclencher la contrainte UNIQUE (partial sur template_id is not null).
    // On utilise createIntervention pour un test léger.
    const i1 = await createIntervention({
      mission_id: missionId,
      scheduled_at: '2026-05-14T08:00:00.000Z',
      created_by: null,
    })
    const i2 = await createIntervention({
      mission_id: missionId,
      scheduled_at: '2026-05-14T08:00:00.000Z',
      created_by: null,
    })
    expect(i1).toBeTruthy()
    expect(i2).toBeTruthy()
    expect(i1).not.toBe(i2)

    // Mettre scheduled_for + slot identiques sur les deux, template_id reste null
    const { error: u1 } = await supabase
      .from('interventions')
      .update({ scheduled_for: '2026-05-14', slot: 'morning' })
      .eq('id', i1)
    expect(u1).toBeNull()
    const { error: u2 } = await supabase
      .from('interventions')
      .update({ scheduled_for: '2026-05-14', slot: 'morning' })
      .eq('id', i2)
    expect(u2).toBeNull() // partial UNIQUE WHERE template_id IS NOT NULL ne s'applique pas
  })
})
