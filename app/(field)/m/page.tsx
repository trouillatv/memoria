import Link from 'next/link'
import { ArrowRight, ArrowRightLeft, ChevronRight, MapPin, Clock, CheckCircle2, CalendarDays, AlertTriangle, History } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listInterventionsVisibleToUser } from '@/lib/db/interventions'
import { listActiveTeamIdsForUser } from '@/lib/db/teams'
import { listSharedHandoverBriefsForChef } from '@/lib/db/handover'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTodayInterventionsForSites } from '@/lib/recurrence/ensure-today'
import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import { FreePhotoFab, type FreePhotoFabSite } from './FreePhotoFab'
import { DateNav } from './DateNav'
import { findMissionAbsences } from '@/lib/ai/site-readings'
import { listOrgTodayInterventions } from '@/lib/db/field-today'
import { ManagerTodayView } from './ManagerTodayView'

/** J1 — Prénom de l'agent à partir du `full_name` (1er mot). Fallback : local-part
 * de l'email avant `@` capitalisée. Évite « Bonjour user@email.com » disgracieux. */
function firstNameOf(fullName: string | null, email: string): string {
  const trimmed = (fullName ?? '').trim()
  if (trimmed.length > 0) {
    const first = trimmed.split(/\s+/)[0]
    if (first) return first
  }
  const local = (email.split('@')[0] ?? email).trim()
  if (local.length === 0) return ''
  return local[0].toUpperCase() + local.slice(1)
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

// Reçoit une date civile pure (YYYY-MM-DD = scheduled_for), JAMAIS un
// `scheduled_at` (timestamp UTC dérivé du créneau : "soir" → 18:00 UTC, qui
// en Nouméa UTC+11 bascule au lendemain). Tout est comparé/formaté en civil.
function formatScheduledTime(civilDate: string): { day: string; isToday: boolean; isPast: boolean } {
  const today = todayLocalIso()
  const isToday = civilDate === today
  const isPast = civilDate < today
  const d = new Date(civilDate + 'T00:00:00.000Z')

  return {
    day: isToday
      ? "Aujourd'hui"
      : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
    isToday,
    isPast,
  }
}

// V5.1 — Doctrine V2 : créneaux nommés, JAMAIS d'heures précises.

// V5.1 — Badge créneau coloré (signature visuelle descriptive du moment de
// la journée). Teintes douces -100/-900, pas saturées alarmistes.
const SLOT_BADGE_CLASSES: Record<string, string> = {
  morning: 'bg-amber-100 text-amber-900 border-amber-200',
  afternoon: 'bg-sky-100 text-sky-900 border-sky-200',
  evening: 'bg-indigo-100 text-indigo-900 border-indigo-200',
}

export default async function FieldHomePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const params = await searchParams
  const todayIso = todayLocalIso()
  const selectedDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : todayIso
  const isToday = selectedDate === todayIso
  const isPast = selectedDate < todayIso
  const isFuture = selectedDate > todayIso

  const supabase = createAdminClient()

  // Étape 1 — Team IDs de l'agent (source canonique : assigned_team_id).
  // Résolution séquentielle voulue : chefTeamIds est requis pour calculer
  // agentSiteIds via missions.assigned_team_id, ce qui était impossible avec
  // l'ancien calcul basé sur le legacy team[] (vide pour les V2 interventions).
  const chefTeamIds = await listActiveTeamIdsForUser(user.id)

  // Sites dont une des missions de l'agent est responsable (assigned_team_id).
  // Fallback legacy : interventions.team[] pour les comptes antérieurs à V2.
  let agentSiteIds: string[] = []
  if (chefTeamIds.length > 0) {
    const { data: missionSiteRows } = await supabase
      .from('missions')
      .select('site_id')
      .in('assigned_team_id', chefTeamIds)
      .is('deleted_at', null)
    agentSiteIds = Array.from(new Set(
      (missionSiteRows ?? []).map((m) => m.site_id).filter((s): s is string => !!s)
    ))
  }
  if (agentSiteIds.length === 0) {
    const { data: legacyIntRes } = await supabase
      .from('interventions')
      .select('mission:missions(site_id)')
      .contains('team', [user.id])
      .limit(200)
    agentSiteIds = Array.from(new Set(
      (legacyIntRes ?? [])
        .map((r) => {
          const m = r.mission as { site_id?: string } | Array<{ site_id?: string }> | null
          if (!m) return null
          if (Array.isArray(m)) return m[0]?.site_id ?? null
          return m.site_id ?? null
        })
        .filter((s): s is string => !!s)
    ))
  }

  // Étape 2 — Génération paresseuse AVANT le fetch des interventions.
  // Obligation séquentielle : ensure doit inscrire les records récurrents en DB
  // AVANT que listInterventionsVisibleToUser les cherche. Couvre aujourd'hui + J+3
  // (toutes les dates visibles dans le DateNav). Idempotente : UNIQUE constraint.
  if (agentSiteIds.length > 0) {
    await ensureTodayInterventionsForSites(agentSiteIds, 4)
  }

  // Étape 3 — Fetch en parallèle : les records récurrents existent maintenant.
  const fabSitesPromise = agentSiteIds.length > 0
    ? supabase.from('sites').select('id, name').in('id', agentSiteIds).is('deleted_at', null).order('name')
    : Promise.resolve({ data: [] as Array<{ id: string; name: string }> })
  const [interventions, handoverBriefs, fabSitesRes] = await Promise.all([
    listInterventionsVisibleToUser(user.id),
    listSharedHandoverBriefsForChef(user.id, chefTeamIds),
    fabSitesPromise,
  ])

  // Batch unique : toutes les missions + tous les sites en 1 requête.
  // Dépend de interventions.map(mission_id) → 2ème vague de fetch.
  const allMissionIds = Array.from(new Set(interventions.map((i) => i.mission_id)))
  const allMissionsRes = allMissionIds.length === 0
    ? { data: [] as Array<{ id: string; name: string; site_id: string; cadence: string }> }
    : await supabase.from('missions').select('id, name, site_id, cadence').in('id', allMissionIds).is('deleted_at', null)

  const missionById = new Map(
    ((allMissionsRes as { data: Array<{ id: string; name: string; site_id: string; cadence: string }> | null }).data ?? [])
      .map((m) => [m.id, m])
  )

  const allSiteIds = Array.from(new Set(
    ((allMissionsRes as { data: Array<{ id: string; name: string; site_id: string; cadence: string }> | null }).data ?? [])
      .map((m) => m.site_id)
  ))
  const { data: allSitesData } = allSiteIds.length === 0
    ? { data: [] as Array<{ id: string; name: string }> }
    : await supabase.from('sites').select('id, name').in('id', allSiteIds)
  const siteById = new Map((allSitesData ?? []).map((s) => [s.id, s]))

  const fabSites: FreePhotoFabSite[] = (fabSitesRes as { data: FreePhotoFabSite[] | null }).data ?? []

  // KPI chef d'équipe : interventions terminées sur les 7 derniers jours glissants
  // avec tâches obligatoires non cochées. Utilise missionById/siteById déjà chargés.
  type IncompleteKPI = { interventionId: string; missionName: string; siteName: string; missingCount: number; executedAt: string | null }
  const incompleteKPIs: IncompleteKPI[] = []
  if (user.role === 'chef_equipe' || user.role === 'admin' || user.role === 'manager') {
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const completedRecentIds = interventions
      .filter((i) => (i.status === 'completed' || i.status === 'validated') && i.executed_at && i.executed_at >= sevenDaysAgoIso)
      .map((i) => i.id)
    if (completedRecentIds.length > 0) {
      const { data: missingItems } = await supabase
        .from('intervention_checklist_items')
        .select('intervention_id')
        .in('intervention_id', completedRecentIds)
        .eq('required', true)
        .eq('done', false)
      const missingByIntervention = new Map<string, number>()
      for (const row of (missingItems ?? []) as Array<{ intervention_id: string }>) {
        missingByIntervention.set(row.intervention_id, (missingByIntervention.get(row.intervention_id) ?? 0) + 1)
      }
      for (const [intId, count] of missingByIntervention.entries()) {
        const intv = interventions.find((i) => i.id === intId)
        const mission = intv ? missionById.get(intv.mission_id) : null
        const site = mission ? siteById.get(mission.site_id) : null
        incompleteKPIs.push({
          interventionId: intId,
          missionName: mission?.name ?? 'Intervention',
          siteName: site?.name ?? '',
          missingCount: count,
          executedAt: intv?.executed_at ?? null,
        })
      }
      incompleteKPIs.sort((a, b) => (b.executedAt ?? '').localeCompare(a.executedAt ?? ''))
    }
  }

  // À régulariser : interventions des 7 derniers jours (hors aujourd'hui)
  // toujours en 'planned'. Utilise missionById/siteById déjà chargés.
  type OverdueKPI = { interventionId: string; missionName: string; siteName: string; scheduledFor: string; daysAgo: number }
  const overdueKPIs: OverdueKPI[] = []
  if (user.role === 'chef_equipe' || user.role === 'admin' || user.role === 'manager') {
    const sevenAgoIso = addDaysLocal(todayIso, -7)
    const overdueRaw = interventions.filter(
      (i) => i.status === 'planned'
        && i.scheduled_for
        && i.scheduled_for >= sevenAgoIso
        && i.scheduled_for < todayIso,
    )
    const [ty, tm, td] = todayIso.split('-').map(Number)
    const todayUtcMs = Date.UTC(ty, tm - 1, td)
    for (const i of overdueRaw) {
      const mission = missionById.get(i.mission_id)
      const site = mission ? siteById.get(mission.site_id) : null
      const [sy, sm, sd] = (i.scheduled_for ?? '').split('-').map(Number)
      const daysAgo = Math.round((todayUtcMs - Date.UTC(sy, sm - 1, sd)) / 86_400_000)
      overdueKPIs.push({
        interventionId: i.id,
        missionName: mission?.name ?? 'Intervention',
        siteName: site?.name ?? '',
        scheduledFor: i.scheduled_for!,
        daysAgo,
      })
    }
    overdueKPIs.sort((a, b) => b.daysAgo - a.daysAgo)
  }

  // Filtrage par date sélectionnée (par défaut = aujourd'hui Nouméa).
  // On compare scheduled_for (date civile) directement à selectedDate.
  // Les in_progress sont toujours visibles dans la sélection "aujourd'hui"
  // (cohérent UX : si l'agent a démarré, c'est sa mission active).
  const selectedInterventions = interventions.filter((i) => {
    if (isToday && i.status === 'in_progress') return true
    return i.scheduled_for === selectedDate
  })
  const upcomingInterventions = isToday
    ? interventions.filter((i) => {
        if (i.status === 'in_progress') return false
        return (i.scheduled_for ?? '') > todayIso
      })
    : []

  // Lectures du lieu — absences d'exécution pour les sites du jour (mobile only)
  const todaySiteIds = Array.from(new Set(
    selectedInterventions.map((i) => missionById.get(i.mission_id)?.site_id).filter((id): id is string => !!id)
  ))
  // Missions en cours aujourd'hui → exclues de la liste d'absences pour éviter
  // de signaler comme "absent" ce que Joseph est justement en train de faire.
  const todayMissionNames = new Set(
    selectedInterventions.map((i) => missionById.get(i.mission_id)?.name).filter((n): n is string => !!n)
  )
  const mobileAbsences = isToday && todaySiteIds.length > 0
    ? (await Promise.all(todaySiteIds.map((sid) => findMissionAbsences(sid)))).flat()
        .filter((abs) => !todayMissionNames.has(abs.missionName))
        .sort((a, b) => b.weeksSince - a.weeksSince).slice(0, 2)
    : []

  // Vue superviseur : pour les managers/admins sans intervention assignée,
  // afficher toutes les interventions du jour de l'organisation.
  const isManager = user.role === 'admin' || user.role === 'manager'
  const orgTodaySites =
    isManager && isToday && interventions.length === 0 && user.organization_id
      ? await listOrgTodayInterventions(user.organization_id, todayIso)
      : []

  if (interventions.length === 0 && orgTodaySites.length > 0) {
    return (
      <div className="space-y-6 max-w-md pb-32">
        <DateNav todayIso={todayIso} selectedIso={selectedDate} />
        <ManagerTodayView sites={orgTodaySites} todayLabel="aujourd'hui" />
        <FreePhotoFab sites={fabSites} />
      </div>
    )
  }

  if (interventions.length === 0) {
    return (
      <div className="space-y-6 max-w-md pb-32">
        <DateNav todayIso={todayIso} selectedIso={selectedDate} />
        <div className="rounded-lg border bg-card max-w-md">
          <EmptyState
            icon={CheckCircle2}
            title="Pas d'intervention prévue aujourd'hui"
            description="La page se mettra à jour quand une mission sera planifiée."
            variant="compact"
          />
        </div>
        <FreePhotoFab sites={fabSites} />
      </div>
    )
  }

  // Label "missions du jour" selon contexte
  const dayLabel = isToday
    ? "aujourd'hui"
    : isPast
      ? new Date(selectedDate + 'T00:00:00.000Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      : new Date(selectedDate + 'T00:00:00.000Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

  return (
    <div className="space-y-6 max-w-md pb-32">
      <DateNav todayIso={todayIso} selectedIso={selectedDate} />

      {/* V6.2 (Vincent 2026-05-20) — alertes mobile chef d'équipe au ROUGE.
          Position déjà en haut (juste après DateNav), couleurs renforcées.
          Silence positif respecté : si overdueKPIs/incompleteKPIs vides, rien
          ne s'affiche. Cf. [[alertes-doctrine-legere]]. */}
      {overdueKPIs.length > 0 && isToday && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-red-700 dark:text-red-300 flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" strokeWidth={2.25} />
            À régulariser (7 derniers jours)
          </h2>
          <ul className="space-y-1.5">
            {overdueKPIs.map((kpi) => {
              const ageLabel = kpi.daysAgo === 1 ? 'hier' : `il y a ${kpi.daysAgo} j`
              return (
                <li key={kpi.interventionId}>
                  <Link
                    href={`/m/intervention/${kpi.interventionId}?date=${selectedDate}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/60 px-3 py-2.5 active:bg-red-100/80 dark:border-red-900/40 dark:bg-red-950/20 dark:active:bg-red-950/40"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-red-950 dark:text-red-50 truncate">{kpi.missionName}</div>
                      {kpi.siteName && <div className="text-xs text-red-900/70 dark:text-red-200/70 truncate">{kpi.siteName}</div>}
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-red-900 bg-red-100 border border-red-300 rounded-full px-2 py-0.5 tabular-nums dark:text-red-100 dark:bg-red-900/40 dark:border-red-800">
                      {ageLabel}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {incompleteKPIs.length > 0 && isToday && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-red-700 dark:text-red-300 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.25} />
            Tâches non terminées (7 derniers jours)
          </h2>
          <ul className="space-y-1.5">
            {incompleteKPIs.map((kpi) => (
              <li key={kpi.interventionId}>
                <Link
                  href={`/m/intervention/${kpi.interventionId}?date=${selectedDate}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/60 px-3 py-2.5 active:bg-red-100/80 dark:border-red-900/40 dark:bg-red-950/20 dark:active:bg-red-950/40"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-red-950 dark:text-red-50 truncate">{kpi.missionName}</div>
                    <div className="flex items-center gap-2 text-xs text-red-900/70 dark:text-red-200/70">
                      {kpi.siteName && <span className="truncate">{kpi.siteName}</span>}
                      {kpi.executedAt && (
                        <span className="shrink-0 tabular-nums">
                          {new Date(kpi.executedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-red-900 bg-red-100 border border-red-300 rounded-full px-2 py-0.5 tabular-nums dark:text-red-100 dark:bg-red-900/40 dark:border-red-800">
                    {kpi.missingCount} manquante{kpi.missingCount > 1 ? 's' : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* P1 audit live — Briefs de passation reçus, retrouvables ici même si le
          lien SMS est perdu. Ouvre la vue publique /h/[token] (lisible sans
          login, avec accusé « C'est lu »). Sujet = mémoire transmise. */}
      {handoverBriefs.length > 0 && isToday && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <ArrowRightLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
            Briefs à lire
          </h2>
          <ul className="space-y-1.5">
            {handoverBriefs.map((b) => {
              const ack = b.status === 'acknowledged'
              const siteCount = b.payload?.sites?.length ?? 0
              return (
                <li key={b.id}>
                  <Link
                    href={`/h/${b.shared_token}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 active:bg-indigo-100/80 dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:active:bg-indigo-950/40"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{b.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {siteCount > 0 ? `${siteCount} site${siteCount > 1 ? 's' : ''} · ` : ''}
                        mémoire transmise
                      </div>
                    </div>
                    {ack ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Lu
                      </span>
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {selectedInterventions.length > 0 && (
        <section className="space-y-3">
          {/* J1 — Doctrine V5 Pilier 5 : dignité > sophistication.
              Reconnaître Joseph par son prénom avant de lui afficher une liste. */}
          {isToday && (
            <h1 className="text-xl font-semibold">
              Bonjour {firstNameOf(user.full_name, user.email)}
            </h1>
          )}
          <p className="text-sm text-muted-foreground">
            {selectedInterventions.length === 1
              ? `1 mission ${dayLabel}`
              : `${selectedInterventions.length} missions ${dayLabel}`}
          </p>
          <ul className="space-y-3">
            {selectedInterventions.map((i) => {
              const mission = missionById.get(i.mission_id)
              const site = mission ? siteById.get(mission.site_id) : null
              return (
                <InterventionCard
                  key={i.id}
                  interventionId={i.id}
                  missionName={mission?.name ?? 'Intervention'}
                  siteName={site?.name ?? null}
                  siteId={mission?.site_id ?? null}
                  scheduledFor={i.scheduled_for ?? i.scheduled_at.slice(0, 10)}
                  slot={i.slot ?? null}
                  plannedStart={i.planned_start}
                  plannedEnd={i.planned_end}
                  status={i.status}
                  skippedReason={i.skipped_reason}
                  selectedDate={selectedDate}
                  primary
                />
              )
            })}
          </ul>
        </section>
      )}

      {mobileAbsences.length > 0 && (
        <section className="space-y-1.5 px-0.5">
          {mobileAbsences.map((abs, i) => (
            <p key={i} className="text-xs text-muted-foreground/80 italic pl-2 border-l border-muted leading-relaxed">
              {abs.weeksSince >= 16
                ? `${abs.missionName} — absent depuis ${Math.round(abs.weeksSince / 4.3)} mois`
                : `${abs.missionName} — absent depuis ${abs.weeksSince} semaines`}
            </p>
          ))}
        </section>
      )}

      {selectedInterventions.length === 0 && upcomingInterventions.length > 0 && (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={CalendarDays}
            title="Rien à faire aujourd'hui"
            description={`Vous avez ${upcomingInterventions.length} intervention${upcomingInterventions.length > 1 ? 's' : ''} à venir cette semaine.`}
            variant="compact"
          />
        </div>
      )}

      {upcomingInterventions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            À venir
          </h2>
          <ul className="space-y-2">
            {upcomingInterventions.map((i) => {
              const mission = missionById.get(i.mission_id)
              const site = mission ? siteById.get(mission.site_id) : null
              return (
                <InterventionCard
                  key={i.id}
                  interventionId={i.id}
                  missionName={mission?.name ?? 'Intervention'}
                  siteName={site?.name ?? null}
                  siteId={mission?.site_id ?? null}
                  scheduledFor={i.scheduled_for ?? i.scheduled_at.slice(0, 10)}
                  slot={i.slot ?? null}
                  plannedStart={i.planned_start}
                  plannedEnd={i.planned_end}
                  status={i.status}
                  skippedReason={i.skipped_reason}
                  selectedDate={selectedDate}
                  primary={false}
                />
              )
            })}
          </ul>
        </section>
      )}
      <FreePhotoFab sites={fabSites} />
    </div>
  )
}

function InterventionCard({
  interventionId,
  missionName,
  siteName,
  siteId,
  scheduledFor,
  slot,
  plannedStart,
  plannedEnd,
  status,
  skippedReason,
  selectedDate,
  primary,
}: {
  interventionId: string
  missionName: string
  siteName: string | null
  siteId: string | null
  scheduledFor: string
  slot: string | null
  plannedStart: string | null
  plannedEnd: string | null
  status: string
  skippedReason: string | null
  selectedDate: string
  primary: boolean
}) {
  const { day, isToday } = formatScheduledTime(scheduledFor)
  // V6.2 — affiche l'HEURE (précise si saisie, ancrage sinon), jamais le mot
  // « matin ». Le slot ne sert plus qu'à la couleur du badge.
  const slotLabel = formatInterventionTimeLabel({
    planned_start: plannedStart,
    planned_end: plannedEnd,
    slot: (slot as 'morning' | 'afternoon' | 'evening' | null) ?? null,
  })
  const slotBadgeClass = slot
    ? SLOT_BADGE_CLASSES[slot] ?? 'bg-muted text-foreground border-border'
    : 'bg-muted text-foreground border-border'
  const isInProgress = status === 'in_progress'
  const isCompleted = status === 'completed' || status === 'validated'
  const isSkipped = status === 'skipped'

  return (
    <li>
      <Link
        href={`/m/intervention/${interventionId}?date=${selectedDate}`}
        className={`block rounded-xl border p-4 transition-colors active:bg-muted/40 ${
          isSkipped
            ? 'bg-muted/30 border-border opacity-70 hover:bg-muted/40'
            : primary
              ? 'bg-card border-foreground/10 hover:bg-muted/20'
              : 'bg-muted/20 border-border hover:bg-muted/30'
        }`}
        style={{ minHeight: primary ? 96 : 72 }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {(primary || isSkipped) && (
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <StatusBadge status={status} />
                {isSkipped && skippedReason && (
                  <span
                    className="text-[11px] text-amber-900/80 italic truncate"
                    title={skippedReason}
                  >
                    — {truncate(skippedReason, 50)}
                  </span>
                )}
              </div>
            )}
            <div className={`font-semibold text-base mb-1 underline underline-offset-2 ${isSkipped ? 'line-through decoration-amber-700/40' : 'decoration-foreground/40'}`}>
              {missionName}
            </div>
            {siteName && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{siteName}</span>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {!isToday && (
                <div className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>{day}</span>
                </div>
              )}
              {slotLabel && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${slotBadgeClass}`}
                >
                  {slotLabel}
                </span>
              )}
            </div>
          </div>
          {primary && !isCompleted && !isSkipped && (
            <div className="flex flex-col items-center justify-center shrink-0">
              <div className="rounded-full bg-foreground text-background px-4 py-3 text-sm font-medium flex items-center gap-1" style={{ minHeight: 64, minWidth: 64 }}>
                {isInProgress ? 'Réouvrir' : 'Démarrer'}
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          )}
          {primary && isCompleted && (
            <div className="flex items-center gap-1.5 shrink-0 text-emerald-700 text-sm">
              ✓
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          {(!primary || isSkipped) && (
            <ArrowRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
          )}
        </div>
      </Link>
    </li>
  )
}
