import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractPdfText } from '@/services/pdf/extract'
import { extractStructuredTableContext, buildPlanningGroups } from './structured-table-context'
import { qualifyPlanningRows } from './planning-row-extractor'
import { extractYearAnchor, normalizePlanningDate } from '@/lib/planning/planning-date-normalizer'
import { insertExtractionProposals, updateExtractionRunStatus } from '@/lib/db/document-extractions'
import type { DocumentProposalFamily } from '@/types/db'

/**
 * Pipeline V1-B — planning géométrique déterministe.
 *
 * Chaîne :
 *   PDF → parseur géométrique → groupes atomiques immuables
 *       → qualification LLM (kind/label uniquement, sans date)
 *       → normalisation temporelle déterministe (hors LLM)
 *       → propositions planning
 *
 * Invariants :
 * - Le LLM ne peut pas modifier le rattachement date/semaine ← ligne.
 * - normalizedDate est calculé côté serveur à partir de l'ancre d'année du document.
 * - dueDate est physiquement absent du schéma LLM planning.
 *
 * Bloc final du même tableau (réceptions/financier) : capturé géométriquement par
 * extractStructuredTableContext (context.tailItems), sans second canal LLM.
 * Seules les lignes rowKind='milestone' (réceptions) deviennent des propositions
 * planning ci-dessous. Les lignes rowKind='financial' (retenue de garantie,
 * règlements) restent dans context.tailItems mais ne sont jamais matérialisées :
 * aucun modèle financier n'existe encore côté site_planning_item/site_deadline/
 * site_action.
 */
export async function extractConstructionSchedule(
  documentId: string,
  _userId?: string | null,
  _siteId?: string | null,
  runId?: string,
): Promise<void> {
  const admin = createAdminClient()
  const { data: doc } = await admin
    .from('documents')
    .select('storage_path,organization_id,document_type')
    .eq('id', documentId)
    .maybeSingle()
  if (!doc || doc.document_type !== 'construction_schedule') return

  const { data: file, error: downloadError } = await admin.storage
    .from('documents')
    .download(doc.storage_path)
  if (downloadError || !file) throw new Error(downloadError?.message ?? 'PDF planning introuvable')
  const buffer = Buffer.from(await file.arrayBuffer())

  // 1. Texte brut — utilisé pour l'ancre d'année uniquement (pas envoyé au LLM planning)
  const extracted = await extractPdfText(buffer)

  // 2. Géométrie prouvée
  const context = await extractStructuredTableContext(buffer)
  if (!context.detected || context.rows.length === 0) {
    // Pas de tableau structuré détecté — aucune proposition planning
    if (runId) await updateExtractionRunStatus(runId, 'ready_for_review')
    return
  }

  // 3. Groupes atomiques immuables (groupKey / rowKey déterministes)
  const groups = buildPlanningGroups(context)

  // 4. Ancre d'année déterministe depuis le texte PDF (jamais la date d'upload)
  const yearAnchor = extractYearAnchor(extracted.text)

  // 5. Qualification LLM — kind/label uniquement, pas de date, schéma sans dueDate
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not set')
  const model = process.env.AI_MODEL ?? 'gemini-2.5-flash'
  const qualified = await qualifyPlanningRows(groups, apiKey, model)

  if (!runId) return

  // 6. Normalisation temporelle déterministe (hors LLM) + construction proposals
  //    Le serveur réattache rawDateText/rawWeekText/normalizedDate après qualification.
  const rowKeyToGroup = new Map(groups.flatMap((g) => g.rows.map((r) => [r.rowKey, g])))

  const inputs = qualified.map((q, idx) => {
    const group = rowKeyToGroup.get(q.rowKey)
    const temporal = normalizePlanningDate(
      group?.rawDateText ?? null,
      group?.rawWeekText ?? null,
      yearAnchor,
    )
    return {
      organization_id: doc.organization_id,
      document_id: documentId,
      proposal_family: 'planning' as DocumentProposalFamily,
      stable_key: `planning-${idx + 1}`,
      label: q.label,
      description: q.description ?? null,
      source_page: null,
      source_excerpt: group?.rows.find((r) => r.rowKey === q.rowKey)?.description ?? null,
      source_payload: {
        rowKey: q.rowKey,
        groupKey: q.groupKey,
        kind: q.kind,
        temporalRole: 'planned',
        rawDateText: group?.rawDateText ?? null,
        rawWeekText: group?.rawWeekText ?? null,
        normalizedDate: temporal.normalizedDate,
        normalizedEndDate: temporal.normalizedEndDate,
        temporalPrecision: temporal.temporalPrecision,
        normalizationSource: temporal.dateBasis,
      } as Record<string, unknown>,
      thematic_category: null,
      document_status: 'planned',
    }
  })

  // 7. Jalons du bloc final (réceptions) — géométrie déjà prouvée dans context.tailItems.
  //    Les lignes financières (rowKind='financial') sont volontairement exclues ici.
  const milestoneInputs = context.tailItems
    .filter((t) => t.rowKind === 'milestone' && t.explicitDate)
    .map((t) => ({
      organization_id: doc.organization_id,
      document_id: documentId,
      proposal_family: 'planning' as DocumentProposalFamily,
      stable_key: t.rowKey,
      label: t.description,
      description: null,
      source_page: t.page,
      source_excerpt: t.description,
      source_payload: {
        rowKey: t.rowKey,
        kind: 'milestone',
        temporalRole: 'planned',
        rawDateText: t.rawDateText,
        rawWeekText: null,
        normalizedDate: t.explicitDate,
        normalizedEndDate: null,
        temporalPrecision: 'day',
        normalizationSource: t.dateBasis,
      } as Record<string, unknown>,
      thematic_category: null,
      document_status: 'planned',
    }))

  await insertExtractionProposals(runId, [...inputs, ...milestoneInputs])
  await updateExtractionRunStatus(runId, 'ready_for_review')
}
