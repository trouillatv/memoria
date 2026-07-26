import { createAdminClient } from '@/lib/supabase/admin'
import {
  deriveEngagementProvenanceReadRow,
  type EngagementProvenanceReadRow,
} from '@/lib/tenders/engagement-provenance'

type TenderEngagementProvenanceQueryRow = {
  id: string
  tender_id: string
  source_ref: Record<string, unknown> | null
  tender_document_id: string | null
  page_number: number | null
  tender_document: { id: string; filename: string } | null
}

const TENDER_ENGAGEMENT_PROVENANCE_SELECT = [
  'id',
  'tender_id',
  'source_ref',
  'tender_document_id',
  'page_number',
  'tender_document:tender_documents!engagements_tender_document_tender_id_fkey(id, filename)',
].join(', ')

export async function listTenderEngagementProvenance(
  tenderId: string,
): Promise<EngagementProvenanceReadRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .select(TENDER_ENGAGEMENT_PROVENANCE_SELECT)
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw error

  // Supabase ne sait pas inférer la forme du join aliasé (tender_document:…) :
  // `data` retombe sur GenericStringError[]. On passe par `unknown` (patron
  // Supabase) — la forme réelle est garantie par TENDER_ENGAGEMENT_PROVENANCE_SELECT.
  return ((data ?? []) as unknown as TenderEngagementProvenanceQueryRow[]).map((row) =>
    deriveEngagementProvenanceReadRow({
      engagementId: row.id,
      tenderId: row.tender_id,
      sourceRef: row.source_ref,
      tenderDocumentId: row.tender_document_id,
      pageNumber: row.page_number,
      document: row.tender_document,
    }),
  )
}
