// ── MODÈLE PUR DU GRAPHE DES ACTEURS ─────────────────────────────────────────
// Types, libellés et compositions PURES du graphe organisationnel — SANS
// 'server-only' : importables par les composants client (ActorsExplorer,
// narration) comme par les fetchers serveur (lib/knowledge/actors-graph.ts,
// qui ré-exporte tout). Aucune I/O ici.
//
// Répond à « QUI travaille avec qui, où, et sur quoi ? » — liens ORGANISATIONNELS,
// jamais causaux (le graphe Mémoire répond à « pourquoi ? ») ; uniquement des
// relations RÉELLES (FK), aucune inférence, aucune IA.

import type { AttentionLevel } from '@/lib/knowledge/actor-attention'

export type ActorGraphKind = 'person' | 'company' | 'team' | 'site' | 'action'

export type ActorGraphRel =
  | 'belongs_to'      // personne → entreprise (appartient à)
  | 'member_of'       // personne → équipe (membre de)
  | 'mobilized_on'    // équipe → chantier (mobilisée sur)
  | 'intervenes_on'   // entreprise → chantier (intervient sur, casting actif)
  | 'referent_of'     // personne → action (référente de)
  | 'responsible_of'  // entreprise → action (responsable de)

export const REL_LABEL: Record<ActorGraphRel, string> = {
  belongs_to: 'appartient à',
  member_of: 'membre de',
  mobilized_on: 'mobilisée sur',
  intervenes_on: 'intervient sur',
  referent_of: 'référente de',
  responsible_of: 'responsable de',
}

/** Source STRUCTURELLE de chaque relation (panneau « le lien est un objet », V2.1).
 *  Toutes les relations du graphe sont structurelles (FK) — les rapprochements
 *  textuels sont exclus par doctrine. */
export const REL_SOURCE_LABEL: Record<ActorGraphRel, string> = {
  belongs_to: 'Fiche contact (rattachement entreprise)',
  member_of: 'Composition d’équipe',
  mobilized_on: 'Mission du chantier',
  intervenes_on: 'Casting du chantier',
  referent_of: 'Action du chantier (contact référent)',
  responsible_of: 'Action du chantier (entreprise responsable)',
}

export interface ActorGraphNode {
  id: string // préfixé par nature (p_/co_/tm_/s_/ac_) — jamais de collision entre types
  kind: ActorGraphKind
  label: string
  sub: string | null
  level: AttentionLevel   // état d'attention (partagé avec cockpit/fiches) → anneau
  historical: boolean     // rendu « gris » — existe encore mais hors périmètre actif
  /** Entreprise de rattachement (personne → sa société ; entreprise → elle-même ;
   *  équipe/chantier/action → null). Sert au FOND coloré par organisation : « qui
   *  travaille avec qui » d'un coup d'œil. */
  companyId: string | null
}

export interface ActorGraphEdge {
  a: string
  b: string
  rel: ActorGraphRel
  label: string
  /** Début STRUCTUREL de la relation quand il existe (joined_at, effective_from).
   *  null = « période inconnue » — jamais une date inventée. */
  since: string | null
}

export interface ActorsGraph {
  nodes: ActorGraphNode[]
  edges: ActorGraphEdge[]
}

// ── PERSPECTIVES & COUCHES ───────────────────────────────────────────────────
// On ne cache pas des données : on change la FAÇON de les lire. Chaque LECTURE
// répond à UNE question métier (au lieu d'un graphe qui montre tout à la fois) et
// n'affiche que les natures utiles à cette question — comme on change de couche sur
// une carte. N'offrir QUE ce que les données honorent : Collaboration pondérée
// (entreprise↔entreprise) et Historique (CR/visites/décisions comme nœuds) exigent
// des lots data à venir → pas de lecture mensongère ici.
export type ActorPerspective = 'all' | 'org' | 'sites' | 'work'

export const KIND_LAYER_LABEL: Record<ActorGraphKind, string> = {
  person: 'Personnes', company: 'Entreprises', team: 'Équipes', site: 'Chantiers', action: 'Actions',
}

/** Une LECTURE = une question + les seules natures qui y répondent. kinds = null →
 *  toutes (échappatoire « Tout »). `hint` = la question métier, affichée à l'écran. */
export const PERSPECTIVES: Array<{ id: ActorPerspective; label: string; hint: string; kinds: ActorGraphKind[] | null }> = [
  { id: 'org', label: 'Organigramme', hint: 'Qui travaille où ?', kinds: ['company', 'person', 'team'] },
  { id: 'sites', label: 'Chantiers', hint: 'Qui travaille avec qui, et où ?', kinds: ['company', 'person', 'team', 'site'] },
  { id: 'work', label: 'Travail', hint: 'Qui porte quoi ?', kinds: ['person', 'company', 'action'] },
  { id: 'all', label: 'Tout', hint: 'Tout afficher (vue dense)', kinds: null },
]

