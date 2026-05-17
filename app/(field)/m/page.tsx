import Link from 'next/link'
import { ArrowRight, ChevronRight, MapPin, Clock, CheckCircle2, CalendarDays, AlertTriangle, History } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listInterventionsVisibleToUser } from '@/lib/db/interventions'
import { getMission } from '@/lib/db/missions'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTodayInterventionsForSites } from '@/lib/recurrence/ensure-today'
import { todayLocalIso, localDateOf, addDaysLocal } from '@/lib/time/local-date'
import { FreePhotoFab, type FreePhotoFabSite } from './FreePhotoFab'
import { DateNav } from './DateNav'
import { findMissionAbsences } from '@/lib/ai/site-readings'

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

function formatScheduledTime(iso: string): { day: string; time: string; isToday: boolean; isPast: boolean } {
  const d = new Date(iso)
  const now = new Date()
  const today = localDateOf(now)
  const dayStr = localDateOf(d)
  const isToday = dayStr === today
  const isPast = d.getTime() < now.getTime()

  return {
    day: isToday
      ? "Aujourd'hui"
      : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
    time: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    isToday,
    isPast,
  }
}

// V5.1 — Doctrine V2 : créneaux nommés, JAMAIS d'heures précises.
const SLOT_LABELS: Record<string, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  evening: 'Soir',
}

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

  // Slice 6.3 — Génération paresseuse silencieuse AVANT le fetch des
  // interventions du jour. On identifie les sites du chef_equipe via ses
  // interventions existantes (où il est dans team[]), puis on déclenche la
  // génération idempotente sur ces sites. La génération hérite du
  // default_team de la mission pour rester visible côté agent.
  // Si la génération échoue, le helper log silencieux + return zeros → le
  // rendu de la page n'est jamais bloqué.
  const supabase = createAdminClient()
  const { data: agentInterventions } = await supabase
    .from('interventions')
    .select('mission:missions(site_id)')
    .contains('team', [user.id])
    .limit(200)
  const agentSiteIds = Array.from(
    new Set(
      (agentInterventions ?? [])
        .map((r) => {
          const m = r.mission as { site_id?: string } | Array<{ site_id?: string }> | null
          if (!m) return null
          if (Array.isArray(m)) return m[0]?.site_id ?? null
          return m.site_id ?? null
        })
        .filter((s): s is string => !!s)
    )
  )
  // Génération paresseuse : seulement pour aujourd'hui, pas pour les autres jours.
  const ensurePromise = (isToday && agentSiteIds.length > 0)
    ? ensureTodayInterventionsForSites(agentSiteIds, 1)
    : Promise.resolve(null)

  // Paralléliser : FAB sites + interventions visibles + génération aujourd'hui
  const fabSitesPromise = agentSiteIds.length > 0
    ? supabase.from('sites').select('id, name').in('id', agentSiteIds).is('deleted_at', null).order('name')
    : Promise.resolve({ data: [] as Array<{ id: string; name: string }> })

  const [, fabSitesRes, interventions] = await Promise.all([
    ensurePromise,
    fabSitesPromise,
    listInterventionsVisibleToUser(user.id),
  ])

  const fabSites: FreePhotoFabSite[] = (fabSitesRes as { data: FreePhotoFabSite[] | null }).data ?? []

  // KPI chef d'équipe : interventions terminées sur les 7 derniers jours glissants
  // avec tâches obligatoires non cochées.
  type IncompleteKPI = { interventionId: string; missionName: string; siteName: string; missingCount: number; executedAt: string | null }
  let incompleteKPIs: IncompleteKPI[] = []
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
      if (missingByIntervention.size > 0) {
        const missionIdsNeeded = Array.from(missingByIntervention.keys()).map((id) => interventions.find((i) => i.id === id)?.mission_id).filter((id): id is string => !!id)
        const missionsForKPI = missionIdsNeeded.length === 0
          ? []
          : (await Promise.all(missionIdsNeeded.map((id) => getMission(id)))).filter((m): m is NonNullable<typeof m> => !!m)
        const siteIdsForKPI = Array.from(new Set(missionsForKPI.map((m) => m.site_id)))
        const { data: sitesForKPI } = siteIdsForKPI.length === 0
          ? { data: [] as Array<{ id: string; name: string }> }
          : await supabase.from('sites').select('id, name').in('id', siteIdsForKPI)
        const siteByIdKPI = new Map((sitesForKPI ?? []).map((s) => [s.id, s]))
        const missionByIdKPI = new Map(missionsForKPI.map((m) => [m.id, m]))
        for (const [intId, count] of missingByIntervention.entries()) {
          const intv = interventions.find((i) => i.id === intId)
          const mission = intv ? missionByIdKPI.get(intv.mission_id) : null
          const site = mission ? siteByIdKPI.get(mission.site_id) : null
          incompleteKPIs.push({
            interventionId: intId,
            missionName: mission?.name ?? 'Intervention',
            siteName: site?.name ?? '',
            missingCount: count,
            executedAt: intv?.executed_at ?? null,
          })
        }
        // Tri du plus récent au plus ancien
        incompleteKPIs.sort((a, b) => (b.executedAt ?? '').localeCompare(a.executedAt ?? ''))
      }
    }
  }

  // À régulariser : interventions des 7 derniers jours (hors aujourd'hui)
  // toujours en 'planned'. Ce sont des passages oubliés — ni terminés, ni
  // décalés, ni annulés. Le chef d'équipe doit les traiter pour fermer
  // proprement la dette opérationnelle.
  type OverdueKPI = { interventionId: string; missionName: string; siteName: string; scheduledFor: string; daysAgo: number }
  let overdueKPIs: OverdueKPI[] = []
  if (user.role === 'chef_equipe' || user.role === 'admin' || user.role === 'manager') {
    const sevenAgoIso = addDaysLocal(todayIso, -7)
    const overdueRaw = interventions.filter(
      (i) => i.status === 'planned'
        && i.scheduled_for
        && i.scheduled_for >= sevenAgoIso
        && i.scheduled_for < todayIso,
    )
    if (overdueRaw.length > 0) {
      const missionIdsNeeded = Array.from(new Set(overdueRaw.map((i) => i.mission_id)))
      const missionsForOv = (await Promise.all(missionIdsNeeded.map((id) => getMission(id))))
        .filter((m): m is NonNullable<typeof m> => !!m)
      const siteIdsForOv = Array.from(new Set(missionsForOv.map((m) => m.site_id)))
      const { data: sitesForOv } = siteIdsForOv.length === 0
        ? { data: [] as Array<{ id: string; name: string }> }
        : await supabase.from('sites').select('id, name').in('id', siteIdsForOv)
      const siteByIdOv = new Map((sitesForOv ?? []).map((s) => [s.id, s]))
      const missionByIdOv = new Map(missionsForOv.map((m) => [m.id, m]))
      const [ty, tm, td] = todayIso.split('-').map(Number)
      const todayUtcMs = Date.UTC(ty, tm - 1, td)
      for (const i of overdueRaw) {
        const mission = missionByIdOv.get(i.mission_id)
        const site = mission ? siteByIdOv.get(mission.site_id) : null
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
      // Plus ancien d'abord (priorité de régularisation)
      overdueKPIs.sort((a, b) => b.daysAgo - a.daysAgo)
    }
  }

  // Fetch missions + sites for context
  const missionIds = Array.from(new Set(interventions.map((i) => i.mission_id)))
  const missions = missionIds.length === 0
    ? []
    : (await Promise.all(missionIds.map((id) => getMission(id)))).filter((m): m is NonNullable<typeof m> => !!m)
  const missionById = new Map(missions.map((m) => [m.id, m]))

  const siteIds = Array.from(new Set(missions.map((m) => m.site_id)))
  const { data: sites } = siteIds.length === 0
    ? { data: [] as Array<{ id: string; name: string }> }
    : await supabase.from('sites').select('id, name').in('id', siteIds)
  const siteById = new Map((sites ?? []).map((s) => [s.id, s]))

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

  if (interventions.length === 0) {
    return (
      <>
        <div className="rounded-lg border bg-card max-w-md">
          <EmptyState
            icon={CheckCircle2}
            title="Pas d'intervention prévue aujourd'hui"
            description="La page se mettra à jour quand une mission sera planifiée."
            variant="compact"
          />
        </div>
        <FreePhotoFab sites={fabSites} />
      </>
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

      {overdueKPIs.length > 0 && isToday && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" />
            À régulariser (7 derniers jours)
          </h2>
          <ul className="space-y-1.5">
            {overdueKPIs.map((kpi) => {
              const ageLabel = kpi.daysAgo === 1 ? 'hier' : `il y a ${kpi.daysAgo} j`
              return (
                <li key={kpi.interventionId}>
                  <Link
                    href={`/m/intervention/${kpi.interventionId}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 active:bg-amber-100/80"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-amber-900 truncate">{kpi.missionName}</div>
                      {kpi.siteName && <div className="text-xs text-amber-700/70 truncate">{kpi.siteName}</div>}
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5 tabular-nums">
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
          <h2 className="text-xs font-semibold uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Tâches non terminées (7 derniers jours)
          </h2>
          <ul className="space-y-1.5">
            {incompleteKPIs.map((kpi) => (
              <li key={kpi.interventionId}>
                <Link
                  href={`/m/intervention/${kpi.interventionId}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 active:bg-amber-100/80"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-amber-900 truncate">{kpi.missionName}</div>
                    <div className="flex items-center gap-2 text-xs text-amber-700/70">
                      {kpi.siteName && <span className="truncate">{kpi.siteName}</span>}
                      {kpi.executedAt && (
                        <span className="shrink-0 tabular-nums">
                          {new Date(kpi.executedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5 tabular-nums">
                    {kpi.missingCount} manquante{kpi.missingCount > 1 ? 's' : ''}
                  </span>
                </Link>
              </li>
            ))}
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
                  scheduledAt={i.scheduled_at}
                  slot={i.slot ?? null}
                  status={i.status}
                  skippedReason={i.skipped_reason}
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
                  scheduledAt={i.scheduled_at}
                  slot={i.slot ?? null}
                  status={i.status}
                  skippedReason={i.skipped_reason}
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
  scheduledAt,
  slot,
  status,
  skippedReason,
  primary,
}: {
  interventionId: string
  missionName: string
  siteName: string | null
  scheduledAt: string
  slot: string | null
  status: string
  skippedReason: string | null
  primary: boolean
}) {
  const { day, isToday } = formatScheduledTime(scheduledAt)
  const slotLabel = slot ? SLOT_LABELS[slot] ?? null : null
  const slotBadgeClass = slot
    ? SLOT_BADGE_CLASSES[slot] ?? 'bg-muted text-foreground border-border'
    : 'bg-muted text-foreground border-border'
  const isInProgress = status === 'in_progress'
  const isCompleted = status === 'completed' || status === 'validated'
  const isSkipped = status === 'skipped'

  return (
    <li>
      <Link
        href={`/m/intervention/${interventionId}`}
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
            <div className={`font-semibold text-base mb-1 underline decoration-muted-foreground/30 underline-offset-2 ${isSkipped ? 'line-through decoration-amber-700/40' : ''}`}>
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
                {isInProgress ? 'Reprendre' : 'Commencer'}
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
