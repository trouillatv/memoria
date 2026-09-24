// P0-2A (réalignement) — Matérialisation document → engagement, Porte B
// (chantier, sans AO). Appelle les RPC PostgreSQL
// materialize_engagement_create_new / link_existing (migration 436) via admin
// client, même convention que materializeObligation
// (lib/db/materialize-obligation.ts) et materializeHistoricalVisit.
//
// Deux issues seulement : create_new (nouvel engagement, site_id renseigné,
// tender_id NULL, status='curated' — validation de l'extraction, PAS
// activation, cf. migration 437) et link_existing (rattachement à un
// engagement existant du même chantier/organisation, zéro mutation de ses
// champs métier). L'activation ('curated' → 'active') est un geste séparé,
// cf. lib/db/engagements.ts::activateEngagement. La Porte A (AO, tender_id
// NOT NULL) reste inchangée et n'utilise jamais ces RPC.

import { createAdminClient } from '@/lib/supabase/admin'
import { KIND_META } from '@/lib/engagements/kind'
import { CATEGORY_LABELS } from '@/lib/engagements/labels'
import type { EngagementCategory, EngagementKind } from '@/types/db'

export async function materializeEngagementCreateNew(
  proposalId: string,
  userId: string | null,
  category: EngagementCategory,
  kind: EngagementKind,
  measurable: boolean
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('materialize_engagement_create_new', {
    p_proposal_id: proposalId,
    p_user_id: userId,
    p_category: category,
    p_kind: kind,
    p_measurable: measurable,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/**
 * La RPC retourne l'ID de la ligne document_proposal_materialization, pas
 * l'ID de l'Engagement (cf. migration 436 : `RETURN v_mat_id`/`v_existing_
 * mat_id`). L'Engagement cible est déjà connu de l'appelant — c'est le
 * paramètre d'entrée — on le retourne directement plutôt que la valeur brute
 * de la RPC, pour ne jamais faire croire qu'un ID de matérialisation est un
 * ID d'Engagement.
 */
export async function materializeEngagementLinkExisting(
  proposalId: string,
  engagementId: string,
  userId: string | null
): Promise<string> {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('materialize_engagement_link_existing', {
    p_proposal_id: proposalId,
    p_engagement_id: engagementId,
    p_user_id: userId,
  })
  if (error) throw new Error(error.message)
  return engagementId
}

export interface FinalizeAcceptedEngagementsResult {
  ok: boolean
  createdCount: number
  needsReviewCount: number
  error?: string
}

/**
 * Bulk « Finaliser les Engagements » (mandat Vincent 2026-09-25, recette OCEF) —
 * comble le trou entre « proposition acceptée » et « Engagement matérialisé »
 * qu'aucun geste groupé ne couvrait jusqu'ici (acceptAllPendingForRun ne fait
 * qu'un accept, jamais de matérialisation).
 *
 * Reproduit exactement ce qu'un humain ferait en cliquant « Créer un nouvel
 * Engagement » sur chaque carte acceptée : mêmes valeurs par défaut que
 * ProposalCard (category='other', measurable=false si absents du payload IA),
 * même RPC create_new — jamais de rattachement à un Engagement existant (ce
 * choix reste un geste humain volontaire par carte, cf. verifyEngagementProposal).
 * `kind` n'a AUCUN défaut sûr (le geste par carte bloque déjà sans nature) :
 * une proposition sans nature IA valide est exclue et comptée dans
 * needsReviewCount plutôt que de deviner une nature.
 *
 * Idempotent par construction : la requête ne sélectionne que review_status IN
 * (accepted, edited) — une proposition déjà matérialisée (review_status flip à
 * 'materialized' par la RPC) ne peut plus être resélectionnée.
 */
export async function finalizeAcceptedEngagementsForRun(input: {
  runId: string
  userId: string
}): Promise<FinalizeAcceptedEngagementsResult> {
  const { runId, userId } = input
  const supabase = createAdminClient()

  const { data: proposals, error } = await supabase
    .from('document_extraction_proposal')
    .select('id, source_payload')
    .eq('extraction_run_id', runId)
    .eq('proposal_family', 'engagement')
    .in('review_status', ['accepted', 'edited'])
  if (error) return { ok: false, createdCount: 0, needsReviewCount: 0, error: error.message }

  let createdCount = 0
  let needsReviewCount = 0

  for (const p of proposals ?? []) {
    const payload = (p.source_payload as Record<string, unknown> | null) ?? {}
    const kindRaw = payload.kind
    const kind = typeof kindRaw === 'string' && kindRaw in KIND_META ? (kindRaw as EngagementKind) : null
    if (!kind) {
      needsReviewCount++
      continue
    }
    const categoryRaw = payload.category
    const category = typeof categoryRaw === 'string' && categoryRaw in CATEGORY_LABELS
      ? (categoryRaw as EngagementCategory)
      : 'other'
    const measurable = payload.measurable === true

    try {
      await materializeEngagementCreateNew(p.id, userId, category, kind, measurable)
      createdCount++
    } catch {
      needsReviewCount++
    }
  }

  return { ok: true, createdCount, needsReviewCount }
}

export interface PendingEngagementFinalization {
  runId: string
  documentId: string
  count: number
}

/**
 * Correction #3 du mandat Vincent 2026-09-25 (recette OCEF) — l'état vide de
 * la page Prestations prévues ne doit pas dire « Aucun engagement » quand des
 * propositions ont en fait déjà été acceptées mais jamais finalisées. Cherche,
 * parmi les runs d'extraction canoniques du chantier, des propositions
 * proposal_family='engagement' encore en review_status accepted/edited.
 *
 * Deux requêtes plutôt qu'un embed Supabase : évite toute ambiguïté de nom de
 * relation entre document_extraction_proposal et document_extraction_run, et
 * reste lisible pour un cas normalement mono-run par chantier.
 */
export async function findPendingEngagementFinalizationForSite(
  siteId: string,
): Promise<PendingEngagementFinalization | null> {
  const supabase = createAdminClient()

  const { data: runs, error: runsError } = await supabase
    .from('document_extraction_run')
    .select('id, document_id')
    .eq('target_site_id', siteId)
    .eq('is_canonical', true)
  if (runsError) throw new Error(runsError.message)
  if (!runs || runs.length === 0) return null

  const runIds = runs.map((r) => r.id)
  const { data: proposals, error: proposalsError } = await supabase
    .from('document_extraction_proposal')
    .select('id, extraction_run_id')
    .eq('proposal_family', 'engagement')
    .in('review_status', ['accepted', 'edited'])
    .in('extraction_run_id', runIds)
  if (proposalsError) throw new Error(proposalsError.message)
  if (!proposals || proposals.length === 0) return null

  const countByRun = new Map<string, number>()
  for (const p of proposals) {
    countByRun.set(p.extraction_run_id, (countByRun.get(p.extraction_run_id) ?? 0) + 1)
  }
  const [topRunId] = [...countByRun.entries()].sort((a, b) => b[1] - a[1])[0]
  const documentId = runs.find((r) => r.id === topRunId)!.document_id

  return { runId: topRunId, documentId, count: proposals.length }
}
