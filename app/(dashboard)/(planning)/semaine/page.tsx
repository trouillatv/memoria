// Phase 9 — Vue Semaine & Équipes (Slice 9.3, étendu 9.4)
//
// Page /semaine : Vue Site × Jour primaire.
// Slice 9.3 : read-only.
// Slice 9.4 : drag & drop replanification + réassignation équipe.
// La Vue Équipe × Jour arrive en Slice 9.5.
//
// Doctrine V2 + V6.1 (Vincent 2026-05-20) :
//   - Vue Site × Jour PRIMAIRE (Équipe × Jour secondaire)
//   - ZÉRO évocation de créneau côté utilisateur. On travaille uniquement en
//     HEURES réelles de prestation (planned_start/planned_end). Le slot DB
//     reste pour le tri interne et le dégradé visuel mais n'est jamais nommé.
//   - "Non-affecté" = signal ambre discret, JAMAIS rouge
//   - Aucune métrique de performance / charge / saturation / retard
//   - Wording neutre : on organise, on ne surveille pas
//
// Auth : admin OR manager. Belt + suspenders avec le check du layout dashboard.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Calendar, CalendarOff, FileDown, Info } from 'lucide-react'
import { getCurrentUserWithProfile, getOrgId } from '@/lib/db/users'
import {
  formatWeekParam,
  getWeekBySite,
  getWeekByTeam,
  parseWeekParam,
  type WeekRange,
  type SiteRow,
  type TeamRow,
} from '@/lib/db/week-planning'
import { listActiveClosuresForSites, type SiteClosure } from '@/lib/db/site-closures'
import { listTemplatesByIds } from '@/lib/db/week-planning'
import { detectDeviations, hhmmOf } from '@/lib/planning/occurrence-exception'
import { detectClosureConflicts } from '@/lib/planning/conflicts'
import { listKeptInterventionIds, listDecisions } from '@/lib/db/closure-decisions'
import { projectClosures, type ProjectableClosure } from '@/lib/planning/closures'
import { resolutionOptions, type ResolutionOption } from '@/lib/planning/conflict-resolution'
import { listTeams } from '@/lib/db/teams'
import { getWeekVigilance } from '@/lib/db/week-vigilance'
import {
  getWeekOperationalSignals,
  type SiteWeekSignals,
  type WeekOperationalSignal,
} from '@/lib/db/week-operational-signals'
import { collectMemorySignals } from '@/lib/memory/signals/collect'
import { planningSignalsBySite } from '@/lib/memory/signals/surface'
import type { MemorySignal } from '@/lib/memory/signals/types'
import { WeekNavigation } from './WeekNavigation'
import { WeekVigilanceSection } from './WeekVigilance'
import { PlanMenu } from './PlanMenu'
import {
  fetchMissionOptions,
  fetchSiteOptions,
  fetchTeamMemberCounts,
  fetchRotationOptions,
} from './plan-menu-data'
import { WeekGrid } from './WeekGrid'
import { WeekGridClient } from './WeekGridClient'
import { TeamWeekGrid } from './TeamWeekGrid'
import { TeamWeekGridClient } from './TeamWeekGridClient'
import { ViewModeToggle } from './ViewModeToggle'
import { parseViewMode } from './view-mode-storage'
import { LecturePanel } from '../LecturePanel'
import { buildPlanningLectureInput } from '@/lib/planning/lecture-adapter'
import { derivePlanningLecture } from '@/lib/planning/lecture'
export const dynamic = 'force-dynamic'

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function formatDateShort(iso: string): string {
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  const day = Number(parts[2])
  const month = Number(parts[1])
  const monthName = MONTHS_FR[month - 1] ?? ''
  return `${day} ${monthName}`
}

function formatDateLongWithYear(iso: string): string {
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  const monthName = MONTHS_FR[month - 1] ?? ''
  return `${day} ${monthName} ${year}`
}

