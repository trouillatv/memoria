// Test d'INTÉGRATION (vraie Supabase) — invariants de schéma de la migration
// 436 (Porte B : engagement direct chantier, sans AO).
//
// Couvre les invariants qui ne passent PAS par les RPC de matérialisation
// (tests/lib/db/materialize-engagement-contract.test.ts) : contraintes CHECK
// et trigger posés directement sur public.engagements/public.documents.
//
// Convention reprise de tests/lib/tender-engagement-provenance.integration.test.ts
// (migration 241), qui couvre l'équivalent côté Porte A.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const TEST_TAG = `__test_engagement_direct_doc_provenance__${randomUUID().replaceAll('-', '').slice(0, 12)}`

let orgId: string
let adminId: string
let clientId: string
let siteId: string
const createdEngagementIds: string[] = []
const createdDocumentIds: string[] = []
const createdTenderDocumentIds: string[] = []
const createdTenderIds: string[] = []

async function getAdminUserId(): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (error || !data) throw error ?? new Error('No admin user available for test setup')
  return data.id
}

async function createDocument(suffix: string): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('documents')
    .insert({
      organization_id: orgId,
      document_type: 'cctp',
      storage_path: `${TEST_TAG}/${suffix}.pdf`,
      filename: `${TEST_TAG}_${suffix}.pdf`,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('Insert document failed')
  createdDocumentIds.push(data.id)
  return data.id
}

// Porte A : fixture minimale tender → tender_document, pour tester la
// contrainte engagements_single_document_provenance avec une VRAIE provenance
// AO concurrente (pas seulement une valeur nulle jamais renseignée).
async function createTender(suffix: string): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tenders')
    .insert({ title: `${TEST_TAG}_${suffix}`, status: 'submitted', created_by: adminId })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('Insert tender failed')
  createdTenderIds.push(data.id)
  return data.id
}

async function createTenderDocument(tenderId: string, suffix: string): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tender_documents')
    .insert({
      tender_id: tenderId,
      storage_path: `${TEST_TAG}/${suffix}.pdf`,
      filename: `${TEST_TAG}_${suffix}.pdf`,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('Insert tender document failed')
  createdTenderDocumentIds.push(data.id)
  return data.id
}

async function insertEngagement(overrides: Record<string, unknown>) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .insert({
      source_type: 'manual',
      source_excerpt: `${TEST_TAG} source excerpt`,
      category: 'quality',
      short_label: `${TEST_TAG} label`,
      created_by: adminId,
      ...overrides,
    })
    .select('id')
    .single()
  if (error) return { error, id: null }
  createdEngagementIds.push(data.id)
  return { error: null, id: data.id as string }
}

