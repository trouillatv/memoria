import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { listTenderMemory, setTenderOutcome } from '@/lib/db/tenders'
import type { TenderOutcome } from '@/types/db'

// Suffixe unique pour isoler ce jeu de tests.
const TEST_TAG = '__mc3_memory_list_test__'

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

async function createTender(
  adminId: string,
  title: string,
  clientName: string | null = null,
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tenders')
    .insert({
      title: `${TEST_TAG} ${title}`,
      client_name: clientName,
      status: 'submitted',
      created_by: adminId,
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

interface Seed {
  id: string
  outcome: Exclude<TenderOutcome, 'pending'>
  title: string
  client: string
  reason?: string
  tag?: 'prix' | 'qualite' | 'relation' | 'timing' | 'autre'
}

describe('listTenderMemory — page mémoire journal (MC-3)', () => {
  let adminId: string
  const createdTenders: string[] = []
  let seeded: Seed[] = []

  beforeAll(async () => {
    adminId = await getAdminUserId()

    // Seeds variés.
    const definitions: Omit<Seed, 'id'>[] = [
      { outcome: 'won',           title: 'won-alpha hopital Magenta',        client: 'CHT Magenta' },
      { outcome: 'lost',          title: 'lost-bravo cantine Lapérouse',     client: 'Mairie Lapérouse', reason: 'concurrent moins cher de 8%', tag: 'prix' },
      { outcome: 'lost',          title: 'lost-charlie OPT-NC tour vitres',  client: 'OPT-NC',           reason: 'pas assez de référence client', tag: 'qualite' },
      { outcome: 'lost',          title: 'lost-delta espaces verts province',client: 'Province Sud',     reason: 'connaissance interne du concurrent', tag: 'relation' },
      { outcome: 'withdrawn',     title: 'withdrawn-echo clinique Magnin',   client: 'Clinique Magnin' },
      { outcome: 'not_responded', title: 'noresp-foxtrot lycée Champêtre',   client: 'Province Sud' },
      { outcome: 'won',           title: 'won-golf école Sainte-Marie',      client: 'DDEC' },
    ]

    for (const def of definitions) {
      const id = await createTender(adminId, def.title, def.client)
      createdTenders.push(id)
      // Petit délai pour que les outcome_at diffèrent.
      await new Promise((r) => setTimeout(r, 25))
      await setTenderOutcome({
        tenderId: id,
        outcome: def.outcome,
        reason: def.reason,
        tag: def.tag,
        userId: adminId,
      })
      seeded.push({ id, ...def })
    }
  }, 60_000)

  afterAll(async () => {
    for (const id of createdTenders) await deleteTender(id)
  }, 60_000)

  function onlySeeded<T extends { id: string }>(rows: T[]): T[] {
    const ids = new Set(seeded.map((s) => s.id))
    return rows.filter((r) => ids.has(r.id))
  }

  it('sans filtre → tous les AO avec outcome NOT NULL (et pas pending)', async () => {
    const { items } = await listTenderMemory({ limit: 100 })
    const ours = onlySeeded(items)
    expect(ours.length).toBe(seeded.length)
    // Aucun outcome null ni pending dans le résultat global.
    for (const row of items) {
      expect(row.outcome).not.toBeNull()
      expect(row.outcome).not.toBe('pending')
    }
  })

  it("filtre outcome='lost' → uniquement les perdus", async () => {
    const { items } = await listTenderMemory({ outcome: 'lost', limit: 100 })
    const ours = onlySeeded(items)
    expect(ours.length).toBe(seeded.filter((s) => s.outcome === 'lost').length)
    for (const row of items) {
      expect(row.outcome).toBe('lost')
    }
  })

  it("filtre tag='prix' → uniquement avec ce tag", async () => {
    const { items } = await listTenderMemory({ tag: 'prix', limit: 100 })
    const ours = onlySeeded(items)
    expect(ours.length).toBe(seeded.filter((s) => s.tag === 'prix').length)
    for (const row of items) {
      expect(row.outcome_tag).toBe('prix')
    }
  })

  it('filtre search → match sur title ou client_name', async () => {
    const { items: byTitle } = await listTenderMemory({ search: 'OPT-NC', limit: 100 })
    const oursTitle = onlySeeded(byTitle)
    expect(oursTitle.length).toBeGreaterThanOrEqual(1)
    expect(oursTitle.every((r) =>
      r.title.includes('OPT-NC') || (r.client_name ?? '').includes('OPT-NC'),
    )).toBe(true)

    const { items: byClient } = await listTenderMemory({ search: 'DDEC', limit: 100 })
    const oursClient = onlySeeded(byClient)
    expect(oursClient.length).toBeGreaterThanOrEqual(1)
    expect(oursClient.every((r) => (r.client_name ?? '').includes('DDEC'))).toBe(true)
  })

  it('pagination offset/limit fonctionne', async () => {
    // Filtre uniquement nos AO via search avec le TEST_TAG (chaque title est préfixé)
    // pour pagination déterministe.
    const { items: page1, total: totalA } = await listTenderMemory({
      search: TEST_TAG,
      offset: 0,
      limit: 3,
    })
    const { items: page2, total: totalB } = await listTenderMemory({
      search: TEST_TAG,
      offset: 3,
      limit: 3,
    })
    expect(totalA).toBe(seeded.length)
    expect(totalB).toBe(seeded.length)
    expect(page1.length).toBe(3)
    expect(page2.length).toBeGreaterThan(0)
    // Pas de chevauchement entre les pages.
    const idsP1 = new Set(page1.map((r) => r.id))
    for (const row of page2) expect(idsP1.has(row.id)).toBe(false)
  })

  it('total cohérent avec items après filtre', async () => {
    const { items, total } = await listTenderMemory({
      search: TEST_TAG,
      outcome: 'lost',
      limit: 100,
    })
    const ours = onlySeeded(items)
    const expected = seeded.filter((s) => s.outcome === 'lost').length
    expect(ours.length).toBe(expected)
    // total ≥ items.length (autres tests peuvent avoir laissé des AO),
    // mais après search TEST_TAG, total == nos lost.
    expect(total).toBe(expected)
  })

  it("tri : outcome_at DESC (plus récent d'abord)", async () => {
    const { items } = await listTenderMemory({ search: TEST_TAG, limit: 100 })
    const dates = items.map((r) => new Date(r.outcome_at).getTime())
    for (let i = 0; i < dates.length - 1; i++) {
      expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1])
    }
  })
})
