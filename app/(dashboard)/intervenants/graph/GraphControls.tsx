'use client'

// ── CHANGER LA LECTURE + COUCHES ─────────────────────────────────────────────
// Le graphe ne montre pas tout à la fois : on choisit une LECTURE, qui répond à
// UNE question métier et n'affiche que les natures utiles (comme changer de couche
// sur une carte). La question active est affichée à l'écran (plus de légende
// passive à déchiffrer). Les COUCHES sont l'outil : chaque case masque/affiche une
// nature à la main (Figma/Miro). N'affiche que les natures réellement présentes.

import { Check, Search, Layers } from 'lucide-react'
import { PERSPECTIVES, ENQUETE_LENSES, KIND_LAYER_LABEL, type ActorGraphKind, type ActorPerspective, type EnqueteLens } from '@/lib/knowledge/actors-graph-model'

const KIND_ORDER: ActorGraphKind[] = ['person', 'company', 'team', 'site', 'action']

export function GraphControls({
  availableKinds, visibleKinds, perspective, onPerspective, onToggleKind,
  focusLabel, lens, onLens, isolate, onIsolate,
  colorEdges, onColorEdges,
}: {
  availableKinds: Set<ActorGraphKind>
  visibleKinds: Set<ActorGraphKind>
  perspective: ActorPerspective
  onPerspective: (id: ActorPerspective) => void
  onToggleKind: (k: ActorGraphKind) => void
  /** MODE ENQUÊTE (Niveau 2) : présent seulement quand un acteur est sélectionné. */
  focusLabel?: string | null
  lens?: EnqueteLens
  onLens?: (l: EnqueteLens) => void
  isolate?: boolean
  onIsolate?: (v: boolean) => void
  /** Lecture optionnelle : colorer les liens par nature (désactivée par défaut). */
  colorEdges?: boolean
  onColorEdges?: (v: boolean) => void
}) {
  // Lecture inapplicable si aucune de ses natures n'existe → on la masque.
  const readings = PERSPECTIVES.filter((p) => p.kinds === null || p.kinds.some((k) => availableKinds.has(k)))
  const kinds = KIND_ORDER.filter((k) => availableKinds.has(k))
  if (kinds.length <= 1) return null // rien à filtrer
  const active = PERSPECTIVES.find((p) => p.id === perspective)

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-card/60 px-3 py-2.5">
      {/* CHANGER LA LECTURE — une question à la fois. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Lecture</span>
        <div className="inline-flex flex-wrap gap-1">
          {readings.map((p) => {
            const on = perspective === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPerspective(p.id)}
                title={p.hint}
                className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                  on ? 'border-brand-300 bg-brand-50 font-medium text-brand-700 dark:border-brand-600/50 dark:bg-brand-600/15 dark:text-brand-300' : 'border-border/60 text-muted-foreground hover:border-brand-200 hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
        {/* La question à laquelle la lecture répond — à l'écran, pas cachée. */}
        {active && <span className="text-[12px] italic text-muted-foreground">{active.hint}</span>}
      </div>

      {/* COUCHES — l'outil : chaque case masque/affiche une nature. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Couches</span>
        {kinds.map((k) => {
          const on = visibleKinds.has(k)
          return (
            <button
              key={k}
              type="button"
              onClick={() => onToggleKind(k)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition ${
                on ? 'border-border bg-muted font-medium text-foreground' : 'border-dashed border-border/50 text-muted-foreground/60'
              }`}
            >
              <span aria-hidden className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-border/70'}`}>
                {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              {KIND_LAYER_LABEL[k]}
            </button>
          )
        })}
        {/* Lecture optionnelle des liens : couleur par nature (sinon neutres). */}
        {onColorEdges && (
          <button
            type="button"
            onClick={() => onColorEdges(!colorEdges)}
            aria-pressed={!!colorEdges}
            className={`ml-1 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition ${
              colorEdges ? 'border-border bg-muted font-medium text-foreground' : 'border-dashed border-border/50 text-muted-foreground/60'
            }`}
          >
            <span aria-hidden className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border ${colorEdges ? 'border-brand-500 bg-brand-500 text-white' : 'border-border/70'}`}>
              {colorEdges && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            </span>
            Liens par nature
          </button>
        )}
      </div>

      {/* NIVEAU 2 — MODE ENQUÊTE : n'apparaît qu'avec un acteur sélectionné. */}
      {focusLabel && lens && onLens && onIsolate && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/50 pt-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-brand-700 dark:text-brand-300">Focus · {focusLabel}</span>
          <div className="inline-flex flex-wrap gap-1">
            {ENQUETE_LENSES.map((l) => {
              const on = lens === l.id
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onLens(l.id)}
                  title={l.hint}
                  className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                    on ? 'border-brand-300 bg-brand-50 font-medium text-brand-700 dark:border-brand-600/50 dark:bg-brand-600/15 dark:text-brand-300' : 'border-border/60 text-muted-foreground hover:border-brand-200 hover:text-foreground'
                  }`}
                >
                  {l.label}
                </button>
              )
            })}
          </div>
          {/* Mettre en évidence (le reste s'estompe) vs Isoler (n'afficher que lui). */}
          <div className="inline-flex overflow-hidden rounded-md border border-border/60 text-[12px]">
            <button type="button" onClick={() => onIsolate(false)} className={`inline-flex items-center gap-1 px-2 py-1 ${!isolate ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`}>
              <Search className="h-3 w-3" aria-hidden /> Évidence
            </button>
            <button type="button" onClick={() => onIsolate(true)} className={`inline-flex items-center gap-1 border-l border-border/60 px-2 py-1 ${isolate ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`}>
              <Layers className="h-3 w-3" aria-hidden /> Isoler
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
