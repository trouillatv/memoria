'use client'

// Bouton d'amorçage depuis la fiche équipe : crée un brief team_takes_site.
//
// Vincent 2026-05-22 — Sprint Équipes C. La modale propose un sélecteur de
// site (tous les sites actifs disponibles, ou recherche par nom).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Loader2 } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { createTeamTakesSiteBriefAction } from './actions'

interface Props {
  teamId: string
  teamName: string
  availableSites: Array<{ id: string; name: string; client_name: string | null }>
}

export function CreateTeamTakesSiteButton({
  teamId,
  teamName,
  availableSites,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [siteId, setSiteId] = useState<string>('')
  const [effectiveDate, setEffectiveDate] = useState<string>('')
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!siteId) {
      toast.error('Choisis un site')
      return
    }
    startTransition(async () => {
      const r = await createTeamTakesSiteBriefAction({
        targetTeamId: teamId,
        siteId,
        effectiveDate: effectiveDate || null,
      })
      if (r.ok && r.briefId) {
        toast.success('Brief généré')
        setOpen(false)
        router.push(`/handovers/${r.briefId}`)
      } else {
        toast.error(r.error ?? 'Erreur')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Building2 className="h-3.5 w-3.5" />
            Brief pour une prise de site
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Prise de site — {teamName}</DialogTitle>
          <DialogDescription>
            L&apos;équipe va prendre en charge un nouveau site. MemorIA compile
            la mémoire accumulée par les équipes qui l&apos;ont couvert avant :
            à savoir, anomalies, documents, contacts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="site">Site concerné</Label>
          <select
            id="site"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">— Choisir un site —</option>
            {availableSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.client_name && ` — ${s.client_name}`}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            {availableSites.length} site{availableSites.length > 1 ? 's' : ''} disponible{availableSites.length > 1 ? 's' : ''}.
          </p>
        </div>

        <div className="space-y-2 mt-3">
          <Label htmlFor="tts-effective-date">Effectif à partir du <span className="text-destructive">*</span></Label>
          <input
            id="tts-effective-date"
            type="date"
            required
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Date à laquelle l&apos;équipe prend effectivement le site — obligatoire.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={pending || !siteId || !effectiveDate}>
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Building2 className="h-3.5 w-3.5" />
            )}
            Générer le brief
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
