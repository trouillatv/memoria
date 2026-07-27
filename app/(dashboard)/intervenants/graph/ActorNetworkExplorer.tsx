'use client'

// ── RÉSEAU FUSIONNÉ DANS LA FICHE (direction Vincent) ────────────────────────
// « Tout à partir du même endroit » : PAS de fenêtre Explorer intermédiaire. Le
// réseau de l'acteur est explorable DANS sa fiche : graphe + inspecteur côte à
// côte, sélection nœud/lien en place, narration, mode Suivre. Dans le maître-
// détail, « Ouvrir sa fiche ici » recharge la fiche EN PLACE (aucune navigation).

import { useMemo, useState } from 'react'
import { Route } from 'lucide-react'
import { shortestPath, REL_SOURCE_LABEL, type ActorsGraph, type ActorGraphNode } from '@/lib/knowledge/actors-graph-model'
import { narrateActorInGraph } from '@/lib/knowledge/actor-narration'
import { ActorsGraphCanvas, type SelectableKind } from './ActorsGraphCanvas'
import { NodePanel, EdgePanel } from './inspector'

type Selection = { type: 'node'; id: string } | { type: 'edge'; index: number } | null

export function ActorNetworkExplorer({ network, focusId, onSelectActor }: {
  network: ActorsGraph
  /** Le nœud de l'acteur de la fiche — sélection par défaut. */
  focusId: string
  /** Maître-détail : recharge la fiche en place. Absent (page dédiée) : l'inspecteur
   *  propose « Ouvrir la fiche complète » en lien explicite. */
  onSelectActor?: (kind: SelectableKind, id: string) => void
}) {
  const [sel, setSel] = useState<Selection>({ type: 'node', id: focusId })
  const [followFrom, setFollowFrom] = useState<string | null>(null)
  const [path, setPath] = useState<{ nodes: string[]; edgeIndexes: number[] } | null>(null)

  const nodeById = useMemo(() => new Map(network.nodes.map((n) => [n.id, n])), [network])
  const selNode = sel?.type === 'node' ? nodeById.get(sel.id) ?? null : null
  const selEdge = sel?.type === 'edge' ? network.edges[sel.index] ?? null : null

  const pathNodes = useMemo(() => (path ? new Set(path.nodes) : null), [path])
  const pathEdges = useMemo(() => (path ? new Set(path.edgeIndexes) : null), [path])

  const narration = useMemo(() => (selNode ? narrateActorInGraph(selNode.id, network) : []), [selNode, network])
  const relations = useMemo(() => {
    if (!selNode) return []
    return network.edges
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => e.a === selNode.id || e.b === selNode.id)
      .map(({ e, index }) => ({ e, index, other: nodeById.get(e.a === selNode.id ? e.b : e.a)! }))
      .filter((r) => r.other)
  }, [selNode, network, nodeById])

  const clearPath = () => { setFollowFrom(null); setPath(null) }

  const control = {
    selectedNodeId: sel?.type === 'node' ? sel.id : null,
    selectedEdgeIndex: sel?.type === 'edge' ? sel.index : null,
    pathNodes,
    pathEdges,
    onTapNode(node: ActorGraphNode) {
      if (followFrom && node.id !== followFrom) {
        setPath(shortestPath(network, followFrom, node.id))
        setFollowFrom(null)
        setSel({ type: 'node', id: node.id })
        return
      }
      setPath(null)
      setSel({ type: 'node', id: node.id })
    },
    onTapEdge(index: number) { setPath(null); setFollowFrom(null); setSel({ type: 'edge', index }) },
    onTapVoid() { setSel({ type: 'node', id: focusId }); clearPath() },
  }

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_250px]">
      <div className="relative">
        <ActorsGraphCanvas graph={network} focusId={focusId} control={control} heightClass="h-[420px]" />
        {followFrom && (
          <Banner onQuit={clearPath}>Suivre depuis {nodeById.get(followFrom)?.label} — cliquez un second acteur</Banner>
        )}
        {path && (
          <Banner onQuit={clearPath}>{path.nodes.map((id) => nodeById.get(id)?.label).join(' → ')}</Banner>
        )}
      </div>

      <aside className="rounded-xl border border-border/60 bg-muted/20 p-3.5 md:max-h-[420px] md:overflow-y-auto">
        {selNode ? (
          <NodePanel
            node={selNode}
            narration={narration}
            relations={relations}
            compact
            onFollow={() => { setPath(null); setFollowFrom(selNode.id) }}
            onSelectNode={(id) => { setPath(null); setSel({ type: 'node', id }) }}
            onSelectEdge={(index) => { setPath(null); setSel({ type: 'edge', index }) }}
            onActivateActor={onSelectActor && selNode.id !== focusId
              ? (n) => onSelectActor(n.kind as SelectableKind, n.id.slice(n.id.indexOf('_') + 1))
              : undefined}
          />
        ) : selEdge ? (
          <EdgePanel
            a={nodeById.get(selEdge.a)!}
            b={nodeById.get(selEdge.b)!}
            label={selEdge.label}
            since={selEdge.since}
            source={REL_SOURCE_LABEL[selEdge.rel]}
            onSelectNode={(id) => setSel({ type: 'node', id })}
          />
        ) : null}
      </aside>
    </div>
  )
}

function Banner({ children, onQuit }: { children: React.ReactNode; onQuit(): void }) {
  return (
    <div className="absolute left-1/2 top-2 z-10 flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3 py-1 text-[12px] shadow-md">
      <Route className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
      <b className="truncate">{children}</b>
      <button type="button" onClick={onQuit} className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Quitter</button>
    </div>
  )
}
