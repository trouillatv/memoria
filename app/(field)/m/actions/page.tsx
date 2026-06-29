import Link from 'next/link'
import { ArrowLeft, ListTodo } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listOpenSiteActions, type SiteActionRow } from '@/lib/db/site-actions'
import { FieldActionsList } from '@/components/actions/FieldActionsList'

export const dynamic = 'force-dynamic'

// Cockpit terrain des actions ouvertes : synthèse en tête (l'ensemble avant le
// détail), puis cartes priorisées. Voir, suivre au quotidien, ou clôturer.
export default async function FieldActionsPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const actions = await listOpenSiteActions().catch(() => [] as SiteActionRow[])

  return (
    <div className="space-y-6 pb-24">
      <Link href="/m" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Accueil
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold inline-flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-muted-foreground" />
          Actions du chantier
        </h1>
        <p className="text-sm text-muted-foreground">
          Les points à suivre dans le temps — distinct de la mission du jour.
        </p>
      </header>

      <FieldActionsList actions={actions} />
    </div>
  )
}
