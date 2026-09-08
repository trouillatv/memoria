// 6E.4A — les 5 catégories métier de la page "MemorIA a besoin de toi", isolées dans un module
// sans aucune dépendance (ni 'server-only' ni accès DB) : tracked-point-needs-you-summary.ts
// (côté serveur) ET les composants client de la page (NeedsYouClient.tsx, NeedsYouCards.tsx)
// importent ces constantes depuis ici. Les importer directement depuis
// tracked-point-needs-you-summary.ts depuis un composant client fait entrer toute sa chaîne de
// dépendances (queues → resolvers → lib/supabase/admin.ts) dans le bundle client, où
// 'server-only' échoue au build.

export type MemoriaNeedsYouCategory =
  | 'duplicate_points'
  | 'attach_information'
  | 'confirm_trackability'
  | 'assign_resolution'
  | 'clarify_evidence'

export const MEMORIA_NEEDS_YOU_CATEGORY_ORDER: MemoriaNeedsYouCategory[] = [
  'duplicate_points',
  'attach_information',
  'confirm_trackability',
  'assign_resolution',
  'clarify_evidence',
]

export const MEMORIA_NEEDS_YOU_CATEGORY_LABELS: Record<MemoriaNeedsYouCategory, string> = {
  duplicate_points: 'Deux suivis semblent identiques',
  attach_information: 'Informations à rattacher',
  confirm_trackability: 'Situations à confirmer comme suivi',
  assign_resolution: 'Résolutions à attribuer',
  clarify_evidence: 'Preuve à préciser',
}
