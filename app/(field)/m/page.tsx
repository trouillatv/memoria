import Link from 'next/link'
import { ArrowRight, MapPin, Clock, CheckCircle2, CalendarDays } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listInterventionsVisibleToUser } from '@/lib/db/interventions'
import { getMission } from '@/lib/db/missions'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTodayInterventionsForSites } from '@/lib/recurrence/ensure-today'
import { FreePhotoFab, type FreePhotoFabSite } from './FreePhotoFab'

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

// V5.1 — Doctrine V2 : créneaux nommés, JAMAIS d'heures précises.
const SLOT_LABELS: Record<string, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  evening: 'Soir',
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

  // V5.1 Slice 1 — Sites disponibles pour le FAB "Photo libre". Liste plus
  // large que celle dérivée des interventions visibles (J-1 → J+7) : on
  // exploite agentSiteIds (200 dernières interventions où l'agent est dans
  // team) pour permettre le dépôt spontané sur un site déjà visité même hors
  // de la fenêtre planning courante.
  let fabSites: FreePhotoFabSite[] = []
  if (agentSiteIds.length > 0) {
    const { data: allAgentSites } = await supabase
      .from('sites')
      .select('id, name')
      .in('id', agentSiteIds)
      .is('deleted_at', null)
      .order('name')
    fabSites = allAgentSites ?? []
  }

  const interventions = await listInterventionsVisibleToUser(user.id)

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
    return (
      <>
        <div className="rounded-lg border bg-card max-w-md">
          <EmptyState
            icon={CheckCircle2}
            title="Pas d'intervention prévue aujourd'hui"
            description="Profitez de votre journée. Vous serez prévenu au prochain ordre de mission."
            variant="compact"
          />
        </div>
        <FreePhotoFab sites={fabSites} />
      </>
    )
  }

  return (
    <div className="space-y-6 max-w-md pb-32">
      {todayInterventions.length > 0 && (
        <section className="space-y-3">
          {/* J1 — Doctrine V5 Pilier 5 : dignité > sophistication.
              Reconnaître Joseph par son prénom avant de lui afficher une liste.
              Le vocabulaire ("mission" vs "passage") sera arbitré par A/B pilote. */}
          <h1 className="text-xl font-semibold">
            Bonjour {firstNameOf(user.full_name, user.email)}
          </h1>
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

      {todayInterventions.length === 0 && upcomingInterventions.length > 0 && (
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
            <div className={`font-semibold text-base mb-1 ${isSkipped ? 'line-through decoration-amber-700/40' : ''}`}>
              {missionName}
            </div>
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
                {slotLabel ?? '—'}
              </span>
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
            <div className="flex items-center justify-center shrink-0 text-emerald-700 text-sm">
              ✓
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
