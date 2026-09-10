// P6 — Page interne d'observation du Live Writer global (mandat Vincent, 2026-09-10).
//
// Lecture SEULE, aucun changement du moteur. Source = tracked_point_reconcile_event
// (migration 400), pas les logs Vercel. Cf. lib/db/tracked-point-live-writer-observability.ts
// pour la doctrine complète (reconstruction de "run" par heuristique, limites connues).

import Link from 'next/link'
import {
  getLiveWriterRuns,
  getLiveWriterSites,
  getLiveWriterSummaries,
  type LiveWriterRun,
  type LiveWriterSummary,
} from '@/lib/db/tracked-point-live-writer-observability'
export const dynamic = 'force-dynamic'

const PERIOD_OPTS = [1, 7, 30] as const
type PeriodDays = (typeof PERIOD_OPTS)[number]

function parsePeriod(raw: string | undefined): PeriodDays {
  const n = Number(raw)
  if (n === 1 || n === 7 || n === 30) return n
  return 7
}

const SOURCE_LABEL: Record<string, string> = {
  historical_pdf: 'PV historique',
  field_visit: 'Visite terrain',
  meeting: 'Réunion',
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

function PeriodTabs({ period, siteId }: { period: PeriodDays; siteId?: string }) {
  const qs = (p: PeriodDays) => {
    const params = new URLSearchParams()
    if (p !== 7) params.set('period', String(p))
    if (siteId) params.set('site', siteId)
    const s = params.toString()
    return `/admin/live-writer${s ? `?${s}` : ''}`
  }
  const labels: Record<PeriodDays, string> = { 1: '24 h', 7: '7 j', 30: '30 j' }
  return (
    <div className="flex items-center gap-1.5">
      {PERIOD_OPTS.map((p) => (
        <Link
          key={p}
          href={qs(p)}
          aria-current={p === period ? 'page' : undefined}
          className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
            p === period
              ? 'border-brand-600 bg-brand-50 text-brand-900 font-medium dark:bg-brand-950/30 dark:text-brand-200'
              : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/20'
          }`}
        >
          {labels[p]}
        </Link>
      ))}
    </div>
  )
}

function SiteFilterForm({ sites, period, siteId }: { sites: Array<{ id: string; name: string }>; period: PeriodDays; siteId?: string }) {
  return (
    <form method="get" className="flex items-center gap-2">
      {period !== 7 && <input type="hidden" name="period" value={period} />}
      <select
        name="site"
        defaultValue={siteId ?? ''}
        className="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground"
      >
        <option value="">Tous les chantiers</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <button type="submit" className="rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-muted/30">
        Filtrer
      </button>
    </form>
  )
}

function SummaryCards({ last24h, last7d }: { last24h: LiveWriterSummary; last7d: LiveWriterSummary }) {
  const cards: Array<{ label: string; s: LiveWriterSummary }> = [
    { label: 'Dernières 24 h', s: last24h },
    { label: '7 derniers jours', s: last7d },
  ]
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      {cards.map(({ label, s }) => (
        <div key={label} className="rounded-lg border bg-card p-4">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2.5">{label}</h2>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xl font-semibold tabular-nums">{s.totalUnits}</div>
              <div className="text-[11px] text-muted-foreground">unités traitées</div>
            </div>
            <div>
              <div className="text-xl font-semibold tabular-nums">{s.siteCount}</div>
              <div className="text-[11px] text-muted-foreground">chantiers actifs</div>
            </div>
            <div>
              <div className="text-xl font-semibold tabular-nums">{s.verdictCounts.NEEDS_HUMAN ?? 0}</div>
              <div className="text-[11px] text-muted-foreground">à arbitrer</div>
            </div>
            <div>
              <div className="text-xl font-semibold tabular-nums">{s.verdictCounts.AUTO_CREATED ?? 0}</div>
              <div className="text-[11px] text-muted-foreground">créés auto</div>
            </div>
            <div>
              <div className="text-xl font-semibold tabular-nums">{s.verdictCounts.AUTO_LINKED ?? 0}</div>
              <div className="text-[11px] text-muted-foreground">liés auto</div>
            </div>
            <div>
              <div className="text-xl font-semibold tabular-nums">{s.identityUnresolvedCount}</div>
              <div className="text-[11px] text-muted-foreground">identité non résolue</div>
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}

function runDetailHref(run: LiveWriterRun): string {
  const params = new URLSearchParams({
    site: run.siteId,
    sourceKind: run.sourceKind,
    from: run.startAt,
    to: run.endAt,
  })
  if (run.sourceRefId) params.set('sourceRefId', run.sourceRefId)
  return `/admin/live-writer/detail?${params.toString()}`
}

function RunsTable({ runs }: { runs: LiveWriterRun[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Runs reconstruits ({runs.length})
      </h2>
      <p className="text-xs text-muted-foreground">
        Un « run » n&apos;est pas un identifiant stocké : il est reconstruit en regroupant les événements par
        (chantier, source, document/référence) puis en séparant les occurrences distantes de plus de 10 minutes.
        Les erreurs de la RPC (refus, exception) ne sont pas persistées en base aujourd&apos;hui — elles ne
        peuvent apparaître que dans les logs Vercel <code>[tracked-point-live-writer]</code>.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Date/heure</th>
              <th className="px-3 py-2 text-left">Chantier</th>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-3 py-2 text-right">Unités</th>
              <th className="px-3 py-2 text-right">Lié auto</th>
              <th className="px-3 py-2 text-right">Créé auto</th>
              <th className="px-3 py-2 text-right">À arbitrer</th>
              <th className="px-3 py-2 text-right">Ignoré</th>
              <th className="px-3 py-2 text-right">Identité non résolue</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {runs.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-xs text-muted-foreground">Aucun run sur la période.</td></tr>
            ) : runs.map((run, i) => {
              const anomalous = run.anomalies.autoCreatedHigh || run.anomalies.needsHumanHigh
              return (
                <tr key={`${run.siteId}|${run.sourceKind}|${run.sourceRefId}|${run.startAt}|${i}`} className={anomalous ? 'bg-amber-50/60 dark:bg-amber-950/20' : 'hover:bg-muted/20'}>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDateTime(run.startAt)}</td>
                  <td className="px-3 py-2 font-medium">{run.siteName}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{SOURCE_LABEL[run.sourceKind] ?? run.sourceKind}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{run.unitsProcessed}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{run.verdictCounts.AUTO_LINKED ?? 0}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${run.anomalies.autoCreatedHigh ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}`}>
                    {run.verdictCounts.AUTO_CREATED ?? 0}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${run.anomalies.needsHumanHigh ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}`}>
                    {run.verdictCounts.NEEDS_HUMAN ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{run.verdictCounts.IGNORED_NOT_TRACKABLE ?? 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{run.identityUnresolvedCount}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={runDetailHref(run)} className="text-xs text-brand-700 hover:underline dark:text-brand-300">
                      Détail
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default async function AdminLiveWriterPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; site?: string }>
}) {
  const { period: periodRaw, site: siteId } = await searchParams
  const period = parsePeriod(periodRaw)

  const [sites, runs, summaries] = await Promise.all([
    getLiveWriterSites(),
    getLiveWriterRuns({ periodDays: period, siteId: siteId || undefined }),
    getLiveWriterSummaries(siteId || undefined),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Live Writer</h1>
          <p className="text-sm text-muted-foreground">
            Observation des runs de rattachement automatique aux points de suivi (P6, GLOBAL ON).
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SiteFilterForm sites={sites} period={period} siteId={siteId} />
          <PeriodTabs period={period} siteId={siteId} />
        </div>
      </div>

      <SummaryCards last24h={summaries.last24h} last7d={summaries.last7d} />

      <RunsTable runs={runs} />
    </div>
  )
}
