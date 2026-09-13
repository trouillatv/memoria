// ── POINTS — COUCHE 1.1 « MÉMOIRE DE REVUE » : signature pure (mandat Vincent) ──
//
// Calcule la signature stable (« fingerprint ») de la version COURANTE des raisons de revue
// d'un Point. Primitive PURE, ZÉRO IO — c'est la SEULE fonction qui produit un
// review_fingerprint dans tout le dépôt, consommée à la fois :
//   - en LECTURE de la file (comparer au fingerprint stocké dans tracked_point_reviews pour
//     distinguer « à revoir » de « déjà revu ») ;
//   - en ÉCRITURE d'une revue (recalculer sur l'état COURANT — après un geste métier, toujours
//     sur l'état POST-écriture, jamais sur l'état pré-écriture).
// Jamais de fingerprint fourni par le client : toujours recalculé côté serveur à partir des
// mêmes champs déjà chargés par tracked-point-list.ts, aucune nouvelle requête.
//
// Contrat gelé (Vincent, GO migration+repository) : chaque segment encode l'IDENTITÉ/VERSION
// stable du signal, jamais un simple horodatage de passage de temps ni un texte généré (même
// doctrine que buildDebriefSignalKey, lib/knowledge/live-debrief.ts). Segments triés par type
// puis concaténés — jamais l'ordre d'apparition des raisons à l'écran.
//
//   reopened:<latestMeaningfulEventAt || 'unknown'>
//   needs_you:<ids triés joints par '+'>
//   changed_since_last_pv:<lastPvDate>
//   lingering:<latestMeaningfulEventAt || 'unknown'>:<lastPvDate>
//   canonical_attention:<signals triés joints par '+'>        -- JAMAIS le score (recalibrable
//                                                                 sans changement métier réel)
//
// `latestMeaningfulEventAt` peut être `null` sur un Point réouvert (cas RUS confirmé) : encodé
// explicitement `unknown`, jamais une valeur implicite/instable. Aucun compteur temporel
// (daysSinceLastEvent, passagesSinceEvent) : ils changent à chaque passage sans changement
// métier réel et feraient perpétuellement ressurgir un Point déjà revu.

import type { CanonicalSignal } from '@/lib/knowledge/canonical-attention'

const UNKNOWN = 'unknown'

export interface TrackedPointReviewSignalInput {
  /** Actif ⟺ derivedState === 'reopened'. */
  reopened: { latestMeaningfulEventAt: string | null } | null
  /** Actif ⟺ au moins une question MemorIA NeedsYou référence structurellement ce Point. */
  needsYou: { questionIds: string[] } | null
  /** Actif ⟺ le Point a changé ou est apparu lors du dernier PV du chantier. */
  changedSinceLastPv: { lastPvDate: string } | null
  /** Actif ⟺ le Point traîne (cf. tracked-point-lingering.ts). */
  lingering: { latestMeaningfulEventAt: string | null; lastPvDate: string } | null
  /** Actif ⟺ le sujet porteur est en attention canonique `act_now`. */
  canonicalAttention: { signals: readonly CanonicalSignal[] } | null
}

function reopenedSegment(v: NonNullable<TrackedPointReviewSignalInput['reopened']>): string {
  return `reopened:${v.latestMeaningfulEventAt ?? UNKNOWN}`
}

function needsYouSegment(v: NonNullable<TrackedPointReviewSignalInput['needsYou']>): string {
  return `needs_you:${[...v.questionIds].sort().join('+')}`
}

function changedSinceLastPvSegment(v: NonNullable<TrackedPointReviewSignalInput['changedSinceLastPv']>): string {
  return `changed_since_last_pv:${v.lastPvDate}`
}

function lingeringSegment(v: NonNullable<TrackedPointReviewSignalInput['lingering']>): string {
  return `lingering:${v.latestMeaningfulEventAt ?? UNKNOWN}:${v.lastPvDate}`
}

function canonicalAttentionSegment(v: NonNullable<TrackedPointReviewSignalInput['canonicalAttention']>): string {
  return `canonical_attention:${[...v.signals].sort().join('+')}`
}

/**
 * `null` si aucune des cinq raisons n'est active — rien à revoir, jamais une chaîne vide
 * silencieuse qui pourrait être confondue avec une version valide.
 */
export function computeTrackedPointReviewFingerprint(input: TrackedPointReviewSignalInput): string | null {
  const segments: string[] = []
  if (input.reopened) segments.push(reopenedSegment(input.reopened))
  if (input.needsYou && input.needsYou.questionIds.length > 0) segments.push(needsYouSegment(input.needsYou))
  if (input.changedSinceLastPv) segments.push(changedSinceLastPvSegment(input.changedSinceLastPv))
  if (input.lingering) segments.push(lingeringSegment(input.lingering))
  if (input.canonicalAttention && input.canonicalAttention.signals.length > 0) {
    segments.push(canonicalAttentionSegment(input.canonicalAttention))
  }
  if (segments.length === 0) return null
  segments.sort()
  return segments.join('|')
}

/** Un Point est « déjà revu » ⟺ son fingerprint courant existe ET est strictement identique au
 *  fingerprint stocké. Toute divergence (nouveau signal, signal disparu, version différente)
 *  = à revoir. Un Point sans fingerprint courant (rien à revoir) n'est jamais « déjà revu » : il
 *  est simplement hors file. */
export function isTrackedPointReviewed(currentFingerprint: string | null, storedFingerprint: string | undefined): boolean {
  return currentFingerprint !== null && currentFingerprint === storedFingerprint
}
