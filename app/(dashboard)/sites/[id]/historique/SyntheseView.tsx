import Link from 'next/link'
import { AlertTriangle, Clock, TrendingUp, CheckCircle2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WatchlistEntry, WatchReason, CategoryProgress, DeltaSummary, RunMeta, ImportantSubject } from '@/lib/documents/site-synthesis'
import type { SiteHistoricalTimeline } from '@/lib/documents/pv-history'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

function plural(n: number, singular: string, pluralStr?: string): string {
  return `${n} ${n > 1 ? (pluralStr ?? singular + 's') : singular}`
}

// ── Bloc 1 — Depuis le dernier PV ────────────────────────────────────────────

const DELTA_ROWS: Array<{
  key: keyof DeltaSummary
  label: string
  icon: string
  color: string
  hideIfEmpty?: boolean
}> = [
  { key: 'aggravésRéouverts', label: 'Aggravés / réouverts', icon: '!', color: 'text-red-600 dark:text-red-400' },
  { key: 'nouveaux',          label: 'Nouveaux',             icon: '+', color: 'text-blue-600 dark:text-blue-400' },
  { key: 'réalisésLevés',     label: 'Réalisés / levés',    icon: '✓', color: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'progressés',        label: 'En progression',       icon: '↑', color: 'text-blue-500 dark:text-blue-300' },
  { key: 'toujoursOuverts',   label: 'Toujours ouverts',    icon: '→', color: 'text-muted-foreground' },
  { key: 'nonMentionnés',     label: 'Non mentionnés',      icon: '○', color: 'text-muted-foreground', hideIfEmpty: true },
  { key: 'annulés',           label: 'Annulés',             icon: '×', color: 'text-muted-foreground', hideIfEmpty: true },
]

