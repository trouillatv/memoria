// ── NARRATION D'UN ACTEUR (V2.1) ─────────────────────────────────────────────
// Le panneau de l'Explorer ne doit pas seulement AFFICHER : il RACONTE le réseau.
// Générateur PUR : chaque phrase dérive des relations STRUCTURELLES du graphe et
// de l'état d'attention — jamais d'IA, jamais d'inférence, rien sans preuve.
// (Équivalent Acteurs du `recit()` d'Explorer Mémoire.)

import type { ActorsGraph, ActorGraphNode, ActorGraphRel } from '@/lib/knowledge/actors-graph-model'

function plural(n: number, w: string): string { return `${n} ${w}${n > 1 ? 's' : ''}` }

/** Voisin + relation, orientés depuis `nodeId`. */
function neighborsOf(graph: ActorsGraph, nodeId: string): Array<{ node: ActorGraphNode; rel: ActorGraphRel; outgoing: boolean }> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const out: Array<{ node: ActorGraphNode; rel: ActorGraphRel; outgoing: boolean }> = []
  for (const e of graph.edges) {
    if (e.a === nodeId) { const n = byId.get(e.b); if (n) out.push({ node: n, rel: e.rel, outgoing: true }) }
    else if (e.b === nodeId) { const n = byId.get(e.a); if (n) out.push({ node: n, rel: e.rel, outgoing: false }) }
  }
  return out
}

/**
 * Raconte pourquoi cet acteur apparaît ici, en 2-5 phrases factuelles.
 * Ex. « Joseph Wamytan travaille chez Clim Austral. Membre de l'équipe Électricité.
 * Référent de 2 actions ouvertes, dont 1 en retard. »
 */
export function narrateActorInGraph(nodeId: string, graph: ActorsGraph): string[] {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return []
  const neigh = neighborsOf(graph, nodeId)
  const of = (rel: ActorGraphRel) => neigh.filter((x) => x.rel === rel)
  const s: string[] = []

  if (node.kind === 'person') {
    const company = of('belongs_to').find((x) => x.outgoing)?.node
    const teams = of('member_of').filter((x) => x.outgoing).map((x) => x.node)
    const actions = of('referent_of').filter((x) => x.outgoing).map((x) => x.node)
    const overdue = actions.filter((a) => a.level === 'urgent').length
    if (company) s.push(`${node.label} travaille chez ${company.label}.`)
    if (teams.length) s.push(`Membre de l’équipe ${teams.map((t) => t.label).join(', ')}.`)
    if (actions.length) s.push(`Référent de ${plural(actions.length, 'action')} ouverte${actions.length > 1 ? 's' : ''}${overdue ? `, dont ${overdue} en retard` : ''}.`)
    else s.push('Aucune action ouverte ne lui est attribuée.')
    if (node.historical) s.push('N’est plus mobilisé actuellement (relations historiques).')
  } else if (node.kind === 'company') {
    const sites = of('intervenes_on').filter((x) => x.outgoing).map((x) => x.node)
    const contacts = of('belongs_to').filter((x) => !x.outgoing).map((x) => x.node)
    const actions = of('responsible_of').filter((x) => x.outgoing).map((x) => x.node)
    const overdue = actions.filter((a) => a.level === 'urgent').length
    if (sites.length) s.push(`${node.label} intervient sur ${plural(sites.length, 'chantier')} (${sites.map((x) => x.label).join(', ')}).`)
    else s.push(`${node.label} n’intervient sur aucun chantier actif.`)
    if (contacts.length) s.push(`${plural(contacts.length, 'contact')} connu${contacts.length > 1 ? 's' : ''}.`)
    if (actions.length) s.push(`Responsable de ${plural(actions.length, 'action')} ouverte${actions.length > 1 ? 's' : ''}${overdue ? `, dont ${overdue} en retard` : ''}.`)
    if (node.historical) s.push('N’est plus au casting actif (relations historiques).')
  } else if (node.kind === 'team') {
    const members = of('member_of').filter((x) => !x.outgoing).map((x) => x.node)
    const sites = of('mobilized_on').filter((x) => x.outgoing).map((x) => x.node)
    if (members.length) s.push(`${node.label} compte ${plural(members.length, 'membre')} relié${members.length > 1 ? 's' : ''}.`)
    if (sites.length) s.push(`Mobilisée sur ${sites.map((x) => x.label).join(', ')}.`)
    else s.push('N’est mobilisée sur aucun chantier actuellement.')
  } else if (node.kind === 'site') {
    const companies = of('intervenes_on').filter((x) => !x.outgoing).length
    const teams = of('mobilized_on').filter((x) => !x.outgoing).length
    const actions = neigh.filter((x) => x.node.kind === 'action').length
    const bits = [companies ? plural(companies, 'entreprise') : null, teams ? plural(teams, 'équipe') : null, actions ? `${plural(actions, 'action')} ouverte${actions > 1 ? 's' : ''}` : null].filter(Boolean)
    s.push(bits.length ? `Autour de ${node.label} : ${bits.join(', ')}.` : `${node.label} n’a aucune relation visible ici.`)
  } else {
    const referent = of('referent_of').find((x) => !x.outgoing)?.node
    const responsible = of('responsible_of').find((x) => !x.outgoing)?.node
    if (referent) s.push(`Portée par ${referent.label}.`)
    if (responsible) s.push(`Sous la responsabilité de ${responsible.label}.`)
    if (!referent && !responsible) s.push('Aucun responsable relié.')
    if (node.level === 'urgent') s.push('Cette action est en retard.')
  }
  return s
}
