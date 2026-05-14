'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.4)
//
// Modal de réassignation d'équipe pour une intervention planifiée.
// Ouvert depuis le drawer cellule (bouton "Réassigner équipe").
//
// Doctrine V2 :
//   - Liste radio des équipes actives + option "Non-affecté" (newTeamId=null)
//   - Pas de drag d'agent ici (la modal ne touche que la team)
//   - Pas de métrique d'équipe affichée (juste nom + pastille couleur)
//   - Confirmer → server action → toast + refresh
//   - Si l'intervention n'est plus `planned` au moment de la confirmation,
//     l'action renverra une erreur (immuabilité preuve) → toast d'erreur.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { TeamBadge } from '@/components/ui/team-badge'
import { cn } from '@/lib/utils'
import { reassignInterventionTeamAction } from './actions'

export interface ReassignTeamOption {
  id: string
  name: string
  color: string | null
  /** Si l'équipe est déjà sur un AUTRE site au même créneau (date+slot) que
   *  l'intervention cible, on stocke le nom du site occupant ici. Le radio
   *  est alors désactivé côté UI — évite le clic vers une erreur server. */
  conflict?: { siteName: string } | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  interventionId: string
  interventionLabel: string
  currentTeamId: string | null
  teams: ReassignTeamOption[]
}

const UNASSIGNED_VALUE = '__unassigned__'

export function ReassignTeamDialog({
  open,
  onOpenChange,
  interventionId,
  interventionLabel,
  currentTeamId,
  teams,
}: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<string>(currentTeamId ?? UNASSIGNED_VALUE)
  const [pending, startTransition] = useTransition()

  function handleConfirm() {
    const newTeamId = selected === UNASSIGNED_VALUE ? null : selected
    startTransition(async () => {
      const result = await reassignInterventionTeamAction({
        interventionId,
        newTeamId,
      })
      if (result.ok) {
        toast.success(newTeamId === null ? 'Mission désaffectée' : 'Équipe réassignée')
        onOpenChange(false)
        router.refresh()
      } else {
        toast.error(result.error ?? 'Erreur réassignation équipe')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Réassigner l’équipe
          </DialogTitle>
          <DialogDescription>
            <span className="block truncate">{interventionLabel}</span>
            <span className="text-xs">
              Choisissez une équipe ou laissez non-affecté.
            </span>
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-1" data-testid="reassign-team-options">
          <legend className="sr-only">Équipes disponibles</legend>

          <OptionRow
            value={UNASSIGNED_VALUE}
            selected={selected === UNASSIGNED_VALUE}
            onSelect={() => setSelected(UNASSIGNED_VALUE)}
            disabled={pending}
          >
            <span
              className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800"
              title="Aucune équipe affectée"
            >
              ◯ Non-affecté
            </span>
          </OptionRow>

          {teams.length === 0 ? (
            <p className="px-2 pt-2 text-xs italic text-muted-foreground">
              Aucune équipe active. Créez-en une depuis la page Équipes.
            </p>
          ) : (
            teams.map((t) => {
              const blocked = Boolean(t.conflict)
              return (
                <OptionRow
                  key={t.id}
                  value={t.id}
                  selected={selected === t.id}
                  onSelect={() => setSelected(t.id)}
                  disabled={pending || blocked}
                >
                  <span className="inline-flex items-center gap-2 flex-wrap min-w-0">
                    <TeamBadge name={t.name} color={t.color} size="sm" />
                    {blocked && t.conflict && (
                      <span
                        className="text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                        title="Cette équipe est déjà affectée à un autre site sur ce créneau"
                      >
                        déjà sur {t.conflict.siteName}
                      </span>
                    )}
                  </span>
                </OptionRow>
              )
            })
          )}
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Annuler
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={pending}
            data-testid="reassign-team-confirm"
          >
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OptionRow({
  value,
  selected,
  onSelect,
  disabled,
  children,
}: {
  value: string
  selected: boolean
  onSelect: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  const inputId = `reassign-team-${value}`
  return (
    <Label
      htmlFor={inputId}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors',
        selected ? 'border-brand-300 bg-brand-50/60' : 'border-transparent hover:bg-accent/40',
        disabled && 'pointer-events-none opacity-60',
      )}
    >
      <input
        id={inputId}
        type="radio"
        name="reassign-team-choice"
        value={value}
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
        className="size-4 cursor-pointer accent-brand-600"
        data-testid={`reassign-team-option-${value}`}
      />
      {children}
    </Label>
  )
}
