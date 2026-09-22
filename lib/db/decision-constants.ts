// Constantes PURES des décisions (mig 136) — aucune dépendance serveur → importables
// côté client ET serveur (cf. piège ACTION_CODES). La logique DB vit dans
// site-decisions.ts (server-only) ; ici, juste le vocabulaire + ses libellés.
export const DECISION_STATUTS = ['proposee', 'actee', 'appliquee', 'caduque', 'contredite'] as const
export type DecisionStatut = (typeof DECISION_STATUTS)[number]

export const DECISION_IMPACTS = ['planning', 'cout', 'technique', 'securite', 'autre'] as const
export type DecisionImpact = (typeof DECISION_IMPACTS)[number]

export const STATUT_LABEL: Record<DecisionStatut, string> = {
  proposee: 'Proposée',
  actee: 'Actée',
  appliquee: 'Appliquée',
  caduque: 'Caduque',
  contredite: 'Contredite',
}

export const IMPACT_LABEL: Record<DecisionImpact, string> = {
  planning: 'Planning',
  cout: 'Coût',
  technique: 'Technique',
  securite: 'Sécurité',
  autre: 'Autre',
}

// PERTINENCE TERRAIN (mig 431) — tri-état, jamais un booléen : NULL en base =
// legacy_unknown (décision antérieure à ce champ, jamais classifiée), traité
// comme 'a_verifier' par le Plan de visite tant qu'un humain ne l'a pas
// classifiée explicitement (doctrine anti-masquage, cf. site-memory-signals.ts).
export const DECISION_PERTINENCE_TERRAIN = ['a_verifier', 'memoire_seule'] as const
export type DecisionPertinenceTerrain = (typeof DECISION_PERTINENCE_TERRAIN)[number]

export const PERTINENCE_TERRAIN_LABEL: Record<DecisionPertinenceTerrain, string> = {
  a_verifier: 'À vérifier sur le terrain',
  memoire_seule: 'Décision de mémoire uniquement',
}
