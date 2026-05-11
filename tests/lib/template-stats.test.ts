// Slice 6.5 — Tests getTemplateStats / getTemplateStatsBatch.
//
// Couvre :
//   1. Sans intervention → tous null / 0
//   2. 1 intervention passee executed/completed → lastInterventionDate + status
//   3. 1 intervention future → nextInterventionDate
//   4. 3 interventions cette semaine → interventionsThisWeek = 3
//   5. Skipped ignore pour next + thisWeek (mais peut compter pour last)
//   6. Batch : map coherente pour plusieurs templates

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  createTemplate,
  getTemplateStats,
  getTemplateStatsBatch,
} from '@/lib/db/intervention-templates'
import type { InterventionStatus } from '@/types/db'

const TEST_TENDER_TITLE = '__test_template_stats_phase6_tender__'
const TEST_CLIENT_NAME = '__test_template_stats_phase6_client__'

let tenderId: string
let contractId: string
let clientId: string
let siteId: string
let missionId: string

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function insertIntervention(input: {
  missionId: string
  templateId: string
  scheduledFor: string
  slot?: 'morning' | 'afternoon' | 'evening' | null
  status?: InterventionStatus
  skipped?: boolean
}) {
  const supabase = createAdminClient()
  const slot = input.slot ?? 'morning'
  const hour = slot === 'morning' ? 8 : slot === 'afternoon' ? 14 : 19
  const scheduledAt = `${input.scheduledFor}T${String(hour).padStart(2, '0')}:00:00.000Z`
  const skipped = input.skipped === true
  const status: InterventionStatus = skipped ? 'skipped' : (input.status ?? 'planned')

  const { data, error } = await supabase
    .from('interventions')
    .insert({
      mission_id: input.missionId,
      template_id: input.templateId,
      scheduled_at: scheduledAt,
      scheduled_for: input.scheduledFor,
      slot,
      status,
      skipped_at: skipped ? new Date().toISOString() : null,
      skipped_reason: skipped ? 'test skip' : null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data!.id as string
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

  contractId = await createContract({
    tender_id: tenderId,
    name: '__test_contract_template_stats__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: 'Site Stats Test',
  })
  missionId = await createMission({
    site_id: siteId,
    name: 'Mission stats test',
    cadence: 'daily',
    created_by: null,
  })
}

async function cleanupAll() {
  const supabase = createAdminClient()
  const { data: sites } = await supabase
    .from('sites')
    .select('id')
    .eq('client_id', clientId)
  if (sites && sites.length > 0) {
    const siteIds = sites.map((s) => s.id)
    const { data: missions } = await supabase
      .from('missions')
      .select('id')
      .in('site_id', siteIds)
    if (missions && missions.length > 0) {
      const missionIds = missions.map((m) => m.id)
      await supabase.from('interventions').delete().in('mission_id', missionIds)
      await supabase.from('intervention_templates').delete().in('mission_id', missionIds)
    }
    await supabase.from('missions').delete().in('site_id', siteIds)
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
}

async function cleanupRows() {
  const supabase = createAdminClient()
  await supabase.from('interventions').delete().eq('mission_id', missionId)
  await supabase.from('intervention_templates').delete().eq('mission_id', missionId)
}

describe('getTemplateStats / getTemplateStatsBatch — Slice 6.5', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterEach(async () => {
    await cleanupRows()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  it('aucune intervention → tous null/0', async () => {
    const tpl = await createTemplate({
      mission_id: missionId,
      title: 'Pas d intervention',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: todayUtcIso(),
    })

    const stats = await getTemplateStats(tpl.id)
    expect(stats.lastInterventionDate).toBeNull()
    expect(stats.lastInterventionStatus).toBeNull()
    expect(stats.nextInterventionDate).toBeNull()
    expect(stats.interventionsThisWeek).toBe(0)
  })

  it('1 intervention passee completed → lastInterventionDate + status renseignes', async () => {
    const tpl = await createTemplate({
      mission_id: missionId,
      title: 'Avec intervention passee',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: addDaysIso(todayUtcIso(), -10),
    })
    const past = addDaysIso(todayUtcIso(), -3)
    await insertIntervention({
      missionId,
      templateId: tpl.id,
      scheduledFor: past,
      status: 'completed',
    })

    const stats = await getTemplateStats(tpl.id)
    expect(stats.lastInterventionDate).toBe(past)
    expect(stats.lastInterventionStatus).toBe('completed')
    expect(stats.nextInterventionDate).toBeNull()
    expect(stats.interventionsThisWeek).toBe(0)
  })

  it('1 intervention future → nextInterventionDate renseigne', async () => {
    const tpl = await createTemplate({
      mission_id: missionId,
      title: 'Future intervention',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: todayUtcIso(),
    })
    const future = addDaysIso(todayUtcIso(), 3)
    await insertIntervention({
      missionId,
      templateId: tpl.id,
      scheduledFor: future,
      status: 'planned',
    })

    const stats = await getTemplateStats(tpl.id)
    expect(stats.nextInterventionDate).toBe(future)
    expect(stats.interventionsThisWeek).toBe(1)
    expect(stats.lastInterventionDate).toBeNull()
  })

  it('3 interventions dans la semaine → interventionsThisWeek = 3', async () => {
    const tpl = await createTemplate({
      mission_id: missionId,
      title: 'Cette semaine',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: todayUtcIso(),
    })
    // 3 dates distinctes dans la fenetre [today, today+6]
    await insertIntervention({
      missionId,
      templateId: tpl.id,
      scheduledFor: addDaysIso(todayUtcIso(), 0),
      slot: 'morning',
      status: 'planned',
    })
    await insertIntervention({
      missionId,
      templateId: tpl.id,
      scheduledFor: addDaysIso(todayUtcIso(), 2),
      slot: 'morning',
      status: 'planned',
    })
    await insertIntervention({
      missionId,
      templateId: tpl.id,
      scheduledFor: addDaysIso(todayUtcIso(), 5),
      slot: 'morning',
      status: 'planned',
    })

    const stats = await getTemplateStats(tpl.id)
    expect(stats.interventionsThisWeek).toBe(3)
    expect(stats.nextInterventionDate).toBe(addDaysIso(todayUtcIso(), 0))
  })

  it('intervention skipped → ignoree pour next + thisWeek', async () => {
    const tpl = await createTemplate({
      mission_id: missionId,
      title: 'Skipped only',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: todayUtcIso(),
    })
    // 1 future skipped, 1 future planned plus tard
    await insertIntervention({
      missionId,
      templateId: tpl.id,
      scheduledFor: addDaysIso(todayUtcIso(), 1),
      slot: 'morning',
      skipped: true,
    })
    await insertIntervention({
      missionId,
      templateId: tpl.id,
      scheduledFor: addDaysIso(todayUtcIso(), 4),
      slot: 'morning',
      status: 'planned',
    })

    const stats = await getTemplateStats(tpl.id)
    // next saute le skipped → prend le planned a J+4
    expect(stats.nextInterventionDate).toBe(addDaysIso(todayUtcIso(), 4))
    // thisWeek compte 1 (le planned), pas le skipped
    expect(stats.interventionsThisWeek).toBe(1)
  })

  it('getTemplateStatsBatch retourne une map coherente sur plusieurs templates', async () => {
    const a = await createTemplate({
      mission_id: missionId,
      title: 'Template A batch',
      frequency: 'daily',
      slots: ['morning'],
      starts_on: addDaysIso(todayUtcIso(), -10),
    })
    const b = await createTemplate({
      mission_id: missionId,
      title: 'Template B batch',
      frequency: 'daily',
      slots: ['afternoon'],
      starts_on: addDaysIso(todayUtcIso(), -10),
    })
    const c = await createTemplate({
      mission_id: missionId,
      title: 'Template C batch',
      frequency: 'daily',
      slots: ['evening'],
      starts_on: addDaysIso(todayUtcIso(), -10),
    })

    // a : 1 future planned
    await insertIntervention({
      missionId,
      templateId: a.id,
      scheduledFor: addDaysIso(todayUtcIso(), 1),
      status: 'planned',
    })
    // b : 1 past completed + 1 future planned
    await insertIntervention({
      missionId,
      templateId: b.id,
      scheduledFor: addDaysIso(todayUtcIso(), -2),
      slot: 'afternoon',
      status: 'completed',
    })
    await insertIntervention({
      missionId,
      templateId: b.id,
      scheduledFor: addDaysIso(todayUtcIso(), 3),
      slot: 'afternoon',
      status: 'planned',
    })
    // c : aucune intervention

    const batch = await getTemplateStatsBatch([a.id, b.id, c.id])
    expect(batch.size).toBe(3)

    const sa = batch.get(a.id)!
    expect(sa.nextInterventionDate).toBe(addDaysIso(todayUtcIso(), 1))
    expect(sa.lastInterventionDate).toBeNull()
    expect(sa.interventionsThisWeek).toBe(1)

    const sb = batch.get(b.id)!
    expect(sb.lastInterventionDate).toBe(addDaysIso(todayUtcIso(), -2))
    expect(sb.lastInterventionStatus).toBe('completed')
    expect(sb.nextInterventionDate).toBe(addDaysIso(todayUtcIso(), 3))
    expect(sb.interventionsThisWeek).toBe(1)

    const sc = batch.get(c.id)!
    expect(sc.lastInterventionDate).toBeNull()
    expect(sc.nextInterventionDate).toBeNull()
    expect(sc.interventionsThisWeek).toBe(0)
  })

  it('getTemplateStatsBatch sur liste vide → map vide, pas de throw', async () => {
    const batch = await getTemplateStatsBatch([])
    expect(batch.size).toBe(0)
  })
})
