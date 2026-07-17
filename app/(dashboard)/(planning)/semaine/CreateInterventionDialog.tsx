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
import { createMissionAction } from '@/app/(dashboard)/missions/actions'
import { addFieldPersonToTeamAction, createTeamAction } from '@/app/(dashboard)/equipes/actions'
import {
  pickInitialMissionId,
  mergeMissionOptions,
  visibleRotationOptions,
  type RotationOption,
} from './planning-prefill'
import { siteLabel } from '@/lib/labels/site-label'

export interface MissionOption {
  id: string
  name: string
  siteId: string
  siteName: string
  /** Client du chantier — désambiguïsation « Discount — Pointière » (PR 4). */
  clientName?: string | null
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

/** Chantier de l'org — support de la création INLINE de mission (PR 2). */
export interface SiteOption {
  id: string
  name: string
  clientName?: string | null
  contractName: string | null
}

const CADENCES = [
  { value: 'daily', label: 'Quotidienne' },
  { value: 'weekly', label: 'Hebdomadaire' },
  { value: 'biweekly', label: 'Bihebdomadaire' },
  { value: 'monthly', label: 'Mensuelle' },
  { value: 'on_demand', label: 'À la demande' },
] as const

interface Props {
  missions: MissionOption[]
  sites: SiteOption[]
  teams: TeamOption[]
  rotations: RotationOption[]
  /** yyyy-mm-dd UTC — date par défaut (typiquement le lundi de la semaine vue). */
  defaultDate: string
  /** Contexte chantier (PR 1) : arrivée depuis une fiche chantier
   *  (`/semaine?site=<id>`) → le dialogue s'ouvre tout seul, prérempli sur la
   *  première mission de ce chantier. Déjà validé côté serveur (org). */
  initialSiteId?: string
  /** PL5a.1 — piloté par le menu « Planifier ». Quand ces deux props sont
   *  fournies, le dialogue n'affiche plus son propre bouton : c'est le menu qui
   *  l'ouvre. Sans elles, comportement d'avant, à l'identique. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Sentinelle UI :
 *   '__inherit__' → undefined côté serveur (hériter de la mission)
 *   '__unassigned__' → null côté serveur (Non-affecté explicite)
 *   uuid → uuid (équipe spécifique) */
const INHERIT = '__inherit__'
const UNASSIGNED = '__unassigned__'

export function CreateInterventionDialog({ missions: missionsFromServer, sites, teams, rotations, defaultDate, initialSiteId, open: openProp, onOpenChange }: Props) {
  const router = useRouter()
  // PR 2 (lot Y) : les missions créées inline sont visibles et sélectionnées
  // IMMÉDIATEMENT — la version serveur reprend la main au refresh (dédup).
  const [inlineMissions, setInlineMissions] = useState<MissionOption[]>([])
  // Même principe pour l'équipe. Le maillon manquant : on pouvait créer une
  // mission sans quitter l'écran, mais pas une équipe — et sans équipe, le
  // planificateur laissait l'utilisateur devant un select vide, sans un mot.
  const [inlineTeams, setInlineTeams] = useState<TeamOption[]>([])
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [teamPending, startTeamCreate] = useTransition()
  // Personne TERRAIN (lot 1) : le maillon qui forçait à quitter le planificateur.
  // Pas un compte — une fiche (nom, métier, entreprise optionnelle) rattachée à
  // l'équipe sélectionnée, sans fermer ce dialogue.
  const [addingPerson, setAddingPerson] = useState(false)
  const [personName, setPersonName] = useState('')
  const [personJob, setPersonJob] = useState('')
  const [personCompany, setPersonCompany] = useState('')
  const [personPending, startPersonCreate] = useTransition()
  // Compteur optimiste : les personnes ajoutées pendant que le dialogue est
  // ouvert, par équipe. Le serveur reste la source (router.refresh les absorbe).
  const [fieldAdds, setFieldAdds] = useState<Record<string, number>>({})
  const missions = useMemo(
    () => mergeMissionOptions(missionsFromServer, inlineMissions),
    [missionsFromServer, inlineMissions],
  )
  // Contexte chantier : mission du chantier d'origine présélectionnée, et le
  // dialogue s'ouvre immédiatement (« je clique Planifier sur la fiche, je
  // retrouve mon chantier déjà choisi »). Chantier neuf sans mission → le
  // dialogue s'ouvre en mode « créer la première mission ».
  const initialMissionId = pickInitialMissionId(missionsFromServer, initialSiteId)
  const controlled = openProp !== undefined
  const [openInternal, setOpenInternal] = useState(initialMissionId !== '' || Boolean(initialSiteId))
  const open = controlled ? openProp : openInternal
  const setOpen = (next: boolean) => {
    if (controlled) onOpenChange?.(next)
    else setOpenInternal(next)
  }
  const [pending, startTransition] = useTransition()
  const [missionId, setMissionId] = useState<string>(initialMissionId)

  // ── Création inline de mission (« créer → rester → sélectionné ») ─────────
  const [creating, setCreating] = useState(Boolean(initialSiteId) && initialMissionId === '')
  const [newSiteId, setNewSiteId] = useState<string>(initialSiteId ?? '')
  const [newName, setNewName] = useState('')
  const [newCadence, setNewCadence] = useState<string>('weekly')
  const [createPending, startCreate] = useTransition()

  function submitNewMission() {
    if (!newSiteId || !newName.trim() || createPending) return
    const fd = new FormData()
    fd.set('site_id', newSiteId)
    fd.set('name', newName.trim())
    fd.set('cadence', newCadence)
    startCreate(async () => {
      const r = await createMissionAction(fd)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      const site = sites.find((s) => s.id === newSiteId)
      // Option optimiste alignée sur fetchMissionOptions (contrat absent → '—').
      setInlineMissions((prev) => [
        ...prev,
        {
          id: r.missionId,
          name: newName.trim(),
          siteId: newSiteId,
          siteName: site?.name ?? '—',
          clientName: site?.clientName ?? null,
          contractName: site?.contractName ?? '—',
          defaultTeamId: null,
        },
      ])
      setMissionId(r.missionId) // l'objet créé est SÉLECTIONNÉ, on reste ici
      setCreating(false)
      setNewName('')
      toast.success('Mission créée et sélectionnée')
      router.refresh()
    })
  }
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
  // PR 4 : l'en-tête d'optgroup porte « Client — Chantier », jamais le nom de
  // chantier seul (deux « Pointière » resteraient indistinguables).
  const missionsBySite = useMemo(() => {
    const bySite = new Map<string, MissionOption[]>()
    for (const m of missions) {
      const label = siteLabel(m.siteName, m.clientName)
      if (!bySite.has(label)) bySite.set(label, [])
      bySite.get(label)!.push(m)
    }
    return [...bySite.entries()]
      .sort((a, b) => fr(a[0], b[0]))
      .map(([site, ms]) => ({
        site,
        missions: ms.sort((a, b) => fr(a.name, b.name) || fr(a.contractName, b.contractName)),
      }))
  }, [missions])

  const sortedTeams = useMemo(() => {
    const byId = new Map<string, TeamOption>()
    for (const t of [...teams, ...inlineTeams]) byId.set(t.id, t)
    // Le compteur additionne comptes ET personnes terrain (global ici — la
    // distinction se lit dans la composition de l'équipe, page Équipes).
    return [...byId.values()]
      .map((t) => ({ ...t, memberCount: t.memberCount + (fieldAdds[t.id] ?? 0) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
  }, [teams, inlineTeams, fieldAdds])

  function submitNewPerson() {
    const name = personName.trim()
    const teamId = teamChoice
    if (!name || personPending || teamId === INHERIT || teamId === UNASSIGNED) return
    startPersonCreate(async () => {
      const r = await addFieldPersonToTeamAction({
        teamId,
        fullName: name,
        job: personJob.trim() || undefined,
        companyName: personCompany.trim() || undefined,
      })
      if (!r.ok) {
        toast.error(r.error ?? 'Ajout impossible')
        return
      }
      setFieldAdds((prev) => ({ ...prev, [teamId]: (prev[teamId] ?? 0) + 1 }))
      setPersonName('')
      setPersonJob('')
      setPersonCompany('')
      // Le bloc reste ouvert : on ajoute souvent plusieurs personnes d'affilée.
      toast.success(`${name} ajouté à l’équipe`)
      router.refresh()
    })
  }

  function submitNewTeam() {
    const name = newTeamName.trim()
    if (!name || teamPending) return
    startTeamCreate(async () => {
      const r = await createTeamAction({ name })
      if (!r.ok || !r.teamId) {
        toast.error(r.error ?? 'Création impossible')
        return
      }
      const teamId = r.teamId
      setInlineTeams((prev) => [...prev, { id: teamId, name, color: null, memberCount: 0 }])
      setTeamChoice(teamId) // l'équipe créée est SÉLECTIONNÉE, on reste ici
      setCreatingTeam(false)
      setNewTeamName('')
      // L'équipe naît vide : on enchaîne directement sur l'ajout d'une personne
      // — le parcours du lot 1, sans quitter le formulaire.
      setAddingPerson(true)
      toast.success('Équipe créée et sélectionnée')
      router.refresh()
    })
  }

  const selectedMission = missions.find((m) => m.id === missionId) ?? null
  const visibleRotations = visibleRotationOptions(rotations, selectedMission, initialSiteId)
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
    setCreating(false)
    setNewName('')
    setNewSiteId(initialSiteId ?? '')
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
      {!controlled && (
        <DialogTrigger
          render={
            <Button variant="default" size="sm">
              <Plus className="h-4 w-4" />
              Planifier
            </Button>
          }
        />
      )}
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
            {missions.length > 0 && (
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

            {/* PR 2 (lot Y) : plus de cul-de-sac « créez-en une depuis un contrat
                actif » — la mission manquante se crée ICI, sans quitter le
                planificateur, et ressort sélectionnée. */}
            {creating || missions.length === 0 ? (
              <div className="space-y-2 rounded-md border border-dashed bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Nouvelle mission</p>
                <select
                  aria-label="Chantier de la nouvelle mission"
                  value={newSiteId}
                  onChange={(e) => setNewSiteId(e.target.value)}
                  disabled={createPending || Boolean(initialSiteId)}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
                >
                  <option value="" disabled>
                    Chantier…
                  </option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {siteLabel(s.name, s.clientName)}
                      {s.contractName ? ` · ${s.contractName}` : ''}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={200}
                  placeholder="Nom de la mission (ex : Entretien du magasin)"
                  disabled={createPending}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <select
                  aria-label="Cadence de la nouvelle mission"
                  value={newCadence}
                  onChange={(e) => setNewCadence(e.target.value)}
                  disabled={createPending}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {CADENCES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={submitNewMission} disabled={!newSiteId || !newName.trim() || createPending}>
                    {createPending ? 'Création…' : 'Créer la mission'}
                  </Button>
                  {missions.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setCreating(false)} disabled={createPending}>
                      Annuler
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                disabled={pending}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                + Nouvelle mission
              </button>
            )}
          </div>

          {visibleRotations.length > 0 && (
            <section className="rounded-md border bg-sky-50/50 p-3 text-xs text-sky-950 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-100">
              <p className="font-medium">Roulements disponibles sur ce chantier</p>
              <ul className="mt-2 space-y-1.5">
                {visibleRotations.slice(0, 6).map((rotation) => (
                  <li key={rotation.id} className="rounded-md bg-background/80 px-2 py-1.5">
                    <span className="font-medium">{rotation.missionName}</span>
                    <span className="text-muted-foreground"> · {rotation.label}</span>
                  </li>
                ))}
              </ul>
              {visibleRotations.length > 6 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  +{visibleRotations.length - 6} autre{visibleRotations.length - 6 > 1 ? 's' : ''} roulement{visibleRotations.length - 6 > 1 ? 's' : ''}
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Pour modifier un roulement complet, passe par Missions.
              </p>
            </section>
          )}

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

            {/* Le maillon manquant. On pouvait créer une mission sans quitter
                l'écran — pas une équipe. Sans équipe, le select se contentait de
                masquer son groupe : l'utilisateur voyait un choix vide, sans un
                mot lui disant quoi faire. */}
            {creatingTeam ? (
              <div className="space-y-1.5 rounded-lg border border-dashed p-2.5">
                <label htmlFor="new-team-name" className="text-[11px] font-medium text-muted-foreground">
                  Nom de la nouvelle équipe
                </label>
                <input
                  id="new-team-name"
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitNewTeam()
                    }
                  }}
                  placeholder="ex. Équipe Nord, Jean-Paul…"
                  autoFocus
                  disabled={teamPending}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={submitNewTeam}
                    disabled={teamPending || newTeamName.trim().length === 0}
                  >
                    {teamPending ? 'Création…' : 'Créer et sélectionner'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setCreatingTeam(false); setNewTeamName('') }}
                    disabled={teamPending}
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    Annuler
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Vous pourrez ajouter les personnes juste après, sans quitter ce formulaire.
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px] text-muted-foreground">
                  {sortedTeams.length === 0
                    ? "Aucune équipe pour l'instant — vous pouvez en créer une ici, ou planifier sans équipe."
                    : 'Vous pouvez toujours réassigner plus tard par glisser-déposer dans la grille.'}
                </p>
                <button
                  type="button"
                  onClick={() => setCreatingTeam(true)}
                  disabled={pending}
                  className="text-xs text-muted-foreground underline hover:text-foreground shrink-0"
                >
                  + Nouvelle équipe
                </button>
              </div>
            )}

            {/* ── PERSONNE TERRAIN (lot 1) ─────────────────────────────────
                Le maillon qui brisait le parcours : ajouter quelqu'un exigeait
                de quitter le planificateur pour créer un COMPTE. Ici : une
                fiche (nom, métier, entreprise optionnelle), rattachée à
                l'équipe SÉLECTIONNÉE, sans fermer le dialogue. Aucun compte,
                aucune invitation, aucune affectation individuelle. */}
            {teamChoice !== INHERIT && teamChoice !== UNASSIGNED && (
              addingPerson ? (
                <div className="space-y-1.5 rounded-lg border border-dashed p-2.5">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    Ajouter une personne terrain à «&nbsp;{sortedTeams.find((t) => t.id === teamChoice)?.name ?? 'l’équipe'}&nbsp;» — sans compte de connexion.
                  </p>
                  <input
                    type="text"
                    value={personName}
                    onChange={(e) => setPersonName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNewPerson() } }}
                    placeholder="Nom — ex. M. X, Jean Dupont…"
                    autoFocus
                    disabled={personPending}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={personJob}
                      onChange={(e) => setPersonJob(e.target.value)}
                      placeholder="Métier (optionnel) — ex. Électricien"
                      disabled={personPending}
                      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <input
                      type="text"
                      value={personCompany}
                      onChange={(e) => setPersonCompany(e.target.value)}
                      placeholder="Entreprise (optionnelle)"
                      disabled={personPending}
                      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={submitNewPerson}
                      disabled={personPending || personName.trim().length === 0}
                    >
                      {personPending ? 'Ajout…' : 'Ajouter à l’équipe'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setAddingPerson(false); setPersonName(''); setPersonJob(''); setPersonCompany('') }}
                      disabled={personPending}
                      className="text-xs text-muted-foreground underline hover:text-foreground"
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setAddingPerson(true)}
                    disabled={pending}
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    + Ajouter une personne
                  </button>
                </div>
              )
            )}
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
