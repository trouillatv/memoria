'use client'

// ── EXPLORER DES ACTEURS — VUE D'ENSEMBLE ────────────────────────────────────
// Les 5 LECTURES sont le premier niveau de navigation (pas de notion « structurel »
// exposée) : Organigramme / Chantiers / Travail = graphe structurel (layout propre
// à chacune) ; Collaboration / Écosystème = graphe pondéré. Chaque lecture répond à
// UNE question métier et a son propre placement.

import { useState } from 'react'
import { Route } from 'lucide-react'
import { type ActorsGraph, type ActorPerspective } from '@/lib/knowledge/actors-graph-model'
import type { CollaborationGraphView } from '@/lib/knowledge/collaboration-graph'
import { structuralGraphSummary, collaborationGraphSummary, collaborationGraphNarrative } from '@/lib/knowledge/graph-summary'
import { ActorsGraphCanvas } from './ActorsGraphCanvas'
import { GraphControls } from './GraphControls'
import { GraphSearch } from './GraphSearch'
import { GraphTimeline } from './GraphTimeline'
import { CollaborationExplorer } from './CollaborationExplorer'
import { EcosystemExplorer } from './EcosystemExplorer'
import { useGraphExplorer, ExplorerAside } from './useGraphExplorer'

type Reading = 'org' | 'sites' | 'work' | 'collaboration' | 'ecosystem'
const READINGS: ReadonlyArray<{ id: Reading; label: string; question: string; structural: boolean }> = [
  { id: 'org', label: 'Organigramme', question: 'Qui appartient à quoi ?', structural: true },
  { id: 'sites', label: 'Chantiers', question: 'Qui intervient où ?', structural: true },
  { id: 'work', label: 'Travail', question: 'Qui porte quoi ?', structural: true },
  { id: 'collaboration', label: 'Collaboration', question: 'Qui travaille avec qui ?', structural: false },
  { id: 'ecosystem', label: 'Écosystème', question: 'Comment est organisé mon réseau ?', structural: false },
]

export function ActorsExplorer({ graph, focusId, collabGraph }: { graph: ActorsGraph; focusId?: string | null; collabGraph?: CollaborationGraphView | null }) {
  const ex = useGraphExplorer(graph, focusId, 'org')
  const [reading, setReading] = useState<Reading>('org')

  const select = (r: Reading) => {
    setReading(r)
    const def = READINGS.find((x) => x.id === r)!
    if (def.structural) ex.applyPerspective(r as ActorPerspective) // pilote les couches
  }

  const active = READINGS.find((r) => r.id === reading)!
  const collabReady = !!collabGraph && collabGraph.nodes.length > 0
  const companyCount = graph.nodes.filter((n) => n.kind === 'company').length
  const summary = active.structural
    ? structuralGraphSummary(graph, ex.visibleKinds)
    : reading === 'ecosystem'
      ? `${companyCount} entreprise${companyCount > 1 ? 's' : ''} — dépliez pour explorer votre réseau`
      : collabReady ? (collaborationGraphNarrative(collabGraph!) || collaborationGraphSummary(collabGraph!)) : ''

  return (
    <div className="space-y-3">
      {/* Les LECTURES = navigation de premier niveau (chacune sa question, son layout). */}
      <div className="inline-flex flex-wrap self-start rounded-lg border border-border/60 bg-muted/40 p-0.5">
        {READINGS.map((r) => (
          <button key={r.id} type="button" onClick={() => select(r.id)} title={r.question}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${reading === r.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {r.label}
          </button>
        ))}
      </div>

      {/* TITRE VIVANT : la question + les compteurs (le graphe raconte avant lecture). */}
      <p className="text-[13.5px]">
        <span className="font-semibold text-foreground">{active.label}</span>
        <span className="text-muted-foreground"> · {active.question}</span>
        {summary ? <span className="text-muted-foreground"> — {summary}</span> : null}
      </p>

      {reading === 'ecosystem' ? (
        <EcosystemExplorer graph={graph} />
      ) : !active.structural ? (
        collabReady
          ? <CollaborationExplorer data={collabGraph!} mode="collaboration" />
          : <div className="rounded-2xl border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground italic">Aucune collaboration structurelle à représenter pour le moment.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <GraphControls
                availableKinds={ex.availableKinds}
                visibleKinds={ex.visibleKinds}
                perspective={ex.perspective}
                onPerspective={ex.applyPerspective}
                onToggleKind={ex.toggleKind}
                hideReadings
                focusLabel={ex.selNode?.label ?? null}
                lens={ex.lens}
                onLens={ex.setLens}
                isolate={ex.isolate}
                onIsolate={ex.setIsolate}
                colorEdges={ex.colorEdges}
                onColorEdges={ex.setColorEdges}
              />
              <GraphSearch query={ex.query} onQuery={ex.setQuery} matches={ex.matches} onPick={ex.focusNode} />
            </div>
            <div className="relative">
              <ActorsGraphCanvas graph={graph} focusId={focusId} control={ex.control} centerRequest={ex.centerRequest} heightClass="h-[70vh]" layout={reading === 'org' ? 'hierarchical' : reading === 'sites' ? 'radial' : reading === 'work' ? 'layered' : 'force'} />
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
      )}
    </div>
  )
}
