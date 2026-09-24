// Types de document contractuel éligibles à l'extraction d'engagements
// prescriptifs (P0-2B). Partagé entre l'orchestrateur serveur
// (extract-engagement-candidates.ts) et l'UI cliente (document detail page) —
// ne jamais dupliquer cette liste, un extracteur non éligible ne doit jamais
// pouvoir être proposé côté UI ni accepté côté serveur.
export const ENGAGEMENT_ELIGIBLE_DOCUMENT_TYPES: readonly string[] = [
  'cctp',
  'ccap',
  'contrat',
  'avenant',
  'ordre_service',
]
