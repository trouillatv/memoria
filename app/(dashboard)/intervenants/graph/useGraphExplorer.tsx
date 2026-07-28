'use client'

// ── ÉTAT PARTAGÉ DE L'EXPLORATION ────────────────────────────────────────────
// Un seul cerveau pour la vue d'ensemble (ActorsExplorer) ET le réseau fusionné
// dans les fiches (ActorNetworkExplorer) : sélection nœud/lien, mode Suivre (chemin
// raconté), chronologie (le film), narration. Le canvas ne fait que dessiner et
// remonter les gestes ; toute la LECTURE vit ici.

import { useEffect, useMemo, useState } from 'react'
import {
  shortestPath, graphTimeline, graphKinds, PERSPECTIVES, enqueteFocus,
  REL_SOURCE_LABEL,
  type ActorsGraph, type ActorGraphNode, type ActorGraphKind, type ActorPerspective, type EnqueteLens,
} from '@/lib/knowledge/actors-graph-model'
import { narrateActorInGraph } from '@/lib/knowledge/actor-narration'
import { getActorContextAction } from '../context-actions'
import { getActorRelationsAction } from '../relation-actions'
import type { ActorContext } from '@/lib/db/actor-context'
import type { ActorRelationsResult } from '@/lib/knowledge/actor-relation-view'
import { NodePanel, EdgePanel, PathPanel } from './inspector'

export type GraphSelection = { type: 'node'; id: string } | { type: 'edge'; index: number } | null

const kindsOf = (id: ActorPerspective, available: Set<ActorGraphKind>): Set<ActorGraphKind> => {
  const def = PERSPECTIVES.find((p) => p.id === id)!
  return def.kinds === null ? new Set(available) : new Set(def.kinds.filter((k) => available.has(k)))
}

/** `initialPerspective` : la vue d'ensemble s'ouvre sur UNE lecture (« Chantiers »),
 *  le réseau embarqué d'une fiche garde « Tout » (on veut voir tout l'entourage). */
