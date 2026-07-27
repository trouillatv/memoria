'use client'

// ── EXPLORER DES ACTEURS — VUE D'ENSEMBLE DE L'ORG (toggle Graphe) ───────────
// Le graphe global (filtré par pertinence) : qui agit, avec qui, où, QUAND. État et
// inspecteur PARTAGÉS avec le réseau fusionné des fiches. AUCUNE navigation au clic.

import { Route } from 'lucide-react'
import { DEFAULT_PERSPECTIVE, type ActorsGraph } from '@/lib/knowledge/actors-graph-model'
import { ActorsGraphCanvas } from './ActorsGraphCanvas'
import { GraphControls } from './GraphControls'
import { GraphSearch } from './GraphSearch'
import { GraphTimeline } from './GraphTimeline'
import { useGraphExplorer, ExplorerAside } from './useGraphExplorer'

export function ActorsExplorer({ graph, focusId }: { graph: ActorsGraph; focusId?: string | null }) {
  // La vue d'ensemble s'ouvre sur UNE lecture (Chantiers) — pas « tout à la fois ».
  const ex = useGraphExplorer(graph, focusId, DEFAULT_PERSPECTIVE)

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <GraphControls
            availableKinds={ex.availableKinds}
            visibleKinds={ex.visibleKinds}
            perspective={ex.perspective}
            onPerspective={ex.applyPerspective}
            onToggleKind={ex.toggleKind}
          />
          <GraphSearch query={ex.query} onQuery={ex.setQuery} matches={ex.matches} onPick={ex.focusNode} />
        </div>
        <div className="relative">
        <ActorsGraphCanvas graph={graph} focusId={focusId} control={ex.control} centerRequest={ex.centerRequest} heightClass="h-[70vh]" />
        {ex.followFrom && (
          <div className="absolute left-1/2 top-2 z-10 flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-[12.5px] shadow-md">
            <Route className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
            <b className="truncate">Suivre depuis {ex.nodeById.get(ex.followFrom)?.label} — cliquez un second acteur</b>
            <button type="button" onClick={ex.clearPath} className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[12px] text-muted-foreground">Quitter</button>
          </div>
        )}
        <GraphTimeline days={ex.timeline.days} onChange={ex.setTimeMax} />
        </div>
      </div>

      {/* ── PANNEAU : le graphe repère, le panneau explique. ── */}
      <aside className="rounded-2xl border bg-card p-5 shadow-sm lg:max-h-[70vh] lg:overflow-y-auto">
        <ExplorerAside
          ex={ex}
          focusId={focusId}
          emptyState={
            <p className="text-[13px] text-muted-foreground">
              Cliquez un acteur pour l’inspecter, un lien pour comprendre la relation. {graph.nodes.length} acteurs · {graph.edges.length} relations.
            </p>
          }
        />
      </aside>
    </div>
  )
}