beforeAll(async () => {
  const supabase = createAdminClient()
  adminId = await getAdminUserId()

  const { data: org } = await supabase.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  clientId = (await supabase.from('clients').insert({ name: `${TEST_TAG}client`, organization_id: orgId }).select('id').single()).data!.id as string
  siteId = (await supabase.from('sites').insert({ name: `${TEST_TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const supabase = createAdminClient()
  if (createdEngagementIds.length > 0) {
    await supabase.from('engagements').delete().in('id', createdEngagementIds)
  }
  if (createdDocumentIds.length > 0) {
    await supabase.from('documents').delete().in('id', createdDocumentIds)
  }
  if (createdTenderDocumentIds.length > 0) {
    await supabase.from('tender_documents').delete().in('id', createdTenderDocumentIds)
  }
  if (createdTenderIds.length > 0) {
    await supabase.from('tenders').delete().in('id', createdTenderIds)
  }
  await supabase.from('sites').delete().eq('id', siteId)
  await supabase.from('clients').delete().eq('id', clientId)
})

describe('engagements_origin_door_check — deux portes, jamais orpheline', () => {
  it('accepte un engagement avec seulement site_id (Porte B, sans AO)', async () => {
    const { error, id } = await insertEngagement({ site_id: siteId })
    expect(error).toBeNull()
    expect(id).toBeTruthy()
  })

  it('refuse un engagement sans tender_id NI site_id', async () => {
    const { error } = await insertEngagement({})
    expect(error).not.toBeNull()
  })
})

describe('engagements_single_document_provenance — une seule provenance documentaire directe', () => {
  it('témoin Porte A : tender_document_id seul reste valide', async () => {
    const tenderId = await createTender('porte-a-only')
    const tenderDocumentId = await createTenderDocument(tenderId, 'porte-a-only')
    const { error, id } = await insertEngagement({
      tender_id: tenderId,
      site_id: null,
      tender_document_id: tenderDocumentId,
    })
    expect(error).toBeNull()
    expect(id).toBeTruthy()
  })

  it('témoin Porte B : source_document_id seul reste valide', async () => {
    const documentId = await createDocument('porte-b-only')
    const { error, id } = await insertEngagement({
      site_id: siteId,
      source_document_id: documentId,
    })
    expect(error).toBeNull()
    expect(id).toBeTruthy()
  })

  it('refuse tender_document_id ET source_document_id simultanément (CHECK engagements_single_document_provenance)', async () => {
    const tenderId = await createTender('mutual-exclusion')
    const tenderDocumentId = await createTenderDocument(tenderId, 'mutual-exclusion')
    const documentId = await createDocument('mutual-exclusion')

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('engagements')
      .insert({
        site_id: siteId,
        tender_document_id: tenderDocumentId,
        source_document_id: documentId,
        source_type: 'manual',
        source_excerpt: `${TEST_TAG} both documents at once`,
        category: 'quality',
        short_label: `${TEST_TAG} both documents at once`,
        created_by: adminId,
      })
      .select('id')
      .single()

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/engagements_single_document_provenance/)
  })
})

describe('engagements_page_requires_document — généralisée aux deux portes', () => {
  it('accepte une page avec source_document_id (Porte B)', async () => {
    const documentId = await createDocument('page-ok')
    const { error, id } = await insertEngagement({
      site_id: siteId,
      source_document_id: documentId,
      page_number: 3,
    })
    expect(error).toBeNull()
    expect(id).toBeTruthy()
  })

  it('refuse une page sans aucun document source (Porte B)', async () => {
    const { error } = await insertEngagement({ site_id: siteId, page_number: 1 })
    expect(error).not.toBeNull()
  })
})

describe('provenance documentaire jamais silencieusement perdue (migration 437)', () => {
  it('bloque la suppression physique d’un document tant qu’un Engagement le référence (FK NO ACTION, plus de trigger de nettoyage)', async () => {
    const documentId = await createDocument('delete-blocked')
    const { id: engagementId } = await insertEngagement({
      site_id: siteId,
      source_document_id: documentId,
      page_number: 7,
    })

    const supabase = createAdminClient()
    const { error: deleteError } = await supabase.from('documents').delete().eq('id', documentId)
    expect(deleteError).not.toBeNull()

    // Provenance intacte : la preuve documentaire n'a pas bougé.
    const { data, error } = await supabase
      .from('engagements')
      .select('id, source_document_id, page_number')
      .eq('id', engagementId)
      .single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ id: engagementId, source_document_id: documentId, page_number: 7 })
  })

  it('le soft-delete (deleted_at) n’est pas affecté : la ligne documents subsiste, la provenance reste lisible', async () => {
    const documentId = await createDocument('soft-delete-ok')
    const { id: engagementId } = await insertEngagement({
      site_id: siteId,
      source_document_id: documentId,
      page_number: 2,
    })

    const supabase = createAdminClient()
    const { error: softDeleteError } = await supabase
      .from('documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', documentId)
    expect(softDeleteError).toBeNull()

    const { data, error } = await supabase
      .from('engagements')
      .select('id, source_document_id, page_number')
      .eq('id', engagementId)
      .single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ id: engagementId, source_document_id: documentId, page_number: 2 })
  })
})

describe('engagements_origin_door_check — XOR strict (migration 437)', () => {
  it('refuse un engagement avec tender_id ET site_id renseignés simultanément', async () => {
    const { error } = await insertEngagement({ tender_id: null, site_id: siteId })
    expect(error).toBeNull() // témoin : site_id seul reste valide

    const supabase = createAdminClient()
    const { error: bothError } = await supabase
      .from('engagements')
      .insert({
        site_id: siteId,
        tender_id: randomUUID(), // FK inexistante mais le CHECK doit rejeter avant la FK
        source_type: 'manual',
        source_excerpt: `${TEST_TAG} both doors`,
        category: 'other',
        short_label: `${TEST_TAG} both doors`,
      })
    expect(bothError).not.toBeNull()
  })
})

describe('tender_id nullable — non-régression Porte A', () => {
  it('un tender_id NULL est accepté au niveau colonne dès lors que site_id le couvre', async () => {
    const { error, id } = await insertEngagement({ tender_id: null, site_id: siteId })
    expect(error).toBeNull()
    expect(id).toBeTruthy()
  })
})
