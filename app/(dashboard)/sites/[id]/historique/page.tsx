import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteHistoricalTimeline, getSiteSubjectMatrix } from '@/lib/documents/pv-history'
import { getPvDelta } from '@/lib/documents/pv-comparison'
import {
  getRunsMeta,
  computeWatchlist,
  computeProgressByCategory,
  computeDeltaSummary,
  getImportantSubjects,
  getActivityMap,
} from '@/lib/documents/site-synthesis'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { cn } from '@/lib/utils'
import { SubjectLifelineGrid } from './SubjectLifelineGrid'
import { SyntheseView } from './SyntheseView'
import { ActivityMapView } from './ActivityMapView'

export const dynamic = 'force-dynamic'

type ViewKey = 'synthese' | 'lifelines' | 'heatmap' | 'deps'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    view?: string
    thread?: string
    theme?: string
    status?: string
  }>
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function SiteHistoriquePage({ params, searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) redirect('/login')

  const { id: siteId } = await params
  const sp = await searchParams
  const VALID_VIEWS: ViewKey[] = ['synthese', 'lifelines', 'heatmap', 'deps']
  const view: ViewKey = (VALID_VIEWS.includes(sp.view as ViewKey) ? sp.view as ViewKey : 'synthese')
  const initialThread = sp.thread ?? null
  const initialTheme = sp.theme ?? null

  const [site, matrix, timeline, importantSubjects] = await Promise.all([
    getSiteIdentity(siteId).catch(() => null),
    getSiteSubjectMatrix(siteId).catch(() => null),
    getSiteHistoricalTimeline(siteId).catch(() => ({ siteId, snapshots: [] })),
    getImportantSubjects(siteId).catch(() => []),
  ])

  const activityMap = view === 'heatmap'
    ? await getActivityMap(siteId).catch(() => null)
    : null

  if (!site) redirect(`/sites/${siteId}`)

  const totalRuns = timeline.snapshots.length

  // Métadonnées enrichies : dates réelles des PV + reportId pour les liens
  const matrixRuns = matrix?.runs ?? []
  const runs = await getRunsMeta(matrixRuns).catch(() => matrixRuns.map((r) => ({
    runId: r.id,
    documentId: r.documentId,
    effectiveDate: r.effectiveDate,
    reportId: null,
  })))

  // Delta entre les deux derniers PV (si ≥ 2)
  let deltaData: { summary: ReturnType<typeof computeDeltaSummary>; fromIdx: number; toIdx: number } | null = null
  if (timeline.snapshots.length >= 2) {
    const fromSnap = timeline.snapshots[timeline.snapshots.length - 2]
    const toSnap   = timeline.snapshots[timeline.snapshots.length - 1]
    try {
      const delta = await getPvDelta(fromSnap.runId, toSnap.runId)
      deltaData = {
        summary: computeDeltaSummary(delta),
        fromIdx: timeline.snapshots.length - 2,
        toIdx:   timeline.snapshots.length - 1,
      }
    } catch {
      // delta non disponible, on affiche sans
    }
  }

  // Computations pures depuis la matrice
  const watchlist = matrix ? computeWatchlist(matrix) : []
  const categories = matrix ? computeProgressByCategory(matrix) : []
  const totalSubjects = matrix?.rows.length ?? 0

  function viewHref(v: ViewKey) {
    const p = new URLSearchParams()
    p.set('view', v)
    if (initialThread) p.set('thread', initialThread)
    if (initialTheme) p.set('theme', initialTheme)
    return `/sites/${siteId}/historique?${p.toString()}`
  }

  return (
    <>
      <BreadcrumbPrefix crumbs={[{ href: '/sites', label: 'Sites' }, { href: `/sites/${siteId}`, label: site.name }]} />
      <DynamicCrumb segmentId="historique" label="Histoire du chantier" />

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold">Histoire du chantier</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {totalRuns} PV analysé{totalRuns > 1 ? 's' : ''} — transitions calculées, aucun fait inventé.
              </p>
            </div>
            {runs.length > 0 && (
              <p className="shrink-0 text-sm text-muted-foreground">
                {formatDate(runs[0].effectiveDate)}
                {runs.length > 1 && ` → ${formatDate(runs[runs.length - 1].effectiveDate)}`}
              </p>
            )}
          </div>

          {/* Onglets */}
          <nav className="mt-4 flex gap-1 rounded-xl bg-muted/40 p-1">
            {([
              { key: 'synthese',  label: 'Synthèse' },
              { key: 'lifelines', label: 'Lignes de vie' },
              { key: 'heatmap',   label: 'Activité' },
              { key: 'deps',      label: 'Dépendances' },
            ] as const).map(({ key, label }) => (
              <Link
                key={key}
                href={viewHref(key)}
                className={cn(
                  'flex-1 rounded-lg px-2 py-1.5 text-center text-xs font-medium transition-colors sm:text-sm sm:px-3',
                  view === key ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        </section>

        {/* Synthèse */}
        {view === 'synthese' && (
          <SyntheseView
            siteId={siteId}
            runs={runs}
            timeline={timeline}
            watchlist={watchlist}
            categories={categories}
            delta={deltaData}
            totalSubjects={totalSubjects}
            importantSubjects={importantSubjects}
          />
        )}

        {/* Lignes de vie */}
        {view === 'lifelines' && (
          matrix && matrix.rows.length > 0 ? (
            <SubjectLifelineGrid
              matrix={matrix}
              siteId={siteId}
              initialThread={initialThread}
              initialTheme={initialTheme}
            />
          ) : (
            <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
              <p className="font-medium">Aucun fil thématique reconstruit.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Les PV doivent être importés, analysés et avoir des threads sujets pour apparaître ici.
              </p>
            </section>
          )
        )}

        {/* Carte d'activité */}
        {view === 'heatmap' && (
          activityMap ? (
            <ActivityMapView activityMap={activityMap} siteId={siteId} />
          ) : (
            <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
              <p className="font-medium">Données non disponibles.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Les PV doivent être importés et analysés pour afficher la carte d'activité.
              </p>
            </section>
          )
        )}

        {/* Dépendances */}
        {view === 'deps' && (
          <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
            <p className="font-medium">Dépendances</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Les liens de causalité entre sujets s'ajoutent depuis la fiche de chaque sujet.
            </p>
          </section>
        )}
      </main>
    </>
  )
}
