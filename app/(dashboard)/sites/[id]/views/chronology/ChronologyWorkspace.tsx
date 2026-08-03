import Link from 'next/link'
import type { ReactNode } from 'react'
import { frDayMonthPaddedLocal, frDayMonthTimeLocal } from '@/lib/time/local-date'
import type { SiteDeadline } from '@/lib/db/site-deadlines'
import { echeanceDateLabel, A_PLANIFIER_LABEL } from '@/lib/visits/echeance-labels'
import { ChevronDown, FileText, History, MessageSquare, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SiteActionRow } from '@/lib/db/site-actions'
import type { SiteBlocage } from '@/lib/db/site-blocages'
import type { SupervisorInterventionRow } from '@/lib/db/interventions'
import type { VisitWithCounts } from '@/lib/db/visits'
import type { OverviewChangeInput } from '@/lib/chantier/overview-projections'
import { interventionStatusLabel } from '@/lib/chantier/labels'
import type { DbDocument } from '@/types/db'
import type { PvDelta } from '@/lib/documents/pv-comparison'
import type { SincePvSummary } from '@/lib/documents/pv-narrator'

interface ChronologyWorkspaceProps {
  siteId: string
  visits: VisitWithCounts[]
  changes: OverviewChangeInput[]
  /** Les échéances confirmées : chacune est un fait daté de la vie du chantier. */
  deadlines: SiteDeadline[]
  actions: SiteActionRow[]
  blocages: SiteBlocage[]
  interventions: SupervisorInterventionRow[]
  /** PV et rapports de visite historiques rattachés au chantier (Sprint 4A). */
  historicalDocs: DbDocument[]
  /** Lot 4C.1 — delta entre les deux derniers PV (null si < 2 PV disponibles). */
  pvDelta?: PvDelta | null
  pvSummary?: SincePvSummary | null
  pvFromDate?: string | null
  pvToDate?: string | null
}

