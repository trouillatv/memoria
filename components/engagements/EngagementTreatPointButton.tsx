'use client'

// « Traiter un point » (mandat Vincent 2026-09-25) — assistant de création
// d'Action depuis un Engagement ACTIF. « MemorIA peut proposer d'agir ;
// l'utilisateur décide qu'une Action est nécessaire » : le premier clic
// n'écrit rien, ce n'est qu'une fois motif + description remplis et
// « Créer l'action » cliqué que le site_action + le rapprochement P0-4B +
// la qualification P0-4C sont créés. Composant client dédié, séparé de
// PlannedEngagementCard (qui reste une fonction pure sans hook), comme
// ActivateEngagementButton.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardEdit, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { QUALIFICATION_OPTIONS } from '@/lib/engagements/qualification-labels'
import { createActionFromEngagementAction } from '@/app/(dashboard)/sites/[id]/prestations/actions'
import type { EngagementLinkQualification } from '@/types/db'

export function EngagementTreatPointButton({ engagementId }: { engagementId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [qualification, setQualification] = useState<EngagementLinkQualification | ''>('')
  const [description, setDescription] = useState('')
  const [origin, setOrigin] = useState('')

  function reset() {
    setQualification('')
    setDescription('')
    setOrigin('')
    setError(null)
  }

  function confirm() {
    if (!qualification || !description.trim()) return
    setError(null)
    start(async () => {
      const res = await createActionFromEngagementAction({
        engagement_id: engagementId,
        qualification,
        description: description.trim(),
        origin: origin.trim() || null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success('Action créée')
      setOpen(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <ClipboardEdit className="h-3.5 w-3.5" /> Traiter un point
      </Button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Traiter un point sur cet engagement</DialogTitle>
          <DialogDescription>
            Une Action sera créée et rapprochée de cet engagement avec le motif choisi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <select
            value={qualification}
            onChange={(e) => setQualification(e.target.value as EngagementLinkQualification)}
            disabled={pending}
            className="w-full rounded border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— Motif —</option>
            {QUALIFICATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending}
            maxLength={2000}
            placeholder="Description du point à traiter"
            rows={3}
            className="w-full resize-none rounded border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="text"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            disabled={pending}
            maxLength={500}
            placeholder="Origine (facultatif — ex. Visite du 23/09)"
            className="w-full rounded border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {error && <p className="text-[12px] text-rose-600">{error}</p>}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Annuler</DialogClose>
          <Button onClick={confirm} disabled={pending || !qualification || !description.trim()}>
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Créer l&apos;action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
