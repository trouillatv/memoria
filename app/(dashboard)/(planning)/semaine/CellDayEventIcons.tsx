'use client'

// Niveau 2 + 3 (Vincent 2026-06-24) — indicateurs d'événements DATÉS dans une
// cellule (jour × site) de la grille semaine : visite, réunion, échéance, livraison.
//
// Niveau 2 : badges lisibles pour visite/réunion (type + heure Noumea depuis
// `detail`) ; icône discrète pour action_due/delivery. 2 badges max + « +N ».
// Niveau 3 : tooltip au survol (une ligne par événement).
//
// DRAG préservé : pointer-events-auto SANS stopPropagation.

import { Users, CalendarClock, Package, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { WeekDayKind, WeekOperationalSignal } from '@/lib/week-operational-signals-helpers'

const KIND_PRIORITY: Record<string, number> = { meeting: 0, visit: 1, action_due: 2, delivery: 3 }

const KIND_ICON: Partial<Record<WeekDayKind, typeof CalendarClock>> = {
  meeting: Users,
  visit: Calendar,
  action_due: CalendarClock,
  delivery: Package,
}

const KIND_NOUN: Partial<Record<WeekDayKind, string>> = {
  meeting: 'réunion',
  visit: 'visite',
  action_due: 'échéance',
  delivery: 'livraison',
}

// Visites et réunions planifiées = badges colorés lisibles (type + heure).
// Signaux opérationnels = icône discrète (pas d'heure connue).
const KIND_BADGE_COLOR: Partial<Record<WeekDayKind, string>> = {
  visit: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  meeting: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300',
}

const MAX_SHOWN = 2

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
  const shown = sorted.slice(0, MAX_SHOWN)
  const extra = sorted.length - shown.length
  const summary = summarize(events)

  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              aria-label={summary}
              className="absolute bottom-1 right-0 left-0 flex cursor-default flex-col items-end gap-0.5 px-1"
            />
          }
        >
          {shown.map((e) => {
            const Icon = KIND_ICON[e.kind as WeekDayKind]
            const badgeColor = KIND_BADGE_COLOR[e.kind as WeekDayKind]
            if (badgeColor) {
              // Badge coloré : icône + nom + heure (si disponible dans detail).
              return (
                <span
                  key={e.id}
                  className={cn(
                    'inline-flex w-full items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium leading-none',
                    badgeColor,
                  )}
                >
                  {Icon && <Icon aria-hidden className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">
                    {KIND_NOUN[e.kind as WeekDayKind] ?? e.kind}
                    {e.detail && <span className="font-normal opacity-80"> · {e.detail}</span>}
                  </span>
                </span>
              )
            }
            // Icône discrète pour signaux sans heure propre.
            return Icon ? (
              <Icon key={e.id} aria-hidden className="h-3 w-3 text-muted-foreground/70" />
            ) : null
          })}
          {extra > 0 && (
            <span className="text-[9px] font-medium leading-none text-muted-foreground/70">
              +{extra}
            </span>
          )}
        </TooltipTrigger>
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
