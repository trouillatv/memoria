import 'server-only'

// P1-A — Agrégation "résultat d'import" pour un PV historique précis.
//
// Répond à la question : qu'a fait MemorIA sur CE PV, pas sur tout le chantier.
// Dérive tout depuis document_extraction_proposal.extraction_run_id (même
// périmètre que ensureHistoricalPdfOccurrences, lib/db/canonical-subject-
// historical-occurrence.ts) — jamais de nouvelle colonne, jamais de fenêtre
// temporelle approximative : extraction_run_id scope exactement ce PV.
//
// Symétrie documentaire (2026-08-20) : chaque rapprochement porte, pour
// chaque sujet, soit ce que dit réellement CE PV (document_extraction_
// proposal.source_excerpt/source_page — jamais reformulé), soit un extrait
// représentatif de la mémoire déjà connue (canonical_subject_occurrence,
// créée pour les PV précédents). Un sujet touché par les deux à la fois
// (les deux côtés apparaissent dans ce PV) n'est jamais forcé vers un
// libellé "nouveau" ou "déjà connu" — voir bothTouchedByThisPv.

import { SupabaseClient } from '@supabase/supabase-js'
import {
  getSiteSuggestions,
  isSameSubjectQuestion,
  type SimilarityVerdict,
  type SimilarityRecommendation,
  type SimilarityLinkType,
  type SimilarityDirection,
} from '@/lib/subjects/similarity-analyze'

const ELIGIBLE_FAMILIES = ['action', 'vigilance', 'decision', 'knowledge_fact', 'deadline', 'reservation']

export const FAMILY_LABEL: Record<string, string> = {
  action: 'Action',
  vigilance: 'Point de vigilance',
  decision: 'Décision',
  knowledge_fact: 'Fait constaté',
  deadline: 'Échéance',
  reservation: 'Réserve',
  observation: 'Observation',
  person: 'Personne',
  company: 'Entreprise',
}

interface ProposalRow {
  id: string
  label: string
  subject_thread_id: string
  source_excerpt: string | null
  source_page: number | null
  proposal_family: string
}

interface OccurrenceRow {
  id: string
  canonical_subject_id: string
  label: string
  note: string | null
  effective_date: string
  evidence_count: number
  source_ref_id: string
}

export interface MemoryBuildSuggestionSide {
  canonicalSubjectId: string
  label: string
  /** true si ce sujet est aussi touché par les propositions de CE PV. */
  touchedByThisPv: boolean
  /** Ce que dit réellement ce PV — présent uniquement si touchedByThisPv. */
  pvExcerpt: string | null
  pvExcerptPage: number | null
  /** Extrait représentatif déjà en mémoire — présent uniquement si !touchedByThisPv. */
  knownExcerpt: string | null
  knownSince: string | null
  knownEvidenceCount: number | null
}

export interface MemoryBuildSuggestion {
  id: string
  score: number
  verdict: SimilarityVerdict
  recommendation: SimilarityRecommendation
  suggestedLinkType: SimilarityLinkType | null
  suggestedDirection: SimilarityDirection | null
  suggestedLabel: string | null
  reason: string
  /** Hypothèse « même objet » (significative si verdict=related) — trace fidèle du juge. */
  sameObjectHypothesis: boolean
  /** Dérivé serveur : présenter la question « Même sujet ? » (merge OU related+hypothèse). */
  askSameSubject: boolean
  sideA: MemoryBuildSuggestionSide
  sideB: MemoryBuildSuggestionSide
  /** Les deux sujets sont mentionnés par CE PV — libellé neutre côté UI. */
  bothTouchedByThisPv: boolean
}

export interface MemoryBuildNewSubject {
  id: string
  label: string
  sourceExcerpt: string | null
  sourcePage: number | null
  type: string | null
}

export interface MemoryBuildEnrichedSubject {
  id: string
  label: string
  addedEvidenceCount: number
  page: number | null
}

export interface MemoryBuildIgnoredItem {
  label: string
  reason: string | null
}

