// Slice 6.4 — Tests helper markInterventionSkipped + server action
// skipInterventionAction.
//
// Couvre :
//   1. markInterventionSkipped sur intervention valide → row updated, status =
//      'skipped', skipped_at non-null, skipped_reason renseigné.
//   2. markInterventionSkipped avec raison vide ou whitespace → throws.
//   3. markInterventionSkipped sur uuid inexistant → no-op (l'UPDATE Supabase
//      sur 0 rows ne lève pas — on vérifie qu'il ne throw pas).
//   4. skipInterventionAction sur intervention in_progress → { ok: false }.
//   5. skipInterventionAction sur intervention planned → { ok: true } + DB
//      updated.

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import { createIntervention } from '@/lib/db/interventions'
import { markInterventionSkipped } from '@/lib/db/intervention-templates'

const TEST_TENDER_TITLE = '__test_skip_phase6_tender__'
const TEST_CLIENT_NAME = '__test_skip_phase6_client__'

let tenderId: string
let contractId: string
let clientId: string
let siteId: string
let missionId: string
let adminUserId: string

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
    name: '__test_contract_skip_phase6__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: 'Test Site Skip',
  })
  missionId = await createMission({
    site_id: siteId,
    name: 'Mission skip test',
    cadence: 'daily',
    created_by: null,
  })
}

async function cleanupInterventions() {
  const supabase = createAdminClient()
  await supabase.from('interventions').delete().eq('mission_id', missionId)
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
      await supabase
        .from('interventions')
        .delete()
        .in('mission_id', missions.map((m) => m.id))
    }
    await supabase.from('missions').delete().in('site_id', siteIds)
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
}

describe('markInterventionSkipped — Slice 6.4', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterEach(async () => {
    await cleanupInterventions()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  it('met à jour la ligne avec status=skipped, skipped_at, skipped_reason', async () => {
    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: '2026-05-13T08:00:00.000Z',
      created_by: null,
    })

    await markInterventionSkipped(intvId, 'Site fermé pour travaux', adminUserId)

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
    expect(data!.skipped_by).toBe(adminUserId)
  })

  it('raison vide → throws', async () => {
    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: '2026-05-13T08:00:00.000Z',
      created_by: null,
    })
    await expect(markInterventionSkipped(intvId, '')).rejects.toThrow(/reason/i)
  })

  it('raison whitespace-only → throws (trim → empty)', async () => {
    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: '2026-05-13T08:00:00.000Z',
      created_by: null,
    })
    await expect(markInterventionSkipped(intvId, '   ')).rejects.toThrow(/reason/i)
  })

  it('uuid inexistant → no-op (pas de throw, 0 lignes affectées)', async () => {
    // UUID valide mais inexistant.
    const fakeUuid = '00000000-0000-4000-8000-000000000000'
    await expect(
      markInterventionSkipped(fakeUuid, 'Raison valide pour test')
    ).resolves.toBeUndefined()
  })

  it('intervention déjà sautée → ré-écrit le motif (helper bas niveau, pas de check status)', async () => {
    // markInterventionSkipped est un helper bas niveau. La protection
    // status==='planned' vit dans la server action skipInterventionAction.
    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: '2026-05-13T08:00:00.000Z',
      created_by: null,
    })
    await markInterventionSkipped(intvId, 'Première raison')
    await markInterventionSkipped(intvId, 'Deuxième raison')

    const supabase = createAdminClient()
    const { data } = await supabase
      .from('interventions')
      .select('skipped_reason')
      .eq('id', intvId)
      .maybeSingle()
    expect(data!.skipped_reason).toBe('Deuxième raison')
  })
})

// ---------------------------------------------------------------------------
// Server action skipInterventionAction
// ---------------------------------------------------------------------------

// On mocke l'auth pour ne pas dépendre du contexte HTTP / cookies. Le helper
// requireFieldAgent vit dans le module actions ; on ne peut pas le re-mocker
// trivialement sans réorganiser. Stratégie pragmatique : on mocke
// `@/lib/supabase/server` (utilisé par requireFieldAgent) pour retourner
// adminUserId, et `@/lib/db/users.getUserRoleById` pour retourner 'admin'.

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: globalThis.__SKIP_TEST_USER_ID__ ?? 'unset' } },
      })),
    },
  })),
}))

