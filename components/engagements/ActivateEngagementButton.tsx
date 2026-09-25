'use client'

// P0-3.2 (mandat Vincent 2026-09-25) — mettre en vigueur un Engagement Porte B
// curated. Petit composant client dédié, séparé de PlannedEngagementCard (qui
// reste une fonction pure sans hook) : seule cette pastille devient client,
// comme RemoveButton pour le retrait.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { activatePlannedEngagementAction } from '@/app/(dashboard)/sites/[id]/prestations/actions'

export function ActivateEngagementButton({ engagementId }: { engagementId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function confirm() {
    setError(null)
    start(async () => {
      const res = await activatePlannedEngagementAction({ engagement_id: engagementId })
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success('Engagement en vigueur')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null) }}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5" /> Mettre en vigueur
      </Button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mettre cet engagement en vigueur ?</DialogTitle>
          <DialogDescription>
            Il deviendra applicable sur ce chantier et pourra ensuite être utilisé pour la planification.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-[12px] text-rose-600">{error}</p>}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Annuler</DialogClose>
          <Button onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Mettre en vigueur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
