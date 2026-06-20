// Versions de la version finale diffusée (mig 127). Un document diffusé = preuve :
// on EMPILE (v1, v2, v3…), on n'écrase jamais. Source de vérité de l'historique ;
// report_documents.final_* (mig 126) reste le pointeur « dernière version ».
import { createAdminClient } from '@/lib/supabase/admin'
import { setReportDocumentFinal } from '@/lib/db/report-documents'

export interface ReportFinalVersion {
  id: string
  versionNo: number
  documentId: string | null
  path: string
  format: 'pdf' | 'docx'
  note: string | null
  finalizedAt: string
}

export async function listReportFinalVersions(reportId: string): Promise<ReportFinalVersion[]> {
  const { data } = await createAdminClient()
    .from('report_final_versions')
    .select('id, version_no, document_id, path, format, note, finalized_at')
    .eq('report_id', reportId)
    .order('version_no', { ascending: true })
  return (data ?? []).map((r) => ({
    id: r.id as string,
    versionNo: r.version_no as number,
    documentId: (r.document_id as string | null) ?? null,
    path: r.path as string,
    format: r.format as 'pdf' | 'docx',
    note: (r.note as string | null) ?? null,
    finalizedAt: r.finalized_at as string,
  }))
}

/** Empile une nouvelle version finale (version_no = max+1) + met à jour le pointeur « dernière ». */
export async function addReportFinalVersion(input: {
  reportId: string
  siteId: string | null
  documentId: string | null
  path: string
  format: 'pdf' | 'docx'
  note?: string | null
  finalizedBy: string | null
}): Promise<{ id: string; versionNo: number }> {
  const sb = createAdminClient()
  const { data: last } = await sb
    .from('report_final_versions')
    .select('version_no')
    .eq('report_id', input.reportId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  const versionNo = ((last?.version_no as number | undefined) ?? 0) + 1

  const { data, error } = await sb
    .from('report_final_versions')
    .insert({
      report_id: input.reportId,
      version_no: versionNo,
      document_id: input.documentId,
      path: input.path,
      format: input.format,
      note: input.note ?? null,
      finalized_by: input.finalizedBy,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('insert version échoué')

  // Pointeur « dernière version » (affichage rapide, mig 126).
  await setReportDocumentFinal({
    report_id: input.reportId,
    site_id: input.siteId,
    final_document_id: input.documentId,
    final_path: input.path,
    finalized_by: input.finalizedBy,
  })
  return { id: data.id as string, versionNo }
}
