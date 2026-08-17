import 'server-only'

// P6-A2 — shadow mode : brancher decompose-v2 (P6-A1) sur les VRAIS tours
// Copilote, en observation pure. Mandat Vincent (2026-08-17).
//
// Invariants NON NÉGOCIABLES :
//   1. Zéro effet sur le pipeline réel : aucune carte, aucune écriture,
//      aucune modification de `whichIntent()` (detectIntent, INCHANGÉ),
//      des builders ou des writers.
//   2. Zéro impact sur le chemin critique utilisateur : planifié via
//      `after()` (next/server), donc APRÈS l'envoi de la réponse. Si
//      `after()` n'est pas disponible (hors contexte de requête, tests),
//      le shadow s'efface silencieusement — jamais une exception ne doit
//      remonter à l'appelant réel.
//   3. Best-effort, ne lève jamais — même doctrine que `logCopilotInteraction`.
//   4. Isolé de `copilot_interactions` (mig 294) : table dédiée, jamais lue
//      par le pipeline réel ni par l'Observatoire/pattern-mining métier.

import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decomposeUtterance, routeSegments, DECOMPOSE_PROMPT_VERSION } from './copilot-decompose'
import type { AIProvider } from '@/services/ai'

export type DecomposeShadowInput = {
  siteId: string | null
  userId: string | null
  organizationId: string | null
  conversationId: string | null
  question: string
}

export type DecomposeShadowOpts = {
  // Injection pour les tests — mêmes noms que `decomposeUtterance` lui-même.
  provider?: AIProvider
  timeoutMs?: number
}

/**
 * Exécute le probe et écrit une ligne dans `copilot_decompose_shadow`.
 * Best-effort : ne lève jamais. Exportée (pas seulement `scheduleDecomposeShadow`)
 * pour être appelée directement dans les tests, sans dépendre de `after()`.
 */
export async function runDecomposeShadowProbe(
  input: DecomposeShadowInput,
  opts: DecomposeShadowOpts = {},
): Promise<void> {
  if (!input.organizationId) return // cloisonné org, même doctrine que copilot-telemetry

  const t0 = Date.now()
  try {
    const result = await decomposeUtterance(input.question, { provider: opts.provider, timeoutMs: opts.timeoutMs })
    const routed = routeSegments(input.question, result)
    const latencyMs = Date.now() - t0

    const supabase = createAdminClient()
    await supabase.from('copilot_decompose_shadow').insert({
      organization_id:   input.organizationId,
      site_id:            input.siteId,
      user_id:            input.userId,
      conversation_id:    input.conversationId,
      question:           input.question.slice(0, 500),
      decompose_version:  DECOMPOSE_PROMPT_VERSION,
      segment_count:      routed.length,
      ambiguous:          result.ambiguous,
      used_fallback:      result.ambiguous, // seul le repli mono-segment déclare ambiguous:true
      segments: routed.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        dependsOn: s.dependsOn,
        intent: s.intent.intent,
        confidence: s.intent.confidence,
        signals: s.intent.signals,
      })),
      latency_ms: latencyMs,
      error: null,
    })
  } catch (err) {
    // Best-effort : une ligne d'erreur si possible, jamais d'exception propagée.
    try {
      const supabase = createAdminClient()
      await supabase.from('copilot_decompose_shadow').insert({
        organization_id:  input.organizationId,
        site_id:          input.siteId,
        user_id:          input.userId,
        conversation_id:  input.conversationId,
        question:         input.question.slice(0, 500),
        decompose_version: DECOMPOSE_PROMPT_VERSION,
        segment_count:    0,
        ambiguous:        true,
        used_fallback:    true,
        segments:         [],
        latency_ms:       Date.now() - t0,
        error:            err instanceof Error ? err.message.slice(0, 500) : 'unknown_error',
      })
    } catch {
      // Rien de plus à faire — le shadow ne doit jamais remonter d'erreur.
    }
  }
}

/**
 * Planifie le probe shadow pour ce tour, sans jamais ralentir la réponse
 * réelle. Appeler UNE FOIS par tour `prepareCopilotAnswer`, avant toute
 * branche — couvre ainsi les intents d'écriture (retour anticipé) et de
 * lecture (via `finish`) de façon identique.
 */
export function scheduleDecomposeShadow(input: DecomposeShadowInput, opts: DecomposeShadowOpts = {}): void {
  if (process.env.COPILOT_DECOMPOSE_SHADOW === '0') return
  if (!input.question || input.question.trim().length === 0) return
  try {
    after(() => runDecomposeShadowProbe(input, opts))
  } catch {
    // Hors contexte de requête (tests, environnements sans after()) : le
    // shadow s'efface silencieusement, jamais le Copilote réel n'en souffre.
  }
}
