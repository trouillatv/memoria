'use client'

// Phase 6 — Recurrence simple — Slice 6.5
//
// Bouton "Archiver" sobre + mini-popover de confirmation. Soft-delete uniquement.
// Doctrine UX :
//   - Wording "Archiver" (jamais "Supprimer")
//   - Confirmation explicite : les interventions deja generees sont conservees
//   - Pas de hard-delete depuis l'UI

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { archiveRecurrenceAction } from '../../../recurrences-actions'

interface ArchiveRecurrenceButtonProps {
  templateId: string
  contractId: string
}

export function ArchiveRecurrenceButton({
  templateId,
  contractId,
}: ArchiveRecurrenceButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  function confirm() {
    startTransition(async () => {
      const r = await archiveRecurrenceAction({ templateId, contract_id: contractId })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Récurrence archivée')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        data-testid="archive-recurrence-trigger"
        className="text-xs px-2 py-1 rounded border bg-background hover:bg-muted/50 text-muted-foreground"
      >
        Archiver
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-recurrence-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false)
          }}
        >
          <div className="bg-card border rounded-lg shadow-lg w-full max-w-sm p-5 space-y-3">
            <h2 id="archive-recurrence-title" className="text-base font-semibold">
              Archiver cette récurrence ?
            </h2>
            <p className="text-sm text-muted-foreground">
              Les interventions déjà générées sont conservées. Plus aucune nouvelle ne sera générée.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                data-testid="archive-recurrence-confirm"
                className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
              >
                {pending ? 'Archivage…' : 'Archiver'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
