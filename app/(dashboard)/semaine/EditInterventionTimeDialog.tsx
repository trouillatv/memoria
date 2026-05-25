'use client'

// V6.1 (Vincent 2026-05-20) — Édition de l'heure précise d'une intervention.
//
// Accessible depuis la vue semaine (drawer) ou la fiche détail. Permet à un
// manager de saisir / corriger / retirer planned_start et planned_end sans
// changer la date ni le slot.
//
// Doctrine V6.1 : ancrage de prestation (site/contrat), JAMAIS pointage de
// personne. L'utilisateur saisit l'heure d'une PRESTATION, pas l'horaire
// d'un agent.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Clock } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { updateInterventionTimeAction } from './actions'

interface Props {
  interventionId: string
  /** HH:MM existant, ou '' si pas de saisie précise actuellement. */
  initialStartHHMM: string
  initialEndHHMM: string
  /** YYYY-MM-DD : jour actuel de l'intervention (replanifiable ici). */
  initialDate: string
  /** Libellé court (« Bionettoyage sanitaires · 06h30 – 08h00 ») pour le titre du dialog. */
  label?: string
  trigger?: React.ReactNode
}

export function EditInterventionTimeDialog({
  interventionId,
  initialStartHHMM,
  initialEndHHMM,
  initialDate,
  label,
  trigger,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [date, setDate] = useState(initialDate)
  const [start, setStart] = useState(initialStartHHMM)
  const [end, setEnd] = useState(initialEndHHMM)

  const canSubmit = !pending && /^\d{4}-\d{2}-\d{2}$/.test(date) && (
    // Saisie cohérente : soit start vide (= retirer), soit start non vide.
    start === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(start)
  )

  function submit() {
    if (!canSubmit) return
    startTransition(async () => {
      const r = await updateInterventionTimeAction({
        interventionId,
        plannedStartHHMM: start === '' ? null : start,
        plannedEndHHMM:   end === '' ? null : end,
        newScheduledFor:  date !== initialDate ? date : undefined,
      })
      if (!r.ok) {
        toast.error(r.error ?? 'Erreur inconnue')
        return
      }
      toast.success(
        date !== initialDate
          ? 'Jour et horaire mis à jour'
          : start === '' ? 'Heure précise retirée — retour à l’horaire d’ancrage' : 'Horaire mis à jour',
      )
      setOpen(false)
      router.refresh()
    })
  }

  function clear() {
    setStart('')
    setEnd('')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          (trigger as React.ReactElement | undefined) ?? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              <Clock className="h-3 w-3" />
              Modifier heure
            </button>
          )
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Replanifier la prestation</DialogTitle>
          <DialogDescription>
            {label ? `${label} · ` : ''}
            Jour et heure (l'heure reste optionnelle — laisse vide pour l'horaire d'ancrage par défaut).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="edit-day" className="text-xs text-muted-foreground">
              Jour
            </label>
            <input
              id="edit-day"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="edit-start" className="text-xs text-muted-foreground">
                Début
              </label>
              <input
                id="edit-start"
                type="time"
                step={300}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                disabled={pending}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="edit-end" className="text-xs text-muted-foreground">
                Fin
              </label>
              <input
                id="edit-end"
                type="time"
                step={300}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                disabled={pending || !start}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
              />
            </div>
          </div>
          {start && (
            <button
              type="button"
              onClick={clear}
              disabled={pending}
              className="text-xs text-muted-foreground hover:text-destructive underline-offset-2 hover:underline"
            >
              Retirer l'heure précise (retour à l'horaire d'ancrage)
            </button>
          )}
          <p className="text-[11px] text-muted-foreground/70">
            Change le jour ci-dessus, ou par drag-and-drop dans la grille.
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            Annuler
          </DialogClose>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
