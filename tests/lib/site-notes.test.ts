// Sprint 2 — Mémoire des lieux (Sprint 2 doctrine V5).
//
// Tests des helpers DB : listSiteNotes / createSiteNote / softDeleteSiteNote.
// Couvre :
//   1. createSiteNote 3-140 chars → row créée
//   2. createSiteNote body < 3 chars → throws
//   3. createSiteNote body > 140 chars → throws
//   4. createSiteNote trim espace → length comptée trimée
//   5. listSiteNotes tri par created_at desc
//   6. softDeleteSiteNote → n'apparaît plus dans list

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSite, listSiteNotes, softDeleteSiteNote } from '@/lib/db/sites'

const TEST_CLIENT_NAME = '__test_site_notes_client__'

let clientId: string
let siteId: string
let adminUserId: string

// createSiteNote utilise createServerClient pour récupérer auth.uid(). On le
// mocke pour les tests (pas de contexte cookie HTTP hors Next.js).
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: globalThis.__SITE_NOTES_TEST_USER_ID__ ?? 'unset' } },
      })),
    },
  })),
}))

declare global {
   
  var __SITE_NOTES_TEST_USER_ID__: string | undefined
}

// Lazy import après mocks pour s'assurer que les hooks vi.mock sont appliqués.
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
    name: 'Test Site Notes',
  })
}

async function cleanupNotes() {
  const supabase = createAdminClient()
  await supabase.from('site_notes').delete().eq('site_id', siteId)
}

async function cleanupAll() {
  const supabase = createAdminClient()
  await supabase.from('site_notes').delete().eq('site_id', siteId)
  await supabase.from('sites').delete().eq('client_id', clientId)
  await supabase.from('clients').delete().eq('id', clientId)
}

describe('site_notes helpers — Sprint 2 mémoire des lieux', () => {
  beforeAll(async () => {
    await setupTestData()
    globalThis.__SITE_NOTES_TEST_USER_ID__ = adminUserId
  })

  afterEach(async () => {
    await cleanupNotes()
  })

  afterAll(async () => {
    await cleanupAll()
    globalThis.__SITE_NOTES_TEST_USER_ID__ = undefined
  })

  it('createSiteNote body valide (3-140 chars) → row créée', async () => {
    const createSiteNote = await importCreateSiteNote()
    const note = await createSiteNote({
      siteId,
      body: 'Bloc B : humidité signalée la semaine dernière',
    })
    expect(note.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(note.site_id).toBe(siteId)
    expect(note.body).toBe('Bloc B : humidité signalée la semaine dernière')
    expect(note.created_by).toBe(adminUserId)
    expect(note.deleted_at).toBeNull()
  })

  it('createSiteNote body < 3 chars (après trim) → throws', async () => {
    const createSiteNote = await importCreateSiteNote()
    await expect(createSiteNote({ siteId, body: 'ok' })).rejects.toThrow(/courte/i)
    await expect(createSiteNote({ siteId, body: '   ' })).rejects.toThrow(/courte/i)
  })

  it('createSiteNote body > 140 chars → throws', async () => {
    const createSiteNote = await importCreateSiteNote()
    const tooLong = 'x'.repeat(141)
    await expect(createSiteNote({ siteId, body: tooLong })).rejects.toThrow(/longue/i)
  })

  it('createSiteNote trim espaces → body persisté trimé', async () => {
    const createSiteNote = await importCreateSiteNote()
    const note = await createSiteNote({
      siteId,
      body: '   Code accès cuisine changé : 4521   ',
    })
    expect(note.body).toBe('Code accès cuisine changé : 4521')
  })

  it('listSiteNotes tri par created_at desc + filtre deleted_at NULL', async () => {
    const createSiteNote = await importCreateSiteNote()
    const n1 = await createSiteNote({ siteId, body: 'Note 1 — la plus ancienne' })
    await new Promise((r) => setTimeout(r, 50))
    const n2 = await createSiteNote({ siteId, body: 'Note 2 — milieu' })
    await new Promise((r) => setTimeout(r, 50))
    const n3 = await createSiteNote({ siteId, body: 'Note 3 — la plus récente' })

    const notes = await listSiteNotes(siteId)
    expect(notes.length).toBe(3)
    // Tri DESC : la plus récente d'abord.
    expect(notes[0].id).toBe(n3.id)
    expect(notes[1].id).toBe(n2.id)
    expect(notes[2].id).toBe(n1.id)
  })

  it('softDeleteSiteNote → deleted_at non-null + n\'apparaît plus dans list', async () => {
    const createSiteNote = await importCreateSiteNote()
    const kept = await createSiteNote({ siteId, body: 'Note à garder' })
    const removed = await createSiteNote({ siteId, body: 'Note à supprimer' })

    await softDeleteSiteNote(removed.id)

    const notes = await listSiteNotes(siteId)
    expect(notes.length).toBe(1)
    expect(notes[0].id).toBe(kept.id)

    // Vérif directe en DB : la ligne supprimée a bien deleted_at.
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('site_notes')
      .select('id, deleted_at')
      .eq('id', removed.id)
      .maybeSingle()
    expect(data).not.toBeNull()
    expect(data!.deleted_at).not.toBeNull()
  })

  it('listSiteNotes limit par défaut renvoie 10 max', async () => {
    const createSiteNote = await importCreateSiteNote()
    // Crée 12 notes ; default limit 10.
    for (let i = 0; i < 12; i++) {
      await createSiteNote({ siteId, body: `Note ${i + 1} contexte site` })
    }
    const notes = await listSiteNotes(siteId)
    expect(notes.length).toBe(10)
  })
})