function formatWeekHeader(range: WeekRange): string {
  // « Semaine 20 · du 11 mai au 17 mai 2026 »
  // ou si chevauchement année : « du 30 décembre 2025 au 5 janvier 2026 »
  const startYear = range.weekStart.slice(0, 4)
  const endYear = range.weekEnd.slice(0, 4)
  if (startYear === endYear) {
    return `Semaine ${range.weekNumber} · du ${formatDateShort(
      range.weekStart,
    )} au ${formatDateLongWithYear(range.weekEnd)}`
  }
  return `Semaine ${range.weekNumber} · du ${formatDateLongWithYear(
    range.weekStart,
  )} au ${formatDateLongWithYear(range.weekEnd)}`
}

/**
 * "Aujourd'hui" ancré sur le fuseau Pacific/Noumea (pilote NC, UTC+11).
 *  Évite que le jour bascule prématurément quand le superviseur consulte
 *  depuis l'Europe (UTC+1/+2) tard le soir : à 1h du matin en France, on
 *  est encore en milieu de journée à Nouméa, donc "aujourd'hui" doit
 *  refléter la réalité de l'équipe terrain.
 */
function todayUtcIso(): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Pacific/Noumea',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

interface PageProps {
  searchParams: Promise<{ week?: string; view?: string; debug?: string; site?: string; cell?: string }>
}

function totalSite(rows: SiteRow[]): number {
  return rows.reduce(
    (acc, r) => acc + Object.values(r.days).reduce((s, d) => s + d.length, 0),
    0,
  )
}

function totalTeam(rows: TeamRow[]): number {
  return rows.reduce(
    (acc, r) => acc + Object.values(r.days).reduce((s, d) => s + d.length, 0),
    0,
  )
}

