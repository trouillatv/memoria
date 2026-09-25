import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'

// Keep DB writes real while bypassing only the request-scoped auth lookup.
vi.mock('@/lib/auth/memberships', () => ({
  requireOrganizationMembership: async (organizationId: string) => ({
    ok: true,
    context: { userId: 'task4-test-user', organizationId, role: 'admin' },
  }),
}))

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
  listActiveEngagementsByContracts,
  listActiveEngagementsBySites,
  listEngagementsByIds,
  createEngagementManual,
  createSiteEngagementManual,
  activateEngagement,
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

async function getAdminFixture(): Promise<{ id: string; organization_id: string }> {
  const supabase = createAdminClient()
  const { data: admin } = await supabase
    .from('users')
    .select('id, organization_id')
    .eq('role', 'admin')
    .not('organization_id', 'is', null)
    .limit(1)
    .maybeSingle()
  if (!admin?.organization_id) throw new Error('No admin user with organization_id found for test setup')
  return { id: admin.id, organization_id: admin.organization_id }
}

async function getOrCreateTestTender(): Promise<string> {
  const supabase = createAdminClient()
  const admin = await getAdminFixture()

  const { data: existing } = await supabase
    .from('tenders')
    .select('id, organization_id')
    .eq('title', TEST_TENDER_TITLE)
    .maybeSingle()
  if (existing) {
    if (!existing.organization_id) {
      const { error } = await supabase
        .from('tenders')
        .update({ organization_id: admin.organization_id })
        .eq('id', existing.id)
      if (error) throw error
    }
    return existing.id
  }

  const { data, error } = await supabase
    .from('tenders')
    .insert({
      title: TEST_TENDER_TITLE,
      status: 'ready',
      created_by: admin.id,
      organization_id: admin.organization_id,
    })
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

  it('bulkInsert persists structured tender document provenance', async () => {
    const tag = `__task4_provenance_${crypto.randomUUID()}`
    const supabase = createAdminClient()
    const { data: document, error: documentError } = await supabase
      .from('tender_documents')
      .insert({
        tender_id: tenderId,
        storage_path: `${tag}.pdf`,
        filename: `${tag}.pdf`,
        size_bytes: 1,
        page_count: 4,
        extracted_text: 'Task 4 provenance fixture',
        kind: 'ccap',
      })
      .select('id')
      .single()
    if (documentError) throw documentError

    let engagementId: string | null = null
    try {
      const inserted = await bulkInsertEngagements({
        tender_id: tenderId,
        created_by: null,
        engagements: [{
          source_type: 'ao_clause',
          source_excerpt: `${tag} excerpt`,
          source_ref: { page: 99 },
          category: 'compliance',
          short_label: `${tag} engagement`,
          measurable: false,
          ai_confidence: 0.8,
          tender_document_id: document.id,
          page_number: 4,
        }],
      })
      engagementId = inserted[0]?.id ?? null
      expect(inserted[0]).toMatchObject({
        tender_id: tenderId,
        tender_document_id: document.id,
        page_number: 4,
      })
    } finally {
      if (engagementId) {
        const { error } = await supabase.from('engagements').delete().eq('id', engagementId)
        if (error) throw error
      }
      const { error } = await supabase.from('tender_documents').delete().eq('id', document.id)
      if (error) throw error
    }
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
  const admin = await getAdminFixture()

  const { data: existing } = await supabase
    .from('tenders')
    .select('id, organization_id')
    .eq('title', title)
    .maybeSingle()
  if (existing) {
    if (!existing.organization_id) {
      const { error } = await supabase
        .from('tenders')
        .update({ organization_id: admin.organization_id })
        .eq('id', existing.id)
      if (error) throw error
    }
    return { id: existing.id }
  }

  const { data, error } = await supabase
    .from('tenders')
    .insert({
      title,
      status: 'ready',
      created_by: admin.id,
      organization_id: admin.organization_id,
    })
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

// ============================================================================
// P0-3.5A — population batchée Porte A/B (Missions/Engagements)
// ============================================================================
//
// Témoin réel en prod (site "OCEF Compostage", sans contrat) : Engagement
// Porte B actif "Nettoyage Carrelage hebdomadaire" + 5 Engagements Porte B
// encore curated sur le même site — exactement le cas d'exclusion couvert
// ci-dessous (Porte B curated jamais retournée par listActiveEngagementsBySites).

describe('P0-3.5A — population batchée Porte A/B', () => {
  it('listActiveEngagementsByContracts/listActiveEngagementsBySites/listEngagementsByIds retournent vide sans appel DB pour un tableau vide', async () => {
    expect((await listActiveEngagementsByContracts([])).size).toBe(0)
    expect((await listActiveEngagementsBySites([])).size).toBe(0)
    expect(await listEngagementsByIds([])).toEqual([])
  })

  it('groupe par contrat, exclut le statut curated, sans fuite cross-contrat (Porte A)', { timeout: 20_000 }, async () => {
    const { id: tenderX } = await ensureTenderExists('p035a-contract-x')
    const { id: tenderY } = await ensureTenderExists('p035a-contract-y')
    let contractX: string | null = null
    let contractY: string | null = null

    try {
      contractX = await createContract({
        tender_id: tenderX,
        name: 'P0-3.5A contract X',
        client_name: 'Client X',
        start_date: '2026-06-01',
        created_by: null,
      })
      contractY = await createContract({
        tender_id: tenderY,
        name: 'P0-3.5A contract Y',
        client_name: 'Client Y',
        start_date: '2026-06-01',
        created_by: null,
      })

      const engXActive = await createEngagementManual({
        tender_id: tenderX,
        contract_id: contractX,
        short_label: 'X active',
        category: 'other',
        created_by: null,
      })
      const engXCurated = await createEngagementManual({
        tender_id: tenderX,
        contract_id: contractX,
        short_label: 'X curated (doit être exclue)',
        category: 'other',
        created_by: null,
      })
      const engYActive = await createEngagementManual({
        tender_id: tenderY,
        contract_id: contractY,
        short_label: 'Y active',
        category: 'other',
        created_by: null,
      })

      const supabase = createAdminClient()
      const { error: updErr } = await supabase
        .from('engagements')
        .update({ status: 'curated' })
        .eq('id', engXCurated.id)
      if (updErr) throw updErr

      const map = await listActiveEngagementsByContracts([contractX, contractY])
      const idsX = (map.get(contractX) ?? []).map((e) => e.id)
      const idsY = (map.get(contractY) ?? []).map((e) => e.id)

      expect(idsX).toContain(engXActive.id)
      expect(idsX).not.toContain(engXCurated.id)
      expect(idsX).not.toContain(engYActive.id) // pas de fuite cross-contrat
      expect(idsY).toEqual([engYActive.id])
    } finally {
      // cleanupTender supprime déjà les engagements par tender_id (Porte A
      // créée ici avec tender_id + contract_id tous deux renseignés).
      await cleanupTender(tenderX)
      await cleanupTender(tenderY)
    }
  })

  it('groupe par site, exclut le Porte B curated (témoin réel OCEF), sans fuite cross-site', async () => {
    const supabase = createAdminClient()
    const admin = await getAdminFixture()
    const { data: client } = await supabase.from('clients').select('id').limit(1).single()
    const siteX = await createSite({ client_id: client!.id, contract_id: null, name: '__test_p035a_site_x__', organization_id: admin.organization_id })
    const siteZ = await createSite({ client_id: client!.id, contract_id: null, name: '__test_p035a_site_z__', organization_id: admin.organization_id })

    try {
      const engXPorteB = await createSiteEngagementManual({
        site_id: siteX,
        short_label: 'Site X — Porte B active',
        category: 'other',
        measurable: false,
        created_by: null,
      })
      await activateEngagement(engXPorteB.id)

      const engZActive = await createSiteEngagementManual({
        site_id: siteZ,
        short_label: 'Site Z — Porte B active',
        category: 'other',
        measurable: false,
        created_by: null,
      })
      await activateEngagement(engZActive.id)

      const engZCurated = await createSiteEngagementManual({
        site_id: siteZ,
        short_label: 'Site Z — Porte B curated (doit être exclue)',
        category: 'other',
        measurable: false,
        created_by: null,
      })

      const map = await listActiveEngagementsBySites([siteX, siteZ])
      const idsX = (map.get(siteX) ?? []).map((e) => e.id)
      const idsZ = (map.get(siteZ) ?? []).map((e) => e.id)

      expect(idsX).toEqual([engXPorteB.id])
      expect(idsZ).toContain(engZActive.id)
      expect(idsZ).not.toContain(engZCurated.id)
      expect(idsZ).not.toContain(engXPorteB.id) // pas de fuite cross-site
    } finally {
      await supabase.from('engagements').delete().eq('site_id', siteX)
      await supabase.from('engagements').delete().eq('site_id', siteZ)
      await supabase.from('sites').delete().eq('id', siteX)
      await supabase.from('sites').delete().eq('id', siteZ)
    }
  })

  it('exclut le Porte B completed (FIX_REQUIRED P0-3.5A #2 — pas de notion de "complété" côté Porte B)', async () => {
    const supabase = createAdminClient()
    const admin = await getAdminFixture()
    const { data: client } = await supabase.from('clients').select('id').limit(1).single()
    const siteId = await createSite({ client_id: client!.id, contract_id: null, name: '__test_p035a_completed__', organization_id: admin.organization_id })

    try {
      const eng = await createSiteEngagementManual({
        site_id: siteId,
        short_label: 'Site — Porte B completed (doit être exclue)',
        category: 'other',
        measurable: false,
        created_by: null,
      })
      await activateEngagement(eng.id)
      // Aucun chemin de code ne fait passer un Porte B à 'completed' à ce
      // jour (cf. commentaire listPlannedEngagementsForSite) — on simule
      // l'état pour verrouiller le comportement si ce chemin apparaît un jour.
      await supabase.from('engagements').update({ status: 'completed' }).eq('id', eng.id)

      const map = await listActiveEngagementsBySites([siteId])
      expect(map.get(siteId) ?? []).toEqual([])

      // Préservation intacte : listEngagementsByIds n'a aucun filtre de statut.
      const preserved = await listEngagementsByIds([eng.id])
      expect(preserved.map((e) => e.id)).toEqual([eng.id])
    } finally {
      await supabase.from('engagements').delete().eq('site_id', siteId)
      await supabase.from('sites').delete().eq('id', siteId)
    }
  })

  it('listEngagementsByIds résout un Engagement quel que soit son statut (préservation)', async () => {
    const supabase = createAdminClient()
    const admin = await getAdminFixture()
    const { data: client } = await supabase.from('clients').select('id').limit(1).single()
    const siteId = await createSite({ client_id: client!.id, contract_id: null, name: '__test_p035a_preserve__', organization_id: admin.organization_id })

    try {
      const curated = await createSiteEngagementManual({
        site_id: siteId,
        short_label: 'Préservée bien que curated',
        category: 'other',
        measurable: false,
        created_by: null,
      })

      const resolved = await listEngagementsByIds([curated.id])
      expect(resolved.map((e) => e.id)).toEqual([curated.id])
      expect(resolved[0].status).toBe('curated')
    } finally {
      await supabase.from('engagements').delete().eq('site_id', siteId)
      await supabase.from('sites').delete().eq('id', siteId)
    }
  })
})
