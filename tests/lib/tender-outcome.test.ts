import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { setTenderOutcome } from '@/lib/db/tenders'

const TEST_TENDER_TITLE = '__test_tender_outcome_mc1__'

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
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('Insert tender failed')
  return data.id
}

async function fetchTender(id: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tenders')
    .select('id, status, outcome, outcome_at, outcome_reason, outcome_tag, outcome_set_by')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

async function deleteTender(id: string) {
  const supabase = createAdminClient()
  await supabase.from('tenders').delete().eq('id', id)
}

describe('setTenderOutcome — mémoire commerciale (MC-1)', () => {
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

  it('marque un AO en won (minimal — sans reason ni tag)', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)

    const before = Date.now()
    const result = await setTenderOutcome({
      tenderId: id,
      outcome: 'won',
      userId: adminId,
    })
    const after = Date.now()

    expect(result.outcome).toBe('won')
    expect(result.outcome_reason).toBeNull()
    expect(result.outcome_tag).toBeNull()
    expect(result.outcome_set_by).toBe(adminId)
    expect(result.outcome_at).not.toBeNull()

    // outcome_at est un timestamp proche de now (tolérance large : skew serveur)
    const ts = new Date(result.outcome_at as string).getTime()
    expect(ts).toBeGreaterThanOrEqual(before - 60_000)
    expect(ts).toBeLessThanOrEqual(after + 60_000)
  })

  it('marque un AO perdu avec reason + tag', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)

    const result = await setTenderOutcome({
      tenderId: id,
      outcome: 'lost',
      reason: 'Prix trop haut comparé à Sodexo',
      tag: 'prix',
      userId: adminId,
    })

    expect(result.outcome).toBe('lost')
    expect(result.outcome_reason).toBe('Prix trop haut comparé à Sodexo')
    expect(result.outcome_tag).toBe('prix')
    expect(result.outcome_set_by).toBe(adminId)
  })

  it('refuse une reason > 200 chars (CHECK constraint)', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)

    const tooLong = 'x'.repeat(201)

    await expect(
      setTenderOutcome({
        tenderId: id,
        outcome: 'lost',
        reason: tooLong,
        userId: adminId,
      }),
    ).rejects.toThrow()
  })

  it('cohérence : outcome=pending force reason et tag à NULL', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)

    // On essaie d'envoyer reason+tag avec pending → le helper doit nullifier.
    const result = await setTenderOutcome({
      tenderId: id,
      outcome: 'pending',
      reason: 'devrait être ignoré',
      tag: 'prix',
      userId: adminId,
    })

    expect(result.outcome).toBe('pending')
    expect(result.outcome_reason).toBeNull()
    expect(result.outcome_tag).toBeNull()
  })

  it('outcome_at est auto-set à chaque appel (now)', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)

    const r1 = await setTenderOutcome({
      tenderId: id,
      outcome: 'pending',
      userId: adminId,
    })
    expect(r1.outcome_at).not.toBeNull()

    // Petit délai puis update
    await new Promise((res) => setTimeout(res, 50))

    const r2 = await setTenderOutcome({
      tenderId: id,
      outcome: 'won',
      userId: adminId,
    })
    expect(r2.outcome_at).not.toBeNull()
    expect(new Date(r2.outcome_at as string).getTime()).toBeGreaterThanOrEqual(
      new Date(r1.outcome_at as string).getTime(),
    )
  })

  it('outcome_set_by = userId fourni', async () => {
    const id = await createTestTender(adminId)
    createdTenders.push(id)

    const result = await setTenderOutcome({
      tenderId: id,
      outcome: 'withdrawn',
      userId: adminId,
    })

    expect(result.outcome_set_by).toBe(adminId)

    // Vérif en re-fetchant (pas que la valeur retournée par le helper soit OK,
    // mais que la DB est bien à jour).
    const fresh = await fetchTender(id)
    expect(fresh.outcome).toBe('withdrawn')
    expect(fresh.outcome_set_by).toBe(adminId)
  })
})
