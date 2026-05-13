// Sprint 8 — Tests du helper getAtelierExportData.
//
// Doctrine V5 :
//   - Tests sur DB réelle (pattern projet : Supabase admin client).
//   - On vérifie l'AGRÉGATION (assemblage des sous-domaines), pas la génération
//     créative. Aucun test sur le contenu marketing (il n'y en a pas).
//   - Préfixe '__test_atelier_export_' pour faciliter cleanup.
//
// Couvre :
//   1. UUID invalide / inconnu → null
//   2. Tender valide → toutes les sections présentes
//   3. Engagements groupés par catégorie (présents par catégorie)
//   4. similarTenders est un array (peut être vide)
//   5. Forces compteurs cohérents (>= 0)

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAtelierExportData } from '@/lib/db/atelier-export'
import { bulkInsertEngagements } from '@/lib/db/engagements'

const TEST_TENDER_TITLE = '__test_atelier_export_tender__'

async function getAdminUserId(): Promise<string> {
  const supabase = createAdminClient()
  const { data: admin } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!admin) throw new Error('No admin user found for test setup')
  return admin.id as string
}

async function getOrCreateTestTender(): Promise<string> {
  const supabase = createAdminClient()
  const { data: existing } = await supabase
    .from('tenders')
    .select('id')
    .eq('title', TEST_TENDER_TITLE)
    .maybeSingle()
  if (existing) return existing.id as string

  const adminId = await getAdminUserId()
  const { data, error } = await supabase
    .from('tenders')
    .insert({
      title: TEST_TENDER_TITLE,
      client_name: '__test_atelier_export_client__',
      status: 'ready',
      created_by: adminId,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

async function cleanup(tenderId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('engagements').delete().eq('tender_id', tenderId)
  await supabase.from('tender_chat_messages').delete().eq('tender_id', tenderId)
  await supabase.from('tenders').delete().eq('id', tenderId)
}

describe('getAtelierExportData', () => {
  let tenderId: string

  beforeAll(async () => {
    tenderId = await getOrCreateTestTender()
    // Insert two engagements with different categories
    await bulkInsertEngagements({
      tender_id: tenderId,
      created_by: null,
      engagements: [
        {
          source_type: 'ao_clause',
          source_excerpt: 'Désinfection quotidienne des sanitaires.',
          source_ref: null,
          category: 'frequency',
          short_label: 'Sanitaires 1x/jour',
          measurable: true,
          ai_confidence: 0.9,
        },
        {
          source_type: 'ao_clause',
          source_excerpt: 'Produits écolabel exigés.',
          source_ref: null,
          category: 'quality',
          short_label: 'Produits écolabel',
          measurable: false,
          ai_confidence: 0.8,
        },
      ],
    })
  })

  afterAll(async () => {
    await cleanup(tenderId)
  })

  it('returns null for an unknown UUID', async () => {
    const result = await getAtelierExportData(
      '00000000-0000-0000-0000-000000000000',
    )
    expect(result).toBeNull()
  })

  it('aggregates all sections for a valid tender', async () => {
    const result = await getAtelierExportData(tenderId)
    expect(result).not.toBeNull()
    if (!result) return

    // tender
    expect(result.tender.id).toBe(tenderId)
    expect(result.tender.title).toBe(TEST_TENDER_TITLE)
    expect(result.tender.client_name).toBe('__test_atelier_export_client__')

    // context
    expect(result.context).toBeDefined()
    expect(result.context.keyDates).toBeDefined()
    expect(typeof result.context.keyDates.received).toBe('string')

    // engagements present
    expect(Array.isArray(result.engagements)).toBe(true)
    expect(result.engagements.length).toBe(2)

    // similarTenders is an array
    expect(Array.isArray(result.similarTenders)).toBe(true)

    // evidence map
    expect(result.evidence).toBeInstanceOf(Map)

    // forces
    expect(result.forces).toBeDefined()
    expect(typeof result.forces.activeContractsCount).toBe('number')
    expect(typeof result.forces.totalPhotos).toBe('number')
    expect(typeof result.forces.totalInterventions).toBe('number')

    // chat
    expect(Array.isArray(result.chatMessages)).toBe(true)
    expect(Array.isArray(result.chatAttachments)).toBe(true)

    // agent syntheses
    expect(Array.isArray(result.agentSyntheses)).toBe(true)

    // tenant name
    expect(typeof result.tenantName).toBe('string')
    expect(result.tenantName.length).toBeGreaterThan(0)

    // generatedAt
    expect(typeof result.generatedAt).toBe('string')
    expect(() => new Date(result.generatedAt).toISOString()).not.toThrow()
  })

  it('groups engagements by category correctly', async () => {
    const result = await getAtelierExportData(tenderId)
    expect(result).not.toBeNull()
    if (!result) return

    const byCategory = new Map<string, number>()
    for (const e of result.engagements) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1)
    }

    expect(byCategory.get('frequency')).toBe(1)
    expect(byCategory.get('quality')).toBe(1)

    // Engagements have the expected shape
    for (const e of result.engagements) {
      expect(typeof e.id).toBe('string')
      expect(typeof e.short_label).toBe('string')
      expect(['frequency', 'quality']).toContain(e.category)
    }
  })

  it('similarTenders is always an array (possibly empty)', async () => {
    const result = await getAtelierExportData(tenderId)
    expect(result).not.toBeNull()
    if (!result) return

    expect(Array.isArray(result.similarTenders)).toBe(true)
    // Le matching peut être vide ou non selon l'état réel de la DB ; on
    // garantit seulement la forme. Aucun élément ne doit pointer vers
    // tenderId lui-même.
    for (const st of result.similarTenders) {
      expect(st.id).not.toBe(tenderId)
    }
  })

  it('forces counters are coherent (>= 0 and not NaN)', async () => {
    const result = await getAtelierExportData(tenderId)
    expect(result).not.toBeNull()
    if (!result) return

    const f = result.forces
    expect(f.activeContractsCount).toBeGreaterThanOrEqual(0)
    expect(f.totalPhotos).toBeGreaterThanOrEqual(0)
    expect(f.totalInterventions).toBeGreaterThanOrEqual(0)
    expect(Number.isNaN(f.activeContractsCount)).toBe(false)
    expect(Number.isNaN(f.totalPhotos)).toBe(false)
    expect(Number.isNaN(f.totalInterventions)).toBe(false)

    if (f.daysSinceFirstContract !== null) {
      expect(f.daysSinceFirstContract).toBeGreaterThanOrEqual(0)
    }
    if (f.firstContractStartDate !== null) {
      expect(typeof f.firstContractStartDate).toBe('string')
    }
  })
})
