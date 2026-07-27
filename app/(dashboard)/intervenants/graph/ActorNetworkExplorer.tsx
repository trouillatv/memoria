'use client'

// ── RÉSEAU FUSIONNÉ DANS LA FICHE (direction Vincent) ────────────────────────
// « Tout à partir du même endroit » : PAS de fenêtre Explorer intermédiaire. Le
// réseau de l'acteur est explorable DANS sa fiche : graphe + inspecteur côte à côte,
// sélection nœud/lien en place, narration, chemin raconté, chronologie. Dans le
// maître-détail, « Ouvrir sa fiche ici » recharge la fiche EN PLACE (aucune navigation).
// Même cerveau et même inspecteur que la vue d'ensemble (useGraphExplorer).

import { Route } from 'lucide-react'
import type { ActorsGraph } from '@/lib/knowledge/actors-graph-model'
import { ActorsGraphCanvas, type SelectableKind } from './ActorsGraphCanvas'
import { GraphTimeline } from './GraphTimeline'
import { useGraphExplorer, ExplorerAside } from './useGraphExplorer'

export function ActorNetworkExplorer({ network, focusId, onSelectActor }: {
  network: ActorsGraph
  /** Le nœud de l'acteur de la fiche — sélection par défaut, retour au clic dans le vide. */
  focusId: string
  /** Maître-détail : recharge la fiche en place sur un autre acteur. */
  onSelectActor?: (kind: SelectableKind, id: string) => void
}) {
  const ex = useGraphExplorer(network, focusId)

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_250px]">
      <div className="relative">
        <ActorsGraphCanvas graph={network} focusId={focusId} control={ex.control} heightClass="h-[420px]" />
        {ex.followFrom && (
          <div className="absolute left-1/2 top-2 z-10 flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3 py-1 text-[12px] shadow-md">
            <Route className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
            <b className="truncate">Suivre depuis {ex.nodeById.get(ex.followFrom)?.label} — cliquez un second acteur</b>
            <button type="button" onClick={ex.clearPath} className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Quitter</button>
          </div>
        )}
        <GraphTimeline days={ex.timeline.days} onChange={ex.setTimeMax} />
      </div>

      <aside className="rounded-xl border border-border/60 bg-muted/20 p-3.5 md:max-h-[420px] md:overflow-y-auto">
        <ExplorerAside
          ex={ex}
          compact
          focusId={focusId}
          onActivateActor={onSelectActor
            ? (node) => onSelectActor(node.kind as SelectableKind, node.id.slice(node.id.indexOf('_') + 1))
            : undefined}
        />
      </aside>
    </div>
  )
}
