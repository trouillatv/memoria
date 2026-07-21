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
import { insertActivityLog } from '@/lib/db/activity-logs'
import type { DbReportDocument, ReportDocumentSection } from '@/types/db'

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
async function readVisitAndAnalysis(reportId: string): Promise<{
  siteId: string | null
  orgId: string | null
  analysis: VisitCrAnalysis | null
} | null> {
  const { data } = await createAdminClient()
    .from('site_reports')
    .select('id, site_id, organization_id, debrief_analysis')
    .eq('id', reportId)
    .maybeSingle()
  if (!data) return null
  const row = data as {
    site_id: string | null
    organization_id: string | null
    debrief_analysis: VisitCrAnalysis | null
  }
  return { siteId: row.site_id, orgId: row.organization_id, analysis: row.debrief_analysis ?? null }
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

  // LA COURSE. Deux appels rapprochés (double-tap, deux onglets, rechargement
  // pendant la création) verraient tous deux « absent » et inséreraient chacun
  // leur document : le conducteur corrigerait alors une version que la page
  // suivante n'afficherait pas. L'index unique partiel (mig 227) fait échouer le
  // second insert ; on relit alors le gagnant au lieu de propager l'erreur.
  // La garantie vient de la BASE, pas de l'ordre des instructions ici.
  try {
    const id = await createReportDocument({
      report_id: reportId,
      site_id: visit.siteId,
      // L'organisation vient de LA VISITE, pas du contexte de requête :
      // `organization_id` est NOT NULL en base, et un `getOrgId()` qui échoue
      // ferait disparaître le CR editable sans un mot (defaut trouve en recette
      // reelle, 2026-07-21).
      organization_id: visit.orgId,
      template_key: CR_VISITE_TEMPLATE_KEY,
      sections: withAiBaseline(buildVisitCrSections(visit.analysis)),
      provider: null,
      model: null,
      prompt_version: null,
      created_by: userId,
    })
    return getReportDocument(id)
  } catch (err) {
    const loser = await getVisitCrDocument(reportId)
    if (loser) return loser
    throw err
  }
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

// ── LE CYCLE DE VIE DU COMPTE-RENDU (Étape C, Vincent 2026-07-21) ───────────
//
//   Brouillon éditable → Finaliser → Finalisé, lecture seule
//                              ↑                    │
//                              └──── Rouvrir ───────┘
//
// Deux gestes explicites, et aucun automatisme : concrétiser des objets ne
// finalise PAS le compte-rendu — on peut vouloir créer quatre actions et
// continuer à corriger le texte.
//
// Pas de versionnement : une seule vérité documentaire. Les questions
// « laquelle est la référence, laquelle a été envoyée » n'ont pas encore de
// raison d'être posées, et y répondre trop tôt coûterait plus que ça ne rend.

/** Finalise le compte-rendu : il devient une lecture seule, signée et datée. */
export async function finalizeVisitCr(reportId: string, userId: string | null): Promise<boolean> {
  const doc = await getVisitCrDocument(reportId)
  if (!doc || doc.status !== 'draft') return false
  const { error } = await createAdminClient()
    .from('report_documents')
    .update({
      status: 'validated',
      validated_at: new Date().toISOString(),
      validated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', doc.id)
    .eq('status', 'draft') // la base tranche la course, pas l'ordre des lignes
  if (error) return false
  await trace(userId, doc.id, 'report_document.finalized', { report_id: reportId })
  return true
}

/** Rouvre le brouillon. Les objets DÉJÀ CRÉÉS dans le chantier ne bougent pas —
 *  ni modifiés, ni supprimés. Corriger le récit ne réécrit pas le travail. */
export async function reopenVisitCr(reportId: string, userId: string | null): Promise<boolean> {
  const doc = await getVisitCrDocument(reportId)
  if (!doc || doc.status !== 'validated') return false
  const { error } = await createAdminClient()
    .from('report_documents')
    .update({
      status: 'draft',
      reopened_at: new Date().toISOString(),
      reopened_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', doc.id)
    .eq('status', 'validated')
  if (error) return false
  await trace(userId, doc.id, 'report_document.reopened', { report_id: reportId })
  return true
}

/** La trace vit dans `activity_logs`, qui existe déjà : pas de second moteur
 *  d'audit pour deux événements. Elle ne doit jamais faire échouer le geste. */
async function trace(
  userId: string | null,
  documentId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await insertActivityLog({ userId, entityType: 'report_document', entityId: documentId, action, metadata })
  } catch {
    // Perdre une trace est ennuyeux ; perdre le geste serait pire.
  }
}

/**
 * ÉCRIT LE REGISTRE DE CONCRÉTISATION, quel que soit le statut du document.
 *
 * `updateReportDocumentSections` refuse tout document non-brouillon — c'est
 * juste pour le CONTENU : un CR finalisé ne se réécrit pas. Mais le registre
 * n'est pas du contenu : c'est la trace de ce que le document a fait naître, et
 * concrétiser reste permis après finalisation (le texte est figé, le travail
 * qu'il engendre ne l'est pas).
 *
 * Sans cette porte, concrétiser un CR finalisé perdait la trace EN SILENCE :
 * l'update ne touchait aucune ligne, aucune erreur n'était levée, et l'identité
 * durable retombait sur le libellé — exactement la faille qu'on venait de fermer.
 */
export async function writeConcretisationRegistry(
  documentId: string,
  sections: ReportDocumentSection[],
): Promise<void> {
  const { error } = await createAdminClient()
    .from('report_documents')
    .update({ sections, updated_at: new Date().toISOString() })
    .eq('id', documentId)
  if (error) throw error
}
