import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Share2 } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteKnowledgeGraph } from '@/lib/documents/site-synthesis'
import { SiteTabs } from '../SiteTabs'
import SiteRelationsGraph from './SiteRelationsGraph'

export const dynamic = 'force-dynamic'

export default async function CartePage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const { user } = await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const [siteRow, graph] = await Promise.all([
    supabase.from('sites').select('name').eq('id', siteId).is('deleted_at', null).maybeSingle()
      .then(({ data }) => data as { name: string } | null, () => null as null),
    getSiteKnowledgeGraph(siteId).catch(() => ({ siteId, nodes: [], edges: [] })),
  ])
  if (!siteRow) notFound()

  const empty = graph.nodes.length === 0

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
          <h1 className="text-xl font-semibold">Carte des relations</h1>
          <p className="text-[13px] text-muted-foreground">
            {empty
              ? 'Aucune relation connue'
              : `${graph.nodes.length} élément${graph.nodes.length > 1 ? 's' : ''} · ${graph.edges.length} lien${graph.edges.length > 1 ? 's' : ''}`}
          </p>
        </div>

        <SiteTabs siteId={siteId} active="carte" userRole={user.role} />
      </header>

      {empty ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
          <Share2 className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-[14px] font-medium text-muted-foreground">
            Aucune relation connue
          </p>
          <p className="text-[12px] text-muted-foreground/70">
            Les relations se créent depuis la fiche d'un sujet, onglet Relations.
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
