import 'server-only'

// P1-PERF-A — réutilisation cross-request de la narration IA d'Évolution.
//
// Doctrine : MemorIA calcule → l'IA explique. La narration explique une matière
// déterministe déjà calculée ; tant que cette matière (le fingerprint du prompt)
// n'a pas changé, rappeler le LLM est un gaspillage pur (11,4 s mesurés par rendu
// sur RUS pendant l'incident P0-PERF).
//
// Contrat :
//  - lecture : 1 requête sur evolution_narrative_cache (site_id, fingerprint) ;
//  - écriture : UNIQUEMENT une narration réellement issue du LLM (deterministic=false).
//    Le fallback déterministe n'est jamais stocké : il se recalcule gratuitement, et le
//    stocker ferait passer un échec LLM pour une narration définitive ;
//  - append-only : ON CONFLICT (site_id, fingerprint) DO NOTHING — jamais de réécriture ;
//  - invalidation : AUCUNE ici. Une matière changée produit un fingerprint neuf ; les
//    anciennes lignes restent (narration d'une matière passée = artefact historique).
//
// Concurrence : single-flight in-process (Map de promesses par site|fingerprint) — deux
// rendus simultanés du même onglet ne déclenchent qu'un appel LLM dans CE processus.
// Multi-instance (plusieurs lambdas) : un doublon d'appel LLM reste possible ; l'upsert
// ignoreDuplicates rend la course inoffensive (première écriture gagne, même matière →
// narrations équivalentes). Assumé, pas de verrou distribué.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  generateEvolutionNarrative,
  EVOLUTION_NARRATIVE_PROMPT_VERSION,
  type EvolutionNarrative,
  type EvolutionPeriodNarrative,
  type EvolutionReadModel,
} from './pv-evolution'

/** Narration IA en cache pour cette matière exacte, sinon null. 1 requête. */
export async function getCachedEvolutionNarrative(
  siteId: string,
  fingerprint: string,
): Promise<EvolutionNarrative | null> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('evolution_narrative_cache')
    .select('model, periods')
    .eq('site_id', siteId)
    .eq('fingerprint', fingerprint)
    .maybeSingle()
  if (!data) return null
  const r = data as { model: string; periods: EvolutionPeriodNarrative[] }
  return { deterministic: false, model: r.model, periods: r.periods }
}

const inFlight = new Map<string, Promise<void>>()

/**
 * Génère la narration IA HORS chemin bloquant (appelé via after()) et la persiste si —
 * et seulement si — elle vient réellement du LLM. Toute erreur est avalée : la page a
 * déjà rendu le fallback déterministe, rien ne doit remonter.
 */
export function ensureEvolutionNarrative(
  siteId: string,
  readModel: EvolutionReadModel,
  fingerprint: string,
): Promise<void> {
  const key = `${siteId}|${fingerprint}`
  const existing = inFlight.get(key)
  if (existing) return existing

  const run = (async () => {
    try {
      const narrative = await generateEvolutionNarrative(readModel)
      if (narrative.deterministic || !narrative.model) return // LLM absent/mock/échec → rien à stocker
      const sb = createAdminClient()
      await sb.from('evolution_narrative_cache').upsert(
        {
          site_id: siteId,
          fingerprint,
          prompt_version: EVOLUTION_NARRATIVE_PROMPT_VERSION,
          model: narrative.model,
          periods: narrative.periods,
        },
        { onConflict: 'site_id,fingerprint', ignoreDuplicates: true },
      )
    } catch {
      // best-effort : la narration IA est un enrichissement, jamais un prérequis.
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, run)
  return run
}
