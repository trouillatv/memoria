import { notFound } from 'next/navigation'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { listPlannedEngagementsForSite, type PlannedEngagement } from '@/lib/db/engagements'
import { categoryLabel, plannedEngagementStatusLabel } from '@/lib/engagements/labels'
import { KIND_META, KIND_ORDER, kindLabel } from '@/lib/engagements/kind'
import type { EngagementKind } from '@/types/db'

export const dynamic = 'force-dynamic'

/**
 * Prestations prévues d'un chantier (mobile) — ce que MemorIA sait devoir être
 * vrai/réalisé sur ce chantier (engagements Porte B validés), distinct de
 * l'onglet Documents (ce que MemorIA peut consulter). Lecture seule : aucune
 * activation, édition, calendrier, occurrence, comparaison terrain ou Action
 * n'est proposée depuis cette vue (P0-3, hors scope explicite).
 */
export default async function SitePrestationsMobilePage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  // Un chantier d'une autre organisation doit être indiscernable d'un chantier
  // inexistant : la garde rend 404, jamais « accès refusé ».
  await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const engagements = await listPlannedEngagementsForSite(siteId)
  const sorted = [...engagements].sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header>
        <h1 className="text-xl font-semibold">Prestations prévues</h1>
      </header>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">Aucune prestation validée sur ce chantier.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {sorted.map((e) => (
            <PlannedEngagementCard key={e.id} engagement={e} />
          ))}
        </ul>
      )}
    </div>
  )
}

function kindRank(kind: EngagementKind | null): number {
  if (!kind) return KIND_ORDER.length
  const idx = KIND_ORDER.indexOf(kind)
  return idx === -1 ? KIND_ORDER.length : idx
}

function PlannedEngagementCard({ engagement: e }: { engagement: PlannedEngagement }) {
  const statusBadge = e.status === 'active'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
    : 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
  const kindBadge = e.kind ? KIND_META[e.kind].badge : 'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300'

  return (
    <li className="rounded-xl border bg-card p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{e.shortLabel}</p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge}`}>
          {plannedEngagementStatusLabel(e.status)}
        </span>
      </div>

      {e.primaryProvenance.frequencyRaw && (
        <p className="text-sm font-medium text-foreground">{e.primaryProvenance.frequencyRaw}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${kindBadge}`}>
          {kindLabel(e.kind)}
        </span>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {categoryLabel(e.category)}
        </span>
      </div>

      <ProvenanceLine provenance={e.primaryProvenance} />

      {e.additionalProvenance.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground active:text-foreground">
            + {e.additionalProvenance.length} autre{e.additionalProvenance.length > 1 ? 's' : ''} preuve{e.additionalProvenance.length > 1 ? 's' : ''}
          </summary>
          <ul className="mt-2 space-y-2 border-t border-border pt-2">
            {e.additionalProvenance.map((p, i) => (
              <li key={i}>
                <ProvenanceLine provenance={p} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

function ProvenanceLine({ provenance: p }: { provenance: PlannedEngagement['primaryProvenance'] }) {
  const source = [p.documentFilename ?? 'Document', p.pageNumber ? `p.${p.pageNumber}` : null].filter(Boolean).join(' · ')
  return (
    <div className="space-y-0.5">
      <p className="truncate text-xs text-muted-foreground">{source}</p>
      {p.excerpt && <p className="text-xs italic text-muted-foreground/80 line-clamp-2">« {p.excerpt} »</p>}
    </div>
  )
}