export function useGraphExplorer(graph: ActorsGraph, focusId?: string | null, initialPerspective: ActorPerspective = 'all') {
  const [sel, setSel] = useState<GraphSelection>(focusId ? { type: 'node', id: focusId } : null)
  const [followFrom, setFollowFrom] = useState<string | null>(null)
  const [path, setPath] = useState<{ nodes: string[]; edgeIndexes: number[] } | null>(null)
  const [timeMax, setTimeMax] = useState<string | null>(null)

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const timeline = useMemo(() => graphTimeline(graph), [graph])

  // ── Lectures & couches (changer la LECTURE, pas les données) ──
  const availableKinds = useMemo(() => graphKinds(graph), [graph])
  const [visibleKinds, setVisibleKinds] = useState<Set<ActorGraphKind>>(() => kindsOf(initialPerspective, availableKinds))
  const [perspective, setPerspective] = useState<ActorPerspective>(initialPerspective)
  const applyPerspective = (id: ActorPerspective) => {
    setPerspective(id)
    setVisibleKinds(kindsOf(id, availableKinds))
  }
  const toggleKind = (k: ActorGraphKind) => {
    setPerspective('all') // couche modifiée à la main → plus une perspective nommée
    setVisibleKinds((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }

  // ── Mode enquête (Niveau 2, quand un acteur est sélectionné) ──
  // Lentille = une lecture de son entourage ; `isolate` = ne garder QUE ce sous-graphe
  // (vs le mettre en évidence, le reste estompé). « Pourquoi ? » = comportement par
  // défaut (voisinage direct) → sélection simple inchangée.
  const [lens, setLens] = useState<EnqueteLens>('why')
  const [isolate, setIsolate] = useState(false)
  // Langage visuel épuré par défaut : liens NEUTRES ; la couleur par nature n'est
  // affichée que si l'utilisateur active cette lecture (moins de codes simultanés).
  const [colorEdges, setColorEdges] = useState(false)

  const selNode = sel?.type === 'node' ? nodeById.get(sel.id) ?? null : null
  const selEdge = sel?.type === 'edge' ? graph.edges[sel.index] ?? null : null

  // Sous-graphe d'enquête du nœud sélectionné (null hors sélection) — pilote la mise
  // en évidence ET l'isolement dans le canvas.
  const focusSet = useMemo(() => (selNode ? enqueteFocus(graph, selNode.id, lens) : null), [selNode, graph, lens])

  // ── Contexte opérationnel (V2.2) : dernières interactions datées de l'acteur ──
  // Chargé à la demande (personne/entreprise) — les décisions/CR/actions ne vivent
  // pas dans le graphe. Annulable si la sélection change vite.
  const [context, setContext] = useState<{ id: string; data: ActorContext } | null>(null)
  useEffect(() => {
    // Rien à charger hors personne/entreprise ; le contexte périmé n'est de toute
    // façon jamais affiché (dérivation par id ci-dessous) → pas de setState synchrone.
    if (!selNode || (selNode.kind !== 'person' && selNode.kind !== 'company')) return
    const nodeId = selNode.id
    const rawId = nodeId.slice(nodeId.indexOf('_') + 1)
    let cancelled = false
    getActorContextAction(selNode.kind, rawId)
      .then((res) => { if (!cancelled && res.ok) setContext({ id: nodeId, data: res.context }) })
      .catch(() => { /* contexte indisponible → l'inspecteur reste sans cette section */ })
    return () => { cancelled = true }
  }, [selNode])
  const nodeContext = selNode && context?.id === selNode.id ? context.data : null

  // ── Relations (V3 étape 5) : « Travaille principalement avec » + écosystème ──
  // Même patron : chargé à la demande, dérivation par id (jamais de recalcul UI).
  const [relView, setRelView] = useState<{ id: string; data: ActorRelationsResult } | null>(null)
  useEffect(() => {
    if (!selNode || (selNode.kind !== 'person' && selNode.kind !== 'company')) return
    const nodeId = selNode.id
    const rawId = nodeId.slice(nodeId.indexOf('_') + 1)
    let cancelled = false
    getActorRelationsAction(selNode.kind, rawId)
      .then((res) => { if (!cancelled && res.ok) setRelView({ id: nodeId, data: res.data }) })
      .catch(() => { /* relations indisponibles → section masquée */ })
    return () => { cancelled = true }
  }, [selNode])
  const nodeRelations = selNode && relView?.id === selNode.id ? relView.data : null

  const pathNodes = useMemo(() => (path ? new Set(path.nodes) : null), [path])
  const pathEdges = useMemo(() => (path ? new Set(path.edgeIndexes) : null), [path])
  const pathSteps = useMemo(() => {
    if (!path) return null
    return path.nodes.map((id, i) => ({ node: nodeById.get(id)!, relLabel: i === 0 ? null : graph.edges[path.edgeIndexes[i - 1]!]?.label ?? null }))
  }, [path, nodeById, graph])

  const narration = useMemo(() => (selNode ? narrateActorInGraph(selNode.id, graph) : []), [selNode, graph])
  const relations = useMemo(() => {
    if (!selNode) return []
    const sid = selNode.id
    return graph.edges.map((e, index) => ({ e, index })).filter(({ e }) => e.a === sid || e.b === sid)
      .map(({ e, index }) => ({ e, index, other: nodeById.get(e.a === sid ? e.b : e.a)! })).filter((r) => r.other)
  }, [selNode, graph, nodeById])

  const clearPath = () => { setFollowFrom(null); setPath(null) }
  const selectNode = (id: string) => { setPath(null); setSel({ type: 'node', id }) }
  const selectEdge = (index: number) => { setPath(null); setSel({ type: 'edge', index }) }
  const startFollow = (id: string) => { setPath(null); setFollowFrom(id) }

  // ── Recherche & focus (taper « Joseph » → centrer + sélectionner + inspecter) ──
  // On ne cherche que parmi les natures VISIBLES (couches) — pas de résultat qui
  // ne serait pas affiché. `centerRequest` (avec nonce) demande au canvas de
  // recadrer, même si l'on refocalise le même acteur.
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return graph.nodes.filter((n) => visibleKinds.has(n.kind) && n.label.toLowerCase().includes(q)).slice(0, 8)
  }, [query, graph, visibleKinds])
  const [centerRequest, setCenterRequest] = useState<{ id: string; nonce: number } | null>(null)
  const focusNode = (id: string) => {
    clearPath()
    setSel({ type: 'node', id }) // sélection → contour + voisinage + inspecteur
    setCenterRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }))
    setQuery('') // ferme la liste ; l'acteur reste centré et sélectionné
  }

  const control = {
    selectedNodeId: sel?.type === 'node' ? sel.id : null,
    selectedEdgeIndex: sel?.type === 'edge' ? sel.index : null,
    pathNodes, pathEdges, timeMax,
    // Couches : natures visibles (null = toutes) — filtre appliqué par le canvas.
    visibleKinds: visibleKinds.size === availableKinds.size ? null : visibleKinds,
    // Enquête : sous-graphe mis en avant ; isolé = le canvas n'affiche que lui.
    focusSet, isolate: isolate && !!focusSet,
    // Liens colorés par nature seulement si la lecture est activée (sinon neutres).
    colorEdgesByNature: colorEdges,
    onTapNode(node: ActorGraphNode) {
      if (followFrom && node.id !== followFrom) { setPath(shortestPath(graph, followFrom, node.id)); setFollowFrom(null); setSel({ type: 'node', id: node.id }); return }
      setPath(null); setSel({ type: 'node', id: node.id })
    },
    onTapEdge(index: number) { setPath(null); setFollowFrom(null); setSel({ type: 'edge', index }) },
    onTapVoid() { setSel(focusId ? { type: 'node', id: focusId } : null); clearPath() },
  }

  return {
    selNode, selEdge, followFrom, pathSteps, narration, relations, nodeById, timeline, control,
    setTimeMax, selectNode, selectEdge, startFollow, clearPath,
    availableKinds, visibleKinds, perspective, applyPerspective, toggleKind,
    query, setQuery, matches, focusNode, centerRequest,
    lens, setLens, isolate, setIsolate,
    colorEdges, setColorEdges,
    nodeContext, nodeRelations,
  }
}

