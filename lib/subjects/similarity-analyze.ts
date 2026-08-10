/**
 * Analyse Gemini d'une paire de canonical_subject candidates.
 * Persiste le résultat dans canonical_subject_similarity_suggestion.
 *
 * Ce service est utilisé par :
 * - Le batch (scripts/analyze-subject-similarities.ts)
 * - Le DnD dans SubjectLifelineGrid (fallback si pas de suggestion persistée)
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { getAIProvider } from '@/services/ai/factory'
import { withAITracking } from '@/services/ai/tracking'
import { normalizePairKey, normalizedPair, type SubjectTypeHint, fusionWarningReason as computeFusionWarning } from './similarity-candidates'

// ── Types ──────────────────────────────────────────────────────────────────────

export type SimilarityVerdict = 'same_subject' | 'related' | 'distinct' | 'uncertain'
export type SimilarityRecommendation = 'merge' | 'link' | 'none'
export type SimilarityLinkType = 'requires' | 'enables' | 'causes' | 'validates' | 'replaces' | 'relates_to'
export type SimilarityDirection = 'a_to_b' | 'b_to_a'
export type SuggestionStatus = 'pending' | 'accepted_merge' | 'accepted_link' | 'rejected' | 'obsolete'

export interface SimilarityResult {
  score: number
  verdict: SimilarityVerdict
  recommendation: SimilarityRecommendation
  suggested_link_type: SimilarityLinkType | null
  suggested_direction: SimilarityDirection | null
  suggested_label: string | null
  reason: string
  model: string
  /** Avertissement structurel soft (pas un blocage dur) — à afficher dans l'UI */
  warning_reason: string | null
}

export interface SubjectInput {
  id: string
  label: string
  aliases: string[]
  topicLabel?: string | null
  firstSeenAt?: string | null
  lastSeenAt?: string | null
  pvCount?: number
  nativeOccurrenceCount?: number
  currentStatus?: string | null
  isStagnant?: boolean
  activeObjects?: { actionsOpen: number; reservesOpen: number; decisionsOpen: number; deadlinesActive: number }
}

export interface PersistedSuggestion {
  id: string
  site_id: string
  subject_a_id: string
  subject_b_id: string
  score: number
  verdict: SimilarityVerdict
  recommendation: SimilarityRecommendation
  suggested_link_type: SimilarityLinkType | null
  suggested_direction: SimilarityDirection | null
  suggested_label: string | null
  reason: string
  model: string
  analyzed_at: string
  status: SuggestionStatus
  reviewed_at: string | null
  reviewed_by: string | null
}

// ── Prompt système ─────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `Tu es un expert en management de chantier BTP.
On te donne deux sujets canoniques extraits de procès-verbaux de chantier.
Chaque sujet comporte un libellé principal, des alias (formulations alternatives), et des données contextuelles.

Ta mission : évaluer si ces deux sujets décrivent le même objet réel sur le chantier.

Définitions :
- "same_subject" : même problème physique ou opération, formulé différemment
- "related" : sujets distincts mais liés par une relation causale, temporelle ou de dépendance
- "distinct" : sujets sans rapport direct
- "uncertain" : impossible de trancher avec les informations disponibles

Types de lien possibles si "related" :
- "requires" : A nécessite B pour être réalisé
- "enables" : A rend possible B
- "causes" : A provoque B
- "validates" : A valide ou réceptionne B
- "replaces" : A remplace ou annule B
- "relates_to" : lien générique sans direction claire

Réponds UNIQUEMENT en JSON valide, aucun autre texte :
{
  "verdict": "same_subject" | "related" | "distinct" | "uncertain",
  "score": 0-100,
  "recommendation": "merge" | "link" | "none",
  "suggested_link_type": null | "requires" | "enables" | "causes" | "validates" | "replaces" | "relates_to",
  "suggested_direction": null | "a_to_b" | "b_to_a",
  "suggested_label": null | "libellé canonique proposé si fusion",
  "reason": "phrase courte ≤ 15 mots"
}

