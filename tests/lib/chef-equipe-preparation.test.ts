// Sprint 4 PC — Tests du helper generateChefEquipePreparations.
//
// 5 specs :
//   1. Aucune intervention demain → array vide
//   2. Interventions sur 2 chefs d'équipe → 2 préparations distinctes
//   3. À savoir limité à 5 max
//   4. Wording généré : pas de "Pense à...", "N'oublie pas..."
//   5. userPhone récupéré de users.phone (E.164)
//
// On utilise la DB réelle (createAdminClient) avec un TEST_TAG pour cleanup.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  generateChefEquipePreparations,
  tomorrowUtcIso,
} from '@/lib/db/chef-equipe-preparation'

const TEST_TAG = '__test_chef_prep_s4__'

let tenderId: string
let clientId: string
let contractId: string
let siteId: string
let missionId: string
let chefAUserId: string // chef d'équipe A — avec téléphone
let chefBUserId: string // chef d'équipe B — sans téléphone
const createdInterventionIds: string[] = []
const createdSiteNoteIds: string[] = []
const createdUserIds: string[] = []

function tomorrowUtc(): string {
  return tomorrowUtcIso()
}

async function ensureAdmin(): Promise<string> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!data) throw new Error('No admin user — seed needed')
  return data.id
}

async function createChefEquipeUser(
  fullName: string,
  phone: string | null,
): Promise<string> {
  const supabase = createAdminClient()
  // Crée un auth user (via admin API) — nécessaire car la table users a FK
  // potentielle sur auth.users.id. Email unique par TEST_TAG.
  const email = `${TEST_TAG}_${fullName.replace(/\s+/g, '_')}_${Date.now()}@test.local`
  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password: 'TestPassword123!',
    email_confirm: true,
  })
  if (authErr || !authUser.user) throw authErr ?? new Error('auth user creation failed')
  const id = authUser.user.id
  // Met à jour profil users (trigger crée déjà une row, on patch role/phone/full_name).
  const { error: upErr } = await supabase
    .from('users')
    .upsert({
      id,
      email,
      full_name: fullName,
      role: 'chef_equipe',
      phone,
      must_change_password: false,
    })
  if (upErr) throw upErr
  createdUserIds.push(id)
  return id
}

async function setup() {
  const supabase = createAdminClient()
  const adminId = await ensureAdmin()

  // Tender
  const { data: tender, error: tErr } = await supabase
    .from('tenders')
    .insert({ title: `${TEST_TAG}_tender`, status: 'ready', created_by: adminId })
    .select('id')
    .single()
  if (tErr) throw tErr
  tenderId = tender.id

  // Client
  const { data: client, error: clErr } = await supabase
    .from('clients')
    .insert({ name: `${TEST_TAG}_client` })
    .select('id')
    .single()
  if (clErr) throw clErr
  clientId = client.id

  // Contract
  contractId = await createContract({
    tender_id: tenderId,
    name: `${TEST_TAG}_contract`,
    client_name: `${TEST_TAG}_client`,
    start_date: '2026-05-01',
    created_by: adminId,
  })

  // Site
  siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: `${TEST_TAG}_site`,
  })

  // Mission
  missionId = await createMission({
    site_id: siteId,
    name: `${TEST_TAG}_mission`,
    cadence: 'daily',
    created_by: adminId,
  })

  // 2 chefs d'équipe (un avec téléphone, un sans)
  chefAUserId = await createChefEquipeUser(`${TEST_TAG}_ChefA`, '+687111111')
  chefBUserId = await createChefEquipeUser(`${TEST_TAG}_ChefB`, null)
}

async function cleanup() {
  const supabase = createAdminClient()
  if (createdInterventionIds.length > 0) {
    await supabase.from('interventions').delete().in('id', createdInterventionIds)
  }
  if (createdSiteNoteIds.length > 0) {
    await supabase.from('site_notes').delete().in('id', createdSiteNoteIds)
  }
  if (missionId) await supabase.from('missions').delete().eq('id', missionId)
  if (siteId) await supabase.from('sites').delete().eq('id', siteId)
  if (contractId) await supabase.from('contracts').delete().eq('id', contractId)
  if (clientId) await supabase.from('clients').delete().eq('id', clientId)
  if (tenderId) await supabase.from('tenders').delete().eq('id', tenderId)
  // Users — best effort
  for (const uid of createdUserIds) {
    try {
      await supabase.from('users').delete().eq('id', uid)
      await supabase.auth.admin.deleteUser(uid)
    } catch {
      // ignore
    }
  }
}

