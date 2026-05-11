// Slice B.1 — Liste sobre des étapes réalisées.
//
// Doctrine : on raconte un fait factuel par ligne. Cochée = ✓ vert sapin
// sobre ; non cochée = cercle gris. Heure de complétion sur la même ligne si
// disponible. Pas de jugement, pas de % de complétion en grand.

import { CheckCircle2, Circle } from 'lucide-react'
import type { ProofChecklistItem } from '@/lib/db/proofs'

export function ProofChecklist({ items }: { items: ProofChecklistItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Aucune étape enregistrée.
      </p>
    )
  }

  const doneCount = items.filter((i) => i.completed).length

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground tabular-nums">
        {doneCount} sur {items.length} étape{items.length > 1 ? 's' : ''} réalisée
        {doneCount > 1 ? 's' : ''}.
      </p>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li
            key={it.id}
            className="flex items-start gap-2 text-sm"
          >
            {it.completed ? (
              <CheckCircle2
                className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0"
                aria-hidden
              />
            ) : (
              <Circle
                className="h-4 w-4 text-muted-foreground/60 mt-0.5 shrink-0"
                aria-hidden
              />
            )}
            <div className="min-w-0 flex-1">
              <span
                className={
                  it.completed ? '' : 'text-muted-foreground'
                }
              >
                {it.label}
              </span>
              {it.completed && it.completed_at && (
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                  réalisée à {formatTime(it.completed_at)}
                </span>
              )}
              {!it.completed && it.required && (
                <span className="ml-2 text-xs text-muted-foreground italic">
                  requise
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
