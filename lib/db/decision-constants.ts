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
