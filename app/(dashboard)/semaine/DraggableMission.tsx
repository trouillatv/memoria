'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.4)
//
// Wrapper draggable autour d'un élément mission affiché dans une cellule
// (utilisé depuis le drawer pour permettre le drag depuis la liste détaillée).
//
// Doctrine V2 :
//   - JAMAIS drag vers un agent individuel (on drop sur une cellule = équipe
//     ou jour, jamais sur un user)
//   - Animation drop douce (transition 200ms) gérée côté DroppableCell
//   - Pas de spring fancy / overlay temps réel
//
// Note importante : seules les interventions `planned` sont draggables. Pour
// les autres statuts (in_progress, completed, validated, skipped), on passe
// `disabled` et l'élément se comporte comme un simple bloc statique — cf.
// règle d'immuabilité de la preuve.

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DraggableMissionProps {
  /** Intervention id — sert de drag id. */
  interventionId: string
  /** Désactivé si l'intervention n'est pas `planned` (immuabilité preuve). */
  disabled?: boolean
  /** Source cell key (siteId::yyyy-mm-dd) — utile pour distinguer un drop
   *  identique (no-op silencieux). */
  sourceCellKey: string
  children: React.ReactNode
  className?: string
}

export function DraggableMission({
  interventionId,
  disabled,
  sourceCellKey,
  children,
  className,
}: DraggableMissionProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: interventionId,
    disabled,
    data: { sourceCellKey },
  })

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        // L'animation de retour à la position originelle est gérée côté
        // DnDContext via la prop `onDragEnd` (revalidatePath → re-render).
        // Ici on ne pose qu'un léger feedback de soulèvement.
      }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-slot="draggable-mission"
      data-dragging={isDragging ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      className={cn(
        'transition-transform',
        isDragging && 'opacity-60 ring-2 ring-brand-300 rounded-md',
        className,
      )}
      {...attributes}
    >
      <div className="flex items-start gap-2">
        {!disabled && (
          <button
            type="button"
            aria-label="Glisser pour replanifier"
            data-testid={`drag-handle-${interventionId}`}
            className={cn(
              'mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center',
              'rounded text-muted-foreground/60 hover:text-muted-foreground',
              'cursor-grab active:cursor-grabbing focus:outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring',
            )}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
