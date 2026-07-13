'use client'

// « Qui y va ? » — le sélecteur d'équipe de la mission.
//
// Avant : la colonne existait, aucun écran ne l'écrivait, et toutes les
// interventions générées naissaient « Non-affectées ». Le planning ne disait
// pas qui travaillait — donc il ne servait à rien.
//
// C'est une ÉQUIPE. Une équipe d'une personne est autorisée et se lit comme un
// nom : c'est la façon dont le produit parle des gens sans jamais les planifier
// nominativement.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { TeamBadge } from '@/components/ui/team-badge'
import { setMissionTeamAction } from './mission-actions'

const UNASSIGNED = '__unassigned__'

export interface TeamChoice {
  id: string
  name: string
  color: string | null
}

export function MissionTeamPicker({
  missionId,
  teams,
  currentTeamId,
}: {
  missionId: string
  teams: TeamChoice[]
  currentTeamId: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(currentTeamId ?? UNASSIGNED)
  const [pending, start] = useTransition()

  const current = teams.find((t) => t.id === value) ?? null

  function change(next: string) {
    const previous = value
    setValue(next)
    start(async () => {
      const r = await setMissionTeamAction({
        missionId,
        teamId: next === UNASSIGNED ? null : next,
      })
      if ('error' in r) {
        setValue(previous)
        toast.error(r.error)
        return
      }
      toast.success(
        next === UNASSIGNED
          ? 'Mission non affectée'
          : `Confiée à ${teams.find((t) => t.id === next)?.name ?? 'l’équipe'}`,
      )
      router.refresh()
    })
  }

  return (
    <div className="space-y-1.5">
      <label
        htmlFor="mission-team"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
      >
        <Users className="h-3.5 w-3.5" /> Qui y va ?
      </label>
      <div className="flex items-center gap-2">
        <select
          id="mission-team"
          value={value}
          onChange={(e) => change(e.target.value)}
          disabled={pending}
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <option value={UNASSIGNED}>Non affectée</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {!pending && current && <TeamBadge name={current.name} color={current.color} size="sm" />}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {value === UNASSIGNED
          ? 'Les interventions créées par les rythmes naîtront sans équipe — il faudra les affecter une par une.'
          : 'Les interventions créées par les rythmes seront confiées à cette équipe.'}
      </p>
    </div>
  )
}