Règles générales :
- score ≥ 90 → verdict doit être "same_subject", recommendation "merge"
- score 70-89 → verdict "same_subject" ou "related", recommendation "merge" ou "link"
- score 50-69 → verdict "related" ou "uncertain", recommendation "link" ou "none"
- score < 50 → verdict "distinct" ou "uncertain", recommendation "none"
- suggested_direction : A=sujet source, B=sujet cible dans la relation
- suggested_label : null sauf si verdict "same_subject"

Contre-exemples importants :
- Un événement daté (ex: "Essais plateforme du 30/03") n'est jamais "same_subject" d'un document résultant (ex: "Avis G3 — essais") → verdict "related", recommendation "link" (validates)
- Un sujet générique récurrent (ex: "Intempéries constatées") n'est pas "same_subject" d'un épisode daté précis (ex: "Intempéries du 16/02 au 06/03") si plusieurs épisodes distincts peuvent coexister → verdict "related", recommendation "link"
- En revanche, une reformulation du même travail physique (ex: "Reprise du nivellement – zone hors tolérance" ↔ "Reprise du nivellement suivant VISA 01.004") peut être "same_subject" si les deux décrivent clairement la même opération sur le même chantier`

function buildSystemPrompt(
  typeHintA: SubjectTypeHint | null,
  typeHintB: SubjectTypeHint | null,
  fusionBlock: string | null,
  fusionWarning: string | null,
): string {
  const lines: string[] = [BASE_SYSTEM_PROMPT]

  if (typeHintA || typeHintB) {
    lines.push('')
    lines.push('Types structurels détectés par analyse déterministe :')
    if (typeHintA) lines.push(`- Sujet A : ${typeHintA}`)
    if (typeHintB) lines.push(`- Sujet B : ${typeHintB}`)
  }

  if (fusionBlock) {
    lines.push('')
    lines.push(`CONTRAINTE DE FUSION : ${fusionBlock}`)
    lines.push('La fusion ("merge") est interdite pour cette paire. Ta recommendation NE PEUT PAS être "merge".')
    lines.push('Si les sujets semblent liés, propose "link" avec le type de relation approprié.')
    lines.push('Si aucun lien probant, propose "none".')
  } else if (fusionWarning) {
    lines.push('')
    lines.push(`AVERTISSEMENT STRUCTUREL : ${fusionWarning}`)
    lines.push('Avant de recommander "merge", vérifie que les deux sujets décrivent vraiment le même objet unique.')
    lines.push('Si la formulation générique peut s\'appliquer à plusieurs épisodes distincts, préfère "related/link".')
  }

  return lines.join('\n')
}

// ── Analyse Gemini d'une paire ─────────────────────────────────────────────────

export async function analyzeSubjectPair(
  subjectA: SubjectInput,
  subjectB: SubjectInput,
  userId: string | null,
  opts?: {
    typeHintA?: SubjectTypeHint | null
    typeHintB?: SubjectTypeHint | null
    fusionBlockReason?: string | null
    fusionWarningReason?: string | null
  },
): Promise<SimilarityResult> {
  const provider = getAIProvider()
  const fusionBlock = opts?.fusionBlockReason ?? null
  // Si le warning n'est pas fourni explicitement, le dériver des types si disponibles
  const fusionWarning = opts?.fusionWarningReason !== undefined
    ? opts.fusionWarningReason
    : (opts?.typeHintA && opts?.typeHintB ? computeFusionWarning(opts.typeHintA, opts.typeHintB) : null)
  const systemPrompt = buildSystemPrompt(opts?.typeHintA ?? null, opts?.typeHintB ?? null, fusionBlock, fusionWarning)

  const userMsg = JSON.stringify({
    sujet_A: {
      label: subjectA.label,
      aliases: subjectA.aliases ?? [],
      topic: subjectA.topicLabel ?? null,
      premiere_apparition: subjectA.firstSeenAt,
      derniere_apparition: subjectA.lastSeenAt,
      nb_pv: subjectA.pvCount ?? 0,
      nb_visites_terrain: subjectA.nativeOccurrenceCount ?? 0,
      statut: subjectA.currentStatus,
      stagnant: subjectA.isStagnant ?? false,
      objets_actifs: subjectA.activeObjects ?? null,
    },
    sujet_B: {
      label: subjectB.label,
      aliases: subjectB.aliases ?? [],
      topic: subjectB.topicLabel ?? null,
      premiere_apparition: subjectB.firstSeenAt,
      derniere_apparition: subjectB.lastSeenAt,
      nb_pv: subjectB.pvCount ?? 0,
      nb_visites_terrain: subjectB.nativeOccurrenceCount ?? 0,
      statut: subjectB.currentStatus,
      stagnant: subjectB.isStagnant ?? false,
      objets_actifs: subjectB.activeObjects ?? null,
    },
  }, null, 2)

  const output = await withAITracking('subject_similarity', userId, async () => {
    const r = await provider.complete({
      systemPrompt,
      userMessage: userMsg,
      modelTier: 'light',
      maxOutputTokens: 300,
    })
    return { result: r, tokens: r.tokens, model: r.model, provider: provider.name, durationMs: r.durationMs }
  })

  const rawText = output.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(rawText) as {
    verdict?: string
    score?: number
    recommendation?: string
    suggested_link_type?: string | null
    suggested_direction?: string | null
    suggested_label?: string | null
    reason?: string
  }

  const score = Math.max(0, Math.min(100, Number(parsed.score ?? 0)))

  const validVerdicts: SimilarityVerdict[] = ['same_subject', 'related', 'distinct', 'uncertain']
  const verdict: SimilarityVerdict = validVerdicts.includes(parsed.verdict as SimilarityVerdict)
    ? (parsed.verdict as SimilarityVerdict)
    : score >= 85 ? 'same_subject' : score >= 60 ? 'related' : 'distinct'

  const validRecs: SimilarityRecommendation[] = ['merge', 'link', 'none']
  let recommendation: SimilarityRecommendation = validRecs.includes(parsed.recommendation as SimilarityRecommendation)
    ? (parsed.recommendation as SimilarityRecommendation)
    : verdict === 'same_subject' ? 'merge' : verdict === 'related' ? 'link' : 'none'

  // Garde-fou : si la fusion est structurellement bloquée, cap à 'link' ou 'none'
  if (fusionBlock && recommendation === 'merge') {
    recommendation = 'link'
  }

  const validLinkTypes: SimilarityLinkType[] = ['requires', 'enables', 'causes', 'validates', 'replaces', 'relates_to']
  const validDirections: SimilarityDirection[] = ['a_to_b', 'b_to_a']

  return {
    score,
    verdict,
    recommendation,
    suggested_link_type: validLinkTypes.includes(parsed.suggested_link_type as SimilarityLinkType)
      ? (parsed.suggested_link_type as SimilarityLinkType)
      : null,
    suggested_direction: validDirections.includes(parsed.suggested_direction as SimilarityDirection)
      ? (parsed.suggested_direction as SimilarityDirection)
      : null,
    suggested_label: typeof parsed.suggested_label === 'string' ? parsed.suggested_label : null,
    reason: parsed.reason ?? '',
    model: output.model ?? provider.name,
    warning_reason: fusionWarning ?? null,
  }
}

// ── Persistance ────────────────────────────────────────────────────────────────

/**
 * Persiste ou met à jour une suggestion de rapprochement.
 * Si une suggestion pending existe déjà pour la paire, elle est écrasée.
 * Si elle a été rejetée ou acceptée, on ne l'écrase pas (protection).
 */
export async function upsertSuggestion(
  supabase: SupabaseClient,
  siteId: string,
  subjectAId: string,
  subjectBId: string,
  result: SimilarityResult,
): Promise<{ id: string } | { error: string }> {
  const [aId, bId] = normalizedPair(subjectAId, subjectBId)

  // Vérifier si une suggestion non-pending existe (rejetée, acceptée) → ne pas écraser
  const { data: existing } = await supabase
    .from('canonical_subject_similarity_suggestion')
    .select('id, status')
    .eq('subject_a_id', aId)
    .eq('subject_b_id', bId)
    .maybeSingle()

  if (existing && existing.status !== 'pending' && existing.status !== 'obsolete') {
    return { id: existing.id }
  }

  const payload = {
    site_id: siteId,
    subject_a_id: aId,
    subject_b_id: bId,
    score: result.score,
    verdict: result.verdict,
    recommendation: result.recommendation,
    suggested_link_type: result.suggested_link_type,
    suggested_direction: result.suggested_direction,
    suggested_label: result.suggested_label,
    reason: result.reason,
    model: result.model,
    analyzed_at: new Date().toISOString(),
    status: 'pending',
    reviewed_at: null,
    reviewed_by: null,
  }

  if (existing) {
    const { error } = await supabase
      .from('canonical_subject_similarity_suggestion')
      .update(payload)
      .eq('id', existing.id)
    if (error) return { error: error.message }
    return { id: existing.id }
  }

  const { data, error } = await supabase
    .from('canonical_subject_similarity_suggestion')
    .insert(payload)
    .select('id')
    .single()
  if (error) return { error: error.message }
  return { id: data.id }
}

// ── Récupération ───────────────────────────────────────────────────────────────

/**
 * Sépare les suggestions actionnables (les deux sujets actifs) des obsolètes.
 * Fonction pure : testable sans DB.
 *
 * Invariants garantis :
 * - Une suggestion dont subject_a ou subject_b n'est plus actif → stale
 * - Une suggestion dont les deux extrémités resolvent vers le même canonical → stale
 */
export function filterActiveSuggestions(
  suggestions: PersistedSuggestion[],
  activeSubjectIds: Set<string>,
): { active: PersistedSuggestion[]; staleIds: string[] } {
  const active: PersistedSuggestion[] = []
  const staleIds: string[] = []

  for (const s of suggestions) {
    const aActive = activeSubjectIds.has(s.subject_a_id)
    const bActive = activeSubjectIds.has(s.subject_b_id)
    const distinct = s.subject_a_id !== s.subject_b_id

    if (aActive && bActive && distinct) {
      active.push(s)
    } else {
      staleIds.push(s.id)
    }
  }

  return { active, staleIds }
}

/**
 * Charge toutes les suggestions pending pour un site (lecture UI).
 * Filtre les suggestions dont un sujet n'est plus actif et les marque obsolètes.
 */
export async function getSiteSuggestions(
  supabase: SupabaseClient,
  siteId: string,
  minScore = 50,
): Promise<PersistedSuggestion[]> {
  const { data, error } = await supabase
    .from('canonical_subject_similarity_suggestion')
    .select('*')
    .eq('site_id', siteId)
    .eq('status', 'pending')
    .gte('score', minScore)
    .order('score', { ascending: false })

  if (error) throw new Error(error.message)
  const rows = (data ?? []) as PersistedSuggestion[]
  if (!rows.length) return []

  // Collecter tous les IDs de sujets référencés et vérifier leur statut
  const subjectIds = new Set<string>()
  for (const r of rows) {
    subjectIds.add(r.subject_a_id)
    subjectIds.add(r.subject_b_id)
  }

  const { data: subjects } = await supabase
    .from('canonical_subject')
    .select('id, status')
    .in('id', Array.from(subjectIds))

  const activeSet = new Set(
    (subjects ?? []).filter((s: { id: string; status: string }) => s.status === 'active').map((s: { id: string; status: string }) => s.id),
  )

  const { active, staleIds } = filterActiveSuggestions(rows, activeSet)

  // Nettoyage paresseux : marquer obsolètes en base
  if (staleIds.length) {
    await supabase
      .from('canonical_subject_similarity_suggestion')
      .update({ status: 'obsolete', reviewed_at: new Date().toISOString() })
      .in('id', staleIds)
  }

  return active
}

/**
 * Cherche une suggestion persistée pour une paire donnée (DnD fallback).
 * Retourne null si absente ou obsolète/rejetée.
 */
export async function getSuggestionForPair(
  supabase: SupabaseClient,
  subjectAId: string,
  subjectBId: string,
): Promise<PersistedSuggestion | null> {
  const [aId, bId] = normalizedPair(subjectAId, subjectBId)
  const { data } = await supabase
    .from('canonical_subject_similarity_suggestion')
    .select('*')
    .eq('subject_a_id', aId)
    .eq('subject_b_id', bId)
    .in('status', ['pending'])
    .maybeSingle()
  return (data ?? null) as PersistedSuggestion | null
}

/** Clé canonique pour une paire (display uniquement) */
export { normalizePairKey }
