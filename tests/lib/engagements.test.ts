import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  listEngagementsByTender,
  bulkInsertEngagements,
  curateEngagement,
  activateEngagementsForContract,
  rejectEngagements,
  findSimilarEngagements,
} from '@/lib/db/engagements'
import { createContract } from '@/lib/db/contracts'

const TEST_TENDER_TITLE = '__test_engagement_phase1_tender__'

async function getOrCreateTestTender(): Promise<string> {
  const supabase = createAdminClient()
  // Find admin user to satisfy created_by
  const { data: admin } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!admin) throw new Error('No admin user found for test setup')

  const { data: existing } = await supabase
    .from('tenders')
    .select('id')
    .eq('title', TEST_TENDER_TITLE)
    .maybeSingle()
  if (existing) return existing.id

  const { data, error } = await supabase
    .from('tenders')
    .insert({ title: TEST_TENDER_TITLE, status: 'ready', created_by: admin.id })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function cleanup(tenderId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('engagements').delete().eq('tender_id', tenderId)
  await supabase.from('contracts').delete().eq('tender_id', tenderId)
}

describe('engagements DB helpers', () => {
  let tenderId: string

  beforeAll(async () => {
    tenderId = await getOrCreateTestTender()
    await cleanup(tenderId)
  })

  afterEach(async () => {
    await cleanup(tenderId)
  })

  it('bulkInsert creates engagements with status=extracted', async () => {
    const inserted = await bulkInsertEngagements({
      tender_id: tenderId,
      created_by: null,
      engagements: [
        {
          source_type: 'memoire_engagement',
          source_excerpt: 'Désinfection biquotidienne sanitaires écolabel',
          source_ref: { page: 12, section: '3.2' },
          category: 'frequency',
          short_label: 'Sanitaires 2x/jour avec écolabel',
          measurable: true,
          ai_confidence: 0.92,
        },
      ],
    })
    expect(inserted.length).toBe(1)
    expect(inserted[0].status).toBe('extracted')
    expect(inserted[0].short_label).toContain('Sanitaires')
    expect(inserted[0].ai_confidence).toBe(0.92)
  })

  it('bulkInsert with empty array returns empty', async () => {
    const inserted = await bulkInsertEngagements({
      tender_id: tenderId,
      created_by: null,
      engagements: [],
    })
    expect(inserted).toEqual([])
  })

  it('curateEngagement updates label + category + sets status=curated', async () => {
    const inserted = await bulkInsertEngagements({
      tender_id: tenderId,
      created_by: null,
      engagements: [{
        source_type: 'ao_clause',
        source_excerpt: 'Clause X exemple',
        source_ref: null,
        category: 'compliance',
        short_label: 'Initial label',
        measurable: false,
        ai_confidence: 0.7,
      }],
    })
    await curateEngagement(inserted[0].id, { short_label: 'Updated label', category: 'quality' })
    const list = await listEngagementsByTender(tenderId)
    expect(list[0].short_label).toBe('Updated label')
    expect(list[0].category).toBe('quality')
    expect(list[0].status).toBe('curated')
  })

  it('curateEngagement is rejected when engagement is already active', async () => {
    const inserted = await bulkInsertEngagements({
      tender_id: tenderId,
      created_by: null,
      engagements: [{
        source_type: 'ao_clause',
        source_excerpt: 'Clause Y exemple',
        source_ref: null,
        category: 'compliance',
        short_label: 'Before',
        measurable: false,
        ai_confidence: 0.7,
      }],
    })
    const contractId = await createContract({
      tender_id: tenderId,
      name: 'Test contract',
      client_name: 'Test client',
      start_date: '2026-05-01',
      created_by: null,
    })
    await activateEngagementsForContract(tenderId, contractId)
    await curateEngagement(inserted[0].id, { short_label: 'Should not apply' })
    const list = await listEngagementsByTender(tenderId)
    expect(list[0].short_label).toBe('Before')
    expect(list[0].status).toBe('active')
  })

  it('activateEngagementsForContract sets contract_id + status=active', async () => {
    await bulkInsertEngagements({
      tender_id: tenderId,
      created_by: null,
      engagements: [
        { source_type: 'memoire_engagement', source_excerpt: 'A exemple', source_ref: null,
          category: 'frequency', short_label: 'Engagement A', measurable: true, ai_confidence: 0.9 },
        { source_type: 'memoire_engagement', source_excerpt: 'B exemple', source_ref: null,
          category: 'quality', short_label: 'Engagement B', measurable: false, ai_confidence: 0.8 },
      ],
    })
    const contractId = await createContract({
      tender_id: tenderId,
      name: 'Test contract',
      client_name: 'Test client',
      start_date: '2026-05-01',
      created_by: null,
    })
    const count = await activateEngagementsForContract(tenderId, contractId)
    expect(count).toBe(2)
    const list = await listEngagementsByTender(tenderId)
    expect(list.every((e) => e.status === 'active' && e.contract_id === contractId)).toBe(true)
  })

  it('rejectEngagements removes only extracted engagements', async () => {
    const inserted = await bulkInsertEngagements({
      tender_id: tenderId,
      created_by: null,
      engagements: [
        { source_type: 'ao_clause', source_excerpt: 'X exemple', source_ref: null,
          category: 'other', short_label: 'Engagement X', measurable: false, ai_confidence: 0.5 },
        { source_type: 'ao_clause', source_excerpt: 'Y exemple', source_ref: null,
          category: 'other', short_label: 'Engagement Y', measurable: false, ai_confidence: 0.5 },
      ],
    })
    await rejectEngagements([inserted[0].id])
    const remaining = await listEngagementsByTender(tenderId)
    expect(remaining.length).toBe(1)
    expect(remaining[0].id).toBe(inserted[1].id)
  })
})

