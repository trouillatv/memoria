// Slice 6.1 — Tests des helpers intervention-templates + génération paresseuse.
//
// Couvre :
//   - CRUD (create / update / archive / list filters)
//   - Génération (5 patterns + idempotence + cap 7 jours + scope obligatoire +
//     starts_on/ends_on respect + slots multiples)
//   - Skip individuel (markInterventionSkipped : raison obligatoire, intervention
//     reste visible)

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import { createIntervention } from '@/lib/db/interventions'
import {
  archiveTemplate,
  createTemplate,
  generateInterventionsFromTemplates,
  getTemplate,
  listTemplatesForContract,
  listTemplatesForMission,
  listTemplatesForSite,
  markInterventionSkipped,
  updateTemplate,
} from '@/lib/db/intervention-templates'

const TEST_TENDER_TITLE = '__test_recurrence_phase6_gen_tender__'
const TEST_CLIENT_NAME = '__test_recurrence_phase6_gen_client__'

let tenderId: string
let contractId: string
let clientId: string
let siteId: string
let missionId: string

async function setupTestData() {
  const supabase = createAdminClient()
  const { data: admin } = await supabase.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  if (!admin) throw new Error('No admin user — seed needed')

  // Tender (idempotent)
  const { data: existingTender } = await supabase
    .from('tenders')
    .select('id')
    .eq('title', TEST_TENDER_TITLE)
    .maybeSingle()
  if (existingTender) {
    tenderId = existingTender.id
  } else {
    const { data, error } = await supabase
      .from('tenders')
      .insert({ title: TEST_TENDER_TITLE, status: 'ready', created_by: admin.id })
      .select('id')
      .single()
    if (error) throw error
    tenderId = data.id
  }

  // Client (idempotent)
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

  // Contract
  contractId = await createContract({
    tender_id: tenderId,
    name: '__test_contract_phase6_gen__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  // Site + mission
  siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: 'Test Site Récurrence Gen',
  })
  missionId = await createMission({
    site_id: siteId,
    name: 'Bionettoyage quotidien — gen test',
    cadence: 'daily',
    created_by: null,
  })
}

async function cleanupGenerated() {
  const supabase = createAdminClient()
  // Supprimer les interventions et templates de la mission de test
  await supabase.from('interventions').delete().eq('mission_id', missionId)
  await supabase.from('intervention_templates').delete().eq('mission_id', missionId)
}

