// ── ALGORITHMES DE PLACEMENT PAR LECTURE (V3 UX, Phase 1) ────────────────────
// Chaque lecture du graphe a son PROPRE placement (pas un simple filtre). Ce module
// PUR calcule des positions DÉTERMINISTES + les BLOCS visuels (cartes d'entreprise,
// strates) ; le canvas les applique avec la physique coupée (« layout statique »).
//
// Abstraction : un layout = (graphe) → { positions, blocs }. Ici le HIÉRARCHIQUE
// (Organigramme). Radial (Chantiers) et Cluster (Écosystème) suivront.

import type { ActorsGraph, ActorGraphNode } from './actors-graph-model'

export type GraphLayoutKind = 'force' | 'hierarchical'

export type LayoutPositions = Map<string, { x: number; y: number }>

/** Bloc visuel dessiné derrière un groupe (carte d'entreprise, strate). */
export interface LayoutBlock {
  /** Titre affiché au-dessus (null = l'en-tête est un nœud, ex. l'entreprise). */
  title: string | null
  cx: number
  top: number
  bottom: number
  halfWidth: number
}

export interface HierarchicalResult { positions: LayoutPositions; blocks: LayoutBlock[] }

const COL_W = 190     // largeur d'une colonne d'entreprise
const ROW_H = 54      // hauteur d'une ligne (personne)
const HEADER_GAP = 48 // écart en-tête → première personne
const PAD_X = 78      // demi-largeur d'une carte
const PAD_TOP = 34    // marge de la carte au-dessus de l'en-tête
const PAD_BOTTOM = 30 // marge de la carte sous la dernière ligne

/**
 * ORGANIGRAMME — placement HIÉRARCHIQUE déterministe + cartes d'entreprise :
 *   · ENTREPRISE en-tête (y=0), sa carte englobe ses personnes ;
 *   · PERSONNES (belongs_to) empilées, parfaitement alignées sous l'entreprise ;
 *   · « Sans entreprise » = un vrai bloc titré à droite ;
 *   · ÉQUIPES = 3ᵉ strate, bande titrée en bas.
 * Entreprises triées par NOMBRE de collaborateurs (desc) puis alphabétique →
 * ordre stable. Déterministe. Sites/actions non placés (invisibles ici).
 */
export function hierarchicalLayout(graph: ActorsGraph): HierarchicalResult {
  const pos: LayoutPositions = new Map()
  const blocks: LayoutBlock[] = []
  const companies = graph.nodes.filter((n) => n.kind === 'company')
  const teams = graph.nodes.filter((n) => n.kind === 'team').sort(byLabel)
  const persons = graph.nodes.filter((n) => n.kind === 'person')

  // Personne → entreprise (belongs_to : a=person, b=company).
  const companyOfPerson = new Map<string, string>()
  for (const e of graph.edges) if (e.rel === 'belongs_to') companyOfPerson.set(e.a, e.b)
  const personsByCompany = new Map<string, ActorGraphNode[]>()
  const orphans: ActorGraphNode[] = []
  for (const p of persons) {
    const co = companyOfPerson.get(p.id)
    if (co) { if (!personsByCompany.has(co)) personsByCompany.set(co, []); personsByCompany.get(co)!.push(p) }
    else orphans.push(p)
  }
  for (const list of personsByCompany.values()) list.sort(byLabel)
  orphans.sort(byLabel)

  // Tri des entreprises : plus de collaborateurs d'abord, puis alphabétique.
  const sortedCompanies = [...companies].sort((a, b) => {
    const na = personsByCompany.get(a.id)?.length ?? 0, nb = personsByCompany.get(b.id)?.length ?? 0
    return nb - na || byLabel(a, b)
  })

  // Colonnes = entreprises (+ colonne « Sans entreprise » si besoin).
  const columns: Array<{ head: ActorGraphNode | null; title: string | null; people: ActorGraphNode[] }> =
    sortedCompanies.map((c) => ({ head: c, title: null, people: personsByCompany.get(c.id) ?? [] }))
  if (orphans.length) columns.push({ head: null, title: 'Sans entreprise', people: orphans })

  const nCols = Math.max(1, columns.length)
  const x0 = -((nCols - 1) * COL_W) / 2 // centrage horizontal
  let maxBottom = 0
  columns.forEach((col, i) => {
    const x = x0 + i * COL_W
    if (col.head) pos.set(col.head.id, { x, y: 0 })
    col.people.forEach((p, r) => pos.set(p.id, { x, y: HEADER_GAP + r * ROW_H }))
    const bottom = HEADER_GAP + Math.max(0, col.people.length - 1) * ROW_H + PAD_BOTTOM
    maxBottom = Math.max(maxBottom, bottom)
    // Carte du groupe (englobe en-tête + personnes).
    blocks.push({ title: col.title, cx: x, top: -PAD_TOP, bottom, halfWidth: PAD_X })
  })

  // Équipes : 3ᵉ strate, bande titrée en bas.
  if (teams.length) {
    const ty = maxBottom + HEADER_GAP + ROW_H
    const tx0 = -((teams.length - 1) * COL_W) / 2
    teams.forEach((t, i) => pos.set(t.id, { x: tx0 + i * COL_W, y: ty }))
    blocks.push({ title: 'Équipes', cx: 0, top: ty - PAD_TOP, bottom: ty + PAD_BOTTOM, halfWidth: (teams.length * COL_W) / 2 })
  }
  return { positions: pos, blocks }
}

function byLabel(a: ActorGraphNode, b: ActorGraphNode): number {
  return a.label.localeCompare(b.label, 'fr')
}
