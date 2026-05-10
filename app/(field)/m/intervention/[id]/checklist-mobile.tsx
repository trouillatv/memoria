'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { toggleChecklistItemMobileAction } from './actions'
import type { DbInterventionChecklistItem } from '@/types/db'

interface Props {
  interventionId: string
  items: DbInterventionChecklistItem[]
  canEdit: boolean
}

export function ChecklistMobile({ interventionId: _interventionId, items, canEdit }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // Optimistic state — local override of server state for immediate feedback
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})

  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <p className="text-base text-muted-foreground">Aucune tâche pour cette intervention.</p>
      </div>
    )
  }

  function toggle(item: DbInterventionChecklistItem) {
    if (!canEdit) return
    const currentDone = optimistic[item.id] !== undefined ? optimistic[item.id] : item.done
    const newDone = !currentDone

    // Optimistic update : flip immediately
    setOptimistic((prev) => ({ ...prev, [item.id]: newDone }))

    const fd = new FormData()
    fd.set('id', item.id)
    fd.set('done', newDone.toString())

    startTransition(async () => {
      const r = await toggleChecklistItemMobileAction(fd)
      if (r && 'error' in r && r.error) {
        // Revert
        setOptimistic((prev) => ({ ...prev, [item.id]: !newDone }))
        toast.error(r.error)
      } else {
        // Server-side state will be reflected on next router refresh
        router.refresh()
      }
    })
  }

  const doneCount = items.filter((i) => {
    const o = optimistic[i.id]
    return o !== undefined ? o : i.done
  }).length

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Tâches</h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {doneCount} / {items.length}
        </span>
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const isDone = optimistic[item.id] !== undefined ? optimistic[item.id] : item.done
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => toggle(item)}
                disabled={!canEdit || pending}
                className={`w-full flex items-start gap-3 rounded-xl border p-4 text-left active:bg-muted/40 disabled:opacity-70 ${
                  isDone ? 'bg-emerald-50/40 border-emerald-200' : 'bg-card border-border'
                }`}
                style={{ minHeight: 72 }}
              >
                <span
                  className={`shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors ${
                    isDone ? 'bg-emerald-500 border-emerald-500' : 'bg-card border-foreground/30'
                  }`}
                  aria-hidden
                >
                  {isDone && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-base ${
                      isDone ? 'line-through text-muted-foreground' : 'text-foreground'
                    }`}
                  >
                    {item.label}
                    {item.required && <span className="ml-1 text-rose-500">*</span>}
                  </div>
                  {/* Slice 3.3 ajoutera : preview photo de la tâche */}
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      {items.some((i) => i.required) && (
        <p className="text-xs text-muted-foreground italic">* Tâche obligatoire</p>
      )}
    </div>
  )
}