function DeltaBloc({
  summary,
  siteId,
  fromMeta,
  toMeta,
  pvNumbers,
}: {
  summary: DeltaSummary
  siteId: string
  fromMeta: RunMeta
  toMeta: RunMeta
  pvNumbers: { from: number; to: number }
}) {
  const hasCritical = summary.aggravésRéouverts.length > 0

  return (
    <section className="rounded-[18px] border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Depuis le dernier PV
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            PV{pvNumbers.from} ({fmtShort(fromMeta.effectiveDate)})
            {' → '}
            <span className="font-medium text-foreground">PV{pvNumbers.to} ({fmtDate(toMeta.effectiveDate)})</span>
          </p>
        </div>
        {hasCritical && (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
        )}
      </div>

      <div className="mt-4 divide-y divide-border">
        {DELTA_ROWS.map(({ key, label, icon, color, hideIfEmpty }) => {
          const items = summary[key]
          if (hideIfEmpty && items.length === 0) return null
          return (
            <div key={key} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className={cn('mt-0.5 w-4 shrink-0 text-center font-bold', color)} aria-hidden>
                {icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', items.length === 0 && 'text-muted-foreground')}>
                  {items.length > 0 ? (
                    <span className={color}>{items.length}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}{' '}
                  {label.toLowerCase()}
                </p>
                {items.length > 0 && items.length <= 4 && (
                  <ul className="mt-1 space-y-0.5">
                    {items.map((item) => (
                      <li key={item.subjectThreadId}>
                        <Link
                          href={`/sites/${siteId}/historique/${item.subjectThreadId}`}
                          className="block truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {items.length > 4 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      Voir les {items.length} sujets
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {items.map((item) => (
                        <li key={item.subjectThreadId}>
                          <Link
                            href={`/sites/${siteId}/historique/${item.subjectThreadId}`}
                            className="block truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          >
                            {item.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Bloc 1 — État initial (1 seul PV) ────────────────────────────────────────

function FirstPvBloc({ meta, pvNumber, totalSubjects }: { meta: RunMeta; pvNumber: number; totalSubjects: number }) {
  return (
    <section className="rounded-[18px] border bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Premier PV importé</p>
      <p className="mt-1 text-sm">
        PV{pvNumber} du {fmtDate(meta.effectiveDate)} — {plural(totalSubjects, 'sujet')} identifié{totalSubjects > 1 ? 's' : ''}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Le delta apparaîtra dès l'import du deuxième PV.
      </p>
    </section>
  )
}

// ── Bloc 2 — Sujets importants (ranking canonique) ───────────────────────────

function SujetsImportantsBloc({ items, siteId }: { items: ImportantSubject[]; siteId: string }) {
  if (items.length === 0) {
    return (
      <section className="rounded-[18px] border bg-card p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sujets importants</p>
        <p className="mt-3 text-sm text-muted-foreground">Aucun sujet structurant identifié pour ce chantier.</p>
      </section>
    )
  }

  return (
    <section className="rounded-[18px] border bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sujets importants</p>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>

      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const parts: string[] = []
          if (item.pvCount >= 2) parts.push(`${item.pvCount} PV`)
          if (item.reappearance) parts.push('réapparition')
          if (item.openActions > 0)
            parts.push(`${item.openActions} action${item.openActions > 1 ? 's' : ''} ouverte${item.openActions > 1 ? 's' : ''}`)
          if (item.openReserves > 0)
            parts.push(`${item.openReserves} réserve${item.openReserves > 1 ? 's' : ''} ouverte${item.openReserves > 1 ? 's' : ''}`)
          if (item.overdueDeadlines > 0)
            parts.push(`⚠ ${item.overdueDeadlines} en retard`)
          const nonOverdue = item.activeDeadlines - item.overdueDeadlines
          if (nonOverdue > 0)
            parts.push(`${nonOverdue} échéance${nonOverdue > 1 ? 's' : ''}`)
          if (item.recentOccurrence) parts.push('vu récemment')

          return (
            <li key={item.canonicalSubjectId}>
              <Link
                href={`/sites/${siteId}/historique/sujets/${item.canonicalSubjectId}`}
                className="flex items-start gap-3 rounded-lg bg-muted/20 px-3 py-2.5 transition-colors hover:bg-muted/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  {parts.length > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{parts.join(' · ')}</p>
                  )}
                </div>
                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Bloc 3 — Sujets à surveiller ─────────────────────────────────────────────

const WATCH_CONFIG: Record<WatchReason, { label: string; icon: string; color: string; bgColor: string }> = {
  non_conforme:    { label: 'Non conforme',           icon: '✗', color: 'text-red-700 dark:text-red-400',    bgColor: 'bg-red-50 dark:bg-red-950/30' },
  aggravé:         { label: 'Aggravé',                icon: '↑!', color: 'text-red-600 dark:text-red-400',   bgColor: 'bg-red-50 dark:bg-red-950/30' },
  réouvert:        { label: 'Réouvert',               icon: '↩',  color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-50 dark:bg-orange-950/30' },
  ouvert_longtemps:{ label: 'Ouvert depuis longtemps', icon: '⏱', color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-950/30' },
  en_attente:      { label: 'En attente prolongée',   icon: '…',  color: 'text-blue-600 dark:text-blue-400',  bgColor: 'bg-blue-50 dark:bg-blue-950/30' },
  sans_évolution:  { label: 'Sans évolution',         icon: '→',  color: 'text-muted-foreground',             bgColor: 'bg-muted/40' },
}

function WatchlistBloc({ items, siteId, runs }: { items: WatchlistEntry[]; siteId: string; runs: RunMeta[] }) {
  if (items.length === 0) return (
    <section className="rounded-[18px] border bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sujets à surveiller</p>
      <p className="mt-3 text-sm text-muted-foreground">Aucun sujet critique identifié.</p>
    </section>
  )

  return (
    <section className="rounded-[18px] border bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sujets à surveiller</p>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>

      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const cfg = WATCH_CONFIG[item.reason]
          const lastRunLabel = item.lastRunIndex >= 0
            ? `PV${item.lastRunIndex + 1}`
            : null
          const lastDate = item.lastRunIndex >= 0 && runs[item.lastRunIndex]
            ? fmtShort(runs[item.lastRunIndex].effectiveDate)
            : null

          return (
            <li key={item.subjectThreadId}>
              <Link
                href={`/sites/${siteId}/historique/${item.subjectThreadId}`}
                className={cn(
                  'flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60',
                  cfg.bgColor,
                )}
              >
                <span className={cn('mt-0.5 shrink-0 text-sm font-bold', cfg.color)} aria-hidden>
                  {cfg.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {cfg.label}
                    {item.pvCount > 1 && ` · mentionné dans ${plural(item.pvCount, 'PV')}`}
                    {lastRunLabel && ` · dernière mention ${lastRunLabel}${lastDate ? ` (${lastDate})` : ''}`}
                  </p>
                </div>
                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Bloc 3 — Progression par catégorie ───────────────────────────────────────

function pill(n: number, label: string, color: string) {
  if (n === 0) return null
  return (
    <span key={label} className={cn('inline-flex items-center gap-0.5 text-xs tabular-nums', color)}>
      <span className="font-semibold">{n}</span>{' '}{label}
    </span>
  )
}

function CategoryRow({ cat }: { cat: CategoryProgress }) {
  const hasProblem = cat.nonCompliant > 0
  const pills = [
    pill(cat.nonCompliant, 'non conf.', 'text-red-600 dark:text-red-400'),
    pill(cat.inProgress, 'en cours', 'text-blue-600 dark:text-blue-400'),
    pill(cat.open, 'ouvert', 'text-amber-600 dark:text-amber-400'),
    pill(cat.awaitingValidation, 'en attente', 'text-blue-500 dark:text-blue-300'),
    pill(cat.planned, 'prévu', 'text-muted-foreground'),
    pill(cat.done, 'réalisé', 'text-emerald-600 dark:text-emerald-400'),
    pill(cat.other, 'autre', 'text-muted-foreground'),
  ].filter(Boolean)

  return (
    <div className={cn('flex items-start gap-3 py-2.5 first:pt-0 last:pb-0', hasProblem && 'pl-0')}>
      <div className="min-w-0 w-32 shrink-0">
        <p className={cn('truncate text-sm font-medium', hasProblem && 'text-red-600 dark:text-red-400')}>
          {cat.category}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {pills.length > 0 ? pills : <span className="text-xs text-muted-foreground">—</span>}
      </div>
    </div>
  )
}

function ProgressionBloc({ categories }: { categories: CategoryProgress[] }) {
  if (categories.length === 0) return (
    <section className="rounded-[18px] border bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Progression du chantier</p>
      <p className="mt-3 text-sm text-muted-foreground">Aucune catégorie thématique disponible.</p>
    </section>
  )

  return (
    <section className="rounded-[18px] border bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Progression du chantier</p>
      <div className="mt-3 divide-y divide-border">
        {categories.map((cat) => <CategoryRow key={cat.category} cat={cat} />)}
      </div>
    </section>
  )
}

// ── Bloc 4 — Histoire récente ─────────────────────────────────────────────────

const SNAP_TRANSITIONS: Array<{ key: string; icon: string; color: string }> = [
  { key: 'aggravé',       icon: '!', color: 'text-red-600 dark:text-red-400' },
  { key: 'réouvert',      icon: '↩', color: 'text-red-500 dark:text-red-400' },
  { key: 'nouveau',       icon: '+', color: 'text-blue-600 dark:text-blue-400' },
  { key: 'réalisé',       icon: '✓', color: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'levé',          icon: '✓', color: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'progressé',     icon: '↑', color: 'text-blue-500 dark:text-blue-300' },
  { key: 'non_mentionné', icon: '○', color: 'text-muted-foreground' },
]

function HistoireBloc({
  snapshots,
  runs,
  siteId,
}: {
  snapshots: SiteHistoricalTimeline['snapshots']
  runs: RunMeta[]
  siteId: string
}) {
  const MAX_DISPLAY = 5
  const displayed = snapshots.slice(-MAX_DISPLAY)
  const startIdx = snapshots.length - displayed.length

  return (
    <section className="rounded-[18px] border bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histoire récente</p>

      {snapshots.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Aucun PV importé.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {displayed.map((snap, localIdx) => {
            const globalIdx = startIdx + localIdx
            const runMeta = runs.find((r) => r.runId === snap.runId)
            const effectiveDate = runMeta?.effectiveDate ?? snap.effectiveDate
            const reportId = runMeta?.reportId
            const pvNum = globalIdx + 1

            const counts = snap.transitionCounts
            const total = Object.values(counts).reduce((s, v) => s + (v ?? 0), 0)

            const badges = SNAP_TRANSITIONS
              .map(({ key, icon, color }) => {
                const n = counts[key as keyof typeof counts] ?? 0
                if (!n) return null
                return (
                  <span key={key} className={cn('tabular-nums text-xs', color)}>
                    <span className="font-bold">{icon}</span>{' '}{n}
                  </span>
                )
              })
              .filter(Boolean)

            const href = reportId
              ? `/sites/${siteId}/visites/${reportId}`
              : `/documents/${snap.documentId}/extraction/${snap.runId}`

            const isLast = localIdx === displayed.length - 1

            return (
              <li key={snap.runId}>
                <Link
                  href={href}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50',
                    isLast && 'border-foreground/20 bg-muted/20',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                        PV{pvNum}
                      </span>
                      {snap.isFirstRun && (
                        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                          premier
                        </span>
                      )}
                      <span className="text-sm font-medium">{fmtDate(effectiveDate)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-xs text-muted-foreground">{plural(total, 'sujet')}</span>
                      {badges.length > 0 && (
                        <>
                          <span className="text-xs text-muted-foreground">·</span>
                          {badges}
                        </>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

// ── Composant principal ──────────────────────────────────────────────────────

export interface SyntheseViewProps {
  siteId: string
  runs: RunMeta[]
  timeline: SiteHistoricalTimeline
  watchlist: WatchlistEntry[]
  categories: CategoryProgress[]
  delta: { summary: DeltaSummary; fromIdx: number; toIdx: number } | null
  totalSubjects: number
  importantSubjects: ImportantSubject[]
}

export function SyntheseView({
  siteId,
  runs,
  timeline,
  watchlist,
  categories,
  delta,
  totalSubjects,
  importantSubjects,
}: SyntheseViewProps) {
  if (runs.length === 0) {
    return (
      <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
        <p className="font-medium">Aucun PV historique importé pour ce chantier.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Importez un premier PV depuis l'onglet Documents du chantier.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      {/* Bloc 1 : Delta ou premier PV */}
      {delta ? (
        <DeltaBloc
          summary={delta.summary}
          siteId={siteId}
          fromMeta={runs[delta.fromIdx]}
          toMeta={runs[delta.toIdx]}
          pvNumbers={{ from: delta.fromIdx + 1, to: delta.toIdx + 1 }}
        />
      ) : (
        <FirstPvBloc meta={runs[0]} pvNumber={1} totalSubjects={totalSubjects} />
      )}

      {/* Bloc 2 : Sujets importants */}
      <SujetsImportantsBloc items={importantSubjects} siteId={siteId} />

      {/* Bloc 3 : Sujets à surveiller */}
      <WatchlistBloc items={watchlist} siteId={siteId} runs={runs} />

      {/* Bloc 3 : Progression par catégorie */}
      <ProgressionBloc categories={categories} />

      {/* Bloc 4 : Histoire récente */}
      <HistoireBloc snapshots={timeline.snapshots} runs={runs} siteId={siteId} />
    </div>
  )
}
