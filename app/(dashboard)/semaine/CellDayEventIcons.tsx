'use client'

// Niveau 2 (Vincent 2026-06-24) — icônes d'événements DATÉS dans une cellule
// (jour × site) de la grille semaine : réunion, échéance, livraison.
//
// Volontairement minimal : « sans texte, sans clic, sans drawer ». De simples
// indicateurs. Le détail au survol viendra au Niveau 3.
//
// Anti-sapin de Noël : 3 icônes max + « +N » d'overflow, ordre de priorité fixe
// (réunion > échéance > livraison) pour une lecture instantanée.
//
// `pointer-events-none` impératif : la cellule (`<td>`) est à la fois drag-source
// ET drop-target (dnd-kit). Cette couche purement décorative laisse passer tous
// les événements pointeur vers le `<td>` → le drag existant n'est jamais effleuré.

import { CalendarClock, Clock, Package } from 'lucide-react'
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

  return (
    <div
      className="pointer-events-none absolute bottom-1 right-1 flex items-center gap-0.5 text-muted-foreground/70"
      aria-label={summarize(events)}
    >
      {shown.map((e) => {
        const Icon = KIND_ICON[e.kind as WeekDayKind]
        return Icon ? <Icon key={e.id} aria-hidden className="h-3 w-3" /> : null
      })}
      {extra > 0 && <span className="text-[9px] font-medium leading-none">+{extra}</span>}
    </div>
  )
}
