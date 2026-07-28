// ── TITRE VIVANT DU GRAPHE (V3 UX) ───────────────────────────────────────────
// PUR : un résumé chiffré affiché au-dessus du graphe, propre à chaque lecture —
// « le graphe raconte avant même qu'on le regarde ». Compte les nœuds VISIBLES
// (selon les couches), jamais un total trompeur.

import type { ActorsGraph, ActorGraphKind } from './actors-graph-model'
import type { CollaborationGraphView } from './collaboration-graph'

const plural = (n: number, s: string) => `${n} ${s}${n > 1 ? 's' : ''}`

/** Résumé d'une lecture STRUCTURELLE : compte les natures visibles (couches). */
export function structuralGraphSummary(graph: ActorsGraph, visibleKinds: ReadonlySet<ActorGraphKind> | null): string {
  const show = (k: ActorGraphKind) => !visibleKinds || visibleKinds.has(k)
  const count: Record<ActorGraphKind, number> = { person: 0, company: 0, team: 0, site: 0, action: 0 }
  for (const n of graph.nodes) if (show(n.kind)) count[n.kind] += 1
  const parts: string[] = []
  if (count.company) parts.push(plural(count.company, 'entreprise'))
  if (count.person) parts.push(plural(count.person, 'personne'))
  if (count.team) parts.push(plural(count.team, 'équipe'))
  if (count.site) parts.push(`${count.site} chantier${count.site > 1 ? 's' : ''}`)
  if (count.action) parts.push(plural(count.action, 'action'))
  return parts.join(' · ')
}

/** Résumé de la lecture COLLABORATION : collaborations, fortes, récentes. */
export function collaborationGraphSummary(view: CollaborationGraphView): string {
  const edges = view.edges
  const strong = edges.filter((e) => e.strength >= 4).length          // seuil provisoire (avant distributions)
  const recent = edges.filter((e) => e.daysSinceLastInteraction <= 90).length
  const parts = [`${edges.length} collaboration${edges.length > 1 ? 's' : ''} observée${edges.length > 1 ? 's' : ''}`]
  if (strong) parts.push(`${strong} forte${strong > 1 ? 's' : ''}`)
  if (recent) parts.push(`${recent} récente${recent > 1 ? 's' : ''}`)
  return parts.join(' · ')
}
