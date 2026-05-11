import Link from 'next/link'
import { ArrowRight, MapPin, Clock } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listInterventionsByAgent } from '@/lib/db/interventions'
import { getMission } from '@/lib/db/missions'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTodayInterventionsForSites } from '@/lib/recurrence/ensure-today'

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planifiée',
  in_progress: 'En cours',
  completed: 'Terminée',
  validated: 'Validée',
}

const STATUS_BADGES: Record<string, string> = {
  planned: 'bg-slate-50 border-slate-200 text-slate-700',
  in_progress: 'bg-sky-100 border-sky-300 text-sky-800',
  completed: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  validated: 'bg-emerald-50 border-emerald-200 text-emerald-700',
}

function formatScheduledTime(iso: string): { day: string; time: string; isToday: boolean; isPast: boolean } {
  const d = new Date(iso)
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const dayStr = d.toISOString().split('T')[0]
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

export default async function FieldHomePage() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

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
  if (agentSiteIds.length > 0) {
    await ensureTodayInterventionsForSites(agentSiteIds, 1)
  }

  const interventions = await listInterventionsByAgent(user.id)

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

  // Group: in-progress + today, then later this week
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const tomorrowStart = new Date(todayStart).getTime() + 24 * 60 * 60 * 1000

  const todayInterventions = interventions.filter((i) => {
    if (i.status === 'in_progress') return true
    const t = new Date(i.scheduled_at).getTime()
    return t >= new Date(todayStart).getTime() && t < tomorrowStart
  })
  const upcomingInterventions = interventions.filter((i) => {
    if (i.status === 'in_progress') return false
    const t = new Date(i.scheduled_at).getTime()
    return t >= tomorrowStart
  })

  if (interventions.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="space-y-6 max-w-md">
      {todayInterventions.length > 0 && (
        <section className="space-y-3">
          <h1 className="text-xl font-semibold">Mes missions</h1>
          <p className="text-sm text-muted-foreground">
            {todayInterventions.length === 1
              ? '1 mission aujourd’hui'
              : `${todayInterventions.length} missions aujourd’hui`}
          </p>
          <ul className="space-y-3">
            {todayInterventions.map((i) => {
              const mission = missionById.get(i.mission_id)
              const site = mission ? siteById.get(mission.site_id) : null
              return (
                <InterventionCard
                  key={i.id}
                  interventionId={i.id}
                  missionName={mission?.name ?? 'Intervention'}
                  siteName={site?.name ?? null}
                  scheduledAt={i.scheduled_at}
                  status={i.status}
                  primary
                />
              )
            })}
          </ul>
        </section>
      )}

      {todayInterventions.length === 0 && upcomingInterventions.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h1 className="text-xl font-semibold mb-2">Mes missions</h1>
          <p className="text-base text-muted-foreground">
            Vous n&apos;avez pas de mission aujourd&apos;hui. Voir les prochaines ci-dessous.
          </p>
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
                  status={i.status}
                  primary={false}
                />
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border bg-card p-6 text-center max-w-md">
      <h1 className="text-xl font-semibold mb-2">Mes missions</h1>
      <p className="text-base text-muted-foreground">
        Vous n&apos;avez pas de mission aujourd&apos;hui.
      </p>
      <p className="text-base text-muted-foreground mt-1">
        À demain !
      </p>
    </div>
  )
}

function InterventionCard({
  interventionId,
  missionName,
  siteName,
  scheduledAt,
  status,
  primary,
}: {
  interventionId: string
  missionName: string
  siteName: string | null
  scheduledAt: string
  status: string
  primary: boolean
}) {
  const { day, time, isToday } = formatScheduledTime(scheduledAt)
  const isInProgress = status === 'in_progress'
  const isCompleted = status === 'completed' || status === 'validated'

  return (
    <li>
      <Link
        href={`/m/intervention/${interventionId}`}
        className={`block rounded-xl border p-4 transition-colors active:bg-muted/40 ${
          primary
            ? 'bg-card border-foreground/10 hover:bg-muted/20'
            : 'bg-muted/20 border-border hover:bg-muted/30'
        }`}
        style={{ minHeight: primary ? 96 : 72 }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {primary && (
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium uppercase tracking-wider ${STATUS_BADGES[status] ?? STATUS_BADGES.planned}`}>
                  {STATUS_LABELS[status] ?? status}
                </span>
              </div>
            )}
            <div className="font-semibold text-base mb-1">{missionName}</div>
            {siteName && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{siteName}</span>
              </div>
            )}
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>
                {!isToday && day + ' · '}
                {time}
              </span>
            </div>
          </div>
          {primary && !isCompleted && (
            <div className="flex flex-col items-center justify-center shrink-0">
              <div className="rounded-full bg-foreground text-background px-4 py-3 text-sm font-medium flex items-center gap-1" style={{ minHeight: 64, minWidth: 64 }}>
                {isInProgress ? 'Reprendre' : 'Commencer'}
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          )}
          {primary && isCompleted && (
            <div className="flex items-center justify-center shrink-0 text-emerald-700 text-sm">
              ✓
            </div>
          )}
          {!primary && (
            <ArrowRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
          )}
        </div>
      </Link>
    </li>
  )
}
