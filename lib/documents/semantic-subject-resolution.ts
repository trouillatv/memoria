import 'server-only'
import { z } from 'zod'
import { jaccardSimilarity } from './subject-reconciliation'
import type { OrphanInfo } from './subject-reconciliation'

// Identifie la version du résolveur. Changer cette constante force une nouvelle
// passe LLM sur tous les threads déjà traités (contournement du UNIQUE).
export const RESOLVER_VERSION = 'v1'

const MAX_CANDIDATES = 80

type CandidateSubject = {
  id: string
  label: string
  aliases: string[]
}

export type ShadowDecision = 'would_auto_assign' | 'would_suggest' | 'no_match'

// ── Helpers exportés pour les tests ───────────────────────────────────────────

/**
 * Extrait les codes techniques discriminants d'un label.
 * Exemples : R4, G3, DN160, PVC200, S400, T1
 * Pattern : séquence capitale(s) + chiffres OU chiffres + capitale(s), longueur ≥ 2.
 */
export function extractTechnicalCodes(label: string): Set<string> {
  const codes = new Set<string>()
  // Majuscules 1-4 + chiffres : R4, G3, DN160, PVC200
  // Chiffres + majuscules 1-3 : 42DN (rare, inclus par sécurité)
  const matches = label.toUpperCase().match(/\b([A-Z]{1,4}\d+|\d+[A-Z]{1,3})\b/g) ?? []
  for (const m of matches) codes.add(m)
  return codes
}

/**
 * Pré-filtre les candidats pour un orphelin.
 *
 * Un candidat est conservé si :
 *   - Jaccard(orphan.label, candidate.label OU alias) > 0.10  (similarité lexicale légère)
 *   - OU orphan et candidat partagent un code technique discriminant (R4, DN160…)
 *
 * La borne max évite d'inonder le contexte LLM sur un chantier mature (400+ sujets).
 * Les cas que le moteur lexical manque précisément (forte dérive textuelle) passent
 * grâce au signal "code technique commun" même si Jaccard ≈ 0.
 */
export function filterCandidates(
  orphanLabel: string,
  allCandidates: CandidateSubject[],
  max: number = MAX_CANDIDATES,
): CandidateSubject[] {
  const orphanCodes = extractTechnicalCodes(orphanLabel)

  const filtered = allCandidates.filter((c) => {
    // Signal 1 : Jaccard sur label principal
    if (jaccardSimilarity(orphanLabel, c.label) > 0.10) return true

    // Signal 2 : Jaccard sur les aliases
    for (const alias of c.aliases) {
      if (jaccardSimilarity(orphanLabel, alias) > 0.10) return true
    }

    // Signal 3 : code technique commun (R4, G3, DN160...)
    if (orphanCodes.size > 0) {
      const allLabels = [c.label, ...c.aliases].join(' ')
      const candidateCodes = extractTechnicalCodes(allLabels)
      for (const code of orphanCodes) {
        if (candidateCodes.has(code)) return true
      }
    }

    return false
  })

  return filtered.slice(0, max)
}

/**
 * Valide la sortie LLM et calcule la shadow_decision.
 *
 * Garde anti-hallucination : si le LLM retourne un UUID absent de la liste
 * candidate (candidateIds), le match est forcé à null → no_match.
 *
 * Les seuils 0.95 / 0.70 sont EXPÉRIMENTAUX. model_confidence est l'auto-évaluation
 * du modèle, pas une probabilité calibrée. Le Lot 2 doit mesurer la précision réelle
 * par tranche avant d'activer quoi que ce soit.
 * Seuil 0.95 (vs 0.90 initial) : le banc de test a montré que 0.90 produisait des
 * would_auto_assign sur des faux positifs de zone (accès ≠ terrassement).
 */
