// lib/db/ai-outcome-events.ts
// TÉLÉMÉTRIE DE VALEUR d'un résultat IA (lot 5.1A). Mesure le DEVENIR humain d'un
// résultat déjà produit — pas une nouvelle capacité d'IA.
//
// Écrit dans `usage_events` (mig 224), à côté de l'usage produit. Contrat UNIQUE :
// aucun composant n'appelle `usage_events` directement pour un outcome IA, tout
// passe par `trackAiOutcome`. C'est ce qui garantit les invariants ci-dessous.
//
// ── LES QUATRE INVARIANTS, tenus par ce fichier et vérifiés par ses tests ────
//   1. NON BLOQUANT : ne lève JAMAIS, ne bloque jamais le geste métier. À
//      appeler en `void trackAiOutcome(...)`. Un échec de tracking n'annule pas
//      une promotion d'action.
//   2. CLOISONNÉ par organisation, FAIL-CLOSED : sans org lisible, on n'écrit
//      RIEN (même argument que searchMemory) — jamais de ligne inter-tenant.
//   3. AUCUN CONTENU MÉTIER : la surface d'API n'accepte AUCUN texte libre —
//      seulement des dimensions fermées et des nombres. Pas de titre, pas de
//      résumé, pas de `query`. On ne peut pas fuiter ce qu'on ne peut pas passer.
//   4. AUCUNE DIMENSION INDIVIDUELLE : `user_id` n'est JAMAIS écrit. On mesure
//      quelle capacité sert, jamais qui l'utilise (doctrine
//      metriques-refletent-la-causalite / analyse-usage-par-personne).

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

// Vocabulaires FERMÉS — miroirs exacts des CHECK de la mig 224. Toute valeur hors
// liste est refusée par le contrat AVANT d'atteindre la base.
export const AI_CAPABILITIES = [
  'visit_summary',
  'visit_debrief_extract',
  'visit_action_proposal',
] as const
export type AiCapability = (typeof AI_CAPABILITIES)[number]

export const AI_OUTCOMES = [
  'generated',
  'displayed',
  'accepted',
  'edited',
  'rejected',
  'abandoned',
  'acted_on',
] as const
export type AiOutcome = (typeof AI_OUTCOMES)[number]

export const AI_ARTIFACT_TYPES = ['visit_report', 'action_proposal'] as const
export type AiArtifactType = (typeof AI_ARTIFACT_TYPES)[number]

export interface AiOutcomeInput {
  capability: AiCapability
  outcome: AiOutcome
  artifactType: AiArtifactType
  /** L'artefact concerné — clé technique (chaînage, dédup). Jamais agrégée. */
  artifactId?: string | null
  /** Le run IA d'origine — jointure vers `ai_usage`, évite de dupliquer `generated`. */
  aiRunId?: string | null
  /** Ampleur de la correction, dans [0,1] — calculée serveur à la validation. */
  editRatio?: number | null
  /** Délai génération → décision, en secondes. */
  latencySeconds?: number | null
  /** Si fourni, ce fait ne compte qu'une fois (on-conflict-do-nothing). */
  dedupeKey?: string | null
}

/** Le contrat n'accepte que des UUID pour les clés techniques : un id mal formé
 *  n'atteint pas la base. Volontairement strict — pas de texte libre déguisé. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** La clé de dédup est un IDENTIFIANT, pas un champ texte : charset technique
 *  strict. Sans cette garde, un appelant pouvait y encoder un titre d'action ou
 *  un nom — l'invariant « aucun contenu métier » aurait fui par cette porte. */
const DEDUPE_RE = /^[a-z0-9:._-]{1,160}$/i

function cleanRatio(r: number | null | undefined): number | null {
  if (typeof r !== 'number' || Number.isNaN(r)) return null
  return Math.min(1, Math.max(0, r))
}

function cleanSeconds(s: number | null | undefined): number | null {
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) return null
  return Math.round(s)
}

/**
 * Trace le devenir d'un résultat IA. BEST-EFFORT : ne lève jamais.
 *
 * Renvoie silencieusement sans rien écrire si une dimension fermée est hors
 * vocabulaire — un contrat mal appelé ne pollue pas la table, et ne casse pas
 * l'appelant non plus.
 */
export async function trackAiOutcome(input: AiOutcomeInput): Promise<void> {
  try {
    // Vocabulaire fermé : on refuse en silence plutôt que d'insérer une valeur
    // que le CHECK rejetterait (ce qui, lui, lèverait).
    if (!AI_CAPABILITIES.includes(input.capability)) return
    if (!AI_OUTCOMES.includes(input.outcome)) return
    if (!AI_ARTIFACT_TYPES.includes(input.artifactType)) return

    // Une clé de dédup fournie mais invalide = contrat mal utilisé → refus TOTAL.
    // Écrire quand même SANS la clé gonflerait le signal (un rerender compterait
    // N fois) : mieux vaut aucune donnée qu'une donnée fausse.
    const dedupeKey = input.dedupeKey?.trim() || null
    if (dedupeKey && !DEDUPE_RE.test(dedupeKey)) return

    // ⚠️ FAIL-CLOSED, même argument que `searchMemory` (mig 223) : une ligne
    // sans organisation fuirait dans toute lecture agrégée qui oublierait de la
    // filtrer, ou resterait un poids mort invisible. La télémétrie est
    // best-effort : perdre un événement sur une session illisible est acceptable,
    // écrire une ligne inter-tenant ne l'est pas.
    const orgId = await getOrgId().catch(() => null)
    if (!orgId) return

    const row = {
      // `event` reste renseigné : la colonne est NOT NULL (mig 113). On y met une
      // valeur DÉRIVÉE des dimensions fermées, jamais du texte libre.
      event: `ai_outcome:${input.capability}:${input.outcome}`,
      organization_id: orgId,
      // ⚠️ Volontairement ABSENT : user_id, site_id, meta. On ne mesure pas la
      // personne, et il n'y a aucun texte libre à stocker.
      ai_capability: input.capability,
      ai_outcome: input.outcome,
      ai_artifact_type: input.artifactType,
      ai_artifact_id: input.artifactId && UUID_RE.test(input.artifactId) ? input.artifactId : null,
      ai_run_id: input.aiRunId && UUID_RE.test(input.aiRunId) ? input.aiRunId : null,
      ai_edit_ratio: cleanRatio(input.editRatio),
      ai_latency_seconds: cleanSeconds(input.latencySeconds),
      ai_dedupe_key: dedupeKey,
    }

    const supabase = createAdminClient()
    // Dédup : si `ai_dedupe_key` est déjà présent, l'insert est ignoré. L'index
    // unique est PLEIN (mig 225) — un index partiel n'est pas inférable par
    // ON CONFLICT via PostgREST, défaut prouvé en base (42P10) : chaque insert
    // échouait en silence. Les clés NULL ne se heurtent jamais (NULLS DISTINCT).
    await supabase
      .from('usage_events')
      .upsert(row, { onConflict: 'ai_dedupe_key', ignoreDuplicates: true })
  } catch {
    // Best-effort total : table absente, pas de session, réseau, conflit — on
    // avale. Un défaut de mesure ne casse jamais le geste métier.
  }
}
