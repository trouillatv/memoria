'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { createInterventionFromWeekAction } from './actions'
import type { InterventionSlot } from '@/types/db'

export interface MissionOption {
  id: string
  name: string
  siteName: string
  contractName: string
  /** Équipe par défaut de la mission, héritée si l'utilisateur ne change rien. */
  defaultTeamId: string | null
}

export interface TeamOption {
  id: string
  name: string
  color: string | null
  memberCount: number
}

interface Props {
  missions: MissionOption[]
  teams: TeamOption[]
  /** yyyy-mm-dd UTC — date par défaut (typiquement le lundi de la semaine vue). */
  defaultDate: string
}

/** Sentinelle UI :
 *   '__inherit__' → undefined côté serveur (hériter de la mission)
 *   '__unassigned__' → null côté serveur (Non-affecté explicite)
 *   uuid → uuid (équipe spécifique) */
const INHERIT = '__inherit__'
const UNASSIGNED = '__unassigned__'

const SLOT_OPTIONS: Array<{ value: InterventionSlot; label: string }> = [
  { value: 'morning', label: 'Matin' },
  { value: 'afternoon', label: 'Après-midi' },
  { value: 'evening', label: 'Soir' },
]

export function CreateInterventionDialog({ missions, teams, defaultDate }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [missionId, setMissionId] = useState<string>('')
  const [scheduledFor, setScheduledFor] = useState<string>(defaultDate)
  const [slot, setSlot] = useState<InterventionSlot>('afternoon')
  const [teamChoice, setTeamChoice] = useState<string>(INHERIT)
  // V6.1 (demande Guillaume 2026-05-20) : heures précises optionnelles.
  // Le chef d'équipe travaille de 06h30 à 08h00, pas « matin ». Si toggle off,
  // fallback slot grossier (comportement legacy).
  const [precisHour, setPrecisHour] = useState<boolean>(false)
  const [plannedStartHHMM, setPlannedStartHHMM] = useState<string>('')
  const [plannedEndHHMM, setPlannedEndHHMM] = useState<string>('')

  // Tri pour le picker : contrat → site → mission (alphabétique, fr).
  const sortedMissions = useMemo(() => {
    const fr = (a: string, b: string) =>
      a.localeCompare(b, 'fr', { sensitivity: 'base' })
    return [...missions].sort(
      (a, b) =>
        fr(a.contractName, b.contractName) ||
        fr(a.siteName, b.siteName) ||
        fr(a.name, b.name),
    )
  }, [missions])

  const sortedTeams = useMemo(() => {
    return [...teams].sort((a, b) =>
      a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
    )
  }, [teams])

  const selectedMission = missions.find((m) => m.id === missionId) ?? null
  const defaultTeamName = selectedMission?.defaultTeamId
    ? (teams.find((t) => t.id === selectedMission.defaultTeamId)?.name ?? 'Équipe par défaut')
    : null

  const canSubmit = missionId !== '' && scheduledFor !== '' && !pending

  function reset() {
    setMissionId('')
    setScheduledFor(defaultDate)
    setSlot('afternoon')
    setTeamChoice(INHERIT)
    setPrecisHour(false)
    setPlannedStartHHMM('')
    setPlannedEndHHMM('')
  }

  function resolveTeamId(): string | null | undefined {
    if (teamChoice === INHERIT) return undefined
    if (teamChoice === UNASSIGNED) return null
    return teamChoice
  }

  function submit() {
    if (!canSubmit) return
    const teamId = resolveTeamId()
    // Heures précises : envoyées seulement si toggle activé ET non vides.
    const precis =
      precisHour && plannedStartHHMM
        ? {
            plannedStartHHMM,
            ...(plannedEndHHMM ? { plannedEndHHMM } : {}),
          }
        : {}
    startTransition(async () => {
      const r = await createInterventionFromWeekAction({
        missionId,
        scheduledFor,
        slot,
        ...(teamId === undefined ? {} : { teamId }),
        ...precis,
      })
      if (!r.ok) {
        toast.error(r.error ?? 'Erreur inconnue')
        return
      }
      toast.success('Intervention planifiée')
      reset()
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button variant="default" size="sm">
            <Plus className="h-4 w-4" />
            Planifier
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Planifier une intervention</DialogTitle>
          <DialogDescription>
            Choisir la mission, la date et le créneau. La checklist de la mission est copiée automatiquement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="mission-select" className="text-xs font-medium text-muted-foreground">
              Mission *
            </label>
            {sortedMissions.length === 0 ? (
              <p className="text-sm text-muted-foreground italic rounded-md border border-dashed bg-muted/30 px-3 py-2">
                Aucune mission disponible — créez-en une depuis un contrat actif.
              </p>
            ) : (
              <select
                id="mission-select"
                value={missionId}
                onChange={(e) => setMissionId(e.target.value)}
                disabled={pending}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="" disabled>
                  Sélectionner une mission…
                </option>
                {sortedMissions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.siteName} · {m.contractName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="schedule-date" className="text-xs font-medium text-muted-foreground">
              Date *
            </label>
            <input
              id="schedule-date"
              type="date"
              value={scheduledFor}
              min={defaultDate}
              onChange={(e) => setScheduledFor(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted-foreground">Créneau</legend>
            <div className="flex gap-2" role="radiogroup" aria-label="Créneau">
              {SLOT_OPTIONS.map((opt) => {
                const checked = slot === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => setSlot(opt.value)}
                    disabled={pending || precisHour}
                    className={
                      'flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ' +
                      (checked
                        ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium dark:bg-brand-600/10'
                        : 'bg-background hover:bg-muted')
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={precisHour}
                onChange={(e) => {
                  setPrecisHour(e.target.checked)
                  if (!e.target.checked) {
                    setPlannedStartHHMM('')
                    setPlannedEndHHMM('')
                  }
                }}
                disabled={pending}
                className="h-3.5 w-3.5"
              />
              Préciser l'heure (06h30 – 08h00 plutôt que « Matin »)
            </label>
            {precisHour && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="space-y-1">
                  <label htmlFor="planned-start" className="text-[11px] text-muted-foreground">
                    Début *
                  </label>
                  <input
                    id="planned-start"
                    type="time"
                    step={300 /* 5 min */}
                    value={plannedStartHHMM}
                    onChange={(e) => setPlannedStartHHMM(e.target.value)}
                    disabled={pending}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="planned-end" className="text-[11px] text-muted-foreground">
                    Fin
                  </label>
                  <input
                    id="planned-end"
                    type="time"
                    step={300}
                    value={plannedEndHHMM}
                    onChange={(e) => setPlannedEndHHMM(e.target.value)}
                    disabled={pending || !plannedStartHHMM}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  />
                </div>
              </div>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <label htmlFor="team-select" className="text-xs font-medium text-muted-foreground">
              Équipe
            </label>
            <select
              id="team-select"
              value={teamChoice}
              onChange={(e) => setTeamChoice(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value={INHERIT}>
                {defaultTeamName
                  ? `Équipe par défaut · ${defaultTeamName}`
                  : 'Équipe par défaut de la mission'}
              </option>
              <option value={UNASSIGNED}>Non-affecté (à attribuer plus tard)</option>
              {sortedTeams.length > 0 && (
                <optgroup label="Équipes actives">
                  {sortedTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.memberCount > 0
                        ? ` · ${t.memberCount === 1 ? '1 personne' : `${t.memberCount} personnes`}`
                        : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Tu peux toujours réassigner plus tard par drag&nbsp;&amp;&nbsp;drop dans la grille.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            Annuler
          </DialogClose>
          <Button onClick={submit} disabled={!canSubmit || sortedMissions.length === 0}>
            {pending ? 'Planification…' : 'Planifier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
