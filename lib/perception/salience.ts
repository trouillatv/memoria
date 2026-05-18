// V5.1 Slice 3 — Calcul de la saillance par event (côté serveur, jamais en DB).
//
// Doctrine Vincent 2026-05-14 : la saillance est une logique de rendu, pas
// une vérité métier. Elle peut évoluer librement. Aucune colonne `salience`
// n'est stockée — chaque rendu de page recalcule. Cf. plan V5.1.2 § Slice 3.

import type { SiteMemoryEvent } from '@/lib/db/site-memory'

/**
 * Score [0..1] qui pondère l'importance perceptive d'un event.
 * Combiné avec l'âge dans fading.ts pour produire l'opacity finale.
 *
 * Valeurs intentionnellement grossières — c'est de la sensation, pas de la
 * précision statistique.
 */
export function salienceOf(event: SiteMemoryEvent): number {
  switch (event.type) {
    case 'anomaly': {
      const status = event.status ?? 'open'
      if (status === 'open') return 1.0       // anomalie active = vif
      if (status === 'resolved') return 0.5    // résolue = cicatrice atténuée
      if (status === 'ignored') return 0.3     // ignorée = quasi-fanée
      return 0.5
    }
    case 'a_savoir':
      return 0.7                                // consigne active explicite
    case 'note':
      return 0.6                                // observation manuelle
    case 'photo': {
      const kind = (event.meta?.kind as string) ?? ''
      if (kind === 'anomaly') return 0.8        // photo d'anomalie = saillante
      // Une photo avec caption portée par l'humain est plus saillante qu'une
      // photo nue qui sert de simple trace de passage.
      if (event.title && !event.title.startsWith('Photo ')) return 0.4
      return 0.2                                // passage banal
    }
    case 'intervention': {
      if (event.detail && event.detail.trim().length > 0) return 0.5
      return 0.2                                // intervention sans note = banal
    }
    case 'access': {
      // Incident d'accès = saillant (mémoire). Prise/restitution = routine.
      if (event.meta?.kind === 'incident') return 0.9
      return 0.2
    }
    default:
      return 0.2
  }
}
