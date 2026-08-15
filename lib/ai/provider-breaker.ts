// Disjoncteur de fournisseur — état pur, horloge injectée.
//
// Motif : l'audit de latence du 16/08 a montré que le Copilote vocal payait
// 486 à 1520 ms PAR TOUR pour téléverser l'audio vers OpenAI et recevoir un
// 429 `insufficient_quota` — c'est-à-dire pour réapprendre à chaque question
// ce que le tour précédent avait déjà établi.
//
// Un simple `if (openaiDown) skip` figé au déploiement ne convient pas : un
// quota rechargé doit redevenir utilisable sans redéploiement. D'où un état à
// trois temps — fermé, ouvert, sonde — avec un réessai contrôlé.
//
// Aucune I/O, aucune date implicite : `now` est toujours un paramètre. C'est ce
// qui rend le comportement testable et la fenêtre de réessai vérifiable.
//
// Portée : l'état vit dans le module appelant, donc par instance de fonction.
// Sur Fluid Compute les instances sont réutilisées entre requêtes, ce qui suffit
// à supprimer le coût dans une session vocale. Le pire cas reste une sonde par
// instance chaude et par fenêtre de réessai — négligeable devant un aller-retour
// à chaque tour.

export type BreakerState = {
  /** Instant du premier refus consécutif. `null` = fournisseur réputé sain. */
  openedAt: number | null
  /** Instant à partir duquel une nouvelle tentative est autorisée. */
  nextProbeAt: number
}

export type BreakerPhase = 'closed' | 'open' | 'probe'

export function closedBreaker(): BreakerState {
  return { openedAt: null, nextProbeAt: 0 }
}

/** Le fournisseur doit-il être appelé maintenant ? */
export function shouldAttempt(state: BreakerState, now: number): boolean {
  return state.openedAt === null || now >= state.nextProbeAt
}

/**
 * Phase courante — pour le journal uniquement, jamais pour décider.
 * `probe` = disjoncteur ouvert mais fenêtre de réessai atteinte : la prochaine
 * tentative est une sonde, dont l'échec relancera une fenêtre complète.
 */
export function breakerPhase(state: BreakerState, now: number): BreakerPhase {
  if (state.openedAt === null) return 'closed'
  return now >= state.nextProbeAt ? 'probe' : 'open'
}

/**
 * Le fournisseur a refusé pour indisponibilité (quota, crédit).
 * `openedAt` conserve le PREMIER refus — on veut pouvoir lire depuis combien de
 * temps le fournisseur est tombé, pas depuis combien de temps on l'a resondé.
 */
export function recordUnavailable(state: BreakerState, now: number, cooldownMs: number): BreakerState {
  return { openedAt: state.openedAt ?? now, nextProbeAt: now + cooldownMs }
}

/** Le fournisseur a répondu : retour à l'état sain, sans mémoire de la panne. */
export function recordAvailable(): BreakerState {
  return closedBreaker()
}
