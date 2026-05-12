import Link from 'next/link'
import { FileCheck, SearchX } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FiltersBar } from '@/components/ui/filters-bar'
import { FilterSelect } from '@/components/ui/filter-select'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { StatusBadge } from '@/components/ui/status-badge'
import { listContractsPaged } from '@/lib/db/contracts'
import { countEngagementsByContracts } from '@/lib/db/engagements'
import type { ContractStatus } from '@/types/db'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

const CONTRACT_STATUS_OPTIONS: Array<{ value: ContractStatus; label: string }> = [
  { value: 'active',     label: 'Actif' },
  { value: 'paused',     label: 'En pause' },
  { value: 'terminated', label: 'Terminé' },
  { value: 'archived',   label: 'Archivé' },
]

function parsePage(raw: string | undefined): number {
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return n
}

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>
}) {
  const params = await searchParams
  const page = parsePage(params.page)
  const { items: contracts, total } = await listContractsPaged({
    status: params.status as ContractStatus | undefined,
    search: params.search,
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  })

  // Single query for all engagement counts, no N+1
  const countByContract = await countEngagementsByContracts(contracts.map((c) => c.id))

  const hasActiveFilters = Boolean(params.status || params.search)
  const isEmpty = total === 0

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Contrats</h1>
          <p className="text-sm text-muted-foreground">
            Contrats opérationnels créés depuis vos AO gagnés. Cockpit Boucle de preuve par contrat.
          </p>
        </div>
      </div>

      <FiltersBar
        searchPlaceholder="Rechercher un contrat…"
        hasActiveFilters={hasActiveFilters}
        resetParams={['status', 'search']}
      >
        <FilterSelect
          paramName="status"
          label="Statut"
          emptyLabel="Tous les statuts"
          options={CONTRACT_STATUS_OPTIONS}
        />
      </FiltersBar>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{total} contrat{total > 1 ? 's' : ''}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isEmpty && hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="Aucun contrat ne correspond à votre recherche"
              description="Essayez de modifier ou de retirer vos filtres."
              primaryAction={
                <Link
                  href="/contracts"
                  className={cn(buttonVariants({ variant: 'outline' }))}
                >
                  Réinitialiser les filtres
                </Link>
              }
              variant="compact"
            />
          ) : isEmpty ? (
            <EmptyState
              icon={FileCheck}
              title="Aucun contrat actif"
              description={
                <>
                  Convertissez un AO finalisé en contrat depuis la page{' '}
                  <Link
                    href="/tenders"
                    className="text-foreground underline underline-offset-4 hover:no-underline"
                  >
                    Appels d&apos;offres
                  </Link>
                  . Le contrat devient le point d&apos;ancrage de vos missions et de la boucle de preuve.
                </>
              }
              primaryAction={
                <Link
                  href="/tenders"
                  className={cn(buttonVariants({ variant: 'default' }))}
                >
                  Voir mes AO
                </Link>
              }
            />
          ) : (
            <ul className="divide-y">
              {contracts.map((c) => {
                const engagementsCount = countByContract.get(c.id) ?? 0
                return (
                  <li key={c.id}>
                    <Link
                      href={`/contracts/${c.id}`}
                      className="flex items-center justify-between gap-3 px-6 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold truncate">{c.name}</span>
                          <StatusBadge status={c.status} className="shrink-0" />
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {c.client_name}
                          {' · démarré le '}
                          {new Date(c.start_date).toLocaleDateString('fr-FR')}
                          {c.end_date && ` · jusqu'au ${new Date(c.end_date).toLocaleDateString('fr-FR')}`}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">
                        {engagementsCount} engagement{engagementsCount > 1 ? 's' : ''}
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  )
}
