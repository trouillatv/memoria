import { notFound } from 'next/navigation'
import { requireSiteAccess } from '@/lib/field/site-access'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { listPlannedEngagementsForSite } from '@/lib/db/engagements'
import { KIND_ORDER } from '@/lib/engagements/kind'
import { groupPlannedEngagementsBySection } from '@/lib/engagements/section'
import { PlannedEngagementSections } from '@/components/engagements/PlannedEngagementSections'
import { AddPlannedEngagementDialog } from '@/components/engagements/AddPlannedEngagementDialog'
import type { EngagementKind } from '@/types/db'

export const dynamic = 'force-dynamic'

/**
 * Prestations prévues d'un chantier (mobile) — ce que MemorIA sait devoir être
 * vrai/réalisé sur ce chantier (engagements Porte B validés), distinct de
 * l'onglet Documents (ce que MemorIA peut consulter). Édition/calendrier/
 * occurrence/comparaison terrain restent hors scope (P0-3). Ajouts depuis :
 * P0-3.1A (créer manuellement un Engagement Porte B sans document), P0-3.2
 * (mettre un engagement curated en vigueur), « Traiter un point » (créer une
 * Action depuis un engagement actif, jamais automatique — cf.
 * EngagementTreatPointButton).
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
  // P0-3.2 FIX (mandat Vincent 2026-09-25) — même primitive que la mutation
  // autoritaire (requireSiteWriteAccess, rôle DANS l'organisation du
  // chantier), pas user.role (rôle plateforme, divergent en multi-org).
  const activationAccess = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  const canActivate = activationAccess.ok

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
  const sections = groupPlannedEngagementsBySection(sorted)

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Prestations prévues</h1>
        <AddPlannedEngagementDialog siteId={siteId} />
      </header>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">Aucun engagement validé pour ce chantier.</p>
        </div>
      ) : (
        <PlannedEngagementSections groups={sections} gridClassName="space-y-3" canActivate={canActivate} canTreatPoint={canActivate} />
      )}
    </div>
  )
}

function kindRank(kind: EngagementKind | null): number {
  if (!kind) return KIND_ORDER.length
  const idx = KIND_ORDER.indexOf(kind)
  return idx === -1 ? KIND_ORDER.length : idx
}
