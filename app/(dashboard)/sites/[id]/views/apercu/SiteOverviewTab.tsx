import Link from 'next/link'
import type { ComponentType, ReactNode } from 'react'
import { AlertTriangle, Calendar, ChevronRight, Clock, ListTodo, RefreshCw, ShieldAlert } from 'lucide-react'
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
  const { actions, attention, nextEvent, recentChanges, reserves, blockages, activity, synthesis } = overview
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

      {/* La visite a été enrichie depuis la synthèse : on le DIT, on ne régénère pas
          en silence. Silence total quand la synthèse est à jour. */}
      {synthesis.status === 'outdated' && synthesisHref && (
        <Link
          href={synthesisHref}
          className="flex items-center gap-2 rounded-[18px] border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm shadow-sm transition hover:brightness-[0.98] dark:border-amber-900/40 dark:bg-amber-950/20"
        >
          <RefreshCw className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="font-medium text-amber-900 dark:text-amber-200">Synthèse à mettre à jour</span>
          <span className="text-amber-800/80 dark:text-amber-300/80">{pendingLabel(synthesis.pending)}</span>
          <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-amber-600" />
        </Link>
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
