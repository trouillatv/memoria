import Link from 'next/link'
import { FileCheck, SearchX, Building2, Calendar, ChevronRight, ListChecks } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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

  // Counts par statut pour la stats-bar (utilise les data déjà fetchées + total)
  const statusCounts: Record<ContractStatus, number> = {
    active: 0,
    paused: 0,
    terminated: 0,
    archived: 0,
  }
  for (const c of contracts) {
    statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header — Doctrine V5 Pilier 6 : sobre, pas marketing.
          Icône brand + titre + sous-titre. Stats-bar à droite (lecture rapide). */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-200 dark:bg-brand-600/10 dark:ring-brand-600/30">
            <FileCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">Contrats</h1>
            <p className="text-sm text-muted-foreground">
              Cockpit boucle de preuve par contrat
            </p>
          </div>
        </div>

        {/* Mini stats-bar — chiffres sobres, pas de pourcentages KPI */}
        {!isEmpty && (
          <div className="inline-flex items-center gap-4 rounded-lg border bg-card px-4 py-2 text-sm">
            <StatPill label="Total" value={total} tone="neutral" />
            {statusCounts.active > 0 && (
              <StatPill label="Actifs" value={statusCounts.active} tone="emerald" />
            )}
            {statusCounts.paused > 0 && (
              <StatPill label="En pause" value={statusCounts.paused} tone="amber" />
            )}
            {statusCounts.terminated > 0 && (
              <StatPill label="Terminés" value={statusCounts.terminated} tone="muted" />
            )}
          </div>
        )}
      </header>

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

      {isEmpty && hasActiveFilters && (
        <Card>
          <CardContent className="p-0">
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
          </CardContent>
        </Card>
      )}

      {isEmpty && !hasActiveFilters && (
        <Card>
          <CardContent className="p-0">
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
          </CardContent>
        </Card>
      )}

      {!isEmpty && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {contracts.map((c) => {
            const engagementsCount = countByContract.get(c.id) ?? 0
            const startDate = new Date(c.start_date).toLocaleDateString('fr-FR', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
            const endDate = c.end_date
              ? new Date(c.end_date).toLocaleDateString('fr-FR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : null
            return (
              <Link
                key={c.id}
                href={`/contracts/${c.id}`}
                className="group block rounded-xl border bg-card p-4 transition-all hover:border-brand-200 hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold leading-tight truncate group-hover:text-brand-700">
                      {c.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1.5 truncate">
                      <Building2 className="h-3 w-3 shrink-0" />
                      {c.client_name}
                    </p>
                  </div>
                  <StatusBadge status={c.status} className="shrink-0" />
                </div>

                <div className="mt-3 pt-3 border-t flex items-center justify-between gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {endDate ? `${startDate} → ${endDate}` : `Depuis ${startDate}`}
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
                    <ListChecks className="h-3 w-3" />
                    {engagementsCount}
                    <span className="hidden sm:inline">&nbsp;engagement{engagementsCount > 1 ? 's' : ''}</span>
                    <ChevronRight className="h-3 w-3 ml-1 opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all text-brand-600" />
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  )
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'neutral' | 'emerald' | 'amber' | 'muted'
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: 'text-foreground',
    emerald: 'text-emerald-700 dark:text-emerald-400',
    amber: 'text-amber-700 dark:text-amber-400',
    muted: 'text-muted-foreground',
  }
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={cn('font-semibold tabular-nums', toneClasses[tone])}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  )
}
