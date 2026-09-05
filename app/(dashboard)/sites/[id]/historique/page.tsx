import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { SiteChantierNav } from '../SiteChantierNav'
import { getSiteHistoricalTimeline, getSiteSubjectMatrix } from '@/lib/documents/pv-history'
import { buildOccurrencePvSummary, type OccurrencePvSummary } from '@/lib/documents/occurrence-pv-summary'
import { getSuggestedLinkCountsBySite } from '@/lib/db/subject-thread-links'
import { getSiteNativeOccurrencesBySubject, getCanonicalSubjectLabelsByIds, buildNativeEvolutionData } from '@/lib/db/canonical-subject-life'
import {
  getRunsMeta,
  computeWatchlist,
  computeProgressByCategory,
  getImportantSubjects,
  getSiteHealthTimeline,
  getSiteDependencyGraph,
} from '@/lib/documents/site-synthesis'
import { buildEvolutionReadModel, generateEvolutionNarrative } from '@/lib/documents/pv-evolution'
import { isEvolutionV2Enabled, classifySubjectEvolutionV2 } from '@/lib/knowledge/evolution-v2'
import type { V2SubjectResult } from '@/lib/knowledge/evolution-v2'
import { deriveCanonicalAttentionItems } from '@/lib/knowledge/canonical-attention'
import { CanonicalAttentionRow } from '@/components/site/CanonicalAttentionRow'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { cn } from '@/lib/utils'
import { buildSiteWindowComparison, type WindowComparisonResult } from '@/lib/documents/pv-window-comparison'
import { SubjectLifelineGrid } from './SubjectLifelineGrid'
import { SyntheseView } from './SyntheseView'
import { EvolutionView } from './EvolutionView'
import { AvantApresView } from './AvantApresView'
import { DependencyGraphView } from './DependencyGraphView'

export const dynamic = 'force-dynamic'

