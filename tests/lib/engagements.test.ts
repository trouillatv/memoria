import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  listEngagementsByTender,
  bulkInsertEngagements,
  curateEngagement,
  activateEngagementsForContract,
  rejectEngagements,
  findSimilarEngagements,
  getEvidenceForEngagement,
  getEvidenceForEngagements,
} from '@/lib/db/engagements'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  createIntervention,
  updateInterventionStatus,
  insertPhoto,
  createValidation,
  createAnomaly,
} from '@/lib/db/interventions'

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

// ============================================================================
// Phase 4 Slice 4.1 — Evidence aggregator
// ============================================================================

/**
 * Deep cleanup helper for evidence tests : removes the site row created during
 * the test (which would otherwise leak since contracts.deletion doesn't cascade
 * to sites — sites.contract_id is set to null instead).
 *
 * Missions cascade from sites, and interventions/photos/anomalies/validations
 * cascade from missions, so a single site DELETE collapses the whole tree.
 */
async function cleanupSitesByContract(contractId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('sites').delete().eq('contract_id', contractId)
}

describe('getEvidenceForEngagement', () => {
  it('returns empty evidence for non-existent engagement', async () => {
    const e = await getEvidenceForEngagement('00000000-0000-0000-0000-999999999999')
    expect(e.interventionsExecuted).toBe(0)
    expect(e.photosCount).toBe(0)
    expect(e.contractIds).toEqual([])
  })

  it('returns empty evidence for engagement with no missions', async () => {
    const { id: tenderId } = await ensureTenderExists('test-evidence-empty')
    try {
      const inserted = await bulkInsertEngagements({
        tender_id: tenderId,
        created_by: null,
        engagements: [{
          source_type: 'memoire_engagement',
          source_excerpt: 'Engagement isolé sans mission de test pour evidence',
          source_ref: null,
          category: 'frequency',
          short_label: 'Test isolé',
          measurable: true,
          ai_confidence: 0.9,
        }],
      })
      const e = await getEvidenceForEngagement(inserted[0].id)
      expect(e.interventionsExecuted).toBe(0)
      expect(e.photosCount).toBe(0)
    } finally {
      await cleanupTender(tenderId)
    }
  })

  it('aggregates interventions, photos, anomalies, validations correctly', { timeout: 30_000 }, async () => {
    const { id: tenderId } = await ensureTenderExists('test-evidence-full')
    const supabase = createAdminClient()
    const { data: admin } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'admin')
      .limit(1)
      .single()
    const { data: client } = await supabase.from('clients').select('id').limit(1).single()
    let contractId: string | null = null

    try {
      // Create engagement
      const inserted = await bulkInsertEngagements({
        tender_id: tenderId,
        created_by: null,
        engagements: [{
          source_type: 'memoire_engagement',
          source_excerpt: 'Engagement complet pour test evidence aggregator',
          source_ref: null,
          category: 'frequency',
          short_label: 'Test complet',
          measurable: true,
          ai_confidence: 0.95,
        }],
      })
      const engagementId = inserted[0].id

      // Create contract + activate engagement
      contractId = await createContract({
        tender_id: tenderId,
        name: 'Test contract evidence',
        client_name: 'Test client evidence',
        start_date: '2026-04-01',
        created_by: null,
      })
      await activateEngagementsForContract(tenderId, contractId)

      // Create site + mission covering this engagement
      const siteId = await createSite({
        client_id: client!.id,
        contract_id: contractId,
        name: 'Test site evidence',
      })
      const missionId = await createMission({
        site_id: siteId,
        name: 'Test mission evidence',
        cadence: 'daily',
        engagement_ids: [engagementId],
        created_by: admin!.id,
      })

      // Create 2 interventions : 1 validated (with photos + anomaly), 1 completed (with photo)
      const intv1 = await createIntervention({
        mission_id: missionId,
        scheduled_at: '2026-04-10T08:00:00.000Z',
        created_by: admin!.id,
      })
      await updateInterventionStatus(intv1, 'validated', '2026-04-10T10:00:00.000Z')
      await insertPhoto({
        intervention_id: intv1,
        checklist_item_id: null,
        storage_path: `test/evidence/${intv1}/before.jpg`,
        kind: 'before',
        caption: null,
        taken_by: admin!.id,
      })
      await insertPhoto({
        intervention_id: intv1,
        checklist_item_id: null,
        storage_path: `test/evidence/${intv1}/after.jpg`,
        kind: 'after',
        caption: null,
        taken_by: admin!.id,
      })
      await createValidation({
        intervention_id: intv1,
        validated_by: admin!.id,
        comment: null,
      })
      await createAnomaly({
        intervention_id: intv1,
        category: 'materiel_casse',
        reported_by: admin!.id,
      })

      const intv2 = await createIntervention({
        mission_id: missionId,
        scheduled_at: '2026-04-12T08:00:00.000Z',
        created_by: admin!.id,
      })
      await updateInterventionStatus(intv2, 'completed', '2026-04-12T10:00:00.000Z')
      await insertPhoto({
        intervention_id: intv2,
        checklist_item_id: null,
        storage_path: `test/evidence/${intv2}/after.jpg`,
        kind: 'after',
        caption: null,
        taken_by: admin!.id,
      })

      // Now check evidence
      const e = await getEvidenceForEngagement(engagementId)
      expect(e.interventionsExecuted).toBe(2)
      expect(e.photosCount).toBe(3)
      expect(e.anomaliesOpen).toBe(1)
      expect(e.anomaliesResolved).toBe(0)
      expect(e.validationsCount).toBe(1)
      expect(e.validationRate).toBe(0.5)
      expect(e.contractIds).toContain(contractId)
      expect(e.contractNames).toContain('Test contract evidence')
      expect(e.firstExecutedAt).toBeTruthy()
      expect(e.lastExecutedAt).toBeTruthy()
      expect(e.durationDays).toBeGreaterThanOrEqual(2)
    } finally {
      if (contractId) await cleanupSitesByContract(contractId)
      await cleanupTender(tenderId)
    }
  })
})

describe('getEvidenceForEngagements (batch)', () => {
  it('returns empty map for empty input', async () => {
    const m = await getEvidenceForEngagements([])
    expect(m.size).toBe(0)
  })

  it('returns map keyed by engagement_id with stats per engagement', async () => {
    const { id: tenderId } = await ensureTenderExists('test-evidence-batch')
    try {
      const inserted = await bulkInsertEngagements({
        tender_id: tenderId,
        created_by: null,
        engagements: [
          {
            source_type: 'memoire_engagement',
            source_excerpt: 'Premier engagement batch test pour aggregation multi',
            source_ref: null,
            category: 'frequency',
            short_label: 'Batch test 1',
            measurable: true,
            ai_confidence: 0.9,
          },
          {
            source_type: 'memoire_engagement',
            source_excerpt: 'Second engagement batch test différent du premier',
            source_ref: null,
            category: 'quality',
            short_label: 'Batch test 2',
            measurable: true,
            ai_confidence: 0.85,
          },
        ],
      })
      const eng1 = inserted[0].id
      const eng2 = inserted[1].id

      const evidence = await getEvidenceForEngagements([eng1, eng2])
      expect(evidence.size).toBe(2)
      expect(evidence.has(eng1)).toBe(true)
      expect(evidence.has(eng2)).toBe(true)
      // Both should be empty since no mission covers them
      expect(evidence.get(eng1)!.interventionsExecuted).toBe(0)
      expect(evidence.get(eng2)!.interventionsExecuted).toBe(0)
    } finally {
      await cleanupTender(tenderId)
    }
  })
})
