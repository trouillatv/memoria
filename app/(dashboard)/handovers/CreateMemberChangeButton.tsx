'use client'

// Bouton d'amorçage depuis la fiche intervenant : crée un brief member_change.
//
// Vincent 2026-05-22 — Sprint Équipes C.
//
// Permet de pré-renseigner source/target team. Si le user a plusieurs équipes
// actives, on offre un sélecteur "départ" + "arrivée" optionnel.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft, Loader2 } from 'lucide-react'
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
import { createMemberChangeBriefAction } from './actions'

interface Props {
  subjectUserId: string
  subjectLabel: string
  /** Équipes actives du sujet (left_at IS NULL). */
  currentTeams: Array<{ id: string; name: string }>
  /** Toutes les équipes actives possibles comme cible. */
  allTeams: Array<{ id: string; name: string }>
}

export function CreateMemberChangeButton({
  subjectUserId,
  subjectLabel,
  currentTeams,
  allTeams,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sourceTeamId, setSourceTeamId] = useState<string>(
    currentTeams[0]?.id ?? '',
  )
  const [targetTeamId, setTargetTeamId] = useState<string>('')
  const [effectiveDate, setEffectiveDate] = useState<string>('')
  const [pending, startTransition] = useTransition()

  function submit() {
    startTransition(async () => {
      const r = await createMemberChangeBriefAction({
        subjectUserId,
        sourceTeamId: sourceTeamId || null,
        targetTeamId: targetTeamId || null,
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
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Préparer un passage de témoin
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Passage de témoin — {subjectLabel}</DialogTitle>
          <DialogDescription>
            Compile automatiquement la mémoire utile à transmettre : sites
            connus, consignes « À savoir », anomalies récentes, documents.
            Le brief documente <strong>les sites</strong>, jamais la personne.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="source-team">Équipe d&apos;origine (optionnel)</Label>
            <select
              id="source-team"
              value={sourceTeamId}
              onChange={(e) => setSourceTeamId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">— Toutes les équipes connues de la personne —</option>
              {currentTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Si renseignée, le brief se focalise sur les sites de cette équipe.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="target-team">Équipe de destination (optionnel)</Label>
            <select
              id="target-team"
              value={targetTeamId}
              onChange={(e) => setTargetTeamId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">— Aucune (départ sans remplacement) —</option>
              {allTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              L&apos;équipe à qui transmettre le brief.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="effective-date">Effectif à partir du (optionnel)</Label>
            <input
              id="effective-date"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Date à laquelle la personne est remplacée sur ses sites.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowRightLeft className="h-3.5 w-3.5" />
            )}
            Générer le brief
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