async function cleanupAll() {
  const supabase = createAdminClient()
  const { data: sites } = await supabase.from('sites').select('id').eq('client_id', clientId)
  if (sites && sites.length > 0) {
    const siteIds = sites.map((s) => s.id)
    const { data: missions } = await supabase.from('missions').select('id').in('site_id', siteIds)
    if (missions && missions.length > 0) {
      await supabase.from('interventions').delete().in('mission_id', missions.map((m) => m.id))
      await supabase
        .from('intervention_templates')
        .delete()
        .in('mission_id', missions.map((m) => m.id))
    }
    await supabase.from('missions').delete().in('site_id', siteIds)
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
}

describe('intervention-templates helpers — Slice 6.1', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterEach(async () => {
    await cleanupGenerated()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  it('createTemplate daily : insère + defaults OK', async () => {
    const tpl = await createTemplate({
      mission_id: missionId,
      title: 'Tous les jours',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: '2026-05-12',
    })
    expect(tpl.id).toBeTruthy()
    expect(tpl.frequency).toBe('daily')
    expect(tpl.active).toBe(true)
    expect(tpl.deleted_at).toBeNull()
    expect(tpl.slots).toEqual(['morning'])

    const fetched = await getTemplate(tpl.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.title).toBe('Tous les jours')
  })

  it('createTemplate weekly sans day_of_week → throws (DB constraint)', async () => {
    await expect(
      createTemplate({
        mission_id: missionId,
        title: 'Weekly bug',
        frequency: 'weekly',
        starts_on: '2026-05-12',
      })
    ).rejects.toThrow()
  })

  it('updateTemplate flip active=false → row updaté', async () => {
    const tpl = await createTemplate({
      mission_id: missionId,
      title: 'À désactiver',
      frequency: 'daily',
      starts_on: '2026-05-12',
    })
    const updated = await updateTemplate(tpl.id, { active: false })
    expect(updated.active).toBe(false)
    const refetch = await getTemplate(tpl.id)
    expect(refetch!.active).toBe(false)
  })

  it('archiveTemplate : deleted_at NOT NULL, disparaît des listings', async () => {
    const tpl = await createTemplate({
      mission_id: missionId,
      title: 'À archiver',
      frequency: 'daily',
      starts_on: '2026-05-12',
    })
    await archiveTemplate(tpl.id)

    // getTemplate filtre les soft-deleted
    const fetched = await getTemplate(tpl.id)
    expect(fetched).toBeNull()

    // listTemplatesForMission ne le renvoie pas non plus
    const list = await listTemplatesForMission(missionId)
    expect(list.find((t) => t.id === tpl.id)).toBeUndefined()

    // Mais la ligne est toujours en DB (soft-delete)
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('intervention_templates')
      .select('id, deleted_at')
      .eq('id', tpl.id)
      .maybeSingle()
    expect(data).not.toBeNull()
    expect(data!.deleted_at).not.toBeNull()
  })

  it('listTemplatesForMission retourne uniquement les non-deleted', async () => {
    const a = await createTemplate({
      mission_id: missionId,
      title: 'Template A',
      frequency: 'daily',
      starts_on: '2026-05-12',
    })
    const b = await createTemplate({
      mission_id: missionId,
      title: 'Template B',
      frequency: 'daily',
      starts_on: '2026-05-12',
    })
    await archiveTemplate(b.id)

    const list = await listTemplatesForMission(missionId)
    expect(list.length).toBe(1)
    expect(list[0]!.id).toBe(a.id)
  })

  it('listTemplatesForSite et listTemplatesForContract — résolution via missions', async () => {
    const tpl = await createTemplate({
      mission_id: missionId,
      title: 'Visible par site/contract',
      frequency: 'daily',
      starts_on: '2026-05-12',
    })

    const bySite = await listTemplatesForSite(siteId)
    expect(bySite.find((t) => t.id === tpl.id)).toBeDefined()

    const byContract = await listTemplatesForContract(contractId)
    expect(byContract.find((t) => t.id === tpl.id)).toBeDefined()
  })

  // ---------------------------------------------------------------------------
  // Génération — garde-fous
  // ---------------------------------------------------------------------------

  it('generateInterventionsFromTemplates : range > 7 jours → throws', async () => {
    await expect(
      generateInterventionsFromTemplates({
        fromDate: '2026-05-12',
        toDate: '2026-05-20', // 9 jours
        missionId,
      })
    ).rejects.toThrow(/7 days/i)
  })

  it('generateInterventionsFromTemplates : sans scope → throws', async () => {
    await expect(
      generateInterventionsFromTemplates({
        fromDate: '2026-05-12',
        toDate: '2026-05-13',
      })
    ).rejects.toThrow(/scope|siteId|missionId|templateIds/i)
  })

  // ---------------------------------------------------------------------------
  // Génération — patterns
  // ---------------------------------------------------------------------------

  it('generation daily sur 7 jours → 7 interventions, idempotent au 2e run', async () => {
    await createTemplate({
      mission_id: missionId,
      title: 'Daily 7j',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: '2026-05-12',
    })

    const r1 = await generateInterventionsFromTemplates({
      fromDate: '2026-05-12',
      toDate: '2026-05-18', // 7 jours inclus
      missionId,
    })
    expect(r1.templatesProcessed).toBe(1)
    expect(r1.generated).toBe(7)
    expect(r1.skipped).toBe(0)

    // Run 2 : idempotent
    const r2 = await generateInterventionsFromTemplates({
      fromDate: '2026-05-12',
      toDate: '2026-05-18',
      missionId,
    })
    expect(r2.generated).toBe(0)
    expect(r2.skipped).toBe(7)
  })

  it('generation weekdays sur lundi-dimanche → 5 interventions (Mon-Fri)', async () => {
    // 2026-05-11 = lundi, 2026-05-17 = dimanche.
    await createTemplate({
      mission_id: missionId,
      title: 'Lun-Ven',
      frequency: 'weekdays',
      slots: ['morning'],
      starts_on: '2026-05-11',
    })

    const r = await generateInterventionsFromTemplates({
      fromDate: '2026-05-11',
      toDate: '2026-05-17',
      missionId,
    })
    expect(r.generated).toBe(5)
  })

  it('generation weekly day_of_week=2 (mardi) → 1 intervention le mardi', async () => {
    // 2026-05-11 = lundi → mardi = 2026-05-12
    await createTemplate({
      mission_id: missionId,
      title: 'Tous les mardis',
      frequency: 'weekly',
      day_of_week: 2,
      slots: ['morning'],
      starts_on: '2026-05-11',
    })

    const r = await generateInterventionsFromTemplates({
      fromDate: '2026-05-11',
      toDate: '2026-05-17',
      missionId,
    })
    expect(r.generated).toBe(1)

    const supabase = createAdminClient()
    const { data } = await supabase
      .from('interventions')
      .select('scheduled_for')
      .eq('mission_id', missionId)
    expect(data!.length).toBe(1)
    expect(data![0]!.scheduled_for).toBe('2026-05-12')
  })

  it('generation slots [morning, evening] → 2 interventions/jour', async () => {
    await createTemplate({
      mission_id: missionId,
      title: 'Matin+Soir',
      frequency: 'daily',
      slots: ['morning', 'evening'],
      starts_on: '2026-05-12',
    })

    const r = await generateInterventionsFromTemplates({
      fromDate: '2026-05-12',
      toDate: '2026-05-14', // 3 jours
      missionId,
    })
    expect(r.generated).toBe(6) // 3 jours x 2 slots
  })

  it('generation respecte starts_on et ends_on (fenêtre du template)', async () => {
    // Template actif uniquement du 13 au 15
    await createTemplate({
      mission_id: missionId,
      title: 'Fenêtre étroite',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: '2026-05-13',
      ends_on: '2026-05-15',
    })

    // Range demandé plus large : 12 → 18
    const r = await generateInterventionsFromTemplates({
      fromDate: '2026-05-12',
      toDate: '2026-05-18',
      missionId,
    })
    expect(r.generated).toBe(3) // seulement 13, 14, 15
  })

  it('generation one_shot → 1 intervention uniquement le jour starts_on', async () => {
    await createTemplate({
      mission_id: missionId,
      title: 'Une seule fois',
      frequency: 'one_shot',
      slots: ['morning'],
      starts_on: '2026-05-14',
    })
    const r = await generateInterventionsFromTemplates({
      fromDate: '2026-05-12',
      toDate: '2026-05-18',
      missionId,
    })
    expect(r.generated).toBe(1)
  })

  it('generation par templateIds explicite (sans missionId/siteId)', async () => {
    const tpl = await createTemplate({
      mission_id: missionId,
      title: 'Template explicit',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: '2026-05-12',
    })
    const r = await generateInterventionsFromTemplates({
      fromDate: '2026-05-12',
      toDate: '2026-05-14',
      templateIds: [tpl.id],
    })
    expect(r.generated).toBe(3)
  })

  it('generation par siteId → couvre tous les templates des missions du site', async () => {
    await createTemplate({
      mission_id: missionId,
      title: 'Daily via site',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: '2026-05-12',
    })

    const r = await generateInterventionsFromTemplates({
      fromDate: '2026-05-12',
      toDate: '2026-05-14',
      siteId,
    })
    expect(r.generated).toBe(3)
  })

  it('generation ignore les templates inactifs (active=false)', async () => {
    const tpl = await createTemplate({
      mission_id: missionId,
      title: 'Désactivé avant gen',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: '2026-05-12',
    })
    await updateTemplate(tpl.id, { active: false })

    const r = await generateInterventionsFromTemplates({
      fromDate: '2026-05-12',
      toDate: '2026-05-14',
      missionId,
    })
    expect(r.templatesProcessed).toBe(0)
    expect(r.generated).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // Skip
  // ---------------------------------------------------------------------------

  it('markInterventionSkipped : raison obligatoire, intervention reste visible', async () => {
    // Crée une intervention via le helper standard
    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: '2026-05-13T08:00:00.000Z',
      created_by: null,
    })

    await markInterventionSkipped(intvId, 'Site fermé pour travaux')

    const supabase = createAdminClient()
    const { data } = await supabase
      .from('interventions')
      .select('*')
      .eq('id', intvId)
      .maybeSingle()
    expect(data).not.toBeNull()
    expect(data!.status).toBe('skipped')
    expect(data!.skipped_at).not.toBeNull()
    expect(data!.skipped_reason).toBe('Site fermé pour travaux')
  })

  it('markInterventionSkipped : raison vide → throws (geste conscient)', async () => {
    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: '2026-05-13T08:00:00.000Z',
      created_by: null,
    })

    await expect(markInterventionSkipped(intvId, '   ')).rejects.toThrow(/reason/i)
    await expect(markInterventionSkipped(intvId, '')).rejects.toThrow(/reason/i)
  })
})
