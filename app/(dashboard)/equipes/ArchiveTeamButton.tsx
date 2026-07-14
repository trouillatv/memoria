'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
//
// Bouton "Archiver" — soft-delete d'une équipe avec confirmation explicite.
// Texte explicite sur les conséquences (désaffectation des missions planifiées).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { archiveTeamAction } from './actions'

interface Props {
  teamId: string
  teamName: string
  /**
   * Ce que l'équipe tient encore. Une cascade ne doit jamais être silencieuse :
   * ce dialogue annonçait « désaffecte les missions » et taisait le principal —
   * que TOUTES les interventions planifiées à venir passaient en « Non-affecté »,
   * et ne pouvaient plus être démarrées.
   */
  dependencies?: {
    missions: number
    futureInterventions: number
  }
}

export function ArchiveTeamButton({ teamId, teamName, dependencies }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveTeamAction({ teamId })
      if (result.ok) {
        toast.success('Équipe archivée')
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.error ?? 'Erreur archivage équipe')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            data-testid={`archive-team-trigger-${teamId}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Archive />
            Archiver
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archiver l’équipe « {teamName} » ?</DialogTitle>
          <DialogDescription>
            L’historique est conservé — interventions passées, photos, preuves.
            L’équipe n’apparaîtra plus dans les listes.
          </DialogDescription>
        </DialogHeader>

        {/* Ce qui va réellement se passer, chiffré. Le dialogue disait « désaffecte
            les missions » et taisait le principal : les interventions à venir. */}
        {dependencies && (dependencies.futureInterventions > 0 || dependencies.missions > 0) && (
          <div
            className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-800/50 dark:bg-amber-950/20"
            data-testid="archive-team-consequences"
          >
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Cette équipe travaille encore.
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-amber-800/90 dark:text-amber-300/90">
              {dependencies.futureInterventions > 0 && (
                <li>
                  <strong>
                    {dependencies.futureInterventions} intervention
                    {dependencies.futureInterventions > 1 ? 's' : ''} à venir
                  </strong>{' '}
                  passera{dependencies.futureInterventions > 1 ? 'ont' : ''} en « Non-affecté ».
                  Elles ne pourront plus être démarrées tant qu’une autre équipe ne leur aura pas
                  été attribuée.
                </li>
              )}
              {dependencies.missions > 0 && (
                <li>
                  {dependencies.missions} mission{dependencies.missions > 1 ? 's' : ''} perdra
                  {dependencies.missions > 1 ? 'ont' : ''} leur équipe par défaut.
                </li>
              )}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Annuler
          </Button>
          <Button
            variant="destructive"
            onClick={handleArchive}
            disabled={pending}
            data-testid={`archive-team-confirm-${teamId}`}
          >
            {pending ? 'Archivage…' : 'Archiver'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
