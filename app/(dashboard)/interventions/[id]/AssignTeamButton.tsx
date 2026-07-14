'use client'

// Bouton "Affecter / Réassigner équipe" pour la page détail intervention.
// Réutilise le ReassignTeamDialog de /semaine — même logique, même action.
// Visible uniquement si l'intervention est encore `planned` (immuabilité
// preuve : on ne change plus l'équipe après exécution).

import { useState } from 'react'
import { Users } from 'lucide-react'
import {
  ReassignTeamDialog,
  type ReassignTeamOption,
} from '@/app/(dashboard)/(planning)/semaine/ReassignTeamDialog'

interface Props {
  interventionId: string
  interventionLabel: string
  currentTeamId: string | null
  teams: ReassignTeamOption[]
  /** CT-3 (Vincent 2026-05-21) — IDs des équipes qui ont déjà fait ≥1
   *  intervention DOCUMENTÉE sur le SITE de l'intervention cible. */
  knownTeamIds?: string[]
}

export function AssignTeamButton({
  interventionId,
  interventionLabel,
  currentTeamId,
  teams,
  knownTeamIds,
}: Props) {
  const [open, setOpen] = useState(false)
  const label = currentTeamId ? 'Réassigner équipe' : 'Affecter une équipe'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border bg-card px-3 py-1.5 text-xs hover:bg-muted/50"
      >
        <Users className="h-3.5 w-3.5" aria-hidden />
        {label}
      </button>
      <ReassignTeamDialog
        open={open}
        onOpenChange={setOpen}
        interventionId={interventionId}
        interventionLabel={interventionLabel}
        currentTeamId={currentTeamId}
        teams={teams}
        knownTeamIds={knownTeamIds}
      />
    </>
  )
}
