import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const TEST_TAG = `__test_tender_engagement_provenance__${randomUUID().replaceAll('-', '').slice(0, 12)}`
const createdTenderIds: string[] = []
const createdDocumentIds: string[] = []
const createdEngagementIds: string[] = []

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

async function createTender(adminId: string, suffix: string): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tenders')
    .insert({
      title: `${TEST_TAG}_${suffix}`,
      status: 'submitted',
      created_by: adminId,
    })
    .select('id')
    .single()

  if (error || !data) throw error ?? new Error('Insert tender failed')
  createdTenderIds.push(data.id)
  return data.id
}

async function createDocument(tenderId: string, suffix: string): Promise<string> {
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
  createdDocumentIds.push(data.id)
  return data.id
}

async function createEngagement(
  tenderId: string,
  adminId: string,
  provenance: { tender_document_id?: string | null; page_number?: number | null } = {},
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .insert({
      tender_id: tenderId,
      source_type: 'manual',
      source_excerpt: `${TEST_TAG} source excerpt`,
      category: 'quality',
      short_label: `${TEST_TAG} label ${provenance.tender_document_id?.slice(0, 8) ?? 'none'} ${provenance.page_number ?? 'none'}`,
      created_by: adminId,
      ...provenance,
    })
    .select('id')
    .single()

  if (error || !data) throw error ?? new Error('Insert engagement failed')
  createdEngagementIds.push(data.id)
  return data.id
}

async function deleteCreatedRows(table: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return

  const supabase = createAdminClient()
  const { error } = await supabase.from(table).delete().in('id', ids)
  if (error) throw new Error(`Cleanup failed for ${table}: ${error.message}`)
}

describe('tender engagement provenance', () => {
  let adminId: string

  beforeAll(async () => {
    adminId = await getAdminUserId()
  })

  afterAll(async () => {
    await deleteCreatedRows('engagements', createdEngagementIds)
    await deleteCreatedRows('tender_documents', createdDocumentIds)
    await deleteCreatedRows('tenders', createdTenderIds)
  })

  it('allows a nullable document/page pair and rejects a page without a document', async () => {
    const tenderId = await createTender(adminId, 'nullable')
    const documentId = await createDocument(tenderId, 'nullable')
    const withoutProvenance = await createEngagement(tenderId, adminId)
    const withDocumentOnly = await createEngagement(tenderId, adminId, {
      tender_document_id: documentId,
      page_number: null,
    })

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('engagements')
      .select('tender_document_id, page_number')
      .in('id', [withoutProvenance, withDocumentOnly])
      .order('tender_document_id', { ascending: true, nullsFirst: true })

    expect(error).toBeNull()
    expect(data).toEqual([
      { tender_document_id: null, page_number: null },
      { tender_document_id: documentId, page_number: null },
    ])

    await expect(createEngagement(tenderId, adminId, { page_number: 1 })).rejects.toThrow()
  })

  it('rejects non-positive pages and a document belonging to another tender', async () => {
    const tenderId = await createTender(adminId, 'constraints')
    const otherTenderId = await createTender(adminId, 'other')
    const documentId = await createDocument(otherTenderId, 'other')

    await expect(
      createEngagement(tenderId, adminId, { page_number: 0 }),
    ).rejects.toThrow()
    await expect(
      createEngagement(tenderId, adminId, { page_number: -1 }),
    ).rejects.toThrow()
    await expect(
      createEngagement(tenderId, adminId, { tender_document_id: documentId, page_number: 1 }),
    ).rejects.toThrow()
  })

  it('restricts changing a referenced document tender', async () => {
    const tenderId = await createTender(adminId, 'update')
    const otherTenderId = await createTender(adminId, 'update-other')
    const documentId = await createDocument(tenderId, 'update')
    await createEngagement(tenderId, adminId, { tender_document_id: documentId, page_number: 1 })

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('tender_documents')
      .update({ tender_id: otherTenderId })
      .eq('id', documentId)

    expect(error).not.toBeNull()
  })

  it('clears only matching provenance fields when the referenced document is deleted', async () => {
    const tenderId = await createTender(adminId, 'delete')
    const documentId = await createDocument(tenderId, 'delete')
    const otherDocumentId = await createDocument(tenderId, 'delete-other')
    const engagementId = await createEngagement(tenderId, adminId, {
      tender_document_id: documentId,
      page_number: 4,
    })
    const untouchedEngagementId = await createEngagement(tenderId, adminId, {
      tender_document_id: otherDocumentId,
      page_number: 5,
    })

    const supabase = createAdminClient()
    const { error: deleteError } = await supabase
      .from('tender_documents')
      .delete()
      .eq('id', documentId)
    expect(deleteError).toBeNull()

    const { data, error } = await supabase
      .from('engagements')
      .select('tender_id, tender_document_id, page_number')
      .in('id', [engagementId, untouchedEngagementId])
      .order('page_number', { ascending: true, nullsFirst: true })

    expect(error).toBeNull()
    expect(data).toEqual([
      { tender_id: tenderId, tender_document_id: null, page_number: null },
      { tender_id: tenderId, tender_document_id: otherDocumentId, page_number: 5 },
    ])
  })
})
