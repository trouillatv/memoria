'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
// Sprint Équipes (Vincent 2026-05-21, migration 077) — identité visuelle étendue :
//   - Color picker libre (12 swatches + hex)
//   - Icon picker (18 pictogrammes lucide)
//   - Aperçu live via TeamBadge
//
// Doctrine V2 : conteneur logistique. La couleur et l'icône restent un repère
// visuel utilisateur, jamais sémantique.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
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
import { createTeamAction } from './actions'

export function CreateTeamButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string | null>(null)
  const [icon, setIcon] = useState<TeamIconName | null>(null)
  const [pending, startTransition] = useTransition()

  const trimmed = name.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= 50

  function reset() {
    setName('')
    setColor(null)
    setIcon(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    startTransition(async () => {
      const result = await createTeamAction({
        name: trimmed,
        color,
        icon,
      })
      if (result.ok) {
        toast.success('Équipe créée')
        reset()
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.error ?? 'Erreur création équipe')
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button data-testid="create-team-trigger">
            <Plus />
            Nouvelle équipe
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle équipe</DialogTitle>
          <DialogDescription>
            Un conteneur logistique pour organiser la couverture des missions.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Nom de l’équipe</Label>
            <Input
              id="team-name"
              data-testid="team-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alpha"
              maxLength={50}
              autoFocus
              required
            />
            <p className="text-xs text-muted-foreground">
              Court et reconnaissable. Ex&nbsp;: « Alpha », « Centre-ville », « Magenta ».
            </p>
          </div>

          {/* Aperçu live */}
          <div className="space-y-1.5">
            <Label>Aperçu</Label>
            <div className="rounded-md border bg-muted/30 px-3 py-3 flex items-center gap-3">
              <TeamBadge
                name={trimmed || 'Aperçu'}
                color={color}
                icon={icon}
                size="md"
                variant="colored"
              />
              <span className="text-muted-foreground text-xs">·</span>
              <TeamBadge
                name={trimmed || 'Aperçu'}
                color={color}
                icon={icon}
                size="md"
                variant="dot"
              />
              <span className="text-muted-foreground text-xs">·</span>
              <TeamBadge
                name={trimmed || 'Aperçu'}
                color={color}
                icon={icon}
                size="md"
                variant="mono"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Trois rendus selon le contexte&nbsp;: chip colorée · point compact · monochrome (N&B / contraste).
            </p>
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              data-testid="create-team-submit"
              disabled={!valid || pending}
            >
              {pending ? 'Création…' : 'Créer l’équipe'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
