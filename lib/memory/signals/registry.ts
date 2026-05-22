// Registre des kinds — couche PURE (aucun import server-only).
//
// Mappe chaque SignalKind vers sa FAMILLE (groupement visuel) et sa VALENCE
// (fragile / sain). La valence n'est PAS un score : c'est une polarité dérivée
// du kind, utilisée par la surface pour équilibrer positif/négatif et choisir
// une teinte. La santé est de premier rang (sinon : machine à anxiété).

import type { SignalKind } from './types'

export type SignalFamily = 'attention' | 'continuite' | 'ao' | 'memoire'
export type SignalValence = 'fragile' | 'sain' | 'neutre'

export interface SignalMeta {
  family: SignalFamily
  valence: SignalValence
  /** Libellé court de la catégorie (debug / future UI). */
  label: string
}

export const SIGNAL_REGISTRY: Record<SignalKind, SignalMeta> = {
  // Santé (de premier rang — le moteur naît équilibré, pas anxiogène).
  handover_acknowledged: { family: 'continuite', valence: 'sain', label: 'Passation reconnue' },
  fresh_field_memory: { family: 'memoire', valence: 'sain', label: 'Mémoire confirmée récemment' },
  // Fragilité.
  unusual_silence: { family: 'memoire', valence: 'fragile', label: 'Silence inhabituel' },
}
