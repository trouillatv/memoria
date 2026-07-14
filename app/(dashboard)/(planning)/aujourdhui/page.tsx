// Page Â« Interventions du jour Â» â€” pendant Briefing du soir prÃ©pare DEMAIN,
// cette page suit AUJOURD'HUI en temps rÃ©el.
//
// Doctrine V5 + V6.1 (Vincent 2026-05-21 â€” purge crÃ©neau cohÃ©rence avec /semaine) :
//   - Flux chronologique par planned_start (plus de groupes par crÃ©neau).
//   - Plage horaire affichÃ©e PAR intervention (formatInterventionTimeLabel).
//   - Tout est visible (terminÃ©es incluses, opacitÃ© rÃ©duite â€” pas masquÃ©es).
//   - Stats : PrÃ©vues / En cours / TerminÃ©es / Ã€ traiter.
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
  Link2,
  Eye,
  MessageSquare,
  Phone,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { TeamBadge } from '@/components/ui/team-badge'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { buildTodayView, todayUtcIso, type TodayIntervention, type OverdueIntervention, type UnassignedRecent } from '@/lib/db/today-view'
import { getTenantDayReading } from '@/lib/ai/site-readings'
import { ReadingCard } from '@/components/ui/reading-card'
import { resolveDocNamesFromFragments } from '@/lib/documents/resolve-doc-names'
import { extractHHMM, fmtDurationFr } from '@/lib/time/prestation-slot'
import type { InterventionSlot } from '@/types/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MONTHS_FR_FULL = [
  'janvier', 'fÃ©vrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aoÃ»t', 'septembre', 'octobre', 'novembre', 'dÃ©cembre',
]
const WEEKDAYS_FR = [
  'Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi',
]
// V6.1 (Vincent 2026-05-21) â€” purge crÃ©neau : on n'affiche plus de label
// Â« Matin / AprÃ¨s-midi / Soir Â». La plage horaire de chaque intervention
// suffit. Les anciennes maps SLOT_FR / SLOT_TONE sont retirÃ©es.

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

  // Construire le contexte site â†’ missions planifiÃ©es pour croiser avec absences IA
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
            Planning du jour
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDateLong(view.date)}.
          </p>
        </div>
      </header>

      {/* 4 stats â€” rÃ©duction cognitive : pas de redondance avec la dette dÃ©taillÃ©e
          en dessous. "Ã€ traiter" = somme silencieuse (sans Ã©quipe + en retard). */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <DayStat
          icon={CalendarDays}
          value={view.stats.planned}
          label={view.stats.planned > 1 ? 'prÃ©vues' : 'prÃ©vue'}
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
          label={view.stats.completed > 1 ? 'terminÃ©es' : 'terminÃ©e'}
          tone={view.stats.completed > 0 ? 'emerald' : 'neutral'}
        />
        <DayStat
          icon={Clock}
          value={view.unassignedRecent.length + view.overdue.length}
          label="Ã  traiter"
          tone={view.unassignedRecent.length + view.overdue.length > 0 ? 'amber' : 'neutral'}
        />
      </div>

      {/* Ce que les lieux disent â€” 1 signal IA, entre les stats et le planning.
          Silence si aucun seuil franchi (doctrine : raretÃ© = force). */}
      {todayReading && (
        <div className="space-y-2">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-reading-label/65">
            Ce que les lieux disent
          </div>
          <ReadingCard fragment={todayReading.fragment} context={todayReading.context} docNames={todayDocNames} />
        </div>
      )}

      {/* V6.2 (Vincent 2026-05-20) â€” Dette opÃ©rationnelle EN HAUT, plus en bas.
          Rouge bordeaux sobre qui saute aux yeux. Silence positif respectÃ© :
          si zÃ©ro signal (sans Ã©quipe + en retard = 0), le bloc ne rend rien.
          GroupÃ© pour Ã©viter l'effet Â« N alarmes Â» â€” l'Å“il voit UN problÃ¨me. */}
      {(view.unassignedRecent.length > 0 || view.overdue.length > 0) && (
        <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/40">
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2 text-red-900 dark:text-red-100">
              <AlertTriangle className="h-4 w-4 text-red-700 dark:text-red-300" strokeWidth={2} />
              Dette opÃ©rationnelle ({view.unassignedRecent.length + view.overdue.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {view.unassignedRecent.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-red-900/80 dark:text-red-200/80 mb-2">
                  Sans Ã©quipe aujourd&apos;hui ({view.unassignedRecent.length})
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
                  Passages en retard Ã  rÃ©gulariser ({view.overdue.length})
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

      {/* Sous-traitants aujourd'hui — confirmation externe (dimension séparée du
          statut). L'or : la liste « non ouverts » = qui appeler. */}
      {(view.externalSummary.confirmed + view.externalSummary.accessed + view.externalSummary.notOpened > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              Sous-traitants aujourd&apos;hui
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-5 text-sm flex-wrap">
              <span className={`inline-flex items-center gap-1.5 ${view.externalSummary.confirmed > 0 ? 'text-emerald-700' : 'text-muted-foreground/50'}`}>
                <CheckCircle2 className="h-4 w-4" /><span className="font-bold tabular-nums">{view.externalSummary.confirmed}</span> confirmé{view.externalSummary.confirmed > 1 ? 's' : ''}
              </span>
              <span className={`inline-flex items-center gap-1.5 ${view.externalSummary.accessed > 0 ? 'text-sky-700' : 'text-muted-foreground/50'}`}>
                <Eye className="h-4 w-4" /><span className="font-bold tabular-nums">{view.externalSummary.accessed}</span> consulté{view.externalSummary.accessed > 1 ? 's' : ''}
              </span>
              <span className={`inline-flex items-center gap-1.5 ${view.externalSummary.notOpened > 0 ? 'text-amber-700' : 'text-muted-foreground/50'}`}>
                <Link2 className="h-4 w-4" /><span className="font-bold tabular-nums">{view.externalSummary.notOpened}</span> non ouvert{view.externalSummary.notOpened > 1 ? 's' : ''}
              </span>
            </div>
            {view.externalSummary.notOpenedList.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 inline-flex items-center gap-1.5 mb-1.5">
                  <Phone className="h-3.5 w-3.5" /> À relancer — lien jamais ouvert
                </h3>
                <ul className="space-y-1">
                  {view.externalSummary.notOpenedList.map((i) => (
                    <li key={i.id}>
                      <Link href={`/interventions/${i.id}`} className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity">
                        <span className="font-medium truncate">{i.mission_name}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">· {i.site_name}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 ml-auto shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Flux chronologique du jour â€” dÃ©roulÃ© naturel par heure de prestation
          (V6.1, Vincent 2026-05-21). La dette opÃ©rationnelle est en haut, le
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
                  Aucune intervention prÃ©vue ce jour.
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
            title="Aucune Ã©quipe affectÃ©e"
          >
            â—¯ Non-affectÃ©
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
  const time = formatTodayTime(item.planned_start, item.planned_end)
  return (
    <li>
      <Link
        href={`/interventions/${item.id}`}
        className={`flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 rounded-md px-2 py-2 hover:bg-muted/40 transition-colors ${
          isClosed ? 'opacity-60' : ''
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 w-full sm:flex-1">
          <span
            className="whitespace-nowrap text-xs font-mono tabular-nums text-muted-foreground shrink-0 sm:min-w-[10.5rem]"
            title="Horaire de prestation"
          >
            {time.range}
            {time.duration && <span className="hidden text-muted-foreground/70 sm:inline"> ({time.duration})</span>}
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
        <div className="flex items-center gap-2 shrink-0 flex-wrap pl-[calc(1.75rem)] sm:pl-0">
          {item.team_name ? (
            <TeamBadge name={item.team_name} color={item.team_color} size="sm" />
          ) : (
            <span
              className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800"
              title="Aucune équipe affectée"
            >
              ? Non-affecté
            </span>
          )}
          {/* UN SEUL signal externe par ligne (lisible) — priorité à la
              confirmation sous-traitant (/i/), sinon partage preuve (/p/).
              Le détail vit dans le widget « Sous-traitants ». */}
          {item.external.state === 'confirmed' ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 max-w-[10rem]"
              title={`Réalisé par ${item.external.byName ?? 'un externe'}${item.external.at ? ' · ' + fmtClock(item.external.at) : ''}`}
            >
              <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">Externe&nbsp;: {item.external.byName ?? 'réalisé'}</span>
            </span>
          ) : item.external.state === 'sent' ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800"
              title="Lien externe envoyé, jamais ouvert — à relancer"
            >
              <Link2 className="h-2.5 w-2.5" />
              Externe&nbsp;: non ouvert
            </span>
          ) : item.external.state === 'accessed' ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700"
              title={`Lien externe consulté${item.external.at ? ' · ' + fmtClock(item.external.at) : ''} — pas encore confirmé`}
            >
              <Eye className="h-2.5 w-2.5" />
              Externe&nbsp;: consulté
            </span>
          ) : item.share_commented ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
              title="Commentaire reçu du client externe"
            >
              <MessageSquare className="h-2.5 w-2.5" />
              Commenté
            </span>
          ) : item.share_accessed ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700"
              title="Dossier preuve consulté par l'externe"
            >
              <Eye className="h-2.5 w-2.5" />
              Consulté
            </span>
          ) : item.share_sent ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700"
              title="Lien de partage preuve envoyé"
            >
              <Link2 className="h-2.5 w-2.5" />
              Envoyé
            </span>
          ) : null}
          {item.status === 'planned' ? (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700">
              Aujourd&apos;hui
            </span>
          ) : (
            <StatusBadge status={item.status} size="sm" />
          )}
        </div>
      </Link>
    </li>
  )
}

function fmtClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Pacific/Noumea' })
  } catch {
    return ''
  }
}

function formatTodayTime(
  plannedStart: string | null,
  plannedEnd: string | null,
): { range: string; duration: string | null } {
  const start = extractHHMM(plannedStart)
  if (!start) return { range: '—', duration: null }
  if (!plannedEnd) return { range: start, duration: null }
  const end = extractHHMM(plannedEnd)
  if (!end) return { range: start, duration: null }
  const d = fmtDurationFr(plannedStart!, plannedEnd!)
  return { range: `${start} - ${end}`, duration: d ? d.replace('h', ' h') : null }
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

