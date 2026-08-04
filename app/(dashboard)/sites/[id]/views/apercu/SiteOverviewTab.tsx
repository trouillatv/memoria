import Link from 'next/link'
import type { ComponentType, ReactNode } from 'react'
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Footprints,
  ListTodo,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getSiteOverview,
  emptySiteOverview,
  type ActionUrgency,
  type SiteOverview,
  type PvAttentionItem,
  type PvVerifyItem,
  type PvLastDelta,
} from '@/lib/knowledge/site-overview'
import { sourceLabels, pendingLabel, visitDateLabel, durationLabel } from '@/lib/chantier/overview-labels'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import { SiteBriefButton } from '../../SiteBriefButton'
import { CopilotBlock } from './CopilotBlock'

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
    actions, nextEvent, reserves, blockages, activity, synthesis,
    pvAttention, pvLastDelta, pvToVerify,
  } = overview
  // La synthèse de la dernière visite est l'endroit où l'on confirme les propositions.
  const synthesisHref = activity.lastVisit
    ? `/sites/${siteId}/visites/${activity.lastVisit.reportId}`
    : undefined

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
            title="Sujets d'action"
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
            href={`/sites/${siteId}/actions`}
            icon={Clock}
            tone={actions.summary.overdue > 0 ? 'red' : 'green'}
            value={actions.summary.overdue}
            title="En retard"
            detail={actions.summary.overdue > 0 ? `${actions.summary.overdue} action${actions.summary.overdue > 1 ? 's' : ''} à traiter en priorité` : 'Aucune action en retard'}
          />
        </div>
      </section>

      {/* ── COPILOTE ──────────────────────────────────────────────────────────
          4 questions guidées → réponse courte sourcée.
          Lecture seule : aucune écriture, aucun RAG PDF, aucun scoring nouveau. */}
      <CopilotBlock siteId={siteId} />

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

          {/* Un échec ne doit JAMAIS être muet : sans ça, la visite paraît n'avoir
              rien produit alors que MemorIA avait compris. On parle CHANTIER, jamais
              « projection » — le conducteur n'a pas à connaître notre plomberie. */}
          {synthesis.projectionFailed && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[13px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Certaines informations de cette visite n&apos;ont pas encore pu être intégrées au chantier.
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

      {/* ── SIGNAUX PV CANONIQUES ─────────────────────────────────────────────
          Trois blocs qui répondent aux trois questions d'un conducteur qui arrive :
          Qu'est-ce qui me pose problème ? / Qu'est-ce qui a changé ? / Où regarder ?
          Source : moteurs Histoire (computeWatchlist, computeDeltaSummary, getImportantSubjects).
          JAMAIS de nouveau scoring opaque — on compose les moteurs stabilisés. */}

      {/* Depuis le dernier PV — signal compact, pas une liste */}
      {pvLastDelta && (
        <PvDeltaBanner delta={pvLastDelta} siteId={siteId} />
      )}

      <div className="grid items-start gap-4 xl:grid-cols-3">
        {/* Ce qui demande votre attention — sujets canoniques classés par sévérité */}
        <OverviewPanel title="Ce qui demande votre attention">
          {pvAttention.length > 0 ? (
            <ul className="space-y-3">
              {pvAttention.map((item, i) => (
                <li key={item.canonicalSubjectId ?? `watch-${i}`}>
                  <OverviewRow
                    href={item.href}
                    icon={pvAttentionIcon(item.reason)}
                    tone={pvAttentionTone(item.reason)}
                    title={item.label}
                    detail={pvAttentionDetail(item)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyLine>Aucun sujet canonique ne signale de problème.</EmptyLine>
          )}
        </OverviewPanel>

        {/* À vérifier — sujets importants classés par score, avec signaux forts */}
        <OverviewPanel title="À vérifier">
          {pvToVerify.length > 0 ? (
            <ul className="space-y-2.5">
              {pvToVerify.map((item) => (
                <li key={item.canonicalSubjectId}>
                  <PvVerifyRow item={item} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyLine>Aucun sujet canonique à vérifier pour l&apos;instant.</EmptyLine>
          )}
          <div className="pt-2">
            <Link href={`/sites/${siteId}/historique?view=lifelines`} className="text-sm font-medium text-primary hover:underline">
              Voir tous les sujets
            </Link>
          </div>
        </OverviewPanel>

        {/* Que reste-t-il à faire ? — actions métier (distinctes des sujets canoniques) */}
        <OverviewPanel title="Que reste-t-il à faire ?">
          {actions.summary.active > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${actions.summary.overdue > 0 ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-muted text-muted-foreground'}`}>
                {actions.summary.overdue > 0 ? `${actions.summary.overdue} en retard` : 'Aucune en retard'}
              </span>
              {actions.summary.week > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  {actions.summary.week} cette semaine
                </span>
              )}
              {actions.summary.undated > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {actions.summary.undated} sans date
                </span>
              )}
            </div>
          )}
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

// ── Composants des 3 blocs PV ────────────────────────────────────────────────

/** Banner compact "Depuis le dernier PV" — signal uniquement, lien vers Histoire. */
function PvDeltaBanner({ delta, siteId }: { delta: PvLastDelta; siteId: string }) {
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

  const parts: string[] = []
  if (delta.nouveaux > 0) parts.push(`${delta.nouveaux} apparu${delta.nouveaux > 1 ? 's' : ''}`)
  if (delta.aggravésRéouverts > 0) parts.push(`${delta.aggravésRéouverts} aggravé${delta.aggravésRéouverts > 1 ? 's' : ''}`)
  if (delta.réalisésLevés > 0) parts.push(`${delta.réalisésLevés} traité${delta.réalisésLevés > 1 ? 's' : ''}`)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] border bg-card px-4 py-2.5 shadow-sm">
      <span className="text-[13px] font-medium text-muted-foreground">
        Depuis le PV du {fmtDate(delta.fromDate)}
      </span>
      <span className="text-muted-foreground/40">·</span>
      {parts.length > 0 ? (
        <span className="text-[13px] text-foreground/80">{parts.join(' · ')}</span>
      ) : (
        <span className="text-[13px] text-muted-foreground">Aucune transition notable</span>
      )}
      <Link
        href={`/sites/${siteId}/historique?view=synthese`}
        className="ml-auto shrink-0 text-[13px] font-medium text-primary hover:underline"
      >
        Voir les détails →
      </Link>
    </div>
  )
}

/** Ligne du bloc "À vérifier" avec signaux et badge dépendances. */
function PvVerifyRow({ item }: { item: PvVerifyItem }) {
  return (
    <Link
      href={item.href}
      className="flex items-start gap-3 rounded-xl p-1.5 hover:bg-muted/60"
    >
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/30">
        <ChevronRight className="h-4 w-4 text-sky-600 dark:text-sky-300" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{item.label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{item.signals.join(' · ')}</span>
        {item.pendingLinks > 0 && (
          <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            {item.pendingLinks} relation{item.pendingLinks > 1 ? 's' : ''} à valider
          </span>
        )}
      </span>
    </Link>
  )
}

function pvAttentionIcon(reason: PvAttentionItem['reason']) {
  if (reason === 'non_conforme') return ShieldAlert
  if (reason === 'aggravé' || reason === 'réouvert') return AlertTriangle
  return Clock
}

function pvAttentionTone(reason: PvAttentionItem['reason']): 'green' | 'orange' | 'red' | 'blue' {
  if (reason === 'non_conforme') return 'red'
  if (reason === 'aggravé' || reason === 'réouvert') return 'orange'
  return 'blue'
}

function pvAttentionDetail(item: PvAttentionItem): string {
  if (item.reason === 'non_conforme')  return 'Non-conformité signalée'
  if (item.reason === 'aggravé')       return 'Aggravé au dernier PV'
  if (item.reason === 'réouvert')      return 'Réouvert au dernier PV'
  return `Sans évolution depuis ${item.pvCount} PV${item.pvCount > 1 ? 's' : ''}`
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

/** Detail du KPI sujets d'action — charge opérationnelle dédupliquée. */
function activeActionsDetail(summary: { active: number; planned: number; overdue: number }): string {
  if (summary.active === 0) return 'Aucun sujet d\'action actif'
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
    <div className="flex items-start gap-3">
      <span className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', toneClass[tone].soft)}>
        <Icon className={cn('h-4 w-4', toneClass[tone].icon)} />
      </span>
      <div className="min-w-0">
        <div className="text-[22px] font-bold leading-none tracking-tight tabular-nums">{value}</div>
        <div className="mt-1 text-[13px] font-medium leading-tight">{title}</div>
        <div className="text-[11.5px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  )
  const className = cn('rounded-xl border p-3 shadow-sm transition', toneClass[tone].bg)
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

// Rendu SERVEUR (Vercel = UTC) : sans fuseau explicite, l'heure d'une réunion
// s'affiche décalée de 11 h et sa date peut reculer d'un jour. Le fuseau de
// l'organisation est la seule vérité pour un conducteur.
const longEventFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: NOUMEA_TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

function formatLongEventDate(iso: string): string {
  return longEventFmt.format(new Date(iso))
}
