import Link from 'next/link'
import { ArrowLeft, ListTodo, MapPin } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listOpenSiteActions, type SiteActionRow } from '@/lib/db/site-actions'
import { OpenActionsList } from '@/components/actions/OpenActionsList'

export const dynamic = 'force-dynamic'

// Cockpit terrain des actions ouvertes : voir, clôturer avec note + photo.
export default async function FieldActionsPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const actions = await listOpenSiteActions().catch(() => [] as SiteActionRow[])

  // Groupé par site (les plus anciennes remontent déjà via listOpenSiteActions).
  const bySite = new Map<string, { name: string; actions: SiteActionRow[] }>()
  for (const a of actions) {
    if (!bySite.has(a.site_id)) bySite.set(a.site_id, { name: a.site_name, actions: [] })
    bySite.get(a.site_id)!.actions.push(a)
  }
  const groups = [...bySite.entries()]

  return (
    <div className="space-y-5 pb-24">
      <Link href="/m" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Accueil
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold inline-flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-muted-foreground" />
          Actions ouvertes
        </h1>
        <p className="text-sm text-muted-foreground">
          Ce qui reste à faire. Clôturez avec un mot (et une photo si utile).
        </p>
      </header>

      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-8 text-center">Aucune action ouverte. 🎉</p>
      ) : (
        groups.map(([siteId, g]) => (
          <section key={siteId} className="space-y-2">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
              <span className="text-sm font-semibold">{g.name}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{g.actions.length}</span>
            </div>
            <OpenActionsList actions={g.actions} compact />
          </section>
        ))
      )}
    </div>
  )
}
