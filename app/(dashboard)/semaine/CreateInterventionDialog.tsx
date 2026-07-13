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
import { TimeField } from '@/components/ui/time-field'
import { Button } from '@/components/ui/button'
import { createInterventionFromWeekAction } from './actions'
import { pickInitialMissionId } from './planning-prefill'

export interface MissionOption {
  id: string
  name: string
  siteId: string
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
  /** Contexte chantier (PR 1) : arrivée depuis une fiche chantier
   *  (`/semaine?site=<id>`) → le dialogue s'ouvre tout seul, prérempli sur la
   *  première mission de ce chantier. Déjà validé côté serveur (org). */
  initialSiteId?: string
}

/** Sentinelle UI :
 *   '__inherit__' → undefined côté serveur (hériter de la mission)
 *   '__unassigned__' → null côté serveur (Non-affecté explicite)
 *   uuid → uuid (équipe spécifique) */
const INHERIT = '__inherit__'
const UNASSIGNED = '__unassigned__'

export function CreateInterventionDialog({ missions, teams, defaultDate, initialSiteId }: Props) {
  const router = useRouter()
  // Contexte chantier : mission du chantier d'origine présélectionnée, et le
  // dialogue s'ouvre immédiatement (« je clique Planifier sur la fiche, je
  // retrouve mon chantier déjà choisi »).
  const initialMissionId = pickInitialMissionId(missions, initialSiteId)
  const [open, setOpen] = useState(initialMissionId !== '')
  const [pending, startTransition] = useTransition()
  const [missionId, setMissionId] = useState<string>(initialMissionId)
  const [scheduledFor, setScheduledFor] = useState<string>(defaultDate)
  const [teamChoice, setTeamChoice] = useState<string>(INHERIT)
  // V6.1 (Vincent 2026-05-20) : l'heure de début est OBLIGATOIRE. Plus de
  // notion de « créneau matin/AM/soir » côté UI. Le slot est dérivé côté
  // serveur depuis plannedStartHHMM (ancrage canonique 07/14/19 = slot
  // morning/afternoon/evening).
  const [plannedStartHHMM, setPlannedStartHHMM] = useState<string>('')
  const [plannedEndHHMM, setPlannedEndHHMM] = useState<string>('')

  // Picker GROUPÉ PAR SITE (sinon, à plat, on s'y perd dès qu'il y a beaucoup de
  // missions). optgroup = site ; à l'intérieur, missions triées par nom puis contrat.
  const fr = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' })
  const missionsBySite = useMemo(() => {
    const bySite = new Map<string, MissionOption[]>()
    for (const m of missions) {
      if (!bySite.has(m.siteName)) bySite.set(m.siteName, [])
      bySite.get(m.siteName)!.push(m)
    }
    return [...bySite.entries()]
      .sort((a, b) => fr(a[0], b[0]))
      .map(([site, ms]) => ({
        site,
        missions: ms.sort((a, b) => fr(a.name, b.name) || fr(a.contractName, b.contractName)),
      }))
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

  // V6.2 — heure de début ET de fin obligatoires (fin de l'ancrage créneau).
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
  const canSubmit =
    missionId !== '' &&
    scheduledFor !== '' &&
    HHMM.test(plannedStartHHMM) &&
    HHMM.test(plannedEndHHMM) &&
    plannedStartHHMM < plannedEndHHMM &&
    !pending

  function reset() {
    // Le contexte chantier survit à une fermeture/réouverture du dialogue.
    setMissionId(initialMissionId)
    setScheduledFor(defaultDate)
    setTeamChoice(INHERIT)
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
    startTransition(async () => {
      const r = await createInterventionFromWeekAction({
        missionId,
        scheduledFor,
        plannedStartHHMM,
        ...(plannedEndHHMM ? { plannedEndHHMM } : {}),
        ...(teamId === undefined ? {} : { teamId }),
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
            Choisir la mission, la date et l'horaire de début. La checklist de la mission est copiée automatiquement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="mission-select" className="text-xs font-medium text-muted-foreground">
              Mission *
            </label>
            {missions.length === 0 ? (
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
                {/* Groupé par site : le site est l'en-tête d'optgroup, plus besoin
                    de le répéter sur chaque ligne. */}
                {missionsBySite.map(({ site, missions: ms }) => (
                  <optgroup key={site} label={site}>
                    {ms.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {m.contractName}
                      </option>
                    ))}
                  </optgroup>
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

          {/* V6.1 (Vincent 2026-05-20) : plus de boutons matin/après-midi/soir.
              L'utilisateur saisit DIRECTEMENT l'heure de début (obligatoire)
              et l'heure de fin (optionnelle). Le slot est dérivé en interne
              côté serveur via slotFromUtcHour pour rester compatible avec
              les vues existantes, mais n'est plus visible côté UI. */}
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted-foreground">Horaire *</legend>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label htmlFor="planned-start" className="text-[11px] text-muted-foreground">
                  Début *
                </label>
                <TimeField
                  id="planned-start"
                  label="Début"
                  value={plannedStartHHMM}
                  onChange={setPlannedStartHHMM}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="planned-end" className="text-[11px] text-muted-foreground">
                  Fin *
                </label>
                <TimeField
                  id="planned-end"
                  label="Fin"
                  value={plannedEndHHMM}
                  onChange={setPlannedEndHHMM}
                  disabled={pending}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Saisis l'heure réelle de la prestation (ex. 06h30 – 08h00).
            </p>
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
          <Button onClick={submit} disabled={!canSubmit || missions.length === 0}>
            {pending ? 'Planification…' : 'Planifier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
