'use client'

// Préparer une passation DEPUIS le chantier qu'elle transmet.
//
// Le chantier est déjà connu : on ne demande que ce qui manque — à qui, et à
// partir de quand. Le brief compilé est celui de /handovers (kind
// `team_takes_site`), pas une copie locale : une passation reste un objet
// unique, ouvrable depuis le chantier ou depuis Passages de témoin.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'
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
import { createTeamTakesSiteBriefAction } from '@/app/(dashboard)/handovers/actions'

export function PrepareSitePassationButton({
  siteId,
  siteName,
  teams,
}: {
  siteId: string
  siteName: string
  teams: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [teamId, setTeamId] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const r = await createTeamTakesSiteBriefAction({
        targetTeamId: teamId,
        siteId,
        effectiveDate: effectiveDate || null,
      })
      if (r.ok && r.briefId) {
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
          <Button size="sm">
            <Send className="h-3.5 w-3.5" />
            Préparer une passation
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transmettre {siteName}</DialogTitle>
          <DialogDescription>
            MemorIA rassemble ce qu&apos;il faut savoir pour reprendre ce chantier
            sans repartir de zéro : ce qui reste à faire, les réserves ouvertes,
            les décisions à connaître, les documents essentiels, les équipes qui
            le connaissent déjà et ce qu&apos;il faut savoir du lieu. Vous relisez
            et complétez avant de partager.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="passation-team">À quelle équipe ?</Label>
          <select
            id="passation-team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">— Choisir une équipe —</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          {teams.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              Aucune équipe enregistrée : créez-en une avant de transmettre le chantier.
            </p>
          )}
        </div>

        <div className="mt-3 space-y-2">
          <Label htmlFor="passation-date">
            À partir du <span className="text-destructive">*</span>
          </Label>
          <input
            id="passation-date"
            type="date"
            required
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Date à laquelle l&apos;équipe reprend le chantier.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={pending || !teamId || !effectiveDate}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Préparer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