export interface MemoryBuildResult {
  siteId: string
  siteReportId: string
  identifiedSubjectCount: number
  integratedSubjectCount: number
  newSubjectCount: number
  newSubjects: MemoryBuildNewSubject[]
  enrichedSubjectCount: number
  enrichedSubjects: MemoryBuildEnrichedSubject[]
  ignoredThreadCount: number
  ignoredItems: MemoryBuildIgnoredItem[]
  pendingSuggestions: MemoryBuildSuggestion[]
  resolvedSuggestionCount: number
  mergedCount: number
  linkedCount: number
  distinctCount: number
}

const EMPTY_RESULT = (siteId: string, siteReportId: string): MemoryBuildResult => ({
  siteId,
  siteReportId,
  identifiedSubjectCount: 0,
  integratedSubjectCount: 0,
  newSubjectCount: 0,
  newSubjects: [],
  enrichedSubjectCount: 0,
  enrichedSubjects: [],
  ignoredThreadCount: 0,
  ignoredItems: [],
  pendingSuggestions: [],
  resolvedSuggestionCount: 0,
  mergedCount: 0,
  linkedCount: 0,
  distinctCount: 0,
})

/** Sélectionne le meilleur extrait exact + page pour un groupe de propositions de CE PV. */
function pickPvExcerpt(group: ProposalRow[]): { excerpt: string | null; page: number | null } {
  const withExcerpt = group.find((p) => (p.source_excerpt ?? '').trim().length > 0)
  if (withExcerpt) return { excerpt: withExcerpt.source_excerpt, page: withExcerpt.source_page }
  const withLabel = group.find((p) => (p.label ?? '').trim().length > 0)
  return { excerpt: withLabel?.label ?? null, page: withLabel?.source_page ?? group[0]?.source_page ?? null }
}

/**
 * Calcule le résultat d'import d'un PV historique précis (siteReportId).
 * Retourne null si la visite n'a pas de run d'extraction associé (visite
 * non-import, ou antérieure à P1-A).
 */
