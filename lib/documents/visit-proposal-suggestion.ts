import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateAndClassify } from '@/lib/documents/semantic-subject-resolution'

// Version distincte du résolveur PV ('v1') : permet de retraiter les proposals
// terrain indépendamment de la passe PV sans collision de contrainte UNIQUE.
const RESOLVER_VERSION = 'v2-visit'

const SYSTEM_PROMPT = `Tu es un assistant de catégorisation de sujets de chantier BTP.
Tu reçois une observation de visite terrain et une liste de sujets canoniques déjà connus pour ce chantier.
Ta tâche : identifier si cette observation désigne l'un des sujets connus, même si la formulation a changé (ajout de statut, reformulation, évolution d'avancement).
Deux sujets ne sont pas identiques uniquement parce qu'ils partagent la même technique ou le même ouvrage général. Respecte les distinctions de zone, objet, document, phase et finalité. Exemples : accès ≠ plateforme ; plan ≠ implantation ; R3 ≠ R4.
Réponds UNIQUEMENT avec l'un des UUIDs fournis ou null si aucun ne correspond vraiment.
N'invente JAMAIS un UUID absent de la liste.
Donne un score model_confidence entre 0.0 et 1.0 reflétant ta certitude.
Reste concis dans reasoning (≤ 100 mots).`

const matchSchema = z.object({
  match: z.string().uuid().nullable().catch(null),
  model_confidence: z
    .number()
    .min(0)
    .max(1)
    .transform((v) => (v > 1 ? v / 100 : v))
    .catch(0),
  reasoning: z.string().max(500).catch(''),
})

function buildPrompt(
  label: string,
  body: string | null,
  candidates: Array<{ id: string; label: string; aliases: string[] }>,
): string {
  const header = body
    ? `Observation terrain : "${label}" — ${body.slice(0, 200)}`
    : `Observation terrain : "${label}"`

  const lines = candidates.map((c) => {
    const aliasStr = c.aliases.length > 0 ? ` [alias : ${c.aliases.join(', ')}]` : ''
    return `- ${c.id} : ${c.label}${aliasStr}`
  })

  return [
    header,
    '',
    'Sujets canoniques connus pour ce chantier :',
    ...lines,
    '',
    "Retourne l'UUID du sujet correspondant, ou null si ce label désigne un sujet nouveau.",
  ].join('\n')
}

/**
 * Appel LLM pour lever l'ambiguïté d'une proposition terrain.
 *
 * Appelé depuis reconcileProposalToCanonical() quand le résolveur déterministe
 * retourne 'ambiguous' avec ≤ 3 candidats et validationStatus = 'observed'.
 *
 * Fire-and-forget — ne doit jamais bloquer la réconciliation principale.
 * Idempotent : doublon silencieux sur (source_proposal_id, resolver_version).
 *
 * Ne crée une suggestion que si l'IA dépasse le seuil would_suggest (≥ 0.70).
 * Pour les cas en dessous du seuil, needs_resolution reste sans suggestion.
 */
export async function createVisitAmbiguitySuggestion(params: {
  proposalId: string
  proposalKind: string
  siteId: string
  proposalTitle: string
  proposalBody: string | null
  candidates: Array<{ id: string; label: string }>
}): Promise<void> {
  const { proposalId, proposalKind, siteId, proposalTitle, proposalBody, candidates } = params
  if (candidates.length === 0) return

  const admin = createAdminClient()
  const { getAIProvider } = await import('@/services/ai/factory')
  const provider = getAIProvider()

  // Enrichir les candidats avec leurs aliases pour améliorer le prompt
  const { data: csRows } = await admin
    .from('canonical_subject')
    .select('id, label, aliases')
    .in('id', candidates.map((c) => c.id))

  const enriched = (csRows ?? []) as Array<{ id: string; label: string; aliases: string[] }>
  const candidateIds = new Set(candidates.map((c) => c.id))

  let parsed: { match: string | null; model_confidence: number; reasoning: string } | null = null

  try {
    const output = await provider.complete({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: buildPrompt(proposalTitle, proposalBody, enriched),
      responseSchema: matchSchema,
      modelTier: 'light',
      maxOutputTokens: 400,
    })
    if (output.parsed) {
      const validated = matchSchema.safeParse(output.parsed)
      if (validated.success) parsed = validated.data
    }
  } catch {
    return // LLM non bloquant
  }

  if (!parsed) return

  const { candidateId, shadowDecision } = validateAndClassify(
    parsed.match,
    parsed.model_confidence,
    candidateIds,
  )

  // En dessous du seuil : pas de suggestion — needs_resolution reste sans file
  if (shadowDecision === 'no_match' || !candidateId) return

  const { error } = await admin
    .from('canonical_subject_suggestion')
    .insert({
      site_id: siteId,
      source_proposal_id: proposalId,
      proposal_label: proposalTitle,
      proposal_family: proposalKind,
      candidate_canonical_subject_id: candidateId,
      model_confidence: parsed.model_confidence,
      reasoning: parsed.reasoning,
      shadow_decision: shadowDecision,
      resolver_version: RESOLVER_VERSION,
      candidate_count: candidates.length,
      model_name: provider.name,
    })

  if (error && error.code !== '23505') {
    console.error('[visit-proposal-suggestion] insert error', error)
  }
}