/** Lecture par défaut de la vue d'ensemble : une question, pas « tout à la fois ». */
export const DEFAULT_PERSPECTIVE: ActorPerspective = 'sites'

/** Natures de nœuds réellement présentes dans un graphe (pour n'offrir que l'utile). */
export function graphKinds(graph: ActorsGraph): Set<ActorGraphKind> {
  return new Set(graph.nodes.map((n) => n.kind))
}

/** Acteur (personne/entreprise/équipe) déjà résolu par le cockpit (état d'attention inclus). */
export interface GraphActorInput {
  id: string
  name: string
  sub: string | null
  level: AttentionLevel
  historical: boolean
}

export interface ActorsGraphInputs {
  persons: Array<GraphActorInput & { companyId: string | null }>
  companies: GraphActorInput[]
  teams: GraphActorInput[]
  siteNames: Array<{ id: string; name: string }>
  fieldMemberships: Array<{ contactId: string; teamId: string; joinedAt?: string | null }>  // personne → équipe (actif)
  missions: Array<{ siteId: string; teamId: string }>             // équipe → chantier (actif, pas de date structurelle)
  casting: Array<{ companyId: string; siteId: string; effectiveFrom?: string | null }>      // entreprise → chantier (casting actif)
  openActions: Array<{ id: string; title: string; siteId: string; contactId: string | null; companyId: string | null; overdue: boolean; createdAt?: string | null }>
}

const P = (id: string) => `p_${id}`
const CO = (id: string) => `co_${id}`
const TM = (id: string) => `tm_${id}`
const S = (id: string) => `s_${id}`
const AC = (id: string) => `ac_${id}`

/**
 * Compose le graphe organisationnel. Déterministe. N'inclut un chantier ou une action
 * QUE s'il est réellement relié à un acteur du périmètre (jamais de nœud orphelin).
 */