async function insertIntervention(
  team: string[],
  slot: 'morning' | 'afternoon' | 'evening' | null,
  scheduled_for: string,
): Promise<string> {
  const supabase = createAdminClient()
  const hour = slot === 'morning' ? 8 : slot === 'afternoon' ? 14 : slot === 'evening' ? 19 : 8
  const scheduled_at = `${scheduled_for}T${String(hour).padStart(2, '0')}:00:00.000Z`
  const { data, error } = await supabase
    .from('interventions')
    .insert({
      mission_id: missionId,
      scheduled_at,
      scheduled_for,
      slot,
      status: 'planned',
      team,
    })
    .select('id')
    .single()
  if (error) throw error
  createdInterventionIds.push(data.id)
  return data.id
}

async function insertSiteNote(body: string, site = siteId): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_notes')
    .insert({ site_id: site, body, created_by: chefAUserId })
    .select('id')
    .single()
  if (error) throw error
  createdSiteNoteIds.push(data.id)
  return data.id
}

describe('generateChefEquipePreparations — Sprint 4 PC', () => {
  beforeAll(async () => {
    await setup()
  }, 60_000)

  afterAll(async () => {
    await cleanup()
  }, 60_000)

  it('aucune intervention demain → array vide', async () => {
    // Date 1 an dans le futur — garantie aucun fixture.
    const farFuture = new Date()
    farFuture.setUTCFullYear(farFuture.getUTCFullYear() + 1)
    const iso = farFuture.toISOString().slice(0, 10)
    const result = await generateChefEquipePreparations(iso)
    expect(result).toEqual([])
  })

  it('interventions sur 2 chefs d\'équipe → 2 préparations distinctes', async () => {
    const tomorrow = tomorrowUtc()
    await insertIntervention([chefAUserId], 'morning', tomorrow)
    await insertIntervention([chefBUserId], 'afternoon', tomorrow)

    const result = await generateChefEquipePreparations(tomorrow)
    const tagged = result.filter((r) =>
      r.userFullName.startsWith(TEST_TAG),
    )
    expect(tagged.length).toBe(2)
    const ids = tagged.map((r) => r.userId).sort()
    expect(ids).toContain(chefAUserId)
    expect(ids).toContain(chefBUserId)
    // Au moins un passage chacun.
    for (const t of tagged) {
      expect(t.blocks.passages.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('à savoir limité à 5 max', async () => {
    const tomorrow = tomorrowUtc()
    // Insert 8 notes descriptives (passe le filtre V4) — la veille pour qu'elles
    // soient dans la fenêtre 30j et différentes du test précédent.
    for (let i = 0; i < 8; i++) {
      await insertSiteNote(`Note descriptive ${i} — état du site`)
    }
    const result = await generateChefEquipePreparations(tomorrow)
    const chefA = result.find((r) => r.userId === chefAUserId)
    expect(chefA).toBeDefined()
    expect(chefA!.blocks.aSavoir.length).toBeLessThanOrEqual(5)
  })

  it("wording généré : aucun verbe de contrôle (verrou V4)", async () => {
    const tomorrow = tomorrowUtc()
    // Insère une note qui contient un verbe banni : doit être FILTRÉE.
    const badId = await insertSiteNote(
      "Pense à vérifier le bloc B — formulation interdite",
    )
    // Une note saine pour vérifier qu'elle, elle passe.
    await insertSiteNote('Bloc B : humidité signalée hier — descriptif passif')

    const result = await generateChefEquipePreparations(tomorrow)
    const chefA = result.find((r) => r.userId === chefAUserId)
    expect(chefA).toBeDefined()
    const joined = chefA!.blocks.aSavoir.join('\n')
    expect(joined.toLowerCase()).not.toMatch(/pense\s*à/)
    expect(joined.toLowerCase()).not.toMatch(/n[''’]?oublie\s*pas/)
    expect(joined.toLowerCase()).not.toMatch(/tu\s+dois/)
    expect(joined.toLowerCase()).not.toMatch(/merci\s+de/)
    expect(joined.toLowerCase()).not.toMatch(/attention\s+à/)
    expect(joined.toLowerCase()).not.toMatch(/fais\s+attention/)
    // La note bannie ne doit pas être dans le résultat.
    expect(joined).not.toMatch(/formulation interdite/)
    // Cleanup id capturé pour symétrie
    expect(badId).toBeDefined()
  })

  it('userPhone récupéré de users.phone (E.164)', async () => {
    const tomorrow = tomorrowUtc()
    const result = await generateChefEquipePreparations(tomorrow)
    const chefA = result.find((r) => r.userId === chefAUserId)
    const chefB = result.find((r) => r.userId === chefBUserId)
    expect(chefA?.userPhone).toBe('+687111111')
    expect(chefB?.userPhone).toBeNull()
  })
})
