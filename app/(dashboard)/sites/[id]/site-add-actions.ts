'use server'

import { revalidatePath } from 'next/cache'
import { createDocumentCollection, listDocumentCollections } from '@/lib/db/documents'
import { uploadDocumentAction } from '@/app/(dashboard)/documents/actions'
import { importVisitAction } from '@/app/(field)/m/import/import-actions'

async function ensureSiteCollection(siteId: string): Promise<string> {
  const collections = await listDocumentCollections()
  const existing = collections.find((c) => c.scope_type === 'site' && c.scope_id === siteId)
  if (existing) return existing.id
  return createDocumentCollection({
    name: 'Documents chantier',
    scope_type: 'site',
    scope_id: siteId,
  })
}

export async function uploadSiteDocumentAction(
  siteId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; documentId?: string; duplicate?: boolean }> {
  const collectionId = await ensureSiteCollection(siteId)
  const fd = new FormData()
  const file = formData.get('file')
  if (file) fd.set('file', file)
  fd.set('collection_id', collectionId)
  fd.set('document_type', String(formData.get('document_type') || 'preuve'))
  fd.set('visibility_level', String(formData.get('visibility_level') || 'manager'))
  fd.set('target_type', 'site')
  fd.set('target_id', siteId)
  fd.set('embed', String(formData.get('embed') || 'true'))
  fd.set('memory_tier', String(formData.get('memory_tier') || 'consultable'))
  const result = await uploadDocumentAction(fd)
  if (result.ok) {
    revalidatePath(`/sites/${siteId}`)
    revalidatePath(`/sites/${siteId}?tab=documents-preuves`)
  }
  return result
}

export async function importSiteEvidenceAction(
  siteId: string,
  formData: FormData,
): Promise<
  | { ok: true; created: number; skippedDuplicates: number; firstVisitId?: string }
  | { ok: false; error: string }
> {
  const fd = new FormData()
  fd.set('site_id', siteId)
  fd.set('source', 'upload')
  for (const file of formData.getAll('files')) {
    fd.append('files', file)
  }
  const result = await importVisitAction(fd)
  if (!result.ok) return result
  revalidatePath(`/sites/${siteId}`)
  revalidatePath(`/sites/${siteId}?tab=chronologie`)
  revalidatePath(`/sites/${siteId}?tab=documents-preuves`)
  return {
    ok: true,
    created: result.created,
    skippedDuplicates: result.skippedDuplicates,
    firstVisitId: result.sessions[0]?.reportId,
  }
}
