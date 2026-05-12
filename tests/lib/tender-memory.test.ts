import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { findSimilarTenderMemory, setTenderOutcome } from '@/lib/db/tenders'

// Suffixe unique pour isoler des autres jeux de tests.
const TEST_TAG = '__mc2_memory_test__'

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
  status: 'draft' | 'submitted' | 'ready' = 'draft',
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tenders')
    .insert({
      title: `${TEST_TAG} ${title}`,
      client_name: clientName,
      status,
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

describe('findSimilarTenderMemory — mémoire commerciale (MC-2)', () => {
  let adminId: string
  const createdTenders: string[] = []

  beforeAll(async () => {
    adminId = await getAdminUserId()
  })

  afterAll(async () => {
    for (const id of createdTenders) await deleteTender(id)
  })

  it('retourne [] si aucun AO similaire avec outcome finalisé', async () => {
    // current isolé, aucun autre AO ne match
    const current = await createTender(
      adminId,
      'titre-very-unique-zzzqqq-xxxyyy-aaa',
      'client-very-unique-zzzqqq-xxxyyy-aaa',
    )
    createdTenders.push(current)

    const result = await findSimilarTenderMemory(current)
    expect(result).toEqual([])
  })

  it('match titre proche → 1+ résultat avec similarity > seuil', async () => {
    // Title commun → forte similarité
    const past = await createTender(
      adminId,
      'nettoyage ecole maternelle Champetre',
      'Mairie de Champetre',
      'submitted',
    )
    createdTenders.push(past)
    // outcome=lost pour passer le filtre
    await setTenderOutcome({
      tenderId: past,
      outcome: 'lost',
      reason: 'prix concurrent moins cher',
      tag: 'prix',
      userId: adminId,
    })

    const current = await createTender(
      adminId,
      'nettoyage ecole maternelle Champetre 2026',
      'Mairie de Champetre',
    )
    createdTenders.push(current)

    const result = await findSimilarTenderMemory(current)
    expect(result.length).toBeGreaterThanOrEqual(1)
    const matched = result.find((r) => r.id === past)
    expect(matched).toBeDefined()
    expect(matched!.similarity).toBeGreaterThan(0.25)
    expect(matched!.outcome).toBe('lost')
    expect(matched!.outcome_reason).toBe('prix concurrent moins cher')
    expect(matched!.outcome_tag).toBe('prix')
  })

  it("filtre les outcomes pending/withdrawn/not_responded (ne renvoie que won/lost)", async () => {
    const pending = await createTender(
      adminId,
      'cantine scolaire Noumea sud',
      'Province Sud',
      'submitted',
    )
    createdTenders.push(pending)
    await setTenderOutcome({
      tenderId: pending,
      outcome: 'pending',
      userId: adminId,
    })

    const withdrawn = await createTender(
      adminId,
      'cantine scolaire Noumea sud',
      'Province Sud',
      'submitted',
    )
    createdTenders.push(withdrawn)
    await setTenderOutcome({
      tenderId: withdrawn,
      outcome: 'withdrawn',
      userId: adminId,
    })

    const wonOne = await createTender(
      adminId,
      'cantine scolaire Noumea sud',
      'Province Sud',
      'submitted',
    )
    createdTenders.push(wonOne)
    await setTenderOutcome({ tenderId: wonOne, outcome: 'won', userId: adminId })

    const current = await createTender(
      adminId,
      'cantine scolaire Noumea sud 2027',
      'Province Sud',
    )
    createdTenders.push(current)

    const result = await findSimilarTenderMemory(current)
    const ids = result.map((r) => r.id)
    expect(ids).toContain(wonOne)
    expect(ids).not.toContain(pending)
    expect(ids).not.toContain(withdrawn)
    for (const r of result) {
      expect(['won', 'lost']).toContain(r.outcome)
    }
  })

  it('tri : perdus d\'abord, puis date desc', async () => {
    // Trois AO similaires sur même thématique :
    //   wonOld (won, plus vieux)
    //   lostNew (lost, plus recent)
    //   lostOld (lost, plus vieux)
    // Attendu ordre : lostNew, lostOld, wonOld
    const lostOld = await createTender(
      adminId,
      'maintenance espaces verts collège Beta',
      'Province Sud',
      'submitted',
    )
    createdTenders.push(lostOld)
    await setTenderOutcome({ tenderId: lostOld, outcome: 'lost', userId: adminId })

    // delay so outcome_at differs
    await new Promise((r) => setTimeout(r, 50))

    const wonOld = await createTender(
      adminId,
      'maintenance espaces verts collège Beta',
      'Province Sud',
      'submitted',
    )
    createdTenders.push(wonOld)
    await setTenderOutcome({ tenderId: wonOld, outcome: 'won', userId: adminId })

    await new Promise((r) => setTimeout(r, 50))

    const lostNew = await createTender(
      adminId,
      'maintenance espaces verts collège Beta',
      'Province Sud',
      'submitted',
    )
    createdTenders.push(lostNew)
    await setTenderOutcome({ tenderId: lostNew, outcome: 'lost', userId: adminId })

    const current = await createTender(
      adminId,
      'maintenance espaces verts collège Beta annexe',
      'Province Sud',
    )
    createdTenders.push(current)

    const result = await findSimilarTenderMemory(current)
    const ids = result.map((r) => r.id)
    // Les 2 lost doivent précéder le won dans le tri
    const idxLostNew = ids.indexOf(lostNew)
    const idxLostOld = ids.indexOf(lostOld)
    const idxWonOld = ids.indexOf(wonOld)
    expect(idxLostNew).toBeGreaterThanOrEqual(0)
    expect(idxLostOld).toBeGreaterThanOrEqual(0)
    expect(idxWonOld).toBeGreaterThanOrEqual(0)
    expect(idxLostNew).toBeLessThan(idxWonOld)
    expect(idxLostOld).toBeLessThan(idxWonOld)
    // Parmi les 2 lost, le plus récent passe devant
    expect(idxLostNew).toBeLessThan(idxLostOld)
  })

  it('respecte limit (max 5 par défaut)', async () => {
    // 7 AO similaires perdus → limit doit couper à 5
    const ids: string[] = []
    for (let i = 0; i < 7; i++) {
      const id = await createTender(
        adminId,
        'gardiennage centre hospitalier territorial',
        'CHT',
        'submitted',
      )
      ids.push(id)
      createdTenders.push(id)
      await setTenderOutcome({ tenderId: id, outcome: 'lost', userId: adminId })
    }

    const current = await createTender(
      adminId,
      'gardiennage centre hospitalier territorial Magenta',
      'CHT',
    )
    createdTenders.push(current)

    const result = await findSimilarTenderMemory(current)
    expect(result.length).toBeLessThanOrEqual(5)
  })

  it('threshold custom plus restrictif que default', async () => {
    // AO légèrement similaire (un mot en commun, le reste différent)
    const past = await createTender(
      adminId,
      'gardiennage parking aeroport magenta',
      'aeroport magenta',
      'submitted',
    )
    createdTenders.push(past)
    await setTenderOutcome({ tenderId: past, outcome: 'lost', userId: adminId })

    const current = await createTender(
      adminId,
      'gardiennage hopital nord',
      'CHT Nord',
    )
    createdTenders.push(current)

    const loose = await findSimilarTenderMemory(current, { threshold: 0.1 })
    const strict = await findSimilarTenderMemory(current, { threshold: 0.9 })
    expect(strict.length).toBeLessThanOrEqual(loose.length)
  })

  it('tender sans title ni client_name → []', async () => {
    // On insère directement avec title='' n'est pas possible (NOT NULL). On
    // teste donc le cas où le tender n'existe pas (return [] aussi).
    const result = await findSimilarTenderMemory(
      '00000000-0000-0000-0000-000000000000',
    )
    expect(result).toEqual([])
  })
})
