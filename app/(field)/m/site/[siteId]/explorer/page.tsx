import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteGraph } from '@/lib/knowledge/site-graph'
import { SiteTabs } from '../SiteTabs'
import { MobileExplorerCanvas } from './MobileExplorerCanvas'

export const dynamic = 'force-dynamic'

export default async function MobileExplorerPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const { user } = await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const [siteRow, graph] = await Promise.all([
    supabase
      .from('sites')
      .select('name')
      .eq('id', siteId)
      .is('deleted_at', null)
      .maybeSingle()
      .then(({ data }) => data as { name: string } | null, () => null as null),
    getSiteGraph(siteId).catch(() => null),
  ])
  if (!siteRow) notFound()

  const empty = !graph || graph.nodes.length === 0

  return (
    <div className="flex max-w-md flex-col gap-4 pb-16">
      <header className="space-y-2">
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {siteRow.name}
        </Link>

        <div>
          <h1 className="text-xl font-semibold">Explorer la mémoire</h1>
          <p className="text-[13px] text-muted-foreground">
            {empty
              ? 'Aucun élément dans la mémoire'
              : `${graph.nodes.length} élément${graph.nodes.length > 1 ? 's' : ''} · ${graph.edges.length} connexion${graph.edges.length > 1 ? 's' : ''}`}
          </p>
        </div>

        <SiteTabs siteId={siteId} active="explorer" userRole={user.role} />
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
