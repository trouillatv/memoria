'use client'

// ── PERSPECTIVES & COUCHES ───────────────────────────────────────────────────
// Deux réglages de LECTURE du même graphe (on change la manière de lire, pas les
// données) :
//   · Perspectives — présets qui mettent en avant un jeu de natures (Collaboration,
//     Chantiers, Charge) pour répondre à une question précise ;
//   · Couches — afficher/masquer chaque nature à la main, pour éviter l'effet
//     « pelote ». Toucher une couche sort de la perspective nommée.
// N'affiche que les natures RÉELLEMENT présentes dans le graphe.

import { PERSPECTIVES, KIND_LAYER_LABEL, type ActorGraphKind, type ActorPerspective } from '@/lib/knowledge/actors-graph-model'

const KIND_ORDER: ActorGraphKind[] = ['person', 'company', 'team', 'site', 'action']

export function GraphControls({ availableKinds, visibleKinds, perspective, onPerspective, onToggleKind }: {
  availableKinds: Set<ActorGraphKind>
  visibleKinds: Set<ActorGraphKind>
  perspective: ActorPerspective
  onPerspective: (id: ActorPerspective) => void
  onToggleKind: (k: ActorGraphKind) => void
}) {
  // Perspective inapplicable si aucune de ses natures n'existe → on la masque.
  const perspectives = PERSPECTIVES.filter((p) => p.kinds === null || p.kinds.some((k) => availableKinds.has(k)))
  const kinds = KIND_ORDER.filter((k) => availableKinds.has(k))
  if (kinds.length <= 1) return null // rien à filtrer

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-card/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Perspective</span>
        {perspectives.map((p) => {
          const active = perspective === p.id
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPerspective(p.id)}
              title={p.hint}
              className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                active ? 'border-brand-300 bg-brand-50 font-medium text-brand-700 dark:border-brand-600/50 dark:bg-brand-600/15 dark:text-brand-300' : 'border-border/60 text-muted-foreground hover:border-brand-200 hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Couches</span>
        {kinds.map((k) => {
          const on = visibleKinds.has(k)
          return (
            <button
              key={k}
              type="button"
              onClick={() => onToggleKind(k)}
              aria-pressed={on}
              className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                on ? 'border-border bg-muted font-medium text-foreground' : 'border-dashed border-border/50 text-muted-foreground/60 line-through'
              }`}
            >
              {KIND_LAYER_LABEL[k]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
