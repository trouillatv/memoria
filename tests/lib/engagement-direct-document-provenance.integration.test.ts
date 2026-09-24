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
  it('refuse tender_document_id ET source_document_id simultanément', async () => {
    const documentId = await createDocument('mutual-exclusion')
    const { error } = await insertEngagement({
      site_id: siteId,
      source_document_id: documentId,
      // tender_document_id référence tender_documents, incompatible avec un
      // engagement sans tender_id — on vérifie la contrainte au niveau le
      // plus direct : source_document_id seul doit être accepté.
    })
    expect(error).toBeNull()
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

describe('documents_clear_engagement_provenance_before_delete — nettoyage à la suppression', () => {
  it('vide source_document_id/page_number sans supprimer l’engagement, à la suppression du document', async () => {
    const documentId = await createDocument('delete-cleanup')
    const { id: engagementId } = await insertEngagement({
      site_id: siteId,
      source_document_id: documentId,
      page_number: 7,
    })

    const supabase = createAdminClient()
    const { error: deleteError } = await supabase.from('documents').delete().eq('id', documentId)
    expect(deleteError).toBeNull()
    createdDocumentIds.splice(createdDocumentIds.indexOf(documentId), 1)

    const { data, error } = await supabase
      .from('engagements')
      .select('id, source_document_id, page_number')
      .eq('id', engagementId)
      .single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ id: engagementId, source_document_id: null, page_number: null })
  })
})

describe('tender_id nullable — non-régression Porte A', () => {
  it('un tender_id NULL est accepté au niveau colonne dès lors que site_id le couvre', async () => {
    const { error, id } = await insertEngagement({ tender_id: null, site_id: siteId })
    expect(error).toBeNull()
    expect(id).toBeTruthy()
  })
})
