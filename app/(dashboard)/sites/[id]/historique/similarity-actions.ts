'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  getSiteSuggestions,
  getSuggestionForPair,
  analyzeSubjectPair,
  upsertSuggestion,
  type PersistedSuggestion,
  type SubjectInput,
} from '@/lib/subjects/similarity-analyze'
import { detectTypeHint, fusionBlockReason as computeFusionBlock, fusionWarningReason as computeFusionWarning, normalizePairKey } from '@/lib/subjects/similarity-candidates'
import { loadSimilarityContextSubjects } from '@/lib/subjects/similarity-context'
import { runSemanticFeed } from '@/lib/subjects/semantic-feed-run'
import { mergeCanonicalSubjectsAction, createLinkFromMatrixAction } from './merge-actions'

// ── Chargement des suggestions pour l'UI ──────────────────────────────────────

export async function getSiteSimilaritySuggestionsAction(
  siteId: string,
  minScore = 50,
): Promise<{ suggestions?: PersistedSuggestion[]; error?: string }> {
  const supabase = createAdminClient()
  try {
    const suggestions = await getSiteSuggestions(supabase, siteId, minScore)
    return { suggestions }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Analyse on-demand (DnD ou bouton manuel) ──────────────────────────────────

/**
 * Vérifie d'abord une suggestion persistée, sinon appelle Gemini.
 * Utilisé par le DnD et le panneau de rapprochement.
 */
export async function getOrAnalyzeSubjectPairAction(
  subjectAId: string,
  subjectBId: string,
  siteId: string,
): Promise<{ suggestion?: PersistedSuggestion; fresh?: boolean; error?: string }> {
  const user = await getCurrentUserWithProfile().catch(() => null)
  const supabase = createAdminClient()

  // 1. Chercher une suggestion déjà persistée
  const existing = await getSuggestionForPair(supabase, subjectAId, subjectBId)
  if (existing) return { suggestion: existing, fresh: false }

  // 2. Charger les données des deux sujets
  const [{ data: sA }, { data: sB }] = await Promise.all([
    supabase
      .from('canonical_subject')
      .select('id, label, aliases')
      .eq('id', subjectAId)
      .maybeSingle(),
    supabase
      .from('canonical_subject')
      .select('id, label, aliases')
      .eq('id', subjectBId)
      .maybeSingle(),
  ])
  if (!sA || !sB) return { error: 'Sujet introuvable' }

  // 3. Topics
  const [{ data: tA }, { data: tB }] = await Promise.all([
    supabase
      .from('canonical_topic_subject')
      .select('canonical_topic(label)')
      .eq('canonical_subject_id', subjectAId)
      .maybeSingle(),
    supabase
      .from('canonical_topic_subject')
      .select('canonical_topic(label)')
      .eq('canonical_subject_id', subjectBId)
      .maybeSingle(),
  ])

  const inputA: SubjectInput = {
    id: sA.id,
    label: (sA as { id: string; label: string; aliases: string[] }).label,
    aliases: (sA as { id: string; label: string; aliases: string[] }).aliases ?? [],
    topicLabel: (tA as { canonical_topic: { label: string } | null } | null)?.canonical_topic?.label ?? null,
  }
  const inputB: SubjectInput = {
    id: sB.id,
    label: (sB as { id: string; label: string; aliases: string[] }).label,
    aliases: (sB as { id: string; label: string; aliases: string[] }).aliases ?? [],
    topicLabel: (tB as { canonical_topic: { label: string } | null } | null)?.canonical_topic?.label ?? null,
  }

  try {
    const typeHintA = detectTypeHint(inputA.label)
    const typeHintB = detectTypeHint(inputB.label)
    const fusionBlock = computeFusionBlock(typeHintA, typeHintB)
    const fusionWarning = fusionBlock ? null : computeFusionWarning(typeHintA, typeHintB)

    // Persons are excluded upstream in the batch but can reach here via DnD
    if (typeHintA === 'person_name' || typeHintB === 'person_name') {
      return { error: 'Acteur détecté — résolution d\'identité distincte requise' }
    }

    const result = await analyzeSubjectPair(inputA, inputB, user?.id ?? null, {
      typeHintA,
      typeHintB,
      fusionBlockReason: fusionBlock,
      fusionWarningReason: fusionWarning,
    })
    const saved = await upsertSuggestion(supabase, siteId, subjectAId, subjectBId, result)
    if ('error' in saved) return { error: saved.error }

    // Relire la suggestion persistée
    const persisted = await getSuggestionForPair(supabase, subjectAId, subjectBId)
    return { suggestion: persisted ?? undefined, fresh: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Recherche approfondie (voie sémantique manuelle, P-UI-R2d) ────────────────

/**
 * Lance la voie sémantique bornée à la demande de l'humain (jamais silencieuse). Deux portées :
 *  - reportId fourni → sources = sujets touchés par CET import (CTA résultat d'import) ;
 *  - reportId absent → sources = tous les sujets métier actifs (CTA Ligne de vie, balayage site).
 * Persistance inchangée : uniquement shouldPersistSemanticSuggestion (same_subject | related+SOH).
 * Toutes les protections R2c restent (rejet mémorisé, pending non dupliqué, paire normalisée,
 * acteurs exclus, fusion existante exclue, cap dur, idempotence).
 */
export async function runSemanticDeepSearchAction(
  siteId: string,
  reportId?: string | null,
): Promise<{ created?: number; evaluated?: number; capped?: boolean; error?: string }> {
  const user = await getCurrentUserWithProfile().catch(() => null)
  const supabase = createAdminClient()
  try {
    const subjects = await loadSimilarityContextSubjects(siteId)
    if (subjects.length < 2) return { created: 0, evaluated: 0, capped: false }

    // Sources selon la portée.
    let touchedSubjectIds: string[]
    if (reportId) {
      const { data: occ } = await supabase
        .from('canonical_subject_occurrence')
        .select('canonical_subject_id')
        .eq('source_ref_id', reportId)
      touchedSubjectIds = [...new Set((occ ?? []).map((o) => o.canonical_subject_id as string))]
    } else {
      touchedSubjectIds = subjects.map((s) => s.forCandidates.id)
    }
    if (touchedSubjectIds.length === 0) return { created: 0, evaluated: 0, capped: false }

    const { data: rejected } = await supabase
      .from('canonical_subject_similarity_suggestion')
      .select('subject_a_id, subject_b_id')
      .eq('site_id', siteId)
      .eq('status', 'rejected')
    const rejectedPairs = new Set((rejected ?? []).map((r) => normalizePairKey(r.subject_a_id, r.subject_b_id)))

    const summary = await runSemanticFeed(subjects, {
      siteId,
      touchedSubjectIds,
      rejectedPairs,
      dryRun: false,
      userId: user?.id ?? null,
    })

    revalidatePath(`/sites/${siteId}/historique`)
    return { created: summary.persistedCount, evaluated: summary.evaluatedPairCount, capped: summary.capped }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Décisions humaines ────────────────────────────────────────────────────────

export async function acceptSuggestionAsMergeAction(
  suggestionId: string,
  subjectAId: string,
  subjectBId: string,
  suggestedLabel: string,
  siteId: string,
): Promise<{ error?: string; winnerId?: string }> {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) return { error: 'Non authentifié' }

  // Exécuter la fusion via l'action existante
  const mergeResult = await mergeCanonicalSubjectsAction(subjectAId, subjectBId, suggestedLabel, siteId)
  if (mergeResult.error) return { error: mergeResult.error }

  // Marquer la suggestion
  const supabase = createAdminClient()
  await supabase
    .from('canonical_subject_similarity_suggestion')
    .update({ status: 'accepted_merge', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
    .eq('id', suggestionId)

  // Auto-obsolète : les autres suggestions pending du sujet perdant deviennent obsolètes
  const loserId = mergeResult.winnerId === subjectAId ? subjectBId : subjectAId
  await supabase
    .from('canonical_subject_similarity_suggestion')
    .update({ status: 'obsolete', reviewed_at: new Date().toISOString() })
    .eq('site_id', siteId)
    .eq('status', 'pending')
    .or(`subject_a_id.eq.${loserId},subject_b_id.eq.${loserId}`)

  revalidatePath(`/sites/${siteId}/historique`)
  return { winnerId: mergeResult.winnerId }
}

export async function acceptSuggestionAsLinkAction(
  suggestionId: string,
  fromSubjectId: string,
  toSubjectId: string,
  linkType: string,
  siteId: string,
  reason?: string | null,
): Promise<{ error?: string }> {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) return { error: 'Non authentifié' }

  // Créer le lien via l'action existante — reason propagé en justification pour traçabilité.
  const linkResult = await createLinkFromMatrixAction(fromSubjectId, toSubjectId, linkType, siteId, reason)
  if (linkResult.error) return { error: linkResult.error }

  // Marquer la suggestion
  const supabase = createAdminClient()
  await supabase
    .from('canonical_subject_similarity_suggestion')
    .update({ status: 'accepted_link', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
    .eq('id', suggestionId)

  revalidatePath(`/sites/${siteId}/historique`)
  return {}
}

export async function rejectSuggestionAction(
  suggestionId: string,
  siteId: string,
): Promise<{ error?: string }> {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) return { error: 'Non authentifié' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('canonical_subject_similarity_suggestion')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
    .eq('id', suggestionId)

  if (error) return { error: error.message }

  revalidatePath(`/sites/${siteId}/historique`)
  return {}
}