export function buildActorsGraph(input: ActorsGraphInputs): ActorsGraph {
  const personSet = new Set(input.persons.map((p) => p.id))
  const companySet = new Set(input.companies.map((c) => c.id))
  const teamSet = new Set(input.teams.map((t) => t.id))
  const siteNameById = new Map(input.siteNames.map((s) => [s.id, s.name]))

  const edges: ActorGraphEdge[] = []
  const edgeKeys = new Set<string>()
  const pushEdge = (a: string, b: string, rel: ActorGraphRel, since: string | null = null) => {
    const key = `${a}|${b}|${rel}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ a, b, rel, label: REL_LABEL[rel], since })
  }

  // Chantiers & actions réellement reliés (calculés d'abord pour ne garder que l'utile).
  const siteHasOverdue = new Map<string, boolean>()
  const siteHasOpen = new Map<string, boolean>()
  const includedSites = new Set<string>()
  const includedActions: ActorsGraphInputs['openActions'] = []

  for (const a of input.openActions) {
    const hasPerson = a.contactId != null && personSet.has(a.contactId)
    const hasCompany = a.companyId != null && companySet.has(a.companyId)
    if (!hasPerson && !hasCompany) continue // action non reliée à un acteur du périmètre → ignorée
    includedActions.push(a)
    includedSites.add(a.siteId)
    siteHasOpen.set(a.siteId, true)
    if (a.overdue) siteHasOverdue.set(a.siteId, true)
  }
  for (const m of input.missions) if (teamSet.has(m.teamId)) includedSites.add(m.siteId)
  for (const c of input.casting) if (companySet.has(c.companyId)) includedSites.add(c.siteId)

  const nodes: ActorGraphNode[] = []
  for (const p of input.persons) nodes.push({ id: P(p.id), kind: 'person', label: p.name, sub: p.sub, level: p.level, historical: p.historical, companyId: p.companyId ?? null })
  for (const c of input.companies) nodes.push({ id: CO(c.id), kind: 'company', label: c.name, sub: c.sub, level: c.level, historical: c.historical, companyId: c.id })
  for (const t of input.teams) nodes.push({ id: TM(t.id), kind: 'team', label: t.name, sub: t.sub, level: t.level, historical: t.historical, companyId: null })
  for (const siteId of includedSites) {
    const level: AttentionLevel = siteHasOverdue.get(siteId) ? 'urgent' : siteHasOpen.get(siteId) ? 'attention' : 'ok'
    nodes.push({ id: S(siteId), kind: 'site', label: siteNameById.get(siteId) ?? 'Chantier', sub: null, level, historical: false, companyId: null })
  }
  for (const a of includedActions) {
    nodes.push({ id: AC(a.id), kind: 'action', label: a.title, sub: siteNameById.get(a.siteId) ?? null, level: a.overdue ? 'urgent' : 'ok', historical: false, companyId: null })
  }

  // Liens structurels (uniquement entre nœuds réellement présents).
  for (const p of input.persons) {
    if (p.companyId && companySet.has(p.companyId)) pushEdge(P(p.id), CO(p.companyId), 'belongs_to')
  }
  for (const f of input.fieldMemberships) {
    if (personSet.has(f.contactId) && teamSet.has(f.teamId)) pushEdge(P(f.contactId), TM(f.teamId), 'member_of', f.joinedAt?.slice(0, 10) ?? null)
  }
  for (const m of input.missions) {
    if (teamSet.has(m.teamId) && includedSites.has(m.siteId)) pushEdge(TM(m.teamId), S(m.siteId), 'mobilized_on')
  }
  for (const c of input.casting) {
    if (companySet.has(c.companyId) && includedSites.has(c.siteId)) pushEdge(CO(c.companyId), S(c.siteId), 'intervenes_on', c.effectiveFrom ?? null)
  }
  for (const a of includedActions) {
    const since = a.createdAt?.slice(0, 10) ?? null
    if (a.contactId && personSet.has(a.contactId)) pushEdge(P(a.contactId), AC(a.id), 'referent_of', since)
    if (a.companyId && companySet.has(a.companyId)) pushEdge(CO(a.companyId), AC(a.id), 'responsible_of', since)
  }

  return { nodes, edges }
}

/**
 * CHRONOLOGIE (le « film ») : jours réels où des relations du graphe sont apparues
 * (`since` structurels), et première apparition de chaque nœud (= plus ancienne de
 * ses relations datées ; null = présent depuis toujours, jamais masqué par le replay).
 * Pur — même modèle que le replay d'Explorer Mémoire : on rejoue l'apparition de
 * l'état ACTUEL, on ne reconstruit pas un passé disparu.
 */
export function graphTimeline(graph: ActorsGraph): { days: string[]; firstSeen: Map<string, string | null> } {
  const daySet = new Set<string>()
  const minDated = new Map<string, string>()
  const hasUndated = new Set<string>()
  for (const e of graph.edges) {
    if (e.since) {
      daySet.add(e.since)
      for (const id of [e.a, e.b]) {
        const cur = minDated.get(id)
        if (cur === undefined || e.since < cur) minDated.set(id, e.since)
      }
    } else {
      hasUndated.add(e.a); hasUndated.add(e.b)
    }
  }
  const firstSeen = new Map<string, string | null>()
  for (const n of graph.nodes) {
    // ≥1 relation NON datée (ou aucune relation) → « depuis toujours » : on ne peut
    // pas prétendre que le nœud est apparu plus tard, il reste visible en replay.
    firstSeen.set(n.id, hasUndated.has(n.id) ? null : minDated.get(n.id) ?? null)
  }
  return { days: [...daySet].sort(), firstSeen }
}

/** Plus court chemin entre deux nœuds (BFS) — mode « Suivre » de l'Explorer des
 *  acteurs. Retourne la suite de nœuds + les index d'arêtes traversées, ou null
 *  si aucun chemin. Pur, testable. */
export function shortestPath(graph: ActorsGraph, from: string, to: string): { nodes: string[]; edgeIndexes: number[] } | null {
  if (from === to) return { nodes: [from], edgeIndexes: [] }
  const adj = new Map<string, Array<{ other: string; index: number }>>()
  graph.edges.forEach((e, index) => {
    ;(adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ other: e.b, index })
    ;(adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ other: e.a, index })
  })
  const prev = new Map<string, { node: string; index: number }>()
  const seen = new Set<string>([from])
  let frontier = [from]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const { other, index } of adj.get(id) ?? []) {
        if (seen.has(other)) continue
        seen.add(other)
        prev.set(other, { node: id, index })
        if (other === to) {
          const nodes: string[] = [to]
          const edgeIndexes: number[] = []
          let cur = to
          while (cur !== from) {
            const p = prev.get(cur)!
            edgeIndexes.unshift(p.index)
            nodes.unshift(p.node)
            cur = p.node
          }
          return { nodes, edgeIndexes }
        }
        next.push(other)
      }
    }
    frontier = next
  }
  return null
}

/** Sous-graphe accessible depuis `nodeId` en `depth` sauts. Pur, réutilisable. */
export function egoSubgraph(graph: ActorsGraph, nodeId: string, depth: number): ActorsGraph {
  if (!graph.nodes.some((n) => n.id === nodeId)) return { nodes: [], edges: [] }
  const adj = new Map<string, string[]>()
  for (const e of graph.edges) {
    ;(adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b)
    ;(adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a)
  }
  const keep = new Set<string>([nodeId])
  let frontier = [nodeId]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!keep.has(nb)) { keep.add(nb); next.push(nb) }
    frontier = next
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.a) && keep.has(e.b)),
  }
}