// ============================================================================
// Phase 4 — Cross-tender matching (pg_trgm similarity engine)
// ============================================================================

async function ensureTenderExists(prefix: string): Promise<{ id: string }> {
  const title = `__test_${prefix}__`
  const supabase = createAdminClient()
  const { data: admin } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!admin) throw new Error('No admin user')

  const { data: existing } = await supabase
    .from('tenders')
    .select('id')
    .eq('title', title)
    .maybeSingle()
  if (existing) return { id: existing.id }

  const { data, error } = await supabase
    .from('tenders')
    .insert({ title, status: 'ready', created_by: admin.id })
    .select('id')
    .single()
  if (error) throw error
  return { id: data.id }
}

async function cleanupTender(tenderId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('engagements').delete().eq('tender_id', tenderId)
  await supabase.from('contracts').delete().eq('tender_id', tenderId)
  await supabase.from('tenders').delete().eq('id', tenderId)
}

describe('findSimilarEngagements (pg_trgm)', () => {
  it('returns empty for query too short', async () => {
    const r = await findSimilarEngagements({ query: 'abc' })
    expect(r).toEqual([])
  })

  it('matches engagements with similar source_excerpt', async () => {
    const { id: tender1 } = await ensureTenderExists('similar-1')
    try {
      await bulkInsertEngagements({
        tender_id: tender1,
        created_by: null,
        engagements: [{
          source_type: 'memoire_engagement',
          source_excerpt: 'Bionettoyage biquotidien des sanitaires avec produits écolabel certifiés',
          source_ref: null,
          category: 'frequency',
          short_label: 'Sanitaires 2x/jour écolabel',
          measurable: true,
          ai_confidence: 0.92,
        }],
      })

      const contractId = await createContract({
        tender_id: tender1,
        name: 'Test contract similar',
        client_name: 'Test client',
        start_date: '2026-05-01',
        created_by: null,
      })
      await activateEngagementsForContract(tender1, contractId)

      const matches = await findSimilarEngagements({
        query: 'nettoyage sanitaires écolabel produits certifiés',
        threshold: 0.2,
        limit: 5,
      })

      const found = matches.find((m) => m.engagement.tender_id === tender1)
      expect(found).toBeDefined()
      expect(found!.similarity).toBeGreaterThan(0.2)
    } finally {
      await cleanupTender(tender1)
    }
  })

  it('excludes engagements from a specific tender when excludeTenderId provided', async () => {
    const { id: tenderA } = await ensureTenderExists('exclude-A')
    try {
      await bulkInsertEngagements({
        tender_id: tenderA,
        created_by: null,
        engagements: [{
          source_type: 'memoire_engagement',
          source_excerpt: 'Audit qualité hebdomadaire avec rapport écrit transmis sous 48h',
          source_ref: null,
          category: 'reporting',
          short_label: 'Audit qualité hebdo',
          measurable: true,
          ai_confidence: 0.88,
        }],
      })
      const contractId = await createContract({
        tender_id: tenderA,
        name: 'Test contract A',
        client_name: 'Test client',
        start_date: '2026-05-01',
        created_by: null,
      })
      await activateEngagementsForContract(tenderA, contractId)

      const matches = await findSimilarEngagements({
        query: 'audit qualité hebdomadaire rapport écrit',
        excludeTenderId: tenderA,
        threshold: 0.2,
      })
      const found = matches.find((m) => m.engagement.tender_id === tenderA)
      expect(found).toBeUndefined()
    } finally {
      await cleanupTender(tenderA)
    }
  })

  it('excludes engagements with status extracted/curated/archived', async () => {
    const { id: tenderC } = await ensureTenderExists('status-filter')
    try {
      await bulkInsertEngagements({
        tender_id: tenderC,
        created_by: null,
        engagements: [{
          source_type: 'memoire_engagement',
          source_excerpt: 'Désinfection biquotidienne unique testée pour ce cas',
          source_ref: null,
          category: 'frequency',
          short_label: 'Désinfection unique test',
          measurable: true,
          ai_confidence: 0.90,
        }],
      })
      // Note : engagement stays in status='extracted' since we didn't activate it

      const matches = await findSimilarEngagements({
        query: 'désinfection biquotidienne unique',
        threshold: 0.2,
      })
      const found = matches.find((m) => m.engagement.tender_id === tenderC)
      expect(found).toBeUndefined() // extracted status should be excluded
    } finally {
      await cleanupTender(tenderC)
    }
  })
})
