'use client'

// Niveau 2 + 3 (Vincent 2026-06-24) — icônes d'événements DATÉS dans une cellule
// (jour × site) de la grille semaine : réunion, échéance, livraison.
//
// Niveau 2 : de simples indicateurs. 3 icônes max + « +N » d'overflow, ordre de
// priorité fixe (réunion > échéance > livraison) pour une lecture instantanée.
// Niveau 3 : le DÉTAIL au survol (tooltip sous/au-dessus, une ligne par
// événement). Aucun clic, aucune navigation, aucun drawer.
//
// DRAG préservé : la couche passe en `pointer-events-auto` (indispensable pour
// déclencher le survol), MAIS sans `stopPropagation` — le `pointerdown` remonte
// donc au `<td>` parent et démarre le drag dnd-kit comme avant. (C'est l'inverse
// du bouton d'intervention, qui lui stoppe la propagation pour NE PAS dragger.)

import { CalendarClock, Clock, Package } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { WeekDayKind, WeekOperationalSignal } from '@/lib/week-operational-signals-helpers'

// Ordre de priorité d'affichage (le plus « à discuter » d'abord).
const KIND_PRIORITY: Record<string, number> = { meeting: 0, action_due: 1, delivery: 2 }

const KIND_ICON: Partial<Record<WeekDayKind, typeof CalendarClock>> = {
  meeting: CalendarClock,
  action_due: Clock,
  delivery: Package,
}

const KIND_NOUN: Partial<Record<WeekDayKind, string>> = {
  meeting: 'réunion',
  action_due: 'échéance',
  delivery: 'livraison',
}

const MAX_ICONS = 3

/** Libellé a11y : « 1 réunion, 1 livraison ». */
function summarize(events: WeekOperationalSignal[]): string {
  const counts = new Map<string, number>()
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
  const parts: string[] = []
  for (const kind of Object.keys(KIND_PRIORITY)) {
    const n = counts.get(kind)
    if (n) parts.push(`${n} ${KIND_NOUN[kind as WeekDayKind] ?? kind}${n > 1 ? 's' : ''}`)
  }
  return parts.join(', ')
}

export function CellDayEventIcons({ events }: { events: WeekOperationalSignal[] | undefined }) {
  if (!events || events.length === 0) return null

  const sorted = [...events].sort(
    (a, b) => (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9),
  )
  const shown = sorted.slice(0, MAX_ICONS)
  const extra = sorted.length - shown.length
  const summary = summarize(events)

  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            // pointer-events-auto pour le survol ; PAS de stopPropagation → le
            // pointerdown remonte au <td> et le drag fonctionne toujours.
            <span
              aria-label={summary}
              className="absolute bottom-1 right-1 flex cursor-default items-center gap-0.5 text-muted-foreground/70"
            />
          }
        >
          {shown.map((e) => {
            const Icon = KIND_ICON[e.kind as WeekDayKind]
            return Icon ? <Icon key={e.id} aria-hidden className="h-3 w-3" /> : null
          })}
          {extra > 0 && <span className="text-[9px] font-medium leading-none">+{extra}</span>}
        </TooltipTrigger>
        {/* side=top : au-dessus de la cellule, n'est pas masqué par la ligne
            suivante de la grille. Une ligne par événement, avec son détail. */}
        <TooltipContent side="top" align="end" className="flex-col items-start gap-1 py-2 text-left">
          <span className="font-semibold">Ce jour-là</span>
          <ul className="space-y-0.5">
            {sorted.map((e) => {
              const Icon = KIND_ICON[e.kind as WeekDayKind]
              return (
                <li key={e.id} className="flex items-center gap-1.5 opacity-90">
                  {Icon && <Icon aria-hidden className="h-3 w-3 shrink-0" />}
                  <span>
                    {e.label}
                    {e.detail && <span className="opacity-75"> — {e.detail}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
