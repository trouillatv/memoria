'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.4)
//
// Wrapper droppable autour d'une cellule (Site × Jour). Le composant n'a pas
// de chrome propre : il se contente d'ajouter un overlay subtil quand un
// élément est survolé, et un style "disabled" pour les cellules passées.
//
// Doctrine V2 :
//   - Drop sur date passée → bloqué silencieusement (CSS + filtre dans
//     onDragEnd côté WeekGridClient — double rempart).
//   - Animation douce 200ms, pas de spring.
//   - Pas de cellule "agent" : la cible est toujours un (site, jour).

import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'

export interface DroppableCellProps {
  /** Cell key = `${siteId}::${yyyy-mm-dd}` — sert d'id de drop. */
  cellKey: string
  /** Jour de la cellule (yyyy-mm-dd). Sert au visuel disabled si passée. */
  date: string
  /** Aujourd'hui yyyy-mm-dd UTC. */
  todayIso: string
  children: React.ReactNode
  className?: string
}

export function DroppableCell({
  cellKey,
  date,
  todayIso,
  children,
  className,
}: DroppableCellProps) {
  const isPast = date < todayIso
  const { isOver, setNodeRef } = useDroppable({
    id: cellKey,
    disabled: isPast,
    data: { date, isPast },
  })

  return (
    <div
      ref={setNodeRef}
      data-slot="droppable-cell"
      data-cell-key={cellKey}
      data-over={isOver ? 'true' : 'false'}
      data-past={isPast ? 'true' : 'false'}
      className={cn(
        'transition-colors duration-200',
        isOver && !isPast && 'bg-brand-50/60 rounded-md outline outline-2 outline-brand-200',
        className,
      )}
    >
      {children}
    </div>
  )
}