// P2-3 — la vue « PV » (heatmap / ActivityMapView) a été retirée : c'était une 2e matrice sujet × PV,
// moins expressive que Lignes de vie, dont le seul apport (objets métier) était une projection brute
// obsolète (hors C2A). Les anciens deep-links `?view=heatmap` redirigent vers `lifelines`.
type ViewKey = 'synthese' | 'avant-apres' | 'lifelines' | 'evolution' | 'deps' | 'attention'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    view?: string
    thread?: string
    theme?: string
    status?: string
    v2?: string
    from?: string
    to?: string
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
  // P2-3 — compat non-cassante : l'ancien `?view=heatmap` (vue « PV » supprimée) redirige vers Lignes de vie.
  if (sp.view === 'heatmap') redirect(`/sites/${siteId}/historique?view=lifelines`)
  const VALID_VIEWS: ViewKey[] = ['synthese', 'avant-apres', 'lifelines', 'evolution', 'deps', 'attention']
  const view: ViewKey = (VALID_VIEWS.includes(sp.view as ViewKey) ? sp.view as ViewKey : 'synthese')
  const initialThread = sp.thread ?? null
  const initialTheme = sp.theme ?? null
  const debugV2 = sp.v2 === '1' && view === 'evolution'

  const [site, matrix, timeline, importantSubjects] = await Promise.all([
    getSiteIdentity(siteId).catch(() => null),
    getSiteSubjectMatrix(siteId).catch(() => null),
    getSiteHistoricalTimeline(siteId).catch(() => ({ siteId, snapshots: [] })),
    getImportantSubjects(siteId).catch(() => []),
  ])

  const depsGraph = view === 'deps'
    ? await getSiteDependencyGraph(siteId).catch(() => null)
    : null

  // #231 — vue Attention : EXACTEMENT la population du moteur d'Aperçu (même
  // read-model, aucun recalcul), population complète (aucun cap). Destination du
  // « +N autres sujets · Voir les X » de l'Aperçu.
  const attentionItems = view === 'attention'
    ? await deriveCanonicalAttentionItems(siteId).catch(() => [])
    : []

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
          const [readModel, healthTimeline, nativeSubjectEvolutions] = await Promise.all([
            buildEvolutionReadModel(siteId),
            getSiteHealthTimeline(siteId).catch(() => null),
            buildNativeEvolutionData(siteId).catch(() => []),
          ])
          const narrative = await generateEvolutionNarrative(readModel)

          let v2Results: V2SubjectResult[] | null = null
          if (debugV2 && isEvolutionV2Enabled(siteId) && nativeSubjectEvolutions.length > 0) {
            v2Results = await Promise.all(
              nativeSubjectEvolutions.map((s) => classifySubjectEvolutionV2(s))
            ).catch(() => null)
          }

          return { readModel, narrative, healthTimeline, nativeSubjectEvolutions, v2Results }
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

  // Avant / Après — comparaison NETTE entre deux bornes LIBREMENT choisies. Primitive dédiée
  // (`buildSiteWindowComparison`) : elle COMPOSE la fenêtre ]from, to] au lieu de relire la
  // transition locale du dernier PV. `getPvDelta` (adjacent-only) n'est PAS utilisé ici.
  // Bornes par défaut : premier PV → dernier PV (« depuis le début du suivi »).
  let windowComparison: WindowComparisonResult | null = null
  if (view === 'avant-apres' && matrixRuns.length >= 2) {
    const last = matrixRuns.length - 1
    const idxOf = (id?: string) => (id ? matrixRuns.findIndex((r) => r.id === id) : -1)
    // Bornes normalisées : `from` strictement antérieur à `to`, jamais un PV comparé à lui-même.
    let fromIdx = idxOf(sp.from)
    let toIdx = idxOf(sp.to)
    if (fromIdx < 0 || fromIdx === last) fromIdx = 0
    if (toIdx <= fromIdx) toIdx = last
    if (toIdx <= fromIdx) fromIdx = 0
    windowComparison = await buildSiteWindowComparison(siteId, matrixRuns[fromIdx].id, matrixRuns[toIdx].id).catch(() => null)
  }

  // Delta entre les deux derniers PV (si ≥ 2) — P0 : occurrence-first (même vérité que
  // l'Aperçu #230 / Chronologie / Lignes de vie), catégories séparées, knowledge_fact gardé.
  let deltaData: { summary: OccurrencePvSummary; fromIdx: number; toIdx: number } | null = null
  if (timeline.snapshots.length >= 2) {
    const fromSnap = timeline.snapshots[timeline.snapshots.length - 2]
    const toSnap   = timeline.snapshots[timeline.snapshots.length - 1]
    try {
      deltaData = {
        summary: await buildOccurrencePvSummary(siteId, fromSnap.runId, toSnap.runId),
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

  // Labels natifs pour la section "Sujets nés dans MemorIA" dans Lignes de vie
  const nativeSubjectLabels = Object.fromEntries(
    nativeOnlyIds.map((id) => [id, subjectLabelMap[id] ?? id])
  )

  // Computations pures depuis la matrice
  const watchlist = matrix ? computeWatchlist(matrix) : []
  const categories = matrix ? computeProgressByCategory(matrix) : []
  const totalSubjects = matrix?.rows.length ?? 0

  // « Avant / Après » n'existe qu'avec au moins deux comptes rendus comparables : sur un chantier
  // nourri uniquement par des visites natives (aucun PV importé), l'onglet est masqué plutôt que
  // d'afficher une comparaison structurellement vide.
  const tabs: Array<{ key: ViewKey; label: string }> = [
    { key: 'synthese', label: 'Synthèse' },
    ...(matrixRuns.length >= 2 ? [{ key: 'avant-apres' as ViewKey, label: 'Avant / Après' }] : []),
    { key: 'attention', label: 'Attention' },
    { key: 'evolution', label: 'Évolution' },
    { key: 'lifelines', label: 'Lignes de vie' },
  ]

  function viewHref(v: ViewKey) {
    const p = new URLSearchParams()
    p.set('view', v)
    if (initialThread) p.set('thread', initialThread)
    if (initialTheme) p.set('theme', initialTheme)
    return `/sites/${siteId}/historique?${p.toString()}`
  }

  return (
    <>
      <DynamicCrumb segmentId={siteId} label={site.name} />
      <DynamicCrumb segmentId="historique" label="Suivi" />
      {site.clientName && (
        <BreadcrumbPrefix crumbs={[
          { href: '/sites', label: 'Chantiers' },
          { href: '/sites', label: site.clientName },
        ]} />
      )}

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {/* Nav chantier PARTAGÉE (sticky compact) — identité persistante « Suivi ». */}
        <SiteChantierNav siteId={siteId} siteName={site.name} clientName={site.clientName} activeTab="histoire" />

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

          {/* Sous-onglets Histoire.
              « Dépendances » MASQUÉ (Relations P0, 2026-08-29) : corpus réel de relations
              quasi nul (Bella 0, OCEF prod 0, PETRO 1 test) → onglet vide trompeur. Les liens
              vivent sur la fiche du sujet (vide-safe). La vue globale reviendra quand un graphe
              réel existera. La route ?view=deps reste fonctionnelle (deep-link), non discoverable.
              Voir docs/architecture/relations-p0-convergence.md. */}
          <nav className="mt-4 flex gap-1 rounded-xl bg-muted/40 p-1">
            {tabs.map(({ key, label }) => (
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

        {/* Avant / Après — comparaison nette entre deux moments choisis */}
        {view === 'avant-apres' && (
          windowComparison?.ok ? (
            <AvantApresView siteId={siteId} data={windowComparison.data} />
          ) : (
            <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
              <p className="font-medium">Comparaison impossible.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Il faut au moins deux comptes rendus importés, et la date d&apos;arrivée doit être
                postérieure à la date de départ.
              </p>
            </section>
          )
        )}

        {/* Attention — population complète des sujets qui demandent une action (#231) */}
        {view === 'attention' && (
          attentionItems.length > 0 ? (
            <section className="space-y-3">
              <p className="px-1 text-sm text-muted-foreground">
                {attentionItems.length} sujet{attentionItems.length > 1 ? 's' : ''} demandant votre attention,
                classé{attentionItems.length > 1 ? 's' : ''} par sévérité. L&apos;Aperçu n&apos;en montre que les premiers.
              </p>
              <div className="space-y-2">
                {attentionItems.map((item, i) => (
                  <CanonicalAttentionRow key={i} item={item} />
                ))}
              </div>
            </section>
          ) : (
            <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
              <p className="font-medium">Aucun sujet ne demande d&apos;attention particulière.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Aucune alerte active (non-conformité, réouverture, stagnation, retard) sur les sujets de ce chantier.
              </p>
            </section>
          )
        )}

        {/* Lignes de vie */}
        {view === 'lifelines' && (
          (matrix?.rows.length ?? 0) > 0 || Object.keys(nativeOccurrences).length > 0 ? (
            <SubjectLifelineGrid
              matrix={matrix ?? { siteId, runs: [], rows: [] }}
              siteId={siteId}
              initialThread={initialThread}
              initialTheme={initialTheme}
              suggestedCounts={suggestedCounts}
              importanceScores={importanceScoreMap}
              nativeOccurrences={nativeOccurrences}
              nativeSubjectLabels={nativeSubjectLabels}
            />
          ) : (
            <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
              <p className="font-medium">Aucun fil thématique reconstruit.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Les sujets apparaissent ici une fois que des propositions ont été rattachées à un sujet canonique.
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
              nativeSubjectEvolutions={evolutionData.nativeSubjectEvolutions}
              v2Results={evolutionData.v2Results ?? undefined}
              subjectLabelMap={subjectLabelMap}
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