export function validateAndClassify(
  matchId: string | null,
  modelConfidence: number,
  candidateIds: Set<string>,
): { candidateId: string | null; shadowDecision: ShadowDecision } {
  // Garde : UUID inventé ou absent de la liste → rejet
  const validatedId = matchId && candidateIds.has(matchId) ? matchId : null

  if (!validatedId || modelConfidence < 0.70) {
    return { candidateId: null, shadowDecision: 'no_match' }
  }
  if (modelConfidence >= 0.95) {
    return { candidateId: validatedId, shadowDecision: 'would_auto_assign' }
  }
  return { candidateId: validatedId, shadowDecision: 'would_suggest' }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un assistant de catégorisation de sujets de chantier BTP.
Tu reçois un label extrait d'un procès-verbal de visite de chantier et une liste de sujets canoniques déjà connus pour ce chantier.
Ta tâche : identifier si ce label désigne l'un des sujets connus, même si la formulation a changé (ajout de statut, reformulation, évolution d'avancement).
Deux sujets ne sont pas identiques uniquement parce qu'ils partagent la même technique ou le même ouvrage général. Respecte les distinctions de zone, objet, document, phase et finalité. Exemples : accès ≠ plateforme ; plan ≠ implantation ; raccordement ≠ busage ; R3 ≠ R4.
Réponds UNIQUEMENT avec l'un des UUIDs fournis ou null si aucun ne correspond vraiment.
N'invente JAMAIS un UUID absent de la liste.
Donne un score model_confidence entre 0.0 et 1.0 reflétant ta certitude.
Reste concis dans reasoning (≤ 100 mots).`

function buildPrompt(label: string, candidates: CandidateSubject[]): string {
  const lines = candidates.map((c) => {
    const aliasStr = c.aliases.length > 0 ? ` [alias : ${c.aliases.join(', ')}]` : ''
    return `- ${c.id} : ${c.label}${aliasStr}`
  })
  return [
    `Label à identifier : "${label}"`,
    '',
    'Sujets canoniques connus pour ce chantier :',
    ...lines,
    '',
    'Retourne l\'UUID du sujet correspondant, ou null si ce label désigne un sujet nouveau.',
  ].join('\n')
}

const matchSchema = z.object({
  match: z.string().uuid().nullable().catch(null),
  model_confidence: z
    .number()
    .min(0)
    .max(1)
    // Gemini retourne parfois un entier 0–100 au lieu de 0–1
    .transform((v) => (v > 1 ? v / 100 : v))
    .catch(0),
  reasoning: z.string().max(500).catch(''),
})

type MatchResult = z.infer<typeof matchSchema>

// ── Résolution principale ─────────────────────────────────────────────────────

/**
 * Résout sémantiquement les orphelins d'un run via LLM (shadow mode).
 *
 * Pour chaque orphelin :
 * 1. Pré-filtre les canonical_subjects du site (Jaccard > 0.10 ou code technique commun).
 * 2. Si aucun candidat → stocke no_match sans appel LLM.
 * 3. Sinon → appelle le LLM avec liste fermée, valide le résultat (anti-hallucination).
 * 4. Stocke dans canonical_subject_suggestion (ON CONFLICT DO NOTHING).
 *
 * N'écrit PAS dans subject_thread_identity ni canonical_subject_id — shadow mode strict.
 * Idempotent : un thread déjà traité avec la même resolver_version est ignoré.
 */
export async function resolveOrphansSemantically(
  orphans: OrphanInfo[],
  siteId: string,
  runId: string,
): Promise<{ total: number; autoAssign: number; suggest: number; noMatch: number }> {
  if (orphans.length === 0) return { total: 0, autoAssign: 0, suggest: 0, noMatch: 0 }

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { getAIProvider } = await import('@/services/ai/factory')

  const supabase = createAdminClient()
  const provider = getAIProvider()

  // Charger tous les canonical_subjects actifs du site
  const { data: subjectsRaw } = await supabase
    .from('canonical_subject')
    .select('id, label, aliases')
    .eq('site_id', siteId)
    .eq('status', 'active')

  const allSubjects: CandidateSubject[] = (subjectsRaw ?? []) as CandidateSubject[]

  const suggestions: Record<string, unknown>[] = []
  let autoAssign = 0
  let suggest = 0
  let noMatch = 0

  for (const orphan of orphans) {
    const candidates = filterCandidates(orphan.label, allSubjects)

    // Pas de candidat → no_match sans LLM
    if (candidates.length === 0) {
      suggestions.push(buildSuggestion({
        siteId, orphan, runId,
        matchId: null, modelConfidence: null, reasoning: null,
        shadowDecision: 'no_match', candidateCount: 0, modelName: null,
      }))
      noMatch++
      continue
    }

    const candidateIds = new Set(candidates.map((c) => c.id))
    let parsed: MatchResult | null = null

    try {
      const output = await provider.complete({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: buildPrompt(orphan.label, candidates),
        responseSchema: matchSchema,
        modelTier: 'light',
        maxOutputTokens: 400,
      })
      if (output.parsed) {
        const validated = matchSchema.safeParse(output.parsed)
        if (validated.success) parsed = validated.data
      }
    } catch {
      // Échec LLM non bloquant — stocke no_match avec trace
    }

    if (!parsed) {
      suggestions.push(buildSuggestion({
        siteId, orphan, runId,
        matchId: null, modelConfidence: null, reasoning: 'LLM call failed',
        shadowDecision: 'no_match', candidateCount: candidates.length, modelName: provider.name,
      }))
      noMatch++
      continue
    }

    const { candidateId, shadowDecision } = validateAndClassify(
      parsed.match,
      parsed.model_confidence,
      candidateIds,
    )

    suggestions.push(buildSuggestion({
      siteId, orphan, runId,
      matchId: candidateId, modelConfidence: parsed.model_confidence, reasoning: parsed.reasoning,
      shadowDecision, candidateCount: candidates.length, modelName: provider.name,
    }))

    if (shadowDecision === 'would_auto_assign') autoAssign++
    else if (shadowDecision === 'would_suggest') suggest++
    else noMatch++
  }

  if (suggestions.length > 0) {
    await supabase
      .from('canonical_subject_suggestion')
      .upsert(suggestions, {
        onConflict: 'subject_thread_id,resolver_version',
        ignoreDuplicates: true,
      })
  }

  return { total: orphans.length, autoAssign, suggest, noMatch }
}

function buildSuggestion(opts: {
  siteId: string
  orphan: OrphanInfo
  runId: string
  matchId: string | null
  modelConfidence: number | null
  reasoning: string | null
  shadowDecision: ShadowDecision
  candidateCount: number
  modelName: string | null
}): Record<string, unknown> {
  return {
    site_id: opts.siteId,
    subject_thread_id: opts.orphan.threadId,
    extraction_run_id: opts.runId,
    proposal_label: opts.orphan.label,
    proposal_family: opts.orphan.family,
    candidate_canonical_subject_id: opts.matchId,
    model_confidence: opts.modelConfidence,
    reasoning: opts.reasoning,
    shadow_decision: opts.shadowDecision,
    resolver_version: RESOLVER_VERSION,
    model_name: opts.modelName,
    candidate_count: opts.candidateCount,
  }
}
