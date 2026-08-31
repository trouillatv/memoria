import { Share2 } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { getSiteKnowledgeGraph } from '@/lib/documents/site-synthesis'
import SiteRelationsGraph from './SiteRelationsGraph'

export const dynamic = 'force-dynamic'

export default async function CartePage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  await requireSiteAccess(siteId)

  const graph = await getSiteKnowledgeGraph(siteId).catch(() => ({ siteId, nodes: [], edges: [] }))

  const empty = graph.nodes.length === 0

  return (
    <div className="flex max-w-md flex-col gap-4 pb-16">
      <header>
        <h1 className="text-xl font-semibold">Carte des relations</h1>
        <p className="text-[13px] text-muted-foreground">
          {empty
            ? 'Relations entre sujets'
            : `${graph.nodes.length} sujet${graph.nodes.length > 1 ? 's' : ''} · ${graph.edges.length} relation${graph.edges.length > 1 ? 's' : ''} confirmée${graph.edges.length > 1 ? 's' : ''}`}
        </p>
      </header>

      {empty ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
          <Share2 className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-[14px] font-medium text-muted-foreground">
            Aucune relation confirmée entre sujets
          </p>
          <p className="text-[12px] text-muted-foreground/70">
            Les relations se construisent depuis la fiche d'un sujet, onglet Relations.
          </p>
        </div>
      ) : (
        <SiteRelationsGraph
          nodes={graph.nodes}
          edges={graph.edges}
          siteId={siteId}
          canvasHeight={440}
        />
      )}
    </div>
  )
}
