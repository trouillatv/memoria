import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteHistoricalTimeline } from '@/lib/documents/pv-history'
import { generateSiteHistoryNarrative } from '@/lib/documents/pv-narrator'
import type { SiteRunSnapshot } from '@/lib/documents/pv-history'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const TRANSITION_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  réalisé:       { label: 'Réalisés',              icon: '✓', color: 'text-emerald-700 dark:text-emerald-400' },
  levé:          { label: 'Levés',                 icon: '✓', color: 'text-emerald-700 dark:text-emerald-400' },
  nouveau:       { label: 'Nouveaux',              icon: '+', color: 'text-blue-700 dark:text-blue-400' },
  aggravé:       { label: 'Aggravés',              icon: '!', color: 'text-red-700 dark:text-red-400' },
  réouvert:      { label: 'Réouverts',             icon: '↩', color: 'text-red-600 dark:text-red-400' },
  progressé:     { label: 'En progression',        icon: '↑', color: 'text-blue-600 dark:text-blue-400' },
  annulé:        { label: 'Annulés',               icon: '×', color: 'text-muted-foreground' },
  maintenu:      { label: 'Inchangés',             icon: '→', color: 'text-muted-foreground' },
  non_mentionné: { label: 'Non mentionnés',        icon: '○', color: 'text-orange-700 dark:text-orange-400' },
  réapparu:      { label: 'Réapparus',             icon: '↗', color: 'text-purple-700 dark:text-purple-400' },
  changé:        { label: 'Autres changements',    icon: '~', color: 'text-muted-foreground' },
}

const DISPLAY_ORDER = [
  'réalisé', 'levé', 'nouveau', 'aggravé', 'réouvert', 'progressé', 'annulé', 'non_mentionné', 'réapparu', 'changé', 'maintenu',
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function SnapshotCard({ snapshot, index }: { snapshot: SiteRunSnapshot; index: number }) {
  const counts = snapshot.transitionCounts
  const total = Object.values(counts).reduce((s, v) => s + (v ?? 0), 0)
  const nonMentionne = counts['non_mentionné'] ?? 0

  return (
    <article className="rounded-[18px] border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            PV {index + 1}
            {snapshot.isFirstRun && <span className="ml-1.5 text-[10px] text-muted-foreground">(premier)</span>}
          </p>
          <p className="mt-0.5 font-medium">{formatDate(snapshot.effectiveDate)}</p>
        </div>
        <p className="text-sm text-muted-foreground">{total} sujet{total > 1 ? 's' : ''}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {DISPLAY_ORDER.map((key) => {
          const count = counts[key as keyof typeof counts] ?? 0
          if (!count) return null
          const cfg = TRANSITION_CONFIG[key]
          if (!cfg) return null
          return (
            <span key={key} className={cn('text-sm tabular-nums', cfg.color)}>
              <span className="font-bold">{cfg.icon}</span>{' '}
              <span className="font-semibold">{count}</span>{' '}
              <span>{cfg.label.toLowerCase()}</span>
            </span>
          )
        })}
      </div>

      {nonMentionne > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          ○ {nonMentionne} sujet{nonMentionne > 1 ? 's' : ''} non mentionné{nonMentionne > 1 ? 's' : ''} — état précédent conservé, pas de résolution implicite.
        </p>
      )}
    </article>
  )
}

export default async function SiteHistoriquePage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) redirect('/login')

  const { id: siteId } = await params

  const [site, timeline, historyResult] = await Promise.all([
    getSiteIdentity(siteId).catch(() => null),
    getSiteHistoricalTimeline(siteId).catch(() => ({ siteId, snapshots: [] })),
    generateSiteHistoryNarrative(siteId).catch(() => null),
  ])

  if (!site) redirect(`/sites/${siteId}`)

  const narrative = historyResult?.narrative ?? null

  return (
    <>
      <BreadcrumbPrefix crumbs={[{ href: '/sites', label: 'Sites' }, { href: `/sites/${siteId}`, label: site.name }]} />
      <DynamicCrumb segmentId="historique" label="Histoire du chantier" />

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <div>
          <Link
            href={`/sites/${siteId}?tab=chronologie`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Retour à la chronologie
          </Link>
        </div>

        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <h1 className="text-xl font-semibold">Histoire du chantier</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Chronologie déterministe de tous les PV — transitions calculées, aucun fait inventé.
          </p>

          {timeline.snapshots.length > 0 && (
            <dl className="mt-4 flex flex-wrap gap-4 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">PV analysés</dt>
                <dd className="mt-0.5 text-lg font-semibold">{timeline.snapshots.length}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Période</dt>
                <dd className="mt-0.5">
                  {formatDate(timeline.snapshots[0].effectiveDate)}
                  {timeline.snapshots.length > 1 && ` → ${formatDate(timeline.snapshots[timeline.snapshots.length - 1].effectiveDate)}`}
                </dd>
              </div>
            </dl>
          )}
        </section>

        {narrative && (
          <section className="rounded-[18px] border bg-card p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Récit chronologique</p>
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">{narrative}</p>
            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              Ce récit est synthétisé à partir des transitions ci-dessous. Une absence n'est pas une résolution.
            </p>
          </section>
        )}

        {timeline.snapshots.length === 0 ? (
          <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
            <p className="font-medium">Aucun PV historique indexé pour ce chantier.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Les PV doivent être importés et traités pour apparaître ici.
            </p>
          </section>
        ) : (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Par PV ({timeline.snapshots.length})
            </h2>
            <ol className="space-y-3">
              {timeline.snapshots.map((snapshot, i) => (
                <li key={snapshot.runId}>
                  <SnapshotCard snapshot={snapshot} index={i} />
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
    </>
  )
}
