import { ListTodo } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { ActionsEnginePanel } from '@/app/(field)/m/actions/ActionsEnginePanel'

export const dynamic = 'force-dynamic'

// Pill « Actions » du chantier — MÊME moteur unifié que /m/actions?site=…, mais
// sous le layout (chantier) (header + pills persistants). Le layout fournit le
// nom du chantier et les onglets ; cette page ne rend que son contenu.
// La garde d'appartenance reste ICI (doctrine : chaque page), dédupliquée par
// cache() avec celle du layout.
export default async function SiteActionsPillPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params
  await requireSiteAccess(siteId)

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 pb-24 pt-2">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold inline-flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-muted-foreground" />
          Actions du chantier
        </h1>
        <p className="text-sm text-muted-foreground">Tous les points ouverts sur ce chantier.</p>
      </header>
      <ActionsEnginePanel siteId={siteId} />
    </div>
  )
}
