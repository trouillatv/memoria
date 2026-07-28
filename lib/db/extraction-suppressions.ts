import 'server-only'

// ── MÉMOIRE MÉTIER — SUPPRESSIONS D'EXTRACTION ───────────────────────────────
// Formule verrouillée (Vincent, 2026-07-28) :
//   score = overlap / suppressionTokens.length
//   déclenchement si overlap ≥ 2 ET score ≥ DEFAULT_SUPPRESSION_THRESHOLD (0.6)
//   refus d'enregistrement si suppressionTokens.length < 2
//
// Le tokenizer est IDENTIQUE à celui de pickCitations() (provenance.ts) :
// mots ≥ 4 lettres, hors mots vides, NFD normalisé, doublons neutralisés par Set.
// Toute divergence entre les deux serait un bug de cohérence.

import { createAdminClient } from '@/lib/supabase/admin'

export const DEFAULT_SUPPRESSION_THRESHOLD = 0.6

export type SuppressionMatch = {
  matched: boolean
  score: number
  overlap: number
  suppressionTokenCount: number
  matchedTokens: string[]
}

const STOP = new Set([
  'dans', 'pour', 'avec', 'les', 'des', 'une', 'que', 'qui', 'est', 'sera', 'seront',
  'vont', 'plus', 'sont', 'aux', 'par', 'pas', 'leur', 'leurs', 'cette', 'ces', 'ils',
  'elle', 'nous', 'vous', 'sur', 'son', 'ses', 'the', 'and', 'etre', 'avoir', 'fait',
])

function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Extrait les tokens signifiants d'un texte.
 * Mots ≥ 4 lettres · hors mots vides · doublons neutralisés (Set).
 * Exporté pour les tests — doit rester pur (pas d'effet de bord).
 */
export function extractTokens(s: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const w of normalizeText(s).replace(/[^a-z0-9]+/g, ' ').split(' ')) {
    if (w.length >= 4 && !STOP.has(w) && !seen.has(w)) {
      seen.add(w)
      result.push(w)
    }
  }
  return result
}

/**
 * Calcule si une proposition ressemble à un pattern supprimé.
 * score = overlap / suppressionTokens.length
 * matched = overlap ≥ 2 ET score ≥ threshold
 * Si suppressionTokens.length < 2 : jamais matched (pattern trop court).
 * Exporté pour les tests — pur, sans appel DB.
 */
export function matchSuppression(
  proposalTitle: string,
  suppressionTokens: string[],
  threshold = DEFAULT_SUPPRESSION_THRESHOLD,
): SuppressionMatch {
  const suppressionTokenCount = suppressionTokens.length
  if (suppressionTokenCount < 2) {
    return { matched: false, score: 0, overlap: 0, suppressionTokenCount, matchedTokens: [] }
  }
  const proposalSet = new Set(extractTokens(proposalTitle))
  const matchedTokens = suppressionTokens.filter((t) => proposalSet.has(t))
  const overlap = matchedTokens.length
  const score = overlap / suppressionTokenCount
  const matched = overlap >= 2 && score >= threshold
  return { matched, score, overlap, suppressionTokenCount, matchedTokens }
}

/**
 * Enregistre un pattern de suppression pour un chantier.
 * Refus silencieux si le titre ne produit pas au moins 2 tokens — un pattern
 * d'un seul mot serait trop large et masquerait des propositions légitimes.
 */
export async function createExtractionSuppression(params: {
  siteId: string
  organizationId: string
  objectType: 'deadline' | 'action' | 'decision'
  rawTitle: string
  cancelReason: string
  createdBy: string | null
}): Promise<void> {
  const titleTokens = extractTokens(params.rawTitle)
  if (titleTokens.length < 2) return
  await createAdminClient()
    .from('site_extraction_suppressions')
    .insert({
      site_id: params.siteId,
      organization_id: params.organizationId,
      object_type: params.objectType,
      title_tokens: titleTokens,
      raw_title: params.rawTitle,
      cancel_reason: params.cancelReason,
      created_by: params.createdBy,
    })
}

/** Supprime une règle de suppression (l'utilisateur a décidé que le filtre avait globalement tort). */
export async function deleteExtractionSuppression(id: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('site_extraction_suppressions')
    .delete()
    .eq('id', id)
  if (error) throw error
}

/** Suppressions actives d'un chantier pour un type d'objet (lecture batch). */
export async function listExtractionSuppressions(
  siteId: string,
  objectType: 'deadline' | 'action' | 'decision',
): Promise<Array<{ id: string; title_tokens: string[]; raw_title: string }>> {
  const { data } = await createAdminClient()
    .from('site_extraction_suppressions')
    .select('id, title_tokens, raw_title')
    .eq('site_id', siteId)
    .eq('object_type', objectType)
    .order('created_at', { ascending: false })
  return (data ?? []) as Array<{ id: string; title_tokens: string[]; raw_title: string }>
}
