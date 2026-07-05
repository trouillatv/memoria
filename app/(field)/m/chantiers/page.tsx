import Link from 'next/link'
import { ChevronRight, MapPin, Building2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listActiveTeamIdsForUser } from '@/lib/db/teams'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * Chantiers — « ce que je pilote » : le vrai centre du conducteur. Chaque chantier
 * regroupe visites, réunions, actions, réserves, documents, entreprises, mémoire
 * et frise. Liste SOBRE (texte, pas de grandes photos). Scopé : admin/manager →
 * tous les sites de l'organisation ; chef_equipe → ceux de ses missions.
 * (« Sites / proximité GPS » reviendra en onglet distinct quand le « près de moi »
 * sera réel — pour l'instant ce serait un doublon.)
 */
type SiteRow = { id: string; name: string; address: string | null }

export default async function ChantiersPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const supabase = createAdminClient()
  let sites: SiteRow[] = []

  if ((user.role === 'admin' || user.role === 'manager') && user.organization_id) {
    const { data } = await supabase
      .from('sites')
      .select('id, name, address')
      .eq('organization_id', user.organization_id)
      .is('deleted_at', null)
      .order('name')
    sites = (data ?? []) as SiteRow[]
  } else {
    const teamIds = await listActiveTeamIdsForUser(user.id)
    if (teamIds.length > 0) {
      const { data: missionRows } = await supabase
        .from('missions')
        .select('site_id')
        .in('assigned_team_id', teamIds)
        .is('deleted_at', null)
      const siteIds = Array.from(new Set((missionRows ?? []).map((m) => m.site_id).filter((s): s is string => !!s)))
      if (siteIds.length > 0) {
        const { data } = await supabase
          .from('sites')
          .select('id, name, address')
          .in('id', siteIds)
          .is('deleted_at', null)
          .order('name')
        sites = (data ?? []) as SiteRow[]
      }
    }
  }

  return (
    <div className="space-y-4 max-w-md pb-4">
      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-xl font-semibold">
          <Building2 className="h-5 w-5 text-muted-foreground" /> Chantiers
          {sites.length > 0 && <span className="text-sm font-normal text-muted-foreground tabular-nums">{sites.length}</span>}
        </h1>
        <p className="text-sm text-muted-foreground">Ce que vous pilotez.</p>
      </header>

      {sites.length === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState icon={Building2} title="Aucun chantier" description="Aucun chantier ne vous est rattaché pour l'instant." variant="compact" />
        </div>
      ) : (
        <ul className="space-y-2">
          {sites.map((s) => (
            <li key={s.id}>
              <Link
                href={`/m/site/${s.id}`}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent active:scale-[0.99]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  {s.address && (
                    <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{s.address}</span>
                    </span>
                  )}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
