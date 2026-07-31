import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export interface VisitSourceDocument {
  id: string
  filename: string
  storagePath: string
  sizeBytes: number | null
  effectiveDate: string | null
  pageCount: number | null
}

/**
 * Charge le document source d'une visite historique importée.
 * Retourne null si la visite n'est pas un import ou si le document n'existe pas.
 */
export async function getVisitSourceDocument(reportId: string): Promise<VisitSourceDocument | null> {
  const admin = createAdminClient()

  // 1. Vérifier que la visite est un import et récupérer le document source
  const { data: visit } = await admin
    .from('site_reports')
    .select('origin, source_document_id')
    .eq('id', reportId)
    .maybeSingle()

  if (!visit || visit.origin !== 'import' || !visit.source_document_id) {
    return null
  }

  const v = visit as { origin: string; source_document_id: string }

  // 2. Charger les métadonnées du document
  const { data: doc } = await admin
    .from('documents')
    .select('id, filename, storage_path, size_bytes, effective_date, page_count')
    .eq('id', v.source_document_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!doc) return null

  const d = doc as {
    id: string
    filename: string
    storage_path: string
    size_bytes: number | null
    effective_date: string | null
    page_count: number | null
  }

  return {
    id: d.id,
    filename: d.filename,
    storagePath: d.storage_path,
    sizeBytes: d.size_bytes,
    effectiveDate: d.effective_date,
    pageCount: d.page_count,
  }
}
