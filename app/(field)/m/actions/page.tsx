import Link from 'next/link'
import { ArrowLeft, ListTodo } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireSiteAccess } from '@/lib/field/site-access'
import { getSiteHeaderName } from '@/lib/field/site-header'
import { ActionsEnginePanel } from './ActionsEnginePanel'

export const dynamic = 'force-dynamic'

// Entrée GLOBALE des actions (barre du bas). `?site=<id>` restreint à UN chantier
// (entrée secondaire). Le pill « Actions » du chantier, lui, vit désormais sous le
// layout dans /m/site/[siteId]/actions — même moteur (ActionsEnginePanel), pas de
// pills ici. Un seul système Actions, deux scopes.
export default async function FieldActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>
}) {
  const { site: siteId } = await searchParams
  const scoped = typeof siteId === 'string' && siteId.length > 0

  // Le scope chantier EST une frontière d'accès (M3-D) : on vérifie AVANT de rendre
  // le moteur, sinon `?site=<id d'un autre chantier>` fuiterait des actions hors-org.
  let siteName: string | null = null
  if (scoped) {
    await requireSiteAccess(siteId!)
    siteName = await getSiteHeaderName(siteId!)
  } else {
    const user = await getCurrentUserWithProfile()
    if (!user) return null
  }

  return (
    <div className="space-y-6 pb-24">
      <Link
        href={scoped ? `/m/site/${siteId}` : '/m'}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {scoped ? siteName ?? 'Chantier' : 'Accueil'}
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold inline-flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-muted-foreground" />
          Actions du chantier
        </h1>
        <p className="text-sm text-muted-foreground">
          {scoped
            ? 'Tous les points ouverts sur ce chantier.'
            : 'Les points à suivre dans le temps — distinct de la mission du jour.'}
        </p>
      </header>

      <ActionsEnginePanel siteId={scoped ? siteId : undefined} />
    </div>
  )
}
