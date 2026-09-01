import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { requireSiteAccess as requireFieldSiteAccess } from '@/lib/field/site-access'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveVisit, buildSiteStatusSummary } from '@/lib/db/visits'
import { getSiteOverview, emptySiteOverview } from '@/lib/knowledge/site-overview'
import { listActivePreparationItems } from '@/lib/db/visit-preparation'
import { buildVisitBriefing } from '@/lib/knowledge/visit-briefing'
import { SiteStatusCard } from '../SiteStatusCard'
import { VisitLauncher } from '../VisitLauncher'
import { DeltaBlock, VisitBriefClient } from './VisitBriefClient'
import type { PrepItemSeed } from './VisitBriefClient'
import { CopilotMobileSheet } from '../CopilotMobileSheet'
import { VisitBriefingBlock } from './VisitBriefingBlock'
import { OverdueDeadlinesSection } from './OverdueDeadlinesSection'

/**
 * « Préparer ma visite » — le brief décisionnel avant d'aller sur le chantier.
 * Structure cible :
 *   État rapide → Depuis le dernier PV → Priorités proposées → Sujets à garder
 *   → Mon plan → Démarrer la visite · N points
 *
 * Les blocs pvAttention / pvLastDelta / pvToVerify viennent de getSiteOverview()
 * (déjà calculé) — aucun fetch supplémentaire.
 */
export default async function PrepareVisitPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const { user } = await requireFieldSiteAccess(siteId)
  await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const [status, activeVisit, overview, rawPrepItems, briefing] = await Promise.all([
    buildSiteStatusSummary(siteId).catch(() => []),
    getActiveVisit(siteId).catch(() => null),
    getSiteOverview(siteId).catch(() => emptySiteOverview(siteId)),
    listActivePreparationItems(siteId, user.id).catch(() => []),
    buildVisitBriefing(siteId).catch(() => null),
  ])

  // Sérialisation JSON-safe pour le client component
  const prepItems: PrepItemSeed[] = rawPrepItems.map((p) => ({
    id: p.id,
    stableKey: p.stableKey,
    label: p.label,
    sourceKind: p.sourceKind as PrepItemSeed['sourceKind'],
    sourceRef: p.sourceRef,
    canonicalSubjectId: p.canonicalSubjectId,
    priority: p.priority,
    reason: p.reason,
  }))

  const planCount = prepItems.length

  return (
    <div className="space-y-6 max-w-md pb-32">
      <header className="space-y-1 pt-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Préparer ma visite
          {planCount > 0 && (
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {planCount} sélectionné{planCount > 1 ? 's' : ''}
            </span>
          )}
        </p>
        <h1 className="text-2xl font-bold leading-tight">{site.name}</h1>
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-foreground/70 underline underline-offset-2 active:opacity-70"
        >
          Fiche complète <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      {/* 0 — Briefing intelligent avant terrain */}
      {briefing && <VisitBriefingBlock briefing={briefing} siteId={siteId} />}

      {/* 1 — Confrontation échéances ↔ terrain */}
      <OverdueDeadlinesSection siteId={siteId} />

      {/* 2 — État rapide du chantier */}
      <SiteStatusCard cells={status} />

      {/* 3 — Depuis le dernier PV */}
      {overview.pvLastDelta && (
        <DeltaBlock delta={overview.pvLastDelta} />
      )}

      {/* Copilote — poser une question avant d'arriver sur le chantier */}
      <CopilotMobileSheet siteId={siteId} siteName={site.name} />

      {/* 3 — Brief interactif : Priorités + Sujets + Mon plan */}
      {(overview.pvAttention.length > 0 || overview.pvToVerify.length > 0 || planCount > 0) && (
        <VisitBriefClient
          siteId={siteId}
          pvAttention={overview.pvAttention}
          pvToVerify={overview.pvToVerify}
          initialPrepItems={prepItems}
        />
      )}

      {/* Aucune donnée PV : message d'état */}
      {overview.pvAttention.length === 0 && overview.pvToVerify.length === 0 && planCount === 0 && (
        <p className="rounded-2xl border border-dashed border-foreground/10 px-4 py-4 text-[13px] text-muted-foreground">
          Pas encore de sujets analysés sur ce chantier. Importez un PV pour obtenir des priorités.
        </p>
      )}

      {/* CTA — démarrer avec le nombre de points sélectionnés */}
      <VisitLauncher siteId={siteId} activeVisit={activeVisit} planCount={planCount} />
    </div>
  )
}
