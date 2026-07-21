// LE CR DE VISITE COMME DOCUMENT ÉDITABLE — accès base (Phase 0, 2/n).
//
// Aucune table nouvelle : `report_documents` (mig 120) référence `site_reports`,
// et une visite EST un `site_report`. Ce module ne fait que poser un document de
// template `cr_visite.v1` sur une visite, et le RELIRE ensuite.
//
// Il ne contient AUCUNE règle : elles vivent toutes dans `cr-visite-policy.ts`,
// en pur et sous test. Ici, on obéit.
//
// Trois interdits tenus :
//   1. jamais d'écrasement — un document existant est retourné tel quel, quel
//      que soit son statut (brouillon corrigé, validé, exporté) ;
//   2. jamais de génération IA implicite — si l'analyse n'est pas déjà en cache,
//      on ne lance rien et on ne crée rien ;
//   3. jamais de déduction — un CR n'existe pas tant que la visite n'a pas de
//      matière ; on retourne null plutôt qu'un document vide.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  createReportDocument,
  getReportDocument,
  updateReportDocumentSections,
} from '@/lib/db/report-documents'
import { CR_VISITE_TEMPLATE_KEY, buildVisitCrSections, type VisitCrAnalysis } from '@/lib/visits/cr-visite-sections'
import { decideVisitCrDocument, restoreSectionProposal, withAiBaseline } from '@/lib/visits/cr-visite-policy'
import type { DbReportDocument } from '@/types/db'

const COLS =
  'id, organization_id, report_id, site_id, template_key, sections, status, document_id, pdf_path, final_document_id, final_path, finalized_at, finalized_by, provider, model, prompt_version, created_by, created_at, updated_at'

/**
 * Le CR de visite d'une visite donnée, s'il existe. Filtré sur le template :
 * une même visite peut porter d'autres lignes `report_documents` (version finale
 * téléversée, cf. `setReportDocumentFinal`) — elles ne sont pas ce CR-ci.
 */
export async function getVisitCrDocument(reportId: string): Promise<DbReportDocument | null> {
  const { data, error } = await createAdminClient()
    .from('report_documents')
    .select(COLS)
    .eq('report_id', reportId)
    .eq('template_key', CR_VISITE_TEMPLATE_KEY)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as DbReportDocument
}

/** La visite et l'analyse déjà EN CACHE. On ne déclenche aucune génération. */
async function readVisitAndAnalysis(
  reportId: string,
): Promise<{ siteId: string | null; analysis: VisitCrAnalysis | null } | null> {
  const { data } = await createAdminClient()
    .from('site_reports')
    .select('id, site_id, debrief_analysis')
    .eq('id', reportId)
    .maybeSingle()
  if (!data) return null
  const row = data as { site_id: string | null; debrief_analysis: VisitCrAnalysis | null }
  return { siteId: row.site_id, analysis: row.debrief_analysis ?? null }
}

/**
 * Le CR éditable de cette visite : on le retourne s'il existe, on le crée sinon.
 *
 * IDEMPOTENT ET NON DESTRUCTIF : appelée dix fois, cette fonction ne réécrit
 * jamais une section. Un document déjà corrigé, validé ou exporté ressort
 * identique. C'est la garantie que les corrections de Guillaume survivent à tout
 * rechargement de page.
 *
 * Retourne `null` si la visite n'existe pas ou n'a pas encore d'analyse : un CR
 * vide ne vaut pas mieux que pas de CR, et MemorIA n'invente pas la matière.
 */
export async function getOrCreateVisitCrDocument(
  reportId: string,
  userId: string | null,
): Promise<DbReportDocument | null> {
  const existing = await getVisitCrDocument(reportId)
  if (decideVisitCrDocument(existing).action === 'reuse') return existing

  const visit = await readVisitAndAnalysis(reportId)
  if (!visit || !visit.analysis) return null

  const id = await createReportDocument({
    report_id: reportId,
    site_id: visit.siteId,
    template_key: CR_VISITE_TEMPLATE_KEY,
    sections: withAiBaseline(buildVisitCrSections(visit.analysis)),
    provider: null,
    model: null,
    prompt_version: null,
    created_by: userId,
  })
  return getReportDocument(id)
}

/**
 * « Revenir à la proposition » sur UNE section. L'écriture passe par
 * `updateReportDocumentSections`, qui refuse déjà tout document non-brouillon :
 * on ne défige pas un CR validé par un geste d'édition.
 */
export async function restoreVisitCrSection(documentId: string, sectionKey: string): Promise<void> {
  const doc = await getReportDocument(documentId)
  if (!doc) return
  await updateReportDocumentSections(documentId, restoreSectionProposal(doc.sections, sectionKey))
}