export async function getMemoryBuildResult(
  supabase: SupabaseClient,
  siteReportId: string,
): Promise<MemoryBuildResult | null> {
  const { data: report } = await supabase
    .from('site_reports')
    .select('id, site_id, extraction_run_id')
    .eq('id', siteReportId)
    .maybeSingle()

  if (!report || !report.site_id || !report.extraction_run_id) return null
  const siteId = report.site_id as string
  const runId = report.extraction_run_id as string

  const { data: propsRaw } = await supabase
    .from('document_extraction_proposal')
    .select('id, label, subject_thread_id, source_excerpt, source_page, proposal_family')
    .eq('extraction_run_id', runId)
    .in('proposal_family', ELIGIBLE_FAMILIES)
    .not('subject_thread_id', 'is', null)

  const proposals = (propsRaw ?? []) as ProposalRow[]
  const threadIds = [...new Set(proposals.map((p) => p.subject_thread_id))]

  if (threadIds.length === 0) return EMPTY_RESULT(siteId, siteReportId)

  const { data: stiRows } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', siteId)
    .in('subject_thread_id', threadIds)

  const threadToCs = new Map(
    (stiRows ?? []).map((r) => [r.subject_thread_id as string, r.canonical_subject_id as string]),
  )
  const resolvedIds = [...new Set([...threadToCs.values()])]
  const resolvedSet = new Set(resolvedIds)

  const unresolvedThreadIds = threadIds.filter((t) => !threadToCs.has(t))
  const ignoredItems: MemoryBuildIgnoredItem[] = [
    ...new Set(proposals.filter((p) => unresolvedThreadIds.includes(p.subject_thread_id)).map((p) => p.label)),
  ].map((label) => ({ label, reason: null }))

  // Propositions de CE PV, groupées par canonical_subject_id résolu — réutilisé
  // pour l'extrait exact des nouveaux sujets et des côtés "touchés" des rapprochements.
  const proposalsByCs = new Map<string, ProposalRow[]>()
  for (const p of proposals) {
    const csId = threadToCs.get(p.subject_thread_id)
    if (!csId) continue
    if (!proposalsByCs.has(csId)) proposalsByCs.set(csId, [])
    proposalsByCs.get(csId)!.push(p)
  }

  // Nouveau (seule preuve = ce PV) vs enrichi (le sujet avait déjà d'autres occurrences).
  let newSubjectCount = 0
  let enrichedSubjectCount = 0
  const newSubjectIds: string[] = []
  const enrichedSubjectIds: string[] = []
  const occByCs = new Map<string, OccurrenceRow[]>()
  if (resolvedIds.length > 0) {
    const { data: occRows } = await supabase
      .from('canonical_subject_occurrence')
      .select('id, canonical_subject_id, label, note, effective_date, evidence_count, source_ref_id')
      .in('canonical_subject_id', resolvedIds)
    for (const row of (occRows ?? []) as OccurrenceRow[]) {
      if (!occByCs.has(row.canonical_subject_id)) occByCs.set(row.canonical_subject_id, [])
      occByCs.get(row.canonical_subject_id)!.push(row)
    }
    for (const csId of resolvedIds) {
      const rows = occByCs.get(csId) ?? []
      if (rows.length <= 1) newSubjectIds.push(csId)
      else enrichedSubjectIds.push(csId)
    }
  }
  newSubjectCount = newSubjectIds.length
  enrichedSubjectCount = enrichedSubjectIds.length

  let newSubjects: MemoryBuildNewSubject[] = []
  let enrichedSubjects: MemoryBuildEnrichedSubject[] = []
  if (newSubjectIds.length > 0 || enrichedSubjectIds.length > 0) {
    const { data: csRows } = await supabase
      .from('canonical_subject')
      .select('id, label')
      .in('id', [...newSubjectIds, ...enrichedSubjectIds])
    const labelById = new Map(((csRows ?? []) as Array<{ id: string; label: string }>).map((c) => [c.id, c.label]))

    newSubjects = newSubjectIds.map((csId) => {
      const group = proposalsByCs.get(csId) ?? []
      const { excerpt, page } = pickPvExcerpt(group)
      const family = group[0]?.proposal_family ?? null
      return {
        id: csId,
        label: labelById.get(csId) ?? '—',
        sourceExcerpt: excerpt,
        sourcePage: page,
        type: family ? (FAMILY_LABEL[family] ?? null) : null,
      }
    })

    enrichedSubjects = enrichedSubjectIds.map((csId) => {
      const rows = occByCs.get(csId) ?? []
      const thisRunRow = rows.find((r) => r.source_ref_id === siteReportId)
      const group = proposalsByCs.get(csId) ?? []
      const page = group.find((p) => p.source_page != null)?.source_page ?? null
      return {
        id: csId,
        label: labelById.get(csId) ?? '—',
        addedEvidenceCount: thisRunRow?.evidence_count ?? group.length,
        page,
      }
    })
  }

  // Rapprochements en attente impliquant au moins un sujet touché par ce PV.
  const allPending = await getSiteSuggestions(supabase, siteId, 50)
  const scopedPending = allPending.filter((s) => resolvedSet.has(s.subject_a_id) || resolvedSet.has(s.subject_b_id))

  let subjectLabels = new Map<string, string>()
  const knownOccByCs = new Map<string, Array<{ label: string; note: string | null; effective_date: string }>>()
  const knownCountByCs = new Map<string, number>()
  if (scopedPending.length > 0) {
    const labelIds = [...new Set(scopedPending.flatMap((s) => [s.subject_a_id, s.subject_b_id]))]
    const { data: csRows } = await supabase.from('canonical_subject').select('id, label').in('id', labelIds)
    subjectLabels = new Map((csRows ?? []).map((c) => [c.id as string, c.label as string]))

    // Extrait représentatif "déjà connu" pour les sujets non touchés par ce PV.
    const untouchedIds = labelIds.filter((id) => !resolvedSet.has(id))
    if (untouchedIds.length > 0) {
      const { data: knownOccRows } = await supabase
        .from('canonical_subject_occurrence')
        .select('canonical_subject_id, label, note, effective_date')
        .in('canonical_subject_id', untouchedIds)
        .order('effective_date', { ascending: false })
      for (const row of (knownOccRows ?? []) as Array<{
        canonical_subject_id: string; label: string; note: string | null; effective_date: string
      }>) {
        knownCountByCs.set(row.canonical_subject_id, (knownCountByCs.get(row.canonical_subject_id) ?? 0) + 1)
        if (!knownOccByCs.has(row.canonical_subject_id)) knownOccByCs.set(row.canonical_subject_id, [])
        knownOccByCs.get(row.canonical_subject_id)!.push(row)
      }
    }
  }

  const buildSide = (csId: string): MemoryBuildSuggestionSide => {
    const label = subjectLabels.get(csId) ?? '—'
    if (resolvedSet.has(csId)) {
      const group = proposalsByCs.get(csId) ?? []
      const { excerpt, page } = pickPvExcerpt(group)
      return {
        canonicalSubjectId: csId,
        label,
        touchedByThisPv: true,
        pvExcerpt: excerpt,
        pvExcerptPage: page,
        knownExcerpt: null,
        knownSince: null,
        knownEvidenceCount: null,
      }
    }
    // Trié effective_date desc à la requête : le premier est le plus récent.
    const rows = knownOccByCs.get(csId) ?? []
    const representative = rows[0] ?? null
    const since = rows.length > 0 ? rows[rows.length - 1]!.effective_date : null
    const excerptText = representative ? (representative.note?.trim() || representative.label) : null
    return {
      canonicalSubjectId: csId,
      label,
      touchedByThisPv: false,
      pvExcerpt: null,
      pvExcerptPage: null,
      knownExcerpt: excerptText,
      knownSince: since,
      knownEvidenceCount: knownCountByCs.get(csId) ?? null,
    }
  }

  const pendingSuggestions: MemoryBuildSuggestion[] = scopedPending.map((s) => {
    const sideA = buildSide(s.subject_a_id)
    const sideB = buildSide(s.subject_b_id)
    return {
      id: s.id,
      score: s.score,
      verdict: s.verdict,
      recommendation: s.recommendation,
      suggestedLinkType: s.suggested_link_type,
      suggestedDirection: s.suggested_direction,
      suggestedLabel: s.suggested_label,
      reason: s.reason,
      sameObjectHypothesis: s.same_object_hypothesis,
      askSameSubject: isSameSubjectQuestion(s),
      sideA,
      sideB,
      bothTouchedByThisPv: sideA.touchedByThisPv && sideB.touchedByThisPv,
    }
  })

  // Rapprochements déjà tranchés impliquant un sujet touché — pour l'état "terminé".
  const resolvedRows: Array<{ id: string; status: string }> = []
  if (resolvedIds.length > 0) {
    const [{ data: byA }, { data: byB }] = await Promise.all([
      supabase
        .from('canonical_subject_similarity_suggestion')
        .select('id, status')
        .eq('site_id', siteId)
        .neq('status', 'pending')
        .not('reviewed_at', 'is', null)
        .in('subject_a_id', resolvedIds),
      supabase
        .from('canonical_subject_similarity_suggestion')
        .select('id, status')
        .eq('site_id', siteId)
        .neq('status', 'pending')
        .not('reviewed_at', 'is', null)
        .in('subject_b_id', resolvedIds),
    ])
    const seen = new Set<string>()
    for (const row of [...((byA ?? []) as Array<{ id: string; status: string }>), ...((byB ?? []) as Array<{ id: string; status: string }>)]) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      resolvedRows.push(row)
    }
  }

  return {
    siteId,
    siteReportId,
    identifiedSubjectCount: threadIds.length,
    integratedSubjectCount: resolvedIds.length,
    newSubjectCount,
    newSubjects,
    enrichedSubjectCount,
    enrichedSubjects,
    ignoredThreadCount: unresolvedThreadIds.length,
    ignoredItems,
    pendingSuggestions,
    resolvedSuggestionCount: resolvedRows.length,
    mergedCount: resolvedRows.filter((r) => r.status === 'accepted_merge').length,
    linkedCount: resolvedRows.filter((r) => r.status === 'accepted_link').length,
    distinctCount: resolvedRows.filter((r) => r.status === 'rejected').length,
  }
}
