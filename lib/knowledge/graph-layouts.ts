// ── ALGORITHMES DE PLACEMENT PAR LECTURE (V3 UX, Phase 1) ────────────────────
// Chaque lecture du graphe a son PROPRE placement (pas un simple filtre). Ce module
// PUR calcule des positions DÉTERMINISTES ; le canvas les applique avec la physique
// coupée (« layout statique »). Force-directed reste géré par le moteur.
//
// Abstraction : un layout = (graphe) → positions. Ici le HIÉRARCHIQUE
// (Organigramme). Radial (Chantiers) et Cluster (Écosystème) viendront s'ajouter
// derrière la même signature.

import type { ActorsGraph, ActorGraphNode } from './actors-graph-model'

export type GraphLayoutKind = 'force' | 'hierarchical'

export type LayoutPositions = Map<string, { x: number; y: number }>

const COL_W = 190   // largeur d'une colonne d'entreprise
const ROW_H = 58    // hauteur d'une ligne (personne)
const HEADER_GAP = 46 // écart entreprise → première personne

/**
 * ORGANIGRAMME — placement HIÉRARCHIQUE déterministe :
 *   · chaque entreprise = une colonne (en-tête en haut) ;
 *   · ses personnes (belongs_to) empilées dessous ;
 *   · personnes sans entreprise → colonne « … » à droite ;
 *   · équipes → bande du bas.
 * Coordonnées centrées autour de (0,0). Sites/actions non placés (invisibles dans
 * cette lecture ; le canvas les laisse hors-champ). Déterministe (tri par libellé).
 */
export function hierarchicalLayout(graph: ActorsGraph): LayoutPositions {
  const pos: LayoutPositions = new Map()
  const companies = graph.nodes.filter((n) => n.kind === 'company').sort(byLabel)
  const teams = graph.nodes.filter((n) => n.kind === 'team').sort(byLabel)
  const persons = graph.nodes.filter((n) => n.kind === 'person')

  // Personne → entreprise (via belongs_to : a=person, b=company).
  const companyOfPerson = new Map<string, string>()
  for (const e of graph.edges) {
    if (e.rel === 'belongs_to') companyOfPerson.set(e.a, e.b)
  }
  const personsByCompany = new Map<string, ActorGraphNode[]>()
  const orphans: ActorGraphNode[] = []
  for (const p of persons) {
    const co = companyOfPerson.get(p.id)
    if (co) { if (!personsByCompany.has(co)) personsByCompany.set(co, []); personsByCompany.get(co)!.push(p) }
    else orphans.push(p)
  }
  for (const list of personsByCompany.values()) list.sort(byLabel)
  orphans.sort(byLabel)

  // Colonnes = entreprises (+ une colonne « orphelins » si besoin).
  const columns: Array<{ head: ActorGraphNode | null; people: ActorGraphNode[] }> = companies.map((c) => ({ head: c, people: personsByCompany.get(c.id) ?? [] }))
  if (orphans.length) columns.push({ head: null, people: orphans })

  const nCols = Math.max(1, columns.length)
  const x0 = -((nCols - 1) * COL_W) / 2 // centrage horizontal
  let maxDepth = 0
  columns.forEach((col, i) => {
    const x = x0 + i * COL_W
    if (col.head) pos.set(col.head.id, { x, y: 0 })
    col.people.forEach((p, r) => {
      const y = HEADER_GAP + r * ROW_H
      pos.set(p.id, { x, y })
      maxDepth = Math.max(maxDepth, y)
    })
  })

  // Équipes : bande du bas, centrée.
  if (teams.length) {
    const ty = maxDepth + HEADER_GAP + ROW_H
    const tx0 = -((teams.length - 1) * COL_W) / 2
    teams.forEach((t, i) => pos.set(t.id, { x: tx0 + i * COL_W, y: ty }))
  }
  return pos
}

function byLabel(a: ActorGraphNode, b: ActorGraphNode): number {
  return a.label.localeCompare(b.label, 'fr')
}
