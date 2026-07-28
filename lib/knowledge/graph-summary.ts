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

/** Titre-PHRASE de la lecture Collaboration (entreprises) : « X collabore
 *  principalement avec Y et Z. N collaborations fortes détectées. » Sur les seules
 *  arêtes entreprise↔entreprise. Vide si pas de collaboration entre entreprises. */
export function collaborationGraphNarrative(view: CollaborationGraphView): string {
  const meta = new Map(view.nodes.map((n) => [n.key, n]))
  const compEdges = view.edges.filter((e) => meta.get(e.a)?.kind === 'company' && meta.get(e.b)?.kind === 'company')
  if (compEdges.length === 0) return ''
  const total = new Map<string, number>()
  const partners = new Map<string, Array<{ key: string; s: number }>>()
  const add = (x: string, y: string, s: number) => {
    total.set(x, (total.get(x) ?? 0) + s)
    if (!partners.has(x)) partners.set(x, [])
    partners.get(x)!.push({ key: y, s })
  }
  for (const e of compEdges) { add(e.a, e.b, e.strength); add(e.b, e.a, e.strength) }
  const topKey = [...total.entries()].sort((a, b) => b[1] - a[1])[0]![0]
  const name = meta.get(topKey)?.label ?? 'Une entreprise'
  const tops = (partners.get(topKey) ?? []).sort((a, b) => b.s - a.s).slice(0, 2)
    .map((p) => meta.get(p.key)?.label).filter((l): l is string => !!l)
  const strong = compEdges.filter((e) => e.strength >= 4).length
  let s = tops.length
    ? `${name} collabore principalement avec ${tops.join(' et ')}.`
    : `${name} est l’entreprise la plus active.`
  if (strong) s += ` ${strong} collaboration${strong > 1 ? 's' : ''} forte${strong > 1 ? 's' : ''} détectée${strong > 1 ? 's' : ''}.`
  return s
}
