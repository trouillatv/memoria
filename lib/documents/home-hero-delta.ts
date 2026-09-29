import 'server-only'

// MEMORIA-HOME-V2 — delta canonique du hero, chantier actif UNIQUEMENT.
//
// Réutilise EXCLUSIVEMENT le moteur existant (canonicalRunsForSite +
// buildOccurrencePvSummary/getPvDelta) — aucune deuxième taxonomie de delta.
// Le hero ne compare jamais autre chose que les DEUX derniers PV matérialisés
// du chantier actif ; jamais une boucle sur plusieurs chantiers (tier "heavy",
// cf. doctrine deux-tiers Home V2).

import { canonicalRunsForSite, runEffectiveDate } from './pv-history'
import {
  buildOccurrencePvSummary,
  type OccurrencePvSummary,
  type PvSubjectRef,
} from './occurrence-pv-summary'

export interface HeroDeltaMetrics {
  nouveaux: PvSubjectRef[]
  evolutions: PvSubjectRef[]
  resolus: PvSubjectRef[]
  nonMentionnes: PvSubjectRef[]
}

/**
 * Projection DOCUMENTÉE et figée du delta canonique vers les 4 métriques du hero.
 * Ne jamais faire évoluer ce mapping au fil de l'eau — toute décision d'où classer
 * une transition doit rester explicite et couverte par un test.
 *
 *   NOUVEAUX       = nouveau (première apparition réelle du sujet)
 *   ÉVOLUTIONS     = réouvert + aggravé + progressé + réapparu + changé + annulé
 *                    (tout ce qui a bougé sans être ni entièrement neuf, ni résolu,
 *                    ni silencieux ; réapparu y entre car c'est un changement de
 *                    trajectoire, pas une nouveauté au sens strict)
 *   RÉSOLUS        = résolu (levé + réalisé)
 *   NON MENTIONNÉS = nonMentionné
 *
 * `maintenu` est volontairement EXCLU des 4 compteurs : c'est la base "rien n'a
 * changé", cohérente avec la sémantique Historique/Avant-Après.
 */
export function mapOccurrenceSummaryToHeroMetrics(summary: OccurrencePvSummary): HeroDeltaMetrics {
  return {
    nouveaux: summary.nouveau,
    evolutions: [
      ...summary.réouvert,
      ...summary.aggravé,
      ...summary.progressé,
      ...summary.réapparu,
      ...summary.changé,
      ...summary.annulé,
    ],
    resolus: summary.résolu,
    nonMentionnes: summary.nonMentionné,
  }
}

export interface HomeHeroDelta {
  toRunId: string
  toEffectiveDate: string
  /** `null` si le chantier n'a qu'un seul PV matérialisé — pas de delta possible,
   *  mais la date du dernier PV reste affichable. */
  fromRunId: string | null
  /** `null` soit parce qu'un seul PV existe (pas encore comparable, `metricsFailed`
   *  reste false), soit parce que le calcul du delta a échoué (`metricsFailed` true).
   *  Jamais une comparaison inventée pour compenser l'un ou l'autre cas. */
  metrics: HeroDeltaMetrics | null
  /** true si `buildOccurrencePvSummary` a techniquement échoué — distinct d'un
   *  résultat réellement vide (aucune évolution) : ne jamais confondre les deux,
   *  jamais fabriquer un delta à zéro pour masquer un échec de calcul. */
  metricsFailed: boolean
}

/**
 * Contexte hero du chantier actif : date du dernier PV matérialisé, et delta
 * canonique avec le PV précédent quand il existe. `null` si le chantier n'a
 * encore aucun PV matérialisé.
 */
export async function getHomeHeroDelta(siteId: string): Promise<HomeHeroDelta | null> {
  const runs = await canonicalRunsForSite(siteId)
  if (runs.length === 0) return null
  const to = runs[runs.length - 1]!
  if (runs.length < 2) {
    return { toRunId: to.id, toEffectiveDate: runEffectiveDate(to), fromRunId: null, metrics: null, metricsFailed: false }
  }
  const from = runs[runs.length - 2]!
  try {
    const summary = await buildOccurrencePvSummary(siteId, from.id, to.id)
    return {
      toRunId: to.id,
      toEffectiveDate: runEffectiveDate(to),
      fromRunId: from.id,
      metrics: mapOccurrenceSummaryToHeroMetrics(summary),
      metricsFailed: false,
    }
  } catch {
    return {
      toRunId: to.id,
      toEffectiveDate: runEffectiveDate(to),
      fromRunId: from.id,
      metrics: null,
      metricsFailed: true,
    }
  }
}
