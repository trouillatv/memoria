// MC-4 — voice note DG sur AO finalisé.
//
// Tests DB minimaux. Pas de test upload réel (Blob/Storage → trop complexe en
// vitest node). On valide :
//   1. Schéma : colonnes voice_note_* présentes sur tenders.
//   2. CHECK contrainte : duration 0 ou 181 refusée.
//   3. getSignedVoiceNoteUrl pour tender sans voice_note → null.
//   4. UPDATE direct voice_note_path → row mis à jour.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSignedVoiceNoteUrl } from '@/lib/db/tenders'

const TEST_TENDER_TITLE = '__test_tender_voice_note_mc4__'

async function getAdminUserId(): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (error || !data) throw new Error('No admin user available for test setup')
  return data.id
}

async function createTestTender(adminId: string): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tenders')
    .insert({
      title: TEST_TENDER_TITLE,
      status: 'submitted',
      created_by: adminId,
      outcome: 'lost',
      outcome_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('Insert tender failed')
  return data.id
}

async function deleteTender(id: string) {
  const supabase = createAdminClient()
  await supabase.from('tenders').delete().eq('id', id)
}

async function fetchVoiceFields(id: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tenders')
    .select('id, voice_note_path, voice_note_duration_seconds, voice_note_recorded_at, voice_note_recorded_by')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

describe('tender voice_note schema (MC-4)', () => {
  let adminId: string
  const createdTenders: string[] = []

  beforeAll(async () => {
    adminId = await getAdminUserId()
  })

  afterAll(async () => {
    for (const id of createdTenders) {
      await deleteTender(id)
    }
  })

  it('colonnes voice_note_* présentes sur tenders', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)
    const row = await fetchVoiceFields(id)
    // Au démarrage, tout est NULL — mais les colonnes existent (sinon select throw).
    expect(row).toBeDefined()
    expect(row.voice_note_path).toBeNull()
    expect(row.voice_note_duration_seconds).toBeNull()
    expect(row.voice_note_recorded_at).toBeNull()
    expect(row.voice_note_recorded_by).toBeNull()
  })

  it('CHECK contrainte : duration 0 refusée', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('tenders')
      .update({
        voice_note_path: 'x/y.webm',
        voice_note_duration_seconds: 0,
        voice_note_recorded_at: new Date().toISOString(),
        voice_note_recorded_by: adminId,
      })
      .eq('id', id)
    expect(error).not.toBeNull()
  })

  it('CHECK contrainte : duration 181 refusée', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('tenders')
      .update({
        voice_note_path: 'x/y.webm',
        voice_note_duration_seconds: 181,
        voice_note_recorded_at: new Date().toISOString(),
        voice_note_recorded_by: adminId,
      })
      .eq('id', id)
    expect(error).not.toBeNull()
  })

  it('CHECK accepte 1 et 180 (bornes)', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)
    const supabase = createAdminClient()
    const { error: e1 } = await supabase
      .from('tenders')
      .update({
        voice_note_path: 'x/1s.webm',
        voice_note_duration_seconds: 1,
        voice_note_recorded_at: new Date().toISOString(),
        voice_note_recorded_by: adminId,
      })
      .eq('id', id)
    expect(e1).toBeNull()

    const { error: e180 } = await supabase
      .from('tenders')
      .update({ voice_note_duration_seconds: 180 })
      .eq('id', id)
    expect(e180).toBeNull()
  })

  it('getSignedVoiceNoteUrl → null si pas de voice_note_path', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)
    const url = await getSignedVoiceNoteUrl(id)
    expect(url).toBeNull()
  })

  it('UPDATE voice_note_path → ligne mise à jour', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)
    const supabase = createAdminClient()
    const path = `${id}/seed.webm`
    const ts = new Date().toISOString()
    const { error } = await supabase
      .from('tenders')
      .update({
        voice_note_path: path,
        voice_note_duration_seconds: 42,
        voice_note_recorded_at: ts,
        voice_note_recorded_by: adminId,
      })
      .eq('id', id)
    expect(error).toBeNull()

    const row = await fetchVoiceFields(id)
    expect(row.voice_note_path).toBe(path)
    expect(row.voice_note_duration_seconds).toBe(42)
    expect(row.voice_note_recorded_by).toBe(adminId)
  })
})
