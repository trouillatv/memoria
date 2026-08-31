import { requireSiteAccess } from '@/lib/field/site-access'
import { listSiteMapCaptures } from '@/lib/db/visit-captures'
import { listSiteVisits } from '@/lib/db/visits'
import { visitIntentLabel } from '@/lib/field/visit-intents'
import { TerrainMap, type TerrainVisitOption } from '../../TerrainMap'

export const dynamic = 'force-dynamic'

/**
 * « Terrain » — mémoire géographique brute du chantier (lot Terrain, mandat
 * Vincent 2026-08-26) : toutes les preuves géolocalisées, toutes visites
 * confondues, plein écran dès l'ouverture. Distinct de « Carte » (graphe des
 * sujets) — ne pas confondre les deux noms.
 */
export default async function SiteTerrainPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  // Un chantier d'une autre organisation doit être indiscernable d'un chantier
  // inexistant : la garde rend 404, jamais « accès refusé ».
  await requireSiteAccess(siteId)

  const [captures, visitRows] = await Promise.all([
    listSiteMapCaptures(siteId).catch(() => []),
    listSiteVisits(siteId).catch(() => []),
  ])

  const visits: TerrainVisitOption[] = visitRows.map((v) => {
    const date = new Date(v.started_at ?? v.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
    const typeLabel = visitIntentLabel(v.visit_motive) ?? 'Visite'
    return { id: v.id, label: `${date} — ${typeLabel}` }
  })

  return (
    <div className="flex h-[100dvh] flex-col gap-3 p-3">
      <div>
        <h1 className="text-lg font-semibold">Terrain</h1>
        <p className="text-[13px] text-muted-foreground">Retrouvez les observations dans l'espace et dans le temps.</p>
      </div>

      <div className="min-h-0 flex-1">
        <TerrainMap siteId={siteId} captures={captures} visits={visits} mapboxToken={process.env.MAPBOX_TOKEN ?? null} />
      </div>
    </div>
  )
}
