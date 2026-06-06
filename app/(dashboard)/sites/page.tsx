// Page Sites globale (cross-contrat) — groupée par client.
//
// Réservée admin/manager. Liste tous les sites du tenant, groupés par client
// (CHT, OPT, Dumbea Mall…). Permet d'éditer chaque site et de le supprimer
// SI aucune donnée n'y est liée.
//
// Doctrine V5 : aucun historique n'est jamais perdu. Un site avec des
// missions/interventions/notes ne peut PAS être supprimé — il vieillit
// vers "Inactif" et reste consultable indéfiniment.

import { redirect } from 'next/navigation'
import { MapPin, ChevronRight, Building2 } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listSitesGlobal, isSiteInactive, listClients, listSitesForMatching } from '@/lib/db/sites'
import { listActiveContractsLite } from '@/lib/db/sites'
import { SiteGlobalRow } from './SiteGlobalRow'
import { CreateSiteDialog } from './CreateSiteDialog'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SitesGlobalPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')

  const [sites, clients, contracts, allSites] = await Promise.all([
    listSitesGlobal(),
    listClients(),
    listActiveContractsLite(),
    listSitesForMatching(),
  ])

  // Grouper par client
  type Group = { clientName: string | null; clientId: string | null; sites: typeof sites }
  const groupMap = new Map<string, Group>()
  for (const s of sites) {
    const key = s.client_id ?? '__no_client__'
    if (!groupMap.has(key)) {
      groupMap.set(key, { clientName: s.client_display_name, clientId: s.client_id ?? null, sites: [] })
    }
    groupMap.get(key)!.sites.push(s)
  }
  const groups = Array.from(groupMap.values()).sort((a, b) =>
    (a.clientName ?? '').localeCompare(b.clientName ?? '', 'fr', { sensitivity: 'base' }),
  )

  return (
    <div className="space-y-8 w-full">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
            <MapPin className="h-6 w-6 text-sky-600" />
            Sites
          </h1>
          <p className="text-sm text-muted-foreground">
            Tous les sites, groupés par client. Un site avec des données liées
            ne peut pas être supprimé — il bascule en « Inactif » après 6 mois
            sans intervention.
          </p>
        </div>
        <CreateSiteDialog clients={clients} contracts={contracts} allSites={allSites} />
      </header>

      {sites.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
          <p className="text-sm text-muted-foreground italic">
            Aucun site enregistré. Cliquez sur « Nouveau site » pour commencer.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => {
            const active = g.sites.filter((s) => !isSiteInactive(s.last_intervention_at))
            const inactive = g.sites.filter((s) => isSiteInactive(s.last_intervention_at))
            return (
              <section key={g.clientId ?? '__no_client__'} className="space-y-3">
                {/* En-tête client */}
                <div className="flex items-center gap-2 pb-1 border-b">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                  <h2 className="text-sm font-semibold">
                    {g.clientName ?? 'Client non associé'}
                  </h2>
                  <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                    {g.sites.length} site{g.sites.length > 1 ? 's' : ''}
                  </span>
                </div>

                {/* Sites actifs */}
                {active.length > 0 && (
                  <ul className="space-y-2 pl-6">
                    {active.map((s) => (
                      <SiteGlobalRow key={s.id} site={s} />
                    ))}
                  </ul>
                )}

                {/* Sites inactifs (repliables) */}
                {inactive.length > 0 && (
                  <details className="pl-6 group [&_summary::-webkit-details-marker]:hidden [&_summary::marker]:hidden">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 select-none">
                      <ChevronRight
                        className="h-3 w-3 transition-transform group-open:rotate-90"
                        aria-hidden
                      />
                      {inactive.length} inactif{inactive.length > 1 ? 's' : ''}
                    </summary>
                    <ul className="space-y-2 mt-2 opacity-60">
                      {inactive.map((s) => (
                        <SiteGlobalRow key={s.id} site={s} inactive />
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
