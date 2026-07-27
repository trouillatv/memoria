'use client'

// ── ÉTAT PARTAGÉ DE L'EXPLORATION ────────────────────────────────────────────
// Un seul cerveau pour la vue d'ensemble (ActorsExplorer) ET le réseau fusionné
// dans les fiches (ActorNetworkExplorer) : sélection nœud/lien, mode Suivre (chemin
// raconté), chronologie (le film), narration. Le canvas ne fait que dessiner et
// remonter les gestes ; toute la LECTURE vit ici.

import { useMemo, useState } from 'react'
import {
  shortestPath, graphTimeline, graphKinds, PERSPECTIVES, REL_SOURCE_LABEL,
  type ActorsGraph, type ActorGraphNode, type ActorGraphKind, type ActorPerspective,
} from '@/lib/knowledge/actors-graph-model'
import { narrateActorInGraph } from '@/lib/knowledge/actor-narration'
import { NodePanel, EdgePanel, PathPanel } from './inspector'

export type GraphSelection = { type: 'node'; id: string } | { type: 'edge'; index: number } | null

export function useGraphExplorer(graph: ActorsGraph, focusId?: string | null) {
  const [sel, setSel] = useState<GraphSelection>(focusId ? { type: 'node', id: focusId } : null)
  const [followFrom, setFollowFrom] = useState<string | null>(null)
  const [path, setPath] = useState<{ nodes: string[]; edgeIndexes: number[] } | null>(null)
  const [timeMax, setTimeMax] = useState<string | null>(null)

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const timeline = useMemo(() => graphTimeline(graph), [graph])

  // ── Perspectives & couches (changer la LECTURE, pas les données) ──
  const availableKinds = useMemo(() => graphKinds(graph), [graph])
  const [visibleKinds, setVisibleKinds] = useState<Set<ActorGraphKind>>(() => new Set(availableKinds))
  const [perspective, setPerspective] = useState<ActorPerspective>('all')
  const applyPerspective = (id: ActorPerspective) => {
    setPerspective(id)
    const def = PERSPECTIVES.find((p) => p.id === id)!
    setVisibleKinds(def.kinds === null ? new Set(availableKinds) : new Set(def.kinds.filter((k) => availableKinds.has(k))))
  }
  const toggleKind = (k: ActorGraphKind) => {
    setPerspective('all') // couche modifiée à la main → plus une perspective nommée
    setVisibleKinds((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }

  const selNode = sel?.type === 'node' ? nodeById.get(sel.id) ?? null : null
  const selEdge = sel?.type === 'edge' ? graph.edges[sel.index] ?? null : null

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
  const { pathSteps, selNode, selEdge, narration, relations, nodeById, selectNode, selectEdge, startFollow, clearPath } = ex
  if (pathSteps) return <PathPanel steps={pathSteps} onQuit={clearPath} onSelectNode={selectNode} />
  if (selNode) return (
    <NodePanel
      node={selNode}
      narration={narration}
      relations={relations}
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
