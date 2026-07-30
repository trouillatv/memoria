'use server'

import { after } from 'next/server'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
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
  try {
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
  } catch (e) {
    console.error('[uploadSiteDocumentAction]', e)
    return { ok: false, error: 'Une erreur inattendue est survenue.' }
  }
}

export async function importSiteHistoricalPvAction(
  siteId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; documentId?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Non authentifié' }
    const role = await getUserRoleById(user.id)
    if (role !== 'admin' && role !== 'manager') return { ok: false, error: 'Permissions insuffisantes' }

    const collectionId = await ensureSiteCollection(siteId)
    const fd = new FormData()
    const file = formData.get('file')
    if (file) fd.set('file', file)
    fd.set('collection_id', collectionId)
    fd.set('document_type', 'historical_visit_report')
    fd.set('visibility_level', 'manager')
    fd.set('target_type', 'site')
    fd.set('target_id', siteId)
    fd.set('embed', 'false')
    fd.set('memory_tier', 'froide')
    const effectiveDate = formData.get('effective_date')?.toString()
    if (effectiveDate) fd.set('effective_date', effectiveDate)

    const result = await uploadDocumentAction(fd)
    if (!result.ok || !result.documentId) return { ok: false, error: result.error ?? 'Import impossible' }

    const secret = process.env.CRON_SECRET
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
    const proto = h.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
    const extractionUrl = `${proto}://${host}/api/extraction/historical-pv`

    if (secret) {
      after(async () => {
        try {
          await fetch(extractionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-trigger': secret },
            body: JSON.stringify({ documentId: result.documentId, userId: user.id, siteId }),
          })
        } catch (e) {
          console.error('importSiteHistoricalPvAction trigger error:', e)
        }
      })
    }

    revalidatePath(`/sites/${siteId}`)
    return { ok: true, documentId: result.documentId }
  } catch (e) {
    console.error('[importSiteHistoricalPvAction]', e)
    return { ok: false, error: 'Une erreur inattendue est survenue.' }
  }
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