export default async function SemainePage({ searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')

  const params = await searchParams
  const range = parseWeekParam(params.week)
  const view = parseViewMode(params.view)
  const isDebug = params.debug === 'true'
  const orgId = await getOrgId()

  // On fetch UNIQUEMENT la vue active pour éviter du I/O inutile (la TeamRow
  // fait un appel supplémentaire à teams + team_members).
  const [siteRows, teamRows, allTeams, missionOptions, siteOptions, memberCounts, vigilance, memorySignals, weekSignals] =
    await Promise.all([
      view === 'site' ? getWeekBySite(range) : Promise.resolve<SiteRow[]>([]),
      view === 'team' ? getWeekByTeam(range) : Promise.resolve<TeamRow[]>([]),
      listTeams(),
      fetchMissionOptions(orgId),
      fetchSiteOptions(orgId),
      fetchTeamMemberCounts(orgId),
      getWeekVigilance(range.weekStart, range.weekEnd),
      // Planning-1 : collecte UNE SEULE FOIS au niveau page (vue site uniquement).
      // La vue équipe viendra plus tard (sujet team non activé ici).
      view === 'site' ? collectMemorySignals() : Promise.resolve<MemorySignal[]>([]),
      // Niveau 1 : signaux opérationnels (standing) par site — vue site uniquement.
      view === 'site' ? getWeekOperationalSignals(range) : Promise.resolve<SiteWeekSignals[]>([]),
    ])
  const rotationOptions = await fetchRotationOptions(missionOptions).catch(() => [])
  const lecture = view === 'site'
    ? derivePlanningLecture(buildPlanningLectureInput({
        scope: 'week',
        anchorDate: range.weekStart,
        rows: siteRows,
        missions: missionOptions,
        rotations: rotationOptions,
      }))
    : null

  // Regroupement par site (conflits résolus, fragilité d'abord) — filtrage par
  // site fait ici, jamais un collect par cellule.
  const signalsBySite = planningSignalsBySite(memorySignals)
  // Niveau 1 : seul le « standing » est surfacé pour l'instant (sous le nom du
  // site). Les événements datés `days` (réunion/échéance/livraison) attendent le
  // Niveau 2 (icônes en cellule). On indexe par site pour la grille.
  const standingBySite: Record<string, WeekOperationalSignal[]> = {}
  // Niveau 2 : événements datés (réunion/échéance/livraison) par site puis par
  // jour → icônes discrètes en cellule.
  const daysBySite: Record<string, Record<string, WeekOperationalSignal[]>> = {}
  for (const s of weekSignals) {
    if (s.standing.length > 0) standingBySite[s.siteId] = s.standing
    const nonEmpty: Record<string, WeekOperationalSignal[]> = {}
    for (const [day, evts] of Object.entries(s.days)) {
      if (evts.length > 0) nonEmpty[day] = evts
    }
    if (Object.keys(nonEmpty).length > 0) daysBySite[s.siteId] = nonEmpty
  }

  // LE CALENDRIER DU CHANTIER D'ABORD, le conflit ensuite.
  //
  //   fermetures du site → jour fermé → si prestation prévue → CONFLIT
  //
  // Une fermeture est une INFORMATION MÉTIER (Guillaume s'en sert pour
  // construire son planning : vacances, fériés, inventaires), pas seulement le
  // symptôme d'une erreur. Elle se voit donc TOUJOURS, même quand aucune
  // prestation n'est prévue — discrètement. Le rouge reste réservé au conflit.
  //
  // Tout est CALCULÉ à chaque lecture, jamais persisté (doctrine des signaux).
  // `{}` si la mig 197 n'est pas appliquée → l'écran reste identique à avant.
  const { conflictsBySite, closuresBySite, decisions, optionsBySite, exceptionsById } = await (async () => {
    const empty = {
      conflictsBySite: {} as Record<string, Record<string, import('@/lib/planning/conflicts').ClosureConflict>>,
      closuresBySite: {} as Record<string, Record<string, ProjectableClosure>>,
      decisions: {} as Record<string, import('@/lib/db/closure-decisions').ClosureDecision>,
      optionsBySite: {} as Record<string, Record<string, ResolutionOption[]>>,
      exceptionsById: {} as Record<string, string[]>,
    }
    if (view !== 'site' || siteRows.length === 0) return empty

    const raw = await listActiveClosuresForSites(
      siteRows.map((r) => r.site_id),
      range.weekStart,
      range.weekEnd,
    ).catch((): Record<string, SiteClosure[]> => ({}))

    // PL3b — les dates PROPOSÉES se calculent ICI, côté serveur.
    //
    // Le composant les appelait d'abord depuis un `useEffect` : une action
    // serveur déclenchée au montage du tiroir. C'est faux à deux titres — un
    // aller-retour réseau pour afficher deux dates, et un `cookies()` hors
    // requête dès qu'on rend le composant hors navigateur (la CI l'a attrapé).
    //
    // On regarde ±14 jours autour de la semaine : c'est la fenêtre dans laquelle
    // un déplacement a un sens.
    const wide = await listActiveClosuresForSites(
      siteRows.map((r) => r.site_id),
      shiftIso(range.weekStart, -14),
      shiftIso(range.weekEnd, 14),
    ).catch((): Record<string, SiteClosure[]> => ({}))

    // Jour par jour : « ce site est-il fermé ce jour-là, et pourquoi ? »
    const byDate: Record<string, Record<string, ProjectableClosure>> = {}
    for (const row of siteRows) {
      const closures = raw[row.site_id] ?? []
      if (closures.length === 0) continue
      byDate[row.site_id] = projectClosures({
        closures,
        from: range.weekStart,
        to: range.weekEnd,
      })
    }

    // PL3b — ce que l'humain a décidé de MAINTENIR ne réalerte plus. Redemander
    // tous les matins ce qui a déjà été tranché est le meilleur moyen de faire
    // ignorer les alertes.
    const keptInterventionIds = await listKeptInterventionIds(
      siteRows.flatMap((r) => Object.values(r.days).flat().map((c) => c.id)),
    ).catch(() => new Set<string>())

    // Les décisions DÉJÀ prises — pour que le tiroir puisse les RELIRE. Une fois
    // « maintenue », le conflit disparaît : sans cette lecture, la décision
    // disparaîtrait avec lui, et il n'y aurait plus rien à relire.
    const decisions = await listDecisions(
      siteRows.flatMap((r) => Object.values(r.days).flat().map((c) => c.id)),
    ).catch(() => ({}))

    const conflictsBySite = detectClosureConflicts({
      rows: siteRows,
      closuresBySite: raw,
      keptInterventionIds,
    })

    // Une proposition par (chantier, jour de conflit). Jamais une date fermée :
    // la règle est pure et testée (lib/planning/conflict-resolution.ts).
    const optionsBySite: Record<string, Record<string, ResolutionOption[]>> = {}
    for (const [siteId, byDateConflict] of Object.entries(conflictsBySite)) {
      const closures = wide[siteId] ?? []
      optionsBySite[siteId] = {}
      for (const conflictDate of Object.keys(byDateConflict)) {
        optionsBySite[siteId][conflictDate] = resolutionOptions(closures, conflictDate).filter(
          // On ne propose jamais de replanifier dans le passé.
          (o) => o.date >= todayUtcIso(),
        )
      }
    }

    // EXCEPTIONS PONCTUELLES — chaque occurrence issue d'un roulement est
    // comparée à ce que son rythme PRESCRIT. Présente dans la carte = issue d'un
    // roulement ; liste non vide = elle dévie (jour, équipe, horaire, annulée).
    // Une déviation silencieuse ferait mentir la grille.
    const allCells = siteRows.flatMap((r) => Object.values(r.days).flat())
    const templatesById = await listTemplatesByIds(
      allCells.map((c) => c.template_id).filter((v): v is string => !!v),
    ).catch((): Record<string, import('@/lib/db/week-planning').WeekTemplate> => ({}))

    const exceptionsById: Record<string, string[]> = {}
    for (const c of allCells) {
      const tpl = c.template_id ? templatesById[c.template_id] : undefined
      if (!tpl) continue
      exceptionsById[c.id] = detectDeviations(
        {
          scheduledFor: c.scheduled_for,
          status: c.status,
          assignedTeamId: c.assigned_team_id,
          startHHMM: hhmmOf(c.planned_start),
          endHHMM: hhmmOf(c.planned_end),
        },
        tpl,
      ).map((d) => d.label)
    }

    return {
      conflictsBySite,
      closuresBySite: byDate,
      decisions,
      optionsBySite,
      exceptionsById,
    }
  })()

  const activeTeams = allTeams.filter((t) => t.active && !t.deleted_at)
  const teams = activeTeams.map((t) => ({ id: t.id, name: t.name, color: t.color }))
  const teamOptions = activeTeams.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    memberCount: memberCounts.get(t.id) ?? 0,
  }))
  const todayIso = todayUtcIso()

  // Contexte chantier (PR 1) : arriver depuis une fiche chantier via
  // `/semaine?site=<id>` ouvre le planificateur prérempli sur ce chantier.
  // Le param n'est honoré que s'il correspond à un chantier de l'ORG (les
  // options sont déjà fail-closed) — un id étranger est simplement ignoré.
  // PR 2 : validé contre les CHANTIERS (pas les missions) — un chantier neuf
  // sans mission ouvre le planificateur en mode « créer la première mission ».
  const initialSiteId =
    params.site && siteOptions.some((s) => s.id === params.site) ? params.site : undefined

  const total = view === 'site' ? totalSite(siteRows) : totalTeam(teamRows)
  const isEmpty =
    (view === 'site' && (siteRows.length === 0 || total === 0)) ||
    (view === 'team' && total === 0)
  const lectureLinks = lecture
    ? {
        rotation: '/roulements',
        gaps: `/semaine?week=${formatWeekParam(range)}`,
        missions: lecture.primary.missionIds.map((id) => `/missions/${id}`),
      }
    : null

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Calendar className="h-6 w-6 text-brand-600" />
            {formatWeekHeader(range)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {view === 'site'
              ? 'Vue Chantier × Jour. Organisation de la couverture. Aucune métrique de surveillance.'
              : 'Vue Équipe × Jour (secondaire). Conteneurs logistiques. Aucune métrique de surveillance.'}
          </p>
          {isDebug && (
            <p className="mt-1 text-xs text-muted-foreground/80">
              Identifiant semaine&nbsp;: <code className="font-mono">{formatWeekParam(range)}</code>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewModeToggle mode={view} />
          <WeekNavigation range={range} />
          {/* PL5a.1 — « Planifier » ouvre les DEUX objets : une intervention
              ponctuelle, ou un ROULEMENT (qui renvoie vers l'unique éditeur,
              /sites/[id]/roulements/nouveau — jamais un second formulaire). */}
          <PlanMenu
            missions={missionOptions}
            sites={siteOptions}
            teams={teamOptions}
            rotations={rotationOptions}
            defaultDate={range.weekStart > todayIso ? range.weekStart : todayIso}
            initialSiteId={initialSiteId}
          />
          <Link
            href={`/semaine/export?week=${formatWeekParam(range)}`}
            prefetch={false}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 h-8 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={`Exporter le planning de la semaine ${range.weekNumber} au format Excel`}
          >
            <FileDown className="h-4 w-4" />
            <span>Exporter</span>
          </Link>
        </div>
      </header>

      {/* V6.2 (Vincent 2026-05-20) — Vigilance EN HAUT, plus en bas. Bandeau
          rouge qui saute aux yeux dès qu'un signal apparaît (sans équipe,
          chevauchement horaire). Silence positif respecté : si aucun signal,
          le widget ne rend rien et la zone disparaît. */}
      <WeekVigilanceSection data={vigilance} />

      {/* Doctrine /semaine — modifications ponctuelles uniquement.
          Discret mais permanent : c'est la règle produit, pas un toast éphémère. */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-xs text-blue-900/90 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200/90"
      >
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
        <p>
          Les modifications sur cette page ne concernent qu&apos;une intervention ponctuelle.
          Pour modifier une mission complète (récurrence, fréquence, horaires par défaut),
          va dans <Link href="/missions" className="font-medium underline-offset-2 hover:underline">Missions</Link>.
        </p>
      </div>

      {/* La grille est TOUJOURS rendue, même pour une semaine vide — la navigation
          hebdomadaire reste continue (doctrine V2 : on organise, on ne surveille pas). */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-2">
        {isEmpty && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
          >
            <CalendarOff className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              Aucune mission planifiée cette semaine. La grille reste affichée pour la navigation.
            </span>
          </div>
        )}
        <p className="text-xs text-muted-foreground md:hidden" aria-hidden>
          ← Faites glisser pour voir toute la semaine →
        </p>
        {view === 'site' ? (
          <WeekGridClient rows={siteRows} todayIso={todayIso} teams={teams} signalsBySite={signalsBySite} conflictsBySite={conflictsBySite} closuresBySite={closuresBySite} decisions={decisions} optionsBySite={optionsBySite} exceptionsById={exceptionsById} initialCellKey={params.cell ?? null}>
            <WeekGrid range={range} rows={siteRows} todayIso={todayIso} signalsBySite={signalsBySite} standingBySite={standingBySite} daysBySite={daysBySite} conflictsBySite={conflictsBySite} closuresBySite={closuresBySite} />
          </WeekGridClient>
        ) : (
          <TeamWeekGridClient rows={teamRows} todayIso={todayIso} teams={teams}>
            <TeamWeekGrid range={range} rows={teamRows} todayIso={todayIso} />
          </TeamWeekGridClient>
        )}
        {/* Légende V6.1 (Vincent 2026-05-20) : l'heure affichée dans la
            cellule est celle de la 1ʳᵉ intervention. Le nombre de points
            (● / ●●) indique combien il y en a en tout. */}
        <p className="text-xs text-muted-foreground pt-1">
          <span className="font-mono">6h30–9h45 · 3h15</span> = plage et durée de la 1ʳᵉ intervention du jour
          {' · '}
          <span>● = 1 intervention</span>
          {' · '}
          <span>●● = plusieurs (clique pour voir le détail)</span>
          {' · '}
          <span className="italic text-amber-700/80">Non-affecté</span> = à attribuer à une équipe
        </p>

        </div>
        <LecturePanel
          lecture={lecture}
          links={lectureLinks ?? { rotation: '/roulements', gaps: `/semaine?week=${formatWeekParam(range)}`, missions: [] }}
          emptyContextLabel={`Planning · ${formatWeekHeader(range)}`}
          rotationCount={rotationOptions.length}
          interventionCount={siteRows.flatMap((row) => Object.values(row.days).flat()).length}
          assignmentCount={siteRows.flatMap((row) => Object.values(row.days).flat()).filter((cell) => Boolean(cell.assigned_team_id)).length}
        />
      </div>
    </div>
  )
}


/** Décale une date ISO de N jours. */
function shiftIso(dateIso: string, days: number): string {
  const t = new Date(`${dateIso}T00:00:00.000Z`).getTime()
  if (Number.isNaN(t)) return dateIso
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10)
}
