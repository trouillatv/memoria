import Link from 'next/link'
import { Mic, AlertCircle, StickyNote } from 'lucide-react'
import {
  matchCriteriaToTerrain,
  matchAoToTerrain,
  type TerrainSourceType,
  type TerrainMatchBySite,
} from '@/lib/ai/match-ao-terrain'
import { getActiveProvider } from '@/lib/ai/embeddings'
import type { DbTenderAnalysis } from '@/types/db'

const SOURCE_LABEL: Record<TerrainSourceType, string> = {
  anomaly: 'Anomalie',
  site_note: 'Consigne',
  intervention_note: 'Note terrain',
}

const SOURCE_ICON: Record<TerrainSourceType, React.ComponentType<{ className?: string }>> = {
  anomaly: AlertCircle,
  site_note: StickyNote,
  intervention_note: Mic,
}

function SiteGroup({ site }: { site: TerrainMatchBySite }) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <Link href={`/sites/${site.siteId}`} className="text-sm font-medium hover:underline">
          {site.siteName}
        </Link>
        <span className="text-xs text-muted-foreground">
          {site.traces.length} trace{site.traces.length > 1 ? 's' : ''}
        </span>
      </div>
      <ul className="divide-y">
        {site.traces.map((trace) => {
          const Icon = SOURCE_ICON[trace.sourceType]
          return (
            <li key={trace.sourceId} className="flex items-start gap-2.5 px-4 py-2.5">
              <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <span className="text-[11px] text-muted-foreground mr-1.5">
                  {SOURCE_LABEL[trace.sourceType]}
                </span>
                <span className="text-sm">{trace.textExcerpt}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

interface TerrainMatchingSectionProps {
  tenderId: string
  analysis: DbTenderAnalysis | null
}

export async function TerrainMatchingSection({
  tenderId,
  analysis,
}: TerrainMatchingSectionProps) {
  if (!getActiveProvider()) return null

  const hasCriteria =
    (analysis?.constraints ?? []).length > 0 ||
    (analysis?.checklist ?? []).length > 0

  // Mode 1 — matching par critère (analyse disponible, prioritaire).
  if (hasCriteria && analysis) {
    const criteriaMatches = await matchCriteriaToTerrain(
      tenderId,
      analysis.constraints,
      analysis.checklist,
    )

    if (criteriaMatches.length === 0) {
      return <EmptyState />
    }

    const totalSites = new Set(
      criteriaMatches.flatMap((c) => c.matchBySite.map((s) => s.siteId)),
    ).size
    const totalTraces = criteriaMatches.reduce(
      (n, c) => n + c.matchBySite.reduce((m, s) => m + s.traces.length, 0),
      0,
    )

    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Mémoire terrain
          </h2>
          <span className="text-xs text-muted-foreground">
            {totalTraces} trace{totalTraces > 1 ? 's' : ''} —&nbsp;
            {totalSites} site{totalSites > 1 ? 's' : ''}
          </span>
        </div>

        <div className="space-y-4">
          {criteriaMatches.map((cm, i) => (
            <div key={i} className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium pl-0.5">
                {cm.criterion.length > 120
                  ? cm.criterion.slice(0, 120).trimEnd() + '…'
                  : cm.criterion}
              </p>
              {cm.matchBySite.map((site) => (
                <SiteGroup key={site.siteId} site={site} />
              ))}
            </div>
          ))}
        </div>
      </section>
    )
  }

  // Mode 2 — fallback sur le texte brut du PDF (pas encore d'analyse structurée).
  const matchBySite = await matchAoToTerrain(tenderId)
  if (matchBySite.length === 0) {
    return <EmptyState />
  }

  const totalTraces = matchBySite.reduce((n, s) => n + s.traces.length, 0)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Mémoire terrain
        </h2>
        <span className="text-xs text-muted-foreground">
          {totalTraces} trace{totalTraces > 1 ? 's' : ''} —&nbsp;
          {matchBySite.length} site{matchBySite.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-2">
        {matchBySite.map((site) => (
          <SiteGroup key={site.siteId} site={site} />
        ))}
      </div>
    </section>
  )
}

function EmptyState() {
  return (
    <section className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
      <p className="text-xs font-semibold uppercase tracking-widest mb-1">Mémoire terrain</p>
      <p>Aucune trace terrain concordante trouvée pour cet appel d'offres.</p>
    </section>
  )
}

export function TerrainMatchingSkeleton() {
  return (
    <div className="rounded-xl border p-5 space-y-3 animate-pulse">
      <div className="h-3 bg-muted rounded w-32" />
      <div className="space-y-2">
        <div className="h-4 bg-muted rounded w-full" />
        <div className="h-4 bg-muted rounded w-4/5" />
        <div className="h-4 bg-muted rounded w-3/5" />
      </div>
    </div>
  )
}
