'use client'

// Lot D — le bouton « Retirer », partagé (mission, client, et les objets à venir).
//
// Doctrine (audit/03) : UN seul verbe côté utilisateur — « Retirer ». Jamais
// « Supprimer », jamais « irréversible » (c'est faux : la mémoire reste).
// La conséquence est DITE avant le geste, et le refus explique quoi faire.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  /** Ce qu'on retire, tel que l'utilisateur le nomme (« Entretien du magasin »). */
  label: string
  /** Ce qui se passe vraiment — dit AVANT le geste. */
  consequence: string
  /** Si présent : le retrait est refusé, et ceci explique quoi faire d'abord. */
  blockedReason?: string | null
  onConfirm: () => Promise<{ ok: true } | { error: string }>
  /** Où aller après un retrait réussi (sinon : on rafraîchit sur place). */
  redirectTo?: string
}

export function RemoveButton({ label, consequence, blockedReason, onConfirm, redirectTo }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  function confirm() {
    start(async () => {
      const r = await onConfirm()
      if ('error' in r) {
        toast.error(r.error, { duration: 8000 })
        return
      }
      toast.success(`« ${label} » retiré`)
      setOpen(false)
      if (redirectTo) router.push(redirectTo)
      else router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Retirer
      </Button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retirer « {label} » ?</DialogTitle>
          <DialogDescription>{blockedReason ?? consequence}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            {blockedReason ? 'Fermer' : 'Annuler'}
          </DialogClose>
          {!blockedReason && (
            <Button onClick={confirm} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Retirer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
