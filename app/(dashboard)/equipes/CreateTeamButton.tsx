'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
//
// Bouton "+ Nouvelle équipe" + dialog avec form de création.
// Champs : nom (text, requis, max 50) + couleur (radio chips, optionnelle).

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
import { TeamBadge, TEAM_BADGE_COLORS, type TeamBadgeColor } from '@/components/ui/team-badge'
import { createTeamAction } from './actions'

export function CreateTeamButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<TeamBadgeColor | null>(null)
  const [pending, startTransition] = useTransition()

  const trimmed = name.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= 50

  function reset() {
    setName('')
    setColor(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    startTransition(async () => {
      const result = await createTeamAction({
        name: trimmed,
        color: color ?? null,
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

        <form onSubmit={handleSubmit} className="space-y-4">
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
              Court et reconnaissable. Ex&nbsp;: « Alpha », « Beta », « Centre-ville ».
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Couleur (facultatif)</Label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Couleur de l’équipe">
              <button
                type="button"
                role="radio"
                aria-checked={color === null}
                data-testid="team-color-none"
                onClick={() => setColor(null)}
                className={
                  'rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors ' +
                  (color === null ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/50')
                }
              >
                Aucune
              </button>
              {TEAM_BADGE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  data-testid={`team-color-${c}`}
                  onClick={() => setColor(c as TeamBadgeColor)}
                  className={
                    'rounded-full border p-0.5 transition-all ' +
                    (color === c ? 'border-foreground ring-2 ring-foreground/20' : 'border-transparent hover:border-border')
                  }
                  aria-label={`Couleur ${c}`}
                >
                  <TeamBadge name={c.charAt(0).toUpperCase() + c.slice(1)} color={c} size="sm" />
                </button>
              ))}
            </div>
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