/** Panneau d'inspection PARTAGÉ : chemin raconté > nœud > lien > état vide. */
export function ExplorerAside({ ex, compact, focusId, onActivateActor, emptyState }: {
  ex: ReturnType<typeof useGraphExplorer>
  compact?: boolean
  focusId?: string | null
  /** Fusion dans une fiche : recharge la fiche EN PLACE sur un autre acteur. */
  onActivateActor?: (node: ActorGraphNode) => void
  emptyState?: React.ReactNode
}) {
  const { pathSteps, selNode, selEdge, narration, relations, nodeById, nodeContext, nodeRelations, selectNode, selectEdge, startFollow, clearPath } = ex
  if (pathSteps) return <PathPanel steps={pathSteps} onQuit={clearPath} onSelectNode={selectNode} />
  if (selNode) return (
    <NodePanel
      node={selNode}
      narration={narration}
      relations={relations}
      context={nodeContext}
      relationsView={nodeRelations}
      compact={compact}
      onFollow={() => startFollow(selNode.id)}
      onSelectNode={selectNode}
      onSelectEdge={selectEdge}
      onActivateActor={onActivateActor && selNode.id !== focusId ? onActivateActor : undefined}
    />
  )
  if (selEdge) return (
    <EdgePanel
      a={nodeById.get(selEdge.a)!}
      b={nodeById.get(selEdge.b)!}
      label={selEdge.label}
      since={selEdge.since}
      source={REL_SOURCE_LABEL[selEdge.rel]}
      onSelectNode={selectNode}
    />
  )
  return <>{emptyState ?? null}</>
}
