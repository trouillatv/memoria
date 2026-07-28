import 'server-only'

// Composition SERVEUR du graphe de collaboration (V3 UX-1) : faits élémentaires
// org-scopés (étape 2) → graphe pondéré PUR → résolution des libellés, de
// l'entreprise-fond et de l'état d'attention (halo) pour le rendu. asOf injecté.

import { createAdminClient } from '@/lib/supabase/admin'
import { getActorInteractions } from '@/lib/db/actor-interactions'
import { getActorsCockpit } from '@/lib/db/actors-cockpit'
import { buildCollaborationGraph, type CollaborationGraphView, type CollaborationNodeView } from '@/lib/knowledge/collaboration-graph'

const EMPTY: CollaborationGraphView = { nodes: [], edges: [] }

/** Graphe de collaboration prêt pour le rendu (pondéré). Fail-closed : sans org, vide. */
export async function getCollaborationGraph(orgIds: string[], asOf: Date): Promise<CollaborationGraphView> {
  if (orgIds.length === 0) return EMPTY
  const interactions = await getActorInteractions(orgIds)
  const graph = buildCollaborationGraph(interactions, asOf)
  if (graph.nodes.length === 0) return EMPTY

  // Libellé + état d'attention via le cockpit (source unique de l'état).
  const cockpit = await getActorsCockpit(orgIds)
  const meta = new Map(cockpit.actors.map((a) => [`${a.kind}:${a.id}`, { label: a.name, level: a.attention.level }]))

  // Entreprise de rattachement des personnes (fond coloré par organisation).
  const personIds = graph.nodes.filter((n) => n.kind === 'person').map((n) => n.id)
  const companyOf = new Map<string, string | null>()
  if (personIds.length) {
    const { data } = await createAdminClient().from('company_contacts').select('id, company_id').in('id', personIds)
    for (const r of (data ?? []) as Array<{ id: string; company_id: string | null }>) companyOf.set(r.id, r.company_id)
  }

  const nodes: CollaborationNodeView[] = graph.nodes.map((n) => {
    const key = `${n.kind}:${n.id}`
    const m = meta.get(key)
    return {
      key, kind: n.kind, id: n.id,
      label: m?.label ?? (n.kind === 'company' ? 'Entreprise' : 'Personne'),
      companyId: n.kind === 'company' ? n.id : companyOf.get(n.id) ?? null,
      level: m?.level ?? 'ok',
    }
  })
  const edges = graph.edges.map((e) => ({
    a: `${e.a.kind}:${e.a.id}`, b: `${e.b.kind}:${e.b.id}`,
    strength: e.strength, interactionCount: e.interactionCount,
    daysSinceLastInteraction: e.daysSinceLastInteraction, trend: e.trend, activeInteractionCount: e.activeInteractionCount,
  }))
  return { nodes, edges }
}
