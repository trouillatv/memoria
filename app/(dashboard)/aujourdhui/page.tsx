// Page « Interventions du jour » — pendant Briefing du soir prépare DEMAIN,
// cette page suit AUJOURD'HUI en temps réel.
//
// Doctrine V5 + V6.1 (Vincent 2026-05-21 — purge créneau cohérence avec /semaine) :
//   - Flux chronologique par planned_start (plus de groupes par créneau).
//   - Plage horaire affichée PAR intervention (formatInterventionTimeLabel).
//   - Tout est visible (terminées incluses, opacité réduite — pas masquées).
//   - Stats : Prévues / En cours / Terminées / À traiter.
//   - Wording calme, jamais alarmiste.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  CalendarDays,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  ListChecks,
  ArrowRight,
  Clock,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { TeamBadge } from '@/components/ui/team-badge'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { buildTodayView, todayUtcIso, type TodayIntervention, type OverdueIntervention, type UnassignedRecent } from '@/lib/db/today-view'
import { getTenantDayReading } from '@/lib/ai/site-readings'
import { ReadingCard } from '@/components/ui/reading-card'
import { resolveDocNamesFromFragments } from '@/lib/documents/resolve-doc-names'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import type { InterventionSlot } from '@/types/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MONTHS_FR_FULL = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const WEEKDAYS_FR = [
  'Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi',
]
// V6.1 (Vincent 2026-05-21) — purge créneau : on n'affiche plus de label
// « Matin / Après-midi / Soir ». La plage horaire de chaque intervention
// suffit. Les anciennes maps SLOT_FR / SLOT_TONE sont retirées.

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d))
  const weekday = WEEKDAYS_FR[date.getUTCDay()] ?? ''
  const month = MONTHS_FR_FULL[(m ?? 1) - 1] ?? ''
  return `${weekday} ${d} ${month} ${y}`
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')

  const params = await searchParams
  const target = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : todayUtcIso()

  const view = await buildTodayView(target)

  // Construire le contexte site → missions planifiées pour croiser avec absences IA
  const siteContextMap = new Map<string, string[]>()
  for (const group of view.bySlot) {
    for (const i of group.interventions) {
      if (!i.site_id) continue
      const existing = siteContextMap.get(i.site_id) ?? []
      existing.push(i.mission_name)
      siteContextMap.set(i.site_id, existing)
    }
  }
  const todaySiteContext = Array.from(siteContextMap.entries()).map(([siteId, plannedMissions]) => ({
    siteId,
    plannedMissions,
  }))
  const todayReading = await getTenantDayReading(todaySiteContext)
  const todayDocNames = todayReading
    ? await resolveDocNamesFromFragments([todayReading.fragment])
    : {}

  return (
    <div className="space-y-6 w-full">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
            <ListChecks className="h-6 w-6 text-brand-600" />
            Interventions du jour
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDateLong(view.date)}.
          </p>
        </div>
      </header>

      {/* 4 stats — réduction cognitive : pas de redondance avec la dette détaillée
          en dessous. "À traiter" = somme silencieuse (sans équipe + en retard). */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <DayStat
          icon={CalendarDays}
          value={view.stats.planned}
          label={view.stats.planned > 1 ? 'prévues' : 'prévue'}
        />
        <DayStat
          icon={PlayCircle}
          value={view.stats.inProgress}
          label="en cours"
          tone={view.stats.inProgress > 0 ? 'sky' : 'neutral'}
        />
        <DayStat
          icon={CheckCircle2}
          value={view.stats.completed}
          label={view.stats.completed > 1 ? 'terminées' : 'terminée'}
          tone={view.stats.completed > 0 ? 'emerald' : 'neutral'}
        />
        <DayStat
          icon={Clock}
          value={view.unassignedRecent.length + view.overdue.length}
          label="à traiter"
          tone={view.unassignedRecent.length + view.overdue.length > 0 ? 'amber' : 'neutral'}
        />
      </div>

      {/* Ce que les lieux disent — 1 signal IA, entre les stats et le planning.
          Silence si aucun seuil franchi (doctrine : rareté = force). */}
      {todayReading && (
        <div className="space-y-2">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-reading-label/65">
            Ce que les lieux disent
          </div>
          <ReadingCard fragment={todayReading.fragment} context={todayReading.context} docNames={todayDocNames} />
        </div>
      )}

      {/* V6.2 (Vincent 2026-05-20) — Dette opérationnelle EN HAUT, plus en bas.
          Rouge bordeaux sobre qui saute aux yeux. Silence positif respecté :
          si zéro signal (sans équipe + en retard = 0), le bloc ne rend rien.
          Groupé pour éviter l'effet « N alarmes » — l'œil voit UN problème. */}
      {(view.unassignedRecent.length > 0 || view.overdue.length > 0) && (
        <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/40">
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2 text-red-900 dark:text-red-100">
              <AlertTriangle className="h-4 w-4 text-red-700 dark:text-red-300" strokeWidth={2} />
              Dette opérationnelle ({view.unassignedRecent.length + view.overdue.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {view.unassignedRecent.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-red-900/80 dark:text-red-200/80 mb-2">
                  Sans équipe aujourd&apos;hui ({view.unassignedRecent.length})
                </h3>
                <ul className="space-y-1.5">
                  {view.unassignedRecent.map((i) => (
                    <UnassignedLine key={i.id} item={i} />
                  ))}
                </ul>
              </div>
            )}
            {view.overdue.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-red-900/80 dark:text-red-200/80 mb-2">
                  Passages en retard à régulariser ({view.overdue.length})
                </h3>
                <ul className="space-y-1.5">
                  {view.overdue.map((i) => (
                    <OverdueLine key={i.id} item={i} />
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Flux chronologique du jour — déroulé naturel par heure de prestation
          (V6.1, Vincent 2026-05-21). La dette opérationnelle est en haut, le
          planning du jour ici. */}
      {(() => {
        const allInterventions = view.bySlot.flatMap((g) => g.interventions)
        // Tri par planned_start asc, nulls last
        allInterventions.sort((a, b) => {
          const ax = a.planned_start ?? '~'
          const bx = b.planned_start ?? '~'
          return ax.localeCompare(bx)
        })
        if (allInterventions.length === 0) {
          return (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-sm text-muted-foreground italic">
                  Aucune intervention prévue ce jour.
                </p>
              </CardContent>
            </Card>
          )
        }
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base inline-flex items-center gap-2">
                Planning du jour
                <span className="text-xs font-normal text-muted-foreground">
                  ({allInterventions.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {allInterventions.map((i) => (
                  <InterventionLine key={i.id} item={i} />
                ))}
              </ul>
            </CardContent>
          </Card>
        )
      })()}

      {/* Liens connexes */}
      <div className="pt-4 flex items-center gap-4 text-sm text-muted-foreground">
        <Link href="/briefing" className="hover:text-foreground inline-flex items-center gap-1">
          Briefing du soir <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <Link
          href={`/semaine?week=${view.date.slice(0, 7)}`}
          className="hover:text-foreground inline-flex items-center gap-1"
        >
          Vue Semaine <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

function UnassignedLine({ item }: { item: UnassignedRecent }) {
  const ageLabel =
    item.daysAgo === 0 ? "aujourd'hui" :
    item.daysAgo === 1 ? 'hier' :
    `il y a ${item.daysAgo} j`
  return (
    <li>
      <Link
        href={`/interventions/${item.id}`}
        className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-white/70 px-3 py-2 hover:bg-red-50/80 transition-colors dark:border-red-900/40 dark:bg-red-950/10 dark:hover:bg-red-950/40"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-red-950 dark:text-red-50 truncate">
            {item.site_name}
          </div>
          <div className="text-xs text-red-900/70 dark:text-red-200/70 truncate">
            {item.mission_name}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="inline-flex items-center rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-900 dark:border-red-800 dark:bg-red-900/40 dark:text-red-100"
            title="Aucune équipe affectée"
          >
            ◯ Non-affecté
          </span>
          <span className="text-[10px] font-medium text-red-900/80 dark:text-red-200/80 tabular-nums">
            {ageLabel}
          </span>
        </div>
      </Link>
    </li>
  )
}

function OverdueLine({ item }: { item: OverdueIntervention }) {
  const ageLabel =
    item.daysOverdue === 1 ? 'hier' :
    item.daysOverdue <= 7 ? `il y a ${item.daysOverdue} j` :
    item.scheduled_for
  return (
    <li>
      <Link
        href={`/interventions/${item.id}`}
        className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50/40 px-3 py-2 hover:bg-red-100/60 transition-colors dark:border-red-900/40 dark:bg-red-950/20 dark:hover:bg-red-950/40"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-red-950 dark:text-red-50 truncate">
            {item.site_name}
          </div>
          <div className="text-xs text-red-900/70 dark:text-red-200/70 truncate">
            {item.mission_name}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {item.team_name && (
            <TeamBadge name={item.team_name} color={item.team_color} size="sm" />
          )}
          <span className="text-[10px] font-medium text-red-900 bg-red-100 border border-red-300 rounded-full px-2 py-0.5 tabular-nums dark:border-red-800 dark:bg-red-900/40 dark:text-red-100">
            {ageLabel}
          </span>
        </div>
      </Link>
    </li>
  )
}

function InterventionLine({ item }: { item: TodayIntervention }) {
  const isClosed = item.status === 'completed' || item.status === 'validated' || item.status === 'skipped'
  // V6.1 — plage horaire par intervention (jamais cumul agent).
  const timeLabel = formatInterventionTimeLabel({
    planned_start: item.planned_start,
    planned_end: item.planned_end,
    slot: item.slot === 'none' ? null : (item.slot as InterventionSlot),
  })
  return (
    <li>
      <Link
        href={`/interventions/${item.id}`}
        className={`flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/40 transition-colors ${
          isClosed ? 'opacity-60' : ''
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Heure de prestation — repère temporel à gauche, tabular-nums pour
              alignement visuel vertical des lignes successives. */}
          <span
            className="text-xs font-mono tabular-nums text-muted-foreground shrink-0 w-14 text-right"
            title="Horaire de prestation"
          >
            {timeLabel}
          </span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-medium truncate ${item.status === 'skipped' ? 'line-through decoration-amber-700/50' : ''}`}>
              {item.site_name}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {item.mission_name}
              {item.skipped_reason && ` — ${item.skipped_reason}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {item.team_name ? (
            <TeamBadge name={item.team_name} color={item.team_color} size="sm" />
          ) : (
            <span
              className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800"
              title="Aucune équipe affectée"
            >
              ◯ Non-affecté
            </span>
          )}
          <StatusBadge status={item.status} size="sm" />
        </div>
      </Link>
    </li>
  )
}

function DayStat({
  icon: Icon,
  value,
  label,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>
  value: number
  label: string
  tone?: 'neutral' | 'amber' | 'sky' | 'emerald'
}) {
  const toneClass =
    tone === 'amber' ? 'border-amber-200 bg-amber-50/40' :
    tone === 'sky' ? 'border-sky-200 bg-sky-50/40' :
    tone === 'emerald' ? 'border-emerald-200 bg-emerald-50/40' :
    ''
  const iconClass =
    tone === 'amber' ? 'text-amber-700' :
    tone === 'sky' ? 'text-sky-700' :
    tone === 'emerald' ? 'text-emerald-700' :
    'text-muted-foreground'
  return (
    <div className={`rounded-lg border bg-card p-3 ${toneClass}`}>
      <Icon className={`h-4 w-4 ${iconClass}`} />
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
