'use client'

// Sprint Équipes (Vincent 2026-05-21, migration 077) — Édition de l'apparence
// (couleur + icône + nom) d'une équipe existante.
//
// Le rename était déjà accessible via updateTeamAction côté server ; ce dialog
// l'expose désormais à l'UI avec les nouveaux pickers.
//
// Distinct de l'archivage et de la composition membres : on garde des dialogs
// séparés et focalisés (un seul concept par modale).

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Palette } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TeamBadge } from '@/components/ui/team-badge'
import { TeamColorPicker } from '@/components/ui/team-color-picker'
import { TeamIconPicker, type TeamIconName } from '@/components/ui/team-icon-picker'
import { updateTeamAction } from './actions'

interface Props {
  teamId: string
  initialName: string
  initialColor: string | null
  initialIcon: string | null
}

export function EditTeamAppearanceButton({
  teamId,
  initialName,
  initialColor,
  initialIcon,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState<string | null>(initialColor)
  const [icon, setIcon] = useState<TeamIconName | null>(
    (initialIcon as TeamIconName | null) ?? null,
  )
  const [pending, startTransition] = useTransition()

  // Resync quand on rouvre la modale (le state aurait pu drift si page server
  // refresh entre 2 ouvertures)
  useEffect(() => {
    if (open) {
      setName(initialName)
      setColor(initialColor)
      setIcon((initialIcon as TeamIconName | null) ?? null)
    }
  }, [open, initialName, initialColor, initialIcon])

  const trimmed = name.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= 50
  const dirty =
    trimmed !== initialName.trim() ||
    color !== initialColor ||
    icon !== ((initialIcon as TeamIconName | null) ?? null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || !dirty) return
    startTransition(async () => {
      const result = await updateTeamAction({
        teamId,
        name: trimmed !== initialName.trim() ? trimmed : undefined,
        color: color !== initialColor ? color : undefined,
        icon: icon !== ((initialIcon as TeamIconName | null) ?? null) ? icon : undefined,
      })
      if (result.ok) {
        toast.success('Équipe mise à jour')
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.error ?? 'Erreur')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            data-testid={`edit-team-appearance-${teamId}`}
            title="Modifier l'apparence (nom, couleur, icône)"
          >
            <Palette className="h-4 w-4" />
            <span className="sr-only">Modifier l'apparence</span>
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apparence de l'équipe</DialogTitle>
          <DialogDescription>
            Identité visuelle (nom, couleur, icône). Aucune dimension analytique
            — juste un repère pour lire le planning d'un coup d'œil.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor={`team-name-${teamId}`}>Nom</Label>
            <Input
              id={`team-name-${teamId}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Aperçu</Label>
            <div className="rounded-md border bg-muted/30 px-3 py-3 flex items-center gap-3 flex-wrap">
              <TeamBadge name={trimmed || 'Aperçu'} color={color} icon={icon} size="md" variant="colored" />
              <span className="text-muted-foreground text-xs">·</span>
              <TeamBadge name={trimmed || 'Aperçu'} color={color} icon={icon} size="md" variant="dot" />
              <span className="text-muted-foreground text-xs">·</span>
              <TeamBadge name={trimmed || 'Aperçu'} color={color} icon={icon} size="md" variant="mono" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Couleur</Label>
            <TeamColorPicker value={color} onChange={setColor} />
          </div>

          <div className="space-y-1.5">
            <Label>Icône</Label>
            <TeamIconPicker value={icon} onChange={setIcon} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" disabled={!valid || !dirty || pending}>
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
