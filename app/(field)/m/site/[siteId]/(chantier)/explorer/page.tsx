import { requireSiteAccess } from '@/lib/field/site-access'
import { getSiteGraph } from '@/lib/knowledge/site-graph'
import { MobileExplorerCanvas } from './MobileExplorerCanvas'

export const dynamic = 'force-dynamic'

export default async function MobileExplorerPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  await requireSiteAccess(siteId)

  const graph = await getSiteGraph(siteId).catch(() => null)
  const empty = !graph || graph.nodes.length === 0

  return (
    <div className="flex max-w-md flex-col gap-4 pb-16">
      <header>
        <h1 className="text-xl font-semibold">Explorer la mémoire</h1>
        <p className="text-[13px] text-muted-foreground">
          {empty
            ? 'Aucun élément dans la mémoire'
            : `${graph.nodes.length} élément${graph.nodes.length > 1 ? 's' : ''} · ${graph.edges.length} connexion${graph.edges.length > 1 ? 's' : ''}`}
        </p>
      </header>

      {empty ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
          <p className="text-[14px] font-medium text-muted-foreground">Aucun élément dans la mémoire</p>
          <p className="text-[12px] text-muted-foreground/70">
            Les éléments apparaissent après la première visite.
          </p>
        </div>
      ) : (
        <MobileExplorerCanvas graph={graph!} canvasHeight={520} />
      )}
    </div>
  )
}
