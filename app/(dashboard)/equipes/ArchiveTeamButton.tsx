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
}

export function ArchiveTeamButton({ teamId, teamName }: Props) {
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
            Cette action désaffecte les missions planifiées de cette équipe
            mais conserve l’historique (interventions passées, preuves).
            L’équipe n’apparaîtra plus dans les listes.
          </DialogDescription>
        </DialogHeader>
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
