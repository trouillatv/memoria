import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { SiteTabsNav } from '../SiteTabsNav'
import { getSiteHistoricalTimeline, getSiteSubjectMatrix } from '@/lib/documents/pv-history'
import { getCanonicalDelta } from '@/lib/documents/canonical-transitions'
import { getSuggestedLinkCountsBySite } from '@/lib/db/subject-thread-links'
import { getSiteNativeOccurrencesBySubject, getCanonicalSubjectLabelsByIds } from '@/lib/db/canonical-subject-life'
import {
  getRunsMeta,
  computeWatchlist,
  computeProgressByCategory,
  computeDeltaSummary,
  getImportantSubjects,
  getActivityMap,
  getSiteHealthTimeline,
  getSiteDependencyGraph,
} from '@/lib/documents/site-synthesis'
import { buildEvolutionReadModel, generateEvolutionNarrative } from '@/lib/documents/pv-evolution'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { cn } from '@/lib/utils'
import { SubjectLifelineGrid } from './SubjectLifelineGrid'
import { SyntheseView } from './SyntheseView'
import { ActivityMapView } from './ActivityMapView'
import { EvolutionView } from './EvolutionView'
import { DependencyGraphView } from './DependencyGraphView'

export const dynamic = 'force-dynamic'

type ViewKey = 'synthese' | 'lifelines' | 'heatmap' | 'evolution' | 'deps'

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
  const VALID_VIEWS: ViewKey[] = ['synthese', 'lifelines', 'heatmap', 'evolution', 'deps']
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

  const depsGraph = view === 'deps'
    ? await getSiteDependencyGraph(siteId).catch(() => null)
    : null

  // nativeOccurrences chargé pour tous les onglets (header + lifelines + évolution)
  const nativeOccurrences = await getSiteNativeOccurrencesBySubject(siteId).catch(() => ({}))
  const suggestedCounts = view === 'lifelines'
    ? await getSuggestedLinkCountsBySite(siteId).catch(() => ({}))
    : {}

  const importanceScoreMap: Record<string, number> = Object.fromEntries(
    importantSubjects.map((s) => [s.canonicalSubjectId, s.score])
  )

  const evolutionData = view === 'evolution'
    ? await (async () => {
        try {
          const [readModel, healthTimeline] = await Promise.all([
            buildEvolutionReadModel(siteId),
            getSiteHealthTimeline(siteId).catch(() => null),
          ])
          const narrative = await generateEvolutionNarrative(readModel)
          return { readModel, narrative, healthTimeline }
        } catch {
          return null
        }
      })()
    : null

  if (!site) redirect(`/sites/${siteId}`)

  const totalRuns = timeline.snapshots.length

  // Résumé des occurrences natives pour le header — comptage par dates distinctes (un report = un événement)
  const nativeVisitDates = new Set<string>()
  const nativeMeetingDates = new Set<string>()
  let nativeLastDate: string | null = null
  for (const occs of Object.values(nativeOccurrences)) {
    for (const o of occs) {
      if (o.sourceKind === 'field_visit') nativeVisitDates.add(o.date)
      else nativeMeetingDates.add(o.date)
      if (!nativeLastDate || o.date > nativeLastDate) nativeLastDate = o.date
    }
  }
  const nativeVisitCount = nativeVisitDates.size
  const nativeMeetingCount = nativeMeetingDates.size

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
      const delta = await getCanonicalDelta(fromSnap.runId, toSnap.runId)
      deltaData = {
        summary: computeDeltaSummary(delta),
        fromIdx: timeline.snapshots.length - 2,
        toIdx:   timeline.snapshots.length - 1,
      }
    } catch {
      // delta non disponible, on affiche sans
    }
  }

  // Événements natifs post-dernier-PV pour EvolutionView
  const lastPvDate = runs.length > 0 ? runs[runs.length - 1].effectiveDate : null
  const subjectLabelMap: Record<string, string> = Object.fromEntries(
    (matrix?.rows ?? []).map((row) => [row.canonicalSubjectId, row.canonicalLabel])
  )
  // Labels des sujets 100% natifs (absents de la matrice PV) — évite l'affichage d'UUID
  const nativeOnlyIds = Object.keys(nativeOccurrences).filter((id) => !subjectLabelMap[id])
  if (nativeOnlyIds.length > 0) {
    const nativeLabels = await getCanonicalSubjectLabelsByIds(nativeOnlyIds).catch(() => ({}))
    Object.assign(subjectLabelMap, nativeLabels)
  }
  const nativeEventsForEvolution = Object.entries(nativeOccurrences)
    .flatMap(([csId, occs]) =>
      occs
        .filter((o) => !lastPvDate || o.date > lastPvDate)
        .map((o) => ({ date: o.date, sourceKind: o.sourceKind, label: subjectLabelMap[csId] ?? csId, canonicalSubjectId: csId }))
    )
    .sort((a, b) => a.date.localeCompare(b.date))

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
      <DynamicCrumb segmentId="historique" label="Histoire" />

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {/* Nav principale du chantier — Histoire est l'onglet actif */}
        <div className="rounded-[18px] border bg-card px-4 pb-0 pt-4 shadow-sm">
          <SiteTabsNav active="histoire" siteId={siteId} />
        </div>

        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {totalRuns} PV historique{totalRuns > 1 ? 's' : ''}
                {nativeVisitCount > 0 && ` · ${nativeVisitCount} visite${nativeVisitCount > 1 ? 's' : ''} terrain`}
                {nativeMeetingCount > 0 && ` · ${nativeMeetingCount} réunion${nativeMeetingCount > 1 ? 's' : ''}`}
              </p>
            </div>
            {(runs.length > 0 || nativeLastDate) && (
              <p className="shrink-0 text-sm text-muted-foreground">
                {runs.length > 0 && formatDate(runs[0].effectiveDate)}
                {(runs.length > 1 || nativeLastDate) && ` → ${formatDate(
                  nativeLastDate && (!runs.length || nativeLastDate > runs[runs.length - 1].effectiveDate)
                    ? nativeLastDate
                    : runs[runs.length - 1].effectiveDate
                )}`}
              </p>
            )}
          </div>

          {/* Sous-onglets Histoire */}
          <nav className="mt-4 flex gap-1 rounded-xl bg-muted/40 p-1">
            {([
              { key: 'synthese',   label: 'Synthèse' },
              { key: 'lifelines',  label: 'Lignes de vie' },
              { key: 'heatmap',    label: 'Activité' },
              { key: 'evolution',  label: 'Évolution' },
              { key: 'deps',       label: 'Dépendances' },
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
              suggestedCounts={suggestedCounts}
              importanceScores={importanceScoreMap}
              nativeOccurrences={nativeOccurrences}
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
            <>
              <p className="px-1 text-xs text-muted-foreground">Comparaison des PV historiques — visites terrain et réunions non incluses</p>
              <ActivityMapView activityMap={activityMap} siteId={siteId} />
            </>
          ) : (
            <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
              <p className="font-medium">Données non disponibles.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Les PV doivent être importés et analysés pour afficher la carte d'activité.
              </p>
            </section>
          )
        )}

        {/* Évolution */}
        {view === 'evolution' && (
          evolutionData ? (
            <EvolutionView
              siteId={siteId}
              readModel={evolutionData.readModel}
              narrative={evolutionData.narrative}
              healthTimeline={evolutionData.healthTimeline}
              nativeEvents={nativeEventsForEvolution}
            />
          ) : (
            <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
              <p className="font-medium">Données non disponibles.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Les PV doivent être importés, analysés et associés à des sujets canoniques.
              </p>
            </section>
          )
        )}

        {/* Dépendances */}
        {view === 'deps' && (
          depsGraph ? (
            <DependencyGraphView siteId={siteId} graph={depsGraph} />
          ) : (
            <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
              <p className="font-medium">Données non disponibles.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Les sujets canoniques doivent exister pour afficher les dépendances.
              </p>
            </section>
          )
        )}
      </main>
    </>
  )
}
