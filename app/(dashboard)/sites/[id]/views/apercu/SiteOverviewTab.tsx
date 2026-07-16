import Link from 'next/link'
import type { ComponentType, ReactNode } from 'react'
import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  Footprints,
  Info,
  ListTodo,
  RefreshCw,
  ShieldAlert,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getSiteOverview,
  emptySiteOverview,
  type AttentionKind,
  type ActionUrgency,
  type SiteOverview,
} from '@/lib/knowledge/site-overview'
import { SiteBriefButton } from '../../SiteBriefButton'

// ── ONGLET APERÇU ────────────────────────────────────────────────────────────
// DOCTRINE (test : tests/lib/site-overview-tab.doctrine.test.ts) : cet onglet ne
// lit QUE le read model `getSiteOverview`. Aucun accès métier direct — pas de
// lib/db/*, pas de Supabase, pas de projection/repository. S'il manque une donnée
// à l'écran, elle entre dans SiteOverview ; on ne rouvre pas une lecture ici.
//
// Le workspace orchestre les onglets ; chaque onglet possède son read model. Aucun
// read model ne devient le god-object de l'application.

export async function SiteOverviewTab({ siteId }: { siteId: string }) {
  const overview = await getSiteOverview(siteId).catch(() => emptySiteOverview(siteId))
  const {
    actions, attention, nextEvent, recentChanges, reserves, blockages, activity, synthesis,
    knowledge, stakeholders, deadlines, watchpoints,
  } = overview
  // La synthèse de la dernière visite est l'endroit où l'on confirme les propositions.
  const synthesisHref = activity.lastVisit ? `/m/visite/${activity.lastVisit.reportId}/cr` : undefined

  return (
    <main className="space-y-4">
      <section aria-labelledby="etat-du-chantier" className="space-y-3">
        <h2 id="etat-du-chantier" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          État du chantier
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StateCard
            href={`/sites/${siteId}/actions`}
            icon={ListTodo}
            tone={actions.summary.overdue > 0 ? 'orange' : actions.summary.active > 0 ? 'blue' : 'green'}
            value={actions.summary.active}
            title="Actions actives"
            detail={activeActionsDetail(actions.summary)}
          />
          <StateCard
            href={`/sites/${siteId}/reserves`}
            icon={AlertTriangle}
            tone={reserves.open > 0 ? 'orange' : 'green'}
            value={reserves.open}
            title="Réserves ouvertes"
            detail={reserves.open > 0 ? 'À lever' : 'Aucune réserve ouverte'}
          />
          <StateCard
            icon={ShieldAlert}
            tone={blockages.open > 0 ? 'red' : 'green'}
            value={blockages.open}
            title="Blocages en cours"
            detail={blockages.open > 0 ? 'Peut ralentir le chantier' : 'Aucun blocage déclaré'}
          />
          <StateCard
            href={`/semaine?site=${siteId}`}
            icon={Calendar}
            tone="blue"
            value={nextEvent ? formatShortEventDate(nextEvent.startsAt) : 'Aucune'}
            title="Prochaine étape"
            detail={nextEvent?.title ?? 'Rien de planifié'}
          />
        </div>
      </section>

      {/* ── LA VIE DU CHANTIER ────────────────────────────────────────────────
          Le chantier doit RESPIRER : on doit sentir qu'une visite vient d'avoir
          lieu, avec ce qu'elle a rapporté et l'état de ce que MemorIA en a compris.
          Sans ça, un chantier visité hier ressemble à un chantier jamais visité. */}
      {activity.lastVisit && (
        <section className="rounded-[18px] border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/30">
              <Footprints className="h-4 w-4 text-sky-600 dark:text-sky-300" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Dernière visite</h2>
              <p className="text-base font-semibold">{visitDateLabel(activity.lastVisit.endedAt)}</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <SynthesisBadge status={synthesis.status} pending={synthesis.pending} />
              {synthesisHref && (
                <Link
                  href={synthesisHref}
                  className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
                >
                  Voir la synthèse <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </div>

          {/* Les SOURCES : ce que la visite a rapporté. C'est la matière sur laquelle
              MemorIA a travaillé — l'afficher, c'est montrer nos fondements. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {sourceLabels(activity.lastVisit.sources).map((label) => (
              <span key={label}>{label}</span>
            ))}
            {activity.lastVisit.durationMin != null && <span>Durée {durationLabel(activity.lastVisit.durationMin)}</span>}
            {activity.lastVisit.sourceCount === 0 && <span>Aucune capture</span>}
          </div>

          {/* Un échec de projection ne doit JAMAIS être muet : sans lui, la visite
              paraît n'avoir rien produit alors que MemorIA avait compris. */}
          {synthesis.projectionFailed && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[13px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Certaines informations de cette visite n&apos;ont pas pu être reportées sur le chantier.
                La synthèse, elle, est intacte.
              </span>
            </p>
          )}
        </section>
      )}

      {/* Connaissance de la dernière visite : les propositions d'action pas encore
          promues, avec leurs PREMIERS titres (pas seulement un compte). Distinctes du
          métier (actions actives) ; « Confirmer » se fait sur la synthèse. Silence
          total tant qu'il n'y en a pas. */}
      {actions.summary.proposed > 0 && (
        <section className="rounded-[18px] border border-sky-200 bg-sky-50/50 p-4 shadow-sm dark:border-sky-900/40 dark:bg-sky-950/20">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-sky-600" />
            <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-200">
              {actions.summary.proposed} action{actions.summary.proposed > 1 ? 's' : ''} proposée{actions.summary.proposed > 1 ? 's' : ''}
            </h2>
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">à confirmer</span>
          </div>
          <ul className="mt-2 space-y-1">
            {actions.proposed.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-sm text-foreground/90">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-sky-500" />
                <span className="min-w-0">{p.title}</span>
              </li>
            ))}
          </ul>
          {synthesisHref && (
            <Link href={synthesisHref} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-sky-700 hover:underline dark:text-sky-300">
              Voir la synthèse et confirmer <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </section>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[0.9fr_1.2fr_0.9fr]">
        {/* L'attention NOMME ses raisons — jamais un simple voyant. */}
        <OverviewPanel title="Ce qui réclame mon attention">
          {attention.reasons.length > 0 ? (
            <ul className="space-y-3">
              {attention.reasons.map((reason) => (
                <li key={reason.id}>
                  <OverviewRow
                    href={reason.href}
                    icon={attentionIcon(reason.kind)}
                    tone={attentionTone(reason.kind)}
                    title={reason.title}
                    detail={reason.detail}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyLine>Rien ne réclame votre attention pour l&apos;instant.</EmptyLine>
          )}
        </OverviewPanel>

        <OverviewPanel title="Que reste-t-il à faire ?">
          {actions.priority.length > 0 ? (
            <ul className="space-y-2.5">
              {actions.priority.slice(0, 3).map((action) => (
                <li key={action.id}>
                  <OverviewRow
                    href={action.href}
                    icon={ListTodo}
                    tone={urgencyTone(action.urgency)}
                    title={action.title}
                    detail={action.dueLabel}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyLine>Aucune action prioritaire ouverte.</EmptyLine>
          )}
          <div className="pt-2">
            <Link href={`/sites/${siteId}/actions`} className="text-sm font-medium text-primary hover:underline">
              Voir toutes les actions
            </Link>
          </div>
        </OverviewPanel>

        <OverviewPanel title="Depuis ma dernière venue">
          {recentChanges.length > 0 ? (
            <ol className="relative space-y-3 border-l border-border pl-4">
              {recentChanges.map((change) => (
                <li key={change.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                  <p className="text-sm font-medium">{change.title}</p>
                  <p className="text-xs text-muted-foreground">{formatRelativeDate(change.occurredAt)}</p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyLine>Aucun changement significatif à afficher.</EmptyLine>
          )}
        </OverviewPanel>
      </div>

      {/* ── CE QUE LA VISITE A APPRIS AU CHANTIER ────────────────────────────
          Ces objets vivaient déjà dans le contrat sans jamais atteindre l'écran :
          la connaissance existait, elle était simplement invisible. Un objet métier
          n'est terminé que lorsqu'il est visible là où il doit apparaître. */}
      {(knowledge.summary.proposed + knowledge.summary.confirmed
        + stakeholders.summary.proposed + stakeholders.summary.confirmed
        + deadlines.summary.proposed + watchpoints.summary.proposed) > 0 && (
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KnowledgePanel
            title="À savoir"
            icon={Info}
            proposed={knowledge.proposed}
            confirmed={knowledge.confirmed}
            summary={knowledge.summary}
            href={`/sites/${siteId}?tab=memoire`}
          />
          <KnowledgePanel
            title="Intervenants"
            icon={Users}
            proposed={stakeholders.proposed}
            confirmed={stakeholders.confirmed}
            summary={stakeholders.summary}
            href={`/sites/${siteId}?tab=memoire`}
          />
          <KnowledgePanel
            title="Échéances"
            icon={CalendarClock}
            proposed={deadlines.proposed}
            confirmed={deadlines.confirmed}
            summary={deadlines.summary}
            href={`/sites/${siteId}?tab=planning`}
          />
          <KnowledgePanel
            title="Points de vigilance"
            icon={ShieldAlert}
            proposed={watchpoints.proposed}
            confirmed={watchpoints.confirmed}
            summary={watchpoints.summary}
            href={synthesisHref}
          />
        </div>
      )}

      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900">
              <Calendar className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Prochaine étape</h2>
              {nextEvent ? (
                <>
                  <p className="mt-1 text-lg font-semibold">{nextEvent.title}</p>
                  <p className="text-sm text-muted-foreground">{formatLongEventDate(nextEvent.startsAt)}</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-lg font-semibold">Aucune prochaine étape planifiée.</p>
                  <p className="text-sm text-muted-foreground">Planifiez la suite lorsque le chantier en a besoin.</p>
                </>
              )}
            </div>
          </div>
          {nextEvent?.kind === 'visit' ? (
            <SiteBriefButton siteId={siteId} mode="visit" variant="desktop" />
          ) : nextEvent?.kind === 'meeting' ? (
            <Link href={nextEvent.href ?? `/sites/${siteId}`} className="inline-flex items-center justify-center rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90">
              Préparer ma réunion
            </Link>
          ) : (
            <Link href={`/semaine?site=${siteId}`} className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
              {nextEvent ? 'Voir le planning' : 'Planifier'}
            </Link>
          )}
        </div>
      </section>
    </main>
  )
}

/** Panneau d'un objet de connaissance : le VALIDÉ d'abord, le PROPOSÉ ensuite —
 *  jamais mélangés. Silence total quand l'objet n'a rien à dire. */
function KnowledgePanel({
  title,
  icon: Icon,
  proposed,
  confirmed,
  summary,
  href,
}: {
  title: string
  icon: ComponentType<{ className?: string }>
  proposed: Array<{ id: string; title: string }>
  confirmed: Array<{ id: string; title: string }>
  summary: { proposed: number; confirmed: number }
  href?: string
}) {
  const total = summary.proposed + summary.confirmed
  if (total === 0) return null
  const body = (
    <>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="ml-auto text-sm font-semibold tabular-nums">{total}</span>
      </div>
      <ul className="mt-2 space-y-1">
        {confirmed.map((item) => (
          <li key={item.id} className="line-clamp-2 text-[13px] text-foreground/90">
            {item.title}
          </li>
        ))}
        {proposed.map((item) => (
          <li key={item.id} className="line-clamp-2 text-[13px] text-muted-foreground">
            {item.title}
          </li>
        ))}
      </ul>
      {summary.proposed > 0 && (
        <span className="mt-2 inline-block rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
          {summary.proposed} à confirmer
        </span>
      )}
    </>
  )
  const className = 'block rounded-[18px] border bg-card p-4 shadow-sm'
  return href ? (
    <Link href={href} className={cn(className, 'transition hover:brightness-[0.98]')}>
      {body}
    </Link>
  ) : (
    <section className={className}>{body}</section>
  )
}

/** L'état de la synthèse, dit en clair — jamais un jargon de développeur. */
function SynthesisBadge({
  status,
  pending,
}: {
  status: SiteOverview['synthesis']['status']
  pending: SiteOverview['synthesis']['pending']
}) {
  if (status === 'up_to_date') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
        <Check className="h-3.5 w-3.5" /> Synthèse à jour
      </span>
    )
  }
  if (status === 'outdated') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        <RefreshCw className="h-3.5 w-3.5" /> Synthèse à mettre à jour · {pendingLabel(pending)}
      </span>
    )
  }
  if (status === 'generating') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-[12px] font-medium text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
        <RefreshCw className="h-3.5 w-3.5" /> Synthèse en cours
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground">
      Pas encore de synthèse
    </span>
  )
}

/** « 4 photos · 2 mémos » — la matière rapportée par la visite. */
function sourceLabels(sources: { photos: number; videos: number; vocals: number; notes: number }): string[] {
  const out: string[] = []
  if (sources.photos > 0) out.push(`${sources.photos} photo${sources.photos > 1 ? 's' : ''}`)
  if (sources.videos > 0) out.push(`${sources.videos} vidéo${sources.videos > 1 ? 's' : ''}`)
  if (sources.vocals > 0) out.push(`${sources.vocals} mémo${sources.vocals > 1 ? 's' : ''}`)
  if (sources.notes > 0) out.push(`${sources.notes} note${sources.notes > 1 ? 's' : ''}`)
  return out
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

/** « Aujourd'hui », « Hier », sinon la date — on parle comme un conducteur. */
function visitDateLabel(iso: string | null): string {
  if (!iso) return 'Date inconnue'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Date inconnue'
  const today = new Date()
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return "Aujourd'hui"
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Hier'
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

/** « +1 note · +2 photos » — ce que la synthèse n'a pas encore pris en compte. */
function pendingLabel(pending: SiteOverview['synthesis']['pending']): string {
  const parts: string[] = []
  if (pending.photos > 0) parts.push(`+${pending.photos} photo${pending.photos > 1 ? 's' : ''}`)
  if (pending.videos > 0) parts.push(`+${pending.videos} vidéo${pending.videos > 1 ? 's' : ''}`)
  if (pending.vocals > 0) parts.push(`+${pending.vocals} mémo${pending.vocals > 1 ? 's' : ''}`)
  if (pending.notes > 0) parts.push(`+${pending.notes} note${pending.notes > 1 ? 's' : ''}`)
  return parts.join(' · ')
}

/** « Actions actives : 5 / dont 2 planifiées » — la charge réelle du chantier. */
function activeActionsDetail(summary: { active: number; planned: number; overdue: number }): string {
  if (summary.active === 0) return 'Aucune action active'
  const parts: string[] = []
  if (summary.overdue > 0) parts.push(`${summary.overdue} en retard`)
  if (summary.planned > 0) parts.push(`dont ${summary.planned} planifiée${summary.planned > 1 ? 's' : ''}`)
  return parts.length > 0 ? parts.join(' · ') : 'À traiter ou suivre'
}

function StateCard({
  href,
  icon: Icon,
  tone,
  value,
  title,
  detail,
}: {
  href?: string
  icon: ComponentType<{ className?: string }>
  tone: 'green' | 'orange' | 'red' | 'blue'
  value: number | string
  title: string
  detail: string
}) {
  const content = (
    <>
      <Icon className={cn('h-5 w-5', toneClass[tone].icon)} />
      <div className="mt-5 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-2 text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </>
  )
  const className = cn('min-h-[128px] rounded-[18px] border p-4 shadow-sm transition', toneClass[tone].bg)
  return href ? (
    <Link href={href} className={cn(className, 'block hover:brightness-[0.98]')}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  )
}

function OverviewPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-h-[232px] rounded-[18px] border bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function OverviewRow({
  href,
  icon: Icon,
  tone,
  title,
  detail,
}: {
  href?: string | null
  icon: ComponentType<{ className?: string }>
  tone: 'green' | 'orange' | 'red' | 'blue'
  title: string
  detail?: string | null
}) {
  const inner = (
    <span className="flex items-start gap-3">
      <span className={cn('mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full', toneClass[tone].soft)}>
        <Icon className={cn('h-4 w-4', toneClass[tone].icon)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {detail && <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>}
      </span>
    </span>
  )
  return href ? (
    <Link href={href} className="block rounded-xl p-1.5 hover:bg-muted/60">
      {inner}
    </Link>
  ) : (
    <div className="rounded-xl p-1.5">{inner}</div>
  )
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">{children}</p>
}

const toneClass = {
  green: {
    bg: 'bg-emerald-50/55 dark:bg-emerald-950/20',
    soft: 'bg-emerald-50 dark:bg-emerald-950/30',
    icon: 'text-emerald-600 dark:text-emerald-300',
  },
  orange: {
    bg: 'bg-orange-50/55 dark:bg-orange-950/20',
    soft: 'bg-orange-50 dark:bg-orange-950/30',
    icon: 'text-orange-600 dark:text-orange-300',
  },
  red: {
    bg: 'bg-red-50/55 dark:bg-red-950/20',
    soft: 'bg-red-50 dark:bg-red-950/30',
    icon: 'text-red-600 dark:text-red-300',
  },
  blue: {
    bg: 'bg-sky-50/55 dark:bg-sky-950/20',
    soft: 'bg-sky-50 dark:bg-sky-950/30',
    icon: 'text-sky-600 dark:text-sky-300',
  },
} as const

/** La couleur est l'affaire de l'écran ; le sens vient du read model. */
function urgencyTone(urgency: ActionUrgency): 'green' | 'orange' | 'red' | 'blue' {
  if (urgency === 'late') return 'red'
  if (urgency === 'today' || urgency === 'week') return 'orange'
  return 'blue'
}

function attentionIcon(kind: AttentionKind) {
  if (kind === 'blocage_active') return ShieldAlert
  if (kind === 'action_overdue') return Clock
  if (kind === 'event_upcoming') return Calendar
  return AlertTriangle
}

function attentionTone(kind: AttentionKind): 'green' | 'orange' | 'red' | 'blue' {
  if (kind === 'blocage_active') return 'red'
  if (kind === 'event_upcoming') return 'blue'
  return 'orange'
}

function formatShortEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function formatLongEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRelativeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}
