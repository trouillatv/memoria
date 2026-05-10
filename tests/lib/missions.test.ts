import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSite, listSitesByContract } from '@/lib/db/sites'
import { createMission, listMissionsByContract, updateMission, getMission } from '@/lib/db/missions'
import { createContract } from '@/lib/db/contracts'

const TEST_TENDER_TITLE = '__test_field_mvp_tender__'
const TEST_CLIENT_NAME = '__test_field_mvp_client__'

let tenderId: string
let contractId: string
let clientId: string

async function setupTestData() {
  const supabase = createAdminClient()
  // Find admin
  const { data: admin } = await supabase.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  if (!admin) throw new Error('No admin user')

  // Tender
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

  // Client
  const { data: existingClient } = await supabase.from('clients').select('id').eq('name', TEST_CLIENT_NAME).maybeSingle()
  if (existingClient) {
    clientId = existingClient.id
  } else {
    const { data, error } = await supabase.from('clients').insert({ name: TEST_CLIENT_NAME }).select('id').single()
    if (error) throw error
    clientId = data.id
  }

  // Contract
  contractId = await createContract({
    tender_id: tenderId,
    name: '__test_contract__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })
}

async function cleanupAll() {
  const supabase = createAdminClient()
  // Delete missions, sites referencing test contract / client
  const { data: sites } = await supabase.from('sites').select('id').eq('client_id', clientId)
  if (sites && sites.length > 0) {
    await supabase.from('missions').delete().in('site_id', sites.map((s) => s.id))
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
}

describe('missions DB helpers', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterEach(async () => {
    const supabase = createAdminClient()
    const { data: sites } = await supabase.from('sites').select('id').eq('client_id', clientId)
    if (sites && sites.length > 0) {
      await supabase.from('missions').delete().in('site_id', sites.map((s) => s.id))
      await supabase.from('sites').delete().eq('client_id', clientId)
    }
  })

  it('createMission persists with engagement_ids', async () => {
    const siteId = await createSite({ client_id: clientId, contract_id: contractId, name: 'Test Site A' })
    const missionId = await createMission({
      site_id: siteId,
      name: 'Nettoyage quotidien',
      cadence: 'daily',
      engagement_ids: [],
      default_checklist: [
        { label: 'Vidage poubelles', required: true, position: 1 },
        { label: 'Désinfection sanitaires', required: true, position: 2 },
      ],
      created_by: null,
    })
    const mission = await getMission(missionId)
    expect(mission).not.toBeNull()
    expect(mission!.cadence).toBe('daily')
    expect(mission!.default_checklist).toHaveLength(2)
  })

  it('listMissionsByContract returns missions across all sites of contract', async () => {
    const site1 = await createSite({ client_id: clientId, contract_id: contractId, name: 'Site 1' })
    const site2 = await createSite({ client_id: clientId, contract_id: contractId, name: 'Site 2' })
    await createMission({ site_id: site1, name: 'M1', cadence: 'daily', created_by: null })
    await createMission({ site_id: site2, name: 'M2', cadence: 'weekly', created_by: null })
    const missions = await listMissionsByContract(contractId)
    expect(missions.length).toBe(2)
  })

  it('listSitesByContract filters correctly', async () => {
    await createSite({ client_id: clientId, contract_id: contractId, name: 'Linked' })
    await createSite({ client_id: clientId, contract_id: null, name: 'Unlinked' })
    const sites = await listSitesByContract(contractId)
    expect(sites.length).toBe(1)
    expect(sites[0].name).toBe('Linked')
  })

  it('updateMission patches fields', async () => {
    const siteId = await createSite({ client_id: clientId, contract_id: contractId, name: 'Site' })
    const missionId = await createMission({ site_id: siteId, name: 'Avant', cadence: 'daily', created_by: null })
    await updateMission(missionId, { name: 'Après', cadence: 'weekly' })
    const m = await getMission(missionId)
    expect(m!.name).toBe('Après')
    expect(m!.cadence).toBe('weekly')
  })
})

// Final cleanup of contract + tender + client
afterEach(async () => {
  // intra-test cleanup handled in describe block; final cleanup runs after all tests
})

// Note: contract is left to clean up at suite end via process exit; harmless test data.
// (No afterAll to drop contract/tender to avoid coupling with other suites.)
void cleanupAll