// revalidatePath needs a static-generation store inside a Next.js request
// context. Hors contexte (test pur), il throw. On le neutralise.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/db/users', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/db/users')>()
  return {
    ...orig,
    getUserRoleById: vi.fn(async () => 'admin' as const),
  }
})

// Lazy import après mocks pour s'assurer que les hooks vi.mock sont appliqués.
async function importSkipAction() {
  const mod = await import('@/app/(field)/m/intervention/[id]/actions')
  return mod.skipInterventionAction
}

declare global {
  // eslint-disable-next-line no-var
  var __SKIP_TEST_USER_ID__: string | undefined
}

describe('skipInterventionAction (server action) — Slice 6.4', () => {
  beforeAll(async () => {
    await setupTestData()
    globalThis.__SKIP_TEST_USER_ID__ = adminUserId
  })

  afterEach(async () => {
    await cleanupInterventions()
  })

  afterAll(async () => {
    await cleanupAll()
    globalThis.__SKIP_TEST_USER_ID__ = undefined
  })

  it('intervention planned + raison valide → { ok: true } et DB mise à jour', async () => {
    const skipInterventionAction = await importSkipAction()
    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: '2026-05-13T08:00:00.000Z',
      created_by: null,
    })

    const fd = new FormData()
    fd.set('intervention_id', intvId)
    fd.set('reason', 'Site fermé, accès condamné')

    const r = await skipInterventionAction(fd)
    expect(r).toEqual(expect.objectContaining({ ok: true }))

    const supabase = createAdminClient()
    const { data } = await supabase
      .from('interventions')
      .select('status, skipped_reason')
      .eq('id', intvId)
      .maybeSingle()
    expect(data!.status).toBe('skipped')
    expect(data!.skipped_reason).toBe('Site fermé, accès condamné')
  })

  it('intervention in_progress → { ok: false } avec message d\'erreur', async () => {
    const skipInterventionAction = await importSkipAction()
    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: '2026-05-13T08:00:00.000Z',
      created_by: null,
    })
    // Démarrer manuellement (passer à in_progress)
    const supabase = createAdminClient()
    await supabase.from('interventions').update({ status: 'in_progress' }).eq('id', intvId)

    const fd = new FormData()
    fd.set('intervention_id', intvId)
    fd.set('reason', 'Raison test refusée')

    const r = await skipInterventionAction(fd)
    expect(r).toEqual(expect.objectContaining({ ok: false }))
    expect((r as { error?: string }).error).toMatch(/commencée|en cours|déjà/i)

    // DB doit rester inchangée (toujours in_progress, pas skipped)
    const { data } = await supabase
      .from('interventions')
      .select('status, skipped_at')
      .eq('id', intvId)
      .maybeSingle()
    expect(data!.status).toBe('in_progress')
    expect(data!.skipped_at).toBeNull()
  })

  it('raison trop courte → { ok: false }', async () => {
    const skipInterventionAction = await importSkipAction()
    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: '2026-05-13T08:00:00.000Z',
      created_by: null,
    })

    const fd = new FormData()
    fd.set('intervention_id', intvId)
    fd.set('reason', 'ok') // 2 chars, < 3

    const r = await skipInterventionAction(fd)
    expect(r).toEqual(expect.objectContaining({ ok: false }))
  })

  it('intervention introuvable → { ok: false, error: "Intervention introuvable" }', async () => {
    const skipInterventionAction = await importSkipAction()

    const fd = new FormData()
    fd.set('intervention_id', '00000000-0000-4000-8000-000000000000')
    fd.set('reason', 'Raison valide pour test')

    const r = await skipInterventionAction(fd)
    expect(r).toEqual(expect.objectContaining({ ok: false }))
    expect((r as { error?: string }).error).toMatch(/introuvable/i)
  })
})