export function ChronologyWorkspace({
  siteId,
  visits,
  changes,
  deadlines,
  actions,
  blocages,
  interventions,
  historicalDocs,
  pvDelta,
  pvSummary,
  pvFromDate,
  pvToDate,
}: ChronologyWorkspaceProps) {
  const interventionEvents = interventions.slice(0, 6)
  const hasEvents = visits.length > 0 || interventionEvents.length > 0 || changes.length > 0 || deadlines.length > 0 || historicalDocs.length > 0
  const lastVisit = visits[0]

  return (
    <main className="space-y-4">
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Chronologie</h1>
            <p className="mt-1 text-sm text-muted-foreground">Ici, je peux comprendre comment on en est arrivé là.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href={`/sites/${siteId}/recit`} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
              Lire le récit
            </Link>
          </div>
        </div>

        {lastVisit && <SinceLastVisit siteId={siteId} visit={lastVisit} actions={actions} blocages={blocages} />}
        {pvDelta && pvSummary && pvFromDate && pvToDate && pvDelta.items.length > 0 && (
          <SincePvSection
            siteId={siteId}
            delta={pvDelta}
            summary={pvSummary}
            fromDate={pvFromDate}
            toDate={pvToDate}
          />
        )}
      </section>

      {hasEvents ? (
        <ol className="relative space-y-4 border-l border-border pl-5">
          {visits.map(({ visit, photos, notes, reserves, actions: actionCount }) => {
            const visitActions = actions.filter((action) => action.report_id === visit.id)
            const visitBlocages = blocages.filter((blocage) => blocage.sourceReportId === visit.id)
            const producedKinds = [actionCount > 0, reserves > 0, photos > 0, notes > 0].filter(Boolean).length

            return (
              <li key={visit.id} className="relative">
                <TimelineDot tone="blue" />
                <article className="rounded-[22px] border bg-card p-5 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">Visite terrain · {formatDateTime(visit.started_at ?? visit.created_at)}</p>
                      <h2 className="mt-1 text-lg font-semibold">{visit.objective?.trim() || 'Visite terrain'}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">{visitOutcomeSentence({ photos, notes, actionCount, reserves })}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Link href={`/sites/${siteId}/visites/${visit.id}`} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                        Ouvrir la visite
                      </Link>
                    </div>
                  </div>

                  {/* Un événement qui n'a produit qu'un seul type d'élément se résume en une
                      phrase : le détail dépliable ne sert que s'il y a plusieurs choses à voir. */}
                  {producedKinds > 1 && (
                    <details className="group mt-4 rounded-2xl border bg-muted/20">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold">
                        <span>Ce que cette visite a produit</span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="grid gap-4 border-t p-4 lg:grid-cols-2">
                        <ProducedList
                          title="Actions créées"
                          empty="Aucune action créée."
                          items={visitActions.map((action) => ({ id: action.id, label: action.title, href: `/sites/${siteId}/actions` }))}
                        />
                        <ProducedList
                          title="Réserves ouvertes"
                          empty="Aucune réserve ouverte."
                          items={visitBlocages.map((blocage) => ({ id: blocage.id, label: blocage.title, href: `/sites/${siteId}/reserves` }))}
                        />
                      </div>
                    </details>
                  )}
                </article>
              </li>
            )
          })}

          {interventionEvents.map((intervention) => {
            const done = intervention.status === 'completed' || intervention.status === 'validated'
            return (
              <li key={intervention.id} className="relative">
                <TimelineDot tone={done ? 'green' : 'orange'} />
                <article className="rounded-[22px] border bg-card p-5 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">Intervention · {formatDateTime(intervention.scheduled_at)}</p>
                      <h2 className="mt-1 text-lg font-semibold">{intervention.mission?.name ?? 'Intervention'}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {interventionStatusLabel(intervention.status)} · {intervention.team?.name ?? 'équipe non affectée'}
                      </p>
                    </div>
                    <Link href={`/interventions/${intervention.id}`} className="w-fit shrink-0 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                      Ouvrir
                    </Link>
                  </div>

                  {/* Le langage suit le cycle réel : une intervention à venir n'a rien produit,
                      elle a une attente. Seule une intervention passée a un résultat. */}
                  <div className={cn('mt-4 rounded-2xl border p-4', done ? 'bg-emerald-50/40 dark:bg-emerald-950/15' : 'bg-amber-50/40 dark:bg-amber-950/15')}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {done ? 'Ce que cette intervention a produit' : 'Ce qui est attendu'}
                    </p>
                    <dl className="mt-3 grid gap-3 md:grid-cols-3">
                      {done ? (
                        <>
                          <Fact label="Preuves" value="À consulter sur la fiche" />
                          <Fact label="Équipe" value={intervention.team?.name ?? 'Non affectée'} />
                          <Fact label="Statut" value={interventionStatusLabel(intervention.status)} />
                        </>
                      ) : (
                        <>
                          <Fact label="Mission" value={intervention.mission?.name ?? 'Non renseignée'} />
                          <Fact label="Équipe" value={intervention.team?.name ?? 'Non affectée'} />
                          <Fact label="Preuve attendue" value="Réalisation confirmée" />
                        </>
                      )}
                    </dl>
                  </div>
                </article>
              </li>
            )
          })}

          {/* ── UNE ÉCHÉANCE AJOUTÉE EST UN FAIT DU CHANTIER ──────────────────
              Pas « échéance confirmée » : la chronologie raconte la vie du
              CHANTIER, pas celle de l'application. Ce qui compte n'est pas qu'on
              ait cliqué, c'est que le chantier attende désormais quelque chose —
              et QUAND, avec les mots de celui qui l'a dit. */}
          {deadlines.slice(0, 6).map((d) => (
            <li key={`deadline-${d.id}`} className="relative">
              <TimelineDot tone="orange" />
              <article className="rounded-[18px] border bg-card p-4 shadow-sm">
                <p className="text-sm text-muted-foreground">
                  {d.source_document_effective_date
                    ? `Mentionnée dans le PV du ${formatDate(d.source_document_effective_date)}`
                    : `Échéance ajoutée · ${formatDate(d.created_at)}`}
                </p>
                <p className="mt-0.5 font-medium">{d.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {d.due_date ? echeanceDateLabel(d.due_date) : (d.constraint_text ?? A_PLANIFIER_LABEL)}
                </p>
              </article>
            </li>
          ))}

          {changes.slice(0, 6).map((change) => (
            <li key={change.id} className="relative">
              <TimelineDot tone="neutral" />
              <article className="rounded-[18px] border bg-card p-4 shadow-sm">
                {change.href ? (
                  <Link href={change.href} className="block hover:underline">
                    <ChangeContent change={change} />
                  </Link>
                ) : (
                  <ChangeContent change={change} />
                )}
              </article>
            </li>
          ))}

          {historicalDocs.map((doc) => (
            <li key={doc.id} className="relative">
              <TimelineDot tone="neutral" />
              <article className="rounded-[18px] border bg-card p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">
                      PV historique · {doc.effective_date ? formatDate(doc.effective_date) : formatDate(doc.created_at)}
                    </p>
                    <p className="mt-0.5 font-semibold leading-snug">{doc.filename}</p>
                    <Link
                      href={`/documents/${doc.id}`}
                      className="mt-1 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      Ouvrir le document
                    </Link>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
          <History className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Aucun événement récent sur ce chantier.</p>
          <p className="mt-1 text-sm text-muted-foreground">Les visites, réunions, interventions, décisions, preuves et réserves apparaîtront ici.</p>
        </section>
      )}
    </main>
  )
}

// ── Lot 4C.1 — Depuis le dernier PV ─────────────────────────────────────────

type DeltaTransitionKey =
  | 'réalisé' | 'levé' | 'nouveau' | 'aggravé' | 'réouvert'
  | 'progressé' | 'annulé' | 'maintenu' | 'non_mentionné' | 'changé'

const TRANSITION_CONFIG: Record<DeltaTransitionKey, { label: string; icon: string; color: string }> = {
  réalisé:       { label: 'Réalisés',                  icon: '✓', color: 'text-emerald-700 dark:text-emerald-400' },
  levé:          { label: 'Levés / résolus',            icon: '✓', color: 'text-emerald-700 dark:text-emerald-400' },
  nouveau:       { label: 'Nouveaux',                   icon: '+', color: 'text-blue-700 dark:text-blue-400' },
  aggravé:       { label: 'Aggravés',                   icon: '!', color: 'text-red-700 dark:text-red-400' },
  réouvert:      { label: 'Réouverts',                  icon: '↩', color: 'text-red-600 dark:text-red-400' },
  progressé:     { label: 'En progression',             icon: '↑', color: 'text-blue-600 dark:text-blue-400' },
  annulé:        { label: 'Annulés',                    icon: '×', color: 'text-muted-foreground' },
  maintenu:      { label: 'Toujours ouverts',           icon: '→', color: 'text-muted-foreground' },
  non_mentionné: { label: 'Non mentionnés dans ce PV', icon: '○', color: 'text-orange-700 dark:text-orange-400' },
  changé:        { label: 'Autres changements',         icon: '~', color: 'text-muted-foreground' },
}

const DISPLAY_ORDER: DeltaTransitionKey[] = [
  'réalisé', 'levé', 'nouveau', 'aggravé', 'réouvert', 'progressé', 'annulé', 'non_mentionné', 'changé', 'maintenu',
]

function SincePvSection({
  siteId,
  delta,
  summary,
  fromDate,
  toDate,
}: {
  siteId: string
  delta: PvDelta
  summary: SincePvSummary
  fromDate: string
  toDate: string
}) {
  const byTransition = new Map<DeltaTransitionKey, typeof delta.items>()
  for (const item of delta.items) {
    const key = item.transition as DeltaTransitionKey
    if (!byTransition.has(key)) byTransition.set(key, [])
    byTransition.get(key)!.push(item)
  }

  return (
    <div className="mt-4 rounded-2xl border bg-muted/20 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Depuis le dernier PV
        </p>
        <p className="text-xs text-muted-foreground">
          PV du {formatDate(fromDate)} → PV du {formatDate(toDate)}
        </p>
      </div>

      <div className="mt-3 space-y-1">
        {DISPLAY_ORDER.map((key) => {
          const items = byTransition.get(key)
          if (!items?.length) return null
          const cfg = TRANSITION_CONFIG[key]
          return (
            <details key={key} className="group rounded-lg border bg-background/50">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                <span className={cn('w-4 shrink-0 font-bold tabular-nums', cfg.color)}>{cfg.icon}</span>
                <span className={cn('font-medium', cfg.color)}>{items.length}</span>
                <span className="text-muted-foreground">{cfg.label}</span>
                <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <ul className="border-t px-3 py-2 space-y-1">
                {items.map((item) => (
                  <li key={item.subjectThreadId} className="text-sm">
                    {item.subjectThreadId ? (
                      <Link
                        href={`/sites/${siteId}/historique/${item.subjectThreadId}`}
                        className="hover:underline underline-offset-2"
                      >
                        {item.label}
                      </Link>
                    ) : (
                      item.label
                    )}
                    {item.fromStatus && item.toStatus && item.fromStatus !== item.toStatus && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        ({item.fromStatus} → {item.toStatus})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )
        })}
      </div>

      {byTransition.has('non_mentionné') && (
        <p className="mt-2 text-xs text-muted-foreground">
          ○ Non mentionné dans ce PV ne signifie pas levé — le sujet reste ouvert jusqu'à preuve du contraire.
        </p>
      )}

      {summary.narrative && (
        <div className="mt-3 rounded-xl border-l-2 border-muted pl-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Synthèse</p>
          <p className="mt-1 text-sm leading-relaxed">{summary.narrative}</p>
        </div>
      )}
    </div>
  )
}

/** Ce que Guillaume cherche en ouvrant l'onglet : ce que la dernière visite a laissé
 *  derrière elle — y compris le trou, quand elle n'a rien laissé du tout. */
function SinceLastVisit({
  siteId,
  visit,
  actions,
  blocages,
}: {
  siteId: string
  visit: VisitWithCounts
  actions: SiteActionRow[]
  blocages: SiteBlocage[]
}) {
  const visitId = visit.visit.id
  const createdActions = actions.filter((action) => action.report_id === visitId).length
  const openedReserves = blocages.filter((blocage) => blocage.sourceReportId === visitId).length
  const noFollowUp = createdActions === 0 && openedReserves === 0

  return (
    <div className="mt-4 rounded-2xl bg-muted/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Depuis la dernière visite · {formatDate(visit.visit.started_at ?? visit.visit.created_at)}
      </p>
      <ul className="mt-2 space-y-1 text-sm tabular-nums">
        <li>{visit.photos} photo{visit.photos > 1 ? 's' : ''} ajoutée{visit.photos > 1 ? 's' : ''}</li>
        <li>{createdActions} action{createdActions > 1 ? 's' : ''} créée{createdActions > 1 ? 's' : ''}</li>
        <li>{openedReserves} réserve{openedReserves > 1 ? 's' : ''} ouverte{openedReserves > 1 ? 's' : ''}</li>
      </ul>
      {noFollowUp && (
        <p className="mt-3 border-t pt-3 text-sm">
          <span className="font-medium text-orange-700 dark:text-orange-300">Aucune suite formalisée.</span>{' '}
          <Link href={`/sites/${siteId}/visites/${visitId}`} className="underline underline-offset-2 hover:no-underline">
            Ouvrir la visite
          </Link>
        </p>
      )}
    </div>
  )
}

function visitOutcomeSentence({
  photos,
  notes,
  actionCount,
  reserves,
}: {
  photos: number
  notes: number
  actionCount: number
  reserves: number
}): string {
  const captured: string[] = []
  if (photos > 0) captured.push(`${photos} photo${photos > 1 ? 's' : ''}`)
  if (notes > 0) captured.push(`${notes} note${notes > 1 ? 's' : ''}`)

  const produced: string[] = []
  if (actionCount > 0) produced.push(`${actionCount} action${actionCount > 1 ? 's' : ''}`)
  if (reserves > 0) produced.push(`${reserves} réserve${reserves > 1 ? 's' : ''}`)

  if (captured.length === 0 && produced.length === 0) return 'Aucune trace capturée.'
  if (produced.length === 0) return `${capitalize(captured.join(' et '))} capturée${photos + notes > 1 ? 's' : ''}. Aucune action ni réserve créée.`
  if (captured.length === 0) return `${capitalize(produced.join(' et '))} créée${actionCount + reserves > 1 ? 's' : ''}.`
  return `${capitalize(captured.join(' et '))} · ${produced.join(' et ')} créée${actionCount + reserves > 1 ? 's' : ''}.`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  )
}

function ProducedList({
  title,
  items,
  empty,
}: {
  title: string
  items: Array<{ id: string; label: string; href: string }>
  empty: string
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="text-sm font-medium hover:underline">{item.label}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  )
}

function ChangeContent({ change }: { change: OverviewChangeInput }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
        {change.kind === 'intervention_done' ? <Wrench className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
      </span>
      <div>
        <p className="font-semibold">{change.title}</p>
        {change.detail && <p className="mt-1 text-sm text-muted-foreground">{change.detail}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(change.occurredAt)}</p>
      </div>
    </div>
  )
}

function TimelineDot({ tone }: { tone: 'blue' | 'green' | 'orange' | 'neutral' }): ReactNode {
  const className = {
    blue: 'bg-sky-500',
    green: 'bg-emerald-500',
    orange: 'bg-amber-500',
    neutral: 'bg-muted-foreground',
  }[tone]
  return <span className={`absolute -left-[25px] top-6 h-3 w-3 rounded-full ${className} ring-4 ring-background`} />
}

// La chronologie est rendue côté SERVEUR (Vercel tourne en UTC) : `toLocaleString`
// sans fuseau y affichait l'heure UTC, décalée de 11 h. Une visite de 11:57 se
// racontait « 00:57 » — une heure plausible, donc un mensonge invisible. Le fuseau
// de l'organisation est la seule vérité pour un conducteur (lib/time/local-date).
function formatDate(value: string): string {
  return frDayMonthPaddedLocal(value)
}

function formatDateTime(value: string): string {
  return frDayMonthTimeLocal(value)
}
