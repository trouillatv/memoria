// Phase 9 — Vue Semaine & Équipes (Slice 9.3, étendu 9.4)
//
// Page /semaine : Vue Site × Jour primaire.
// Slice 9.3 : read-only.
// Slice 9.4 : drag & drop replanification + réassignation équipe.
// La Vue Équipe × Jour arrive en Slice 9.5.
//
// Doctrine V2 (cf. docs/superpowers/doctrines/planning-doctrine.md V2) :
//   - Vue Site × Jour PRIMAIRE (Équipe × Jour sera secondaire)
//   - Créneaux nommés (m / a / s), JAMAIS d'heures précises
//   - "Non-affecté" = signal ambre discret, JAMAIS rouge
//   - Aucune métrique de performance / charge / saturation / retard
//   - Wording neutre : on organise, on ne surveille pas
//
// Auth : admin OR manager. Belt + suspenders avec le check du layout dashboard.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Calendar, CalendarOff, FileDown, Info } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  formatWeekParam,
  getWeekBySite,
  getWeekByTeam,
  parseWeekParam,
  type WeekRange,
  type SiteRow,
  type TeamRow,
} from '@/lib/db/week-planning'
import { listTeams } from '@/lib/db/teams'
import { WeekNavigation } from './WeekNavigation'
import { CreateInterventionDialog, type MissionOption } from './CreateInterventionDialog'
import { WeekGrid } from './WeekGrid'
import { WeekGridClient } from './WeekGridClient'
import { TeamWeekGrid } from './TeamWeekGrid'
import { TeamWeekGridClient } from './TeamWeekGridClient'
import { ViewModeToggle } from './ViewModeToggle'
import { parseViewMode } from './view-mode-storage'

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

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface PageProps {
  searchParams: Promise<{ week?: string; view?: string; debug?: string }>
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

/** Liste toutes les missions actives (non archivées) avec site + contrat pour le
 * picker du dialogue de planification. Requête admin (manager+ uniquement, déjà
 * vérifié plus haut). */
async function fetchMissionOptions(): Promise<MissionOption[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('missions')
    .select(
      `id, name, assigned_team_id,
       site:sites!inner(name, deleted_at, contract:contracts!inner(name, deleted_at))`,
    )
    .is('deleted_at', null)
    .eq('active', true)
  if (error) throw error
  const out: MissionOption[] = []
  for (const m of (data ?? []) as Array<{
    id: string
    name: string
    assigned_team_id: string | null
    site:
      | { name: string; deleted_at: string | null; contract: { name: string; deleted_at: string | null } | { name: string; deleted_at: string | null }[] | null }
      | Array<{ name: string; deleted_at: string | null; contract: { name: string; deleted_at: string | null } | { name: string; deleted_at: string | null }[] | null }>
  }>) {
    const site = Array.isArray(m.site) ? m.site[0] : m.site
    if (!site || site.deleted_at) continue
    const contract = Array.isArray(site.contract) ? site.contract[0] : site.contract
    if (!contract || contract.deleted_at) continue
    out.push({
      id: m.id,
      name: m.name,
      siteName: site.name,
      contractName: contract.name,
      defaultTeamId: m.assigned_team_id,
    })
  }
  return out
}

/** Compte les membres actifs par équipe (left_at IS NULL). Info descriptive,
 * doctrine V2 : JAMAIS exploité comme KPI. */
async function fetchTeamMemberCounts(): Promise<Map<string, number>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id')
    .is('left_at', null)
  if (error) throw error
  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    counts.set(row.team_id, (counts.get(row.team_id) ?? 0) + 1)
  }
  return counts
}

export default async function SemainePage({ searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')

  const params = await searchParams
  const range = parseWeekParam(params.week)
  const view = parseViewMode(params.view)
  const isDebug = params.debug === 'true'

  // On fetch UNIQUEMENT la vue active pour éviter du I/O inutile (la TeamRow
  // fait un appel supplémentaire à teams + team_members).
  const [siteRows, teamRows, allTeams, missionOptions, memberCounts] = await Promise.all([
    view === 'site' ? getWeekBySite(range) : Promise.resolve<SiteRow[]>([]),
    view === 'team' ? getWeekByTeam(range) : Promise.resolve<TeamRow[]>([]),
    listTeams(),
    fetchMissionOptions(),
    fetchTeamMemberCounts(),
  ])
  const activeTeams = allTeams.filter((t) => t.active && !t.deleted_at)
  const teams = activeTeams.map((t) => ({ id: t.id, name: t.name, color: t.color }))
  const teamOptions = activeTeams.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    memberCount: memberCounts.get(t.id) ?? 0,
  }))
  const todayIso = todayUtcIso()

  const total = view === 'site' ? totalSite(siteRows) : totalTeam(teamRows)
  const isEmpty =
    (view === 'site' && (siteRows.length === 0 || total === 0)) ||
    (view === 'team' && total === 0)

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
              ? 'Vue Site × Jour. Organisation de la couverture. Aucune métrique de surveillance.'
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
          <CreateInterventionDialog
            missions={missionOptions}
            teams={teamOptions}
            defaultDate={range.weekStart > todayIso ? range.weekStart : todayIso}
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

      {/* Doctrine /semaine — modifications ponctuelles uniquement.
          Discret mais permanent : c'est la règle produit, pas un toast éphémère. */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-xs text-blue-900/90 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200/90"
      >
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
        <p>
          Les modifications sur cette page ne concernent qu&apos;une intervention ponctuelle.
          Pour modifier une mission complète (récurrence, fréquence, créneaux par défaut),
          va dans <Link href="/missions" className="font-medium underline-offset-2 hover:underline">Missions</Link>.
        </p>
      </div>

      {/* La grille est TOUJOURS rendue, même pour une semaine vide — la navigation
          hebdomadaire reste continue (doctrine V2 : on organise, on ne surveille pas). */}
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
          <WeekGridClient rows={siteRows} todayIso={todayIso} teams={teams}>
            <WeekGrid range={range} rows={siteRows} todayIso={todayIso} />
          </WeekGridClient>
        ) : (
          <TeamWeekGridClient rows={teamRows} todayIso={todayIso} teams={teams}>
            <TeamWeekGrid range={range} rows={teamRows} todayIso={todayIso} />
          </TeamWeekGridClient>
        )}
        {/* Légende — créneaux nommés, jamais d'heures précises (doctrine V2) */}
        <p className="text-xs text-muted-foreground pt-1">
          <span className="font-mono">m</span> = matin
          {' · '}
          <span className="font-mono">a</span> = après-midi
          {' · '}
          <span className="font-mono">s</span> = soir
          {' · '}
          <span className="italic text-amber-700/80">Non-affecté</span> = à attribuer à une équipe
        </p>
      </div>
    </div>
  )
}
