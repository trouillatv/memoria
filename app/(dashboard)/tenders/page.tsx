import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FiltersBar } from '@/components/ui/filters-bar'
import { FilterSelect } from '@/components/ui/filter-select'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { FileText, Plus, SearchX } from 'lucide-react'
import { listTendersPaged } from '@/lib/db/tenders'
import { TenderListTable } from './TenderListTable'
import type { TenderStatus } from '@/types/db'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

const TENDER_STATUS_OPTIONS: Array<{ value: TenderStatus; label: string }> = [
  { value: 'draft',      label: 'Brouillon' },
  { value: 'extracting', label: 'Extraction…' },
  { value: 'analyzing',  label: 'Analyse…' },
  { value: 'ready',      label: 'Prêt' },
  { value: 'failed',     label: 'Échec' },
  { value: 'submitted',  label: 'Soumis' },
  { value: 'archived',   label: 'Archivé' },
]

function parsePage(raw: string | undefined): number {
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return n
}

export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>
}) {
  const params = await searchParams
  const page = parsePage(params.page)
  const { items, total } = await listTendersPaged({
    status: params.status as TenderStatus | undefined,
    search: params.search,
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  })

  const hasActiveFilters = Boolean(params.status || params.search)
  const isEmpty = total === 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Appels d&apos;offres</h1>
          <p className="text-sm text-muted-foreground">
            Liste des AO en cours d&apos;analyse, prêts à soumettre, soumis et archivés.
          </p>
        </div>
        {/* base-ui Button ne supporte pas asChild — on utilise buttonVariants sur un Link */}
        <Link
          href="/tenders/new"
          className={cn(buttonVariants({ variant: 'default' }), 'gap-1.5')}
        >
          <Plus className="h-4 w-4" />
          Nouveau
        </Link>
      </div>

      <FiltersBar
        searchPlaceholder="Rechercher un AO…"
        hasActiveFilters={hasActiveFilters}
        resetParams={['status', 'search']}
      >
        <FilterSelect
          paramName="status"
          label="Statut"
          emptyLabel="Tous les statuts"
          options={TENDER_STATUS_OPTIONS}
        />
      </FiltersBar>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {total} AO{total > 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isEmpty && hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="Aucun AO ne correspond à votre recherche"
              description="Essayez de modifier ou de retirer vos filtres."
              primaryAction={
                <Link
                  href="/tenders"
                  className={cn(buttonVariants({ variant: 'outline' }))}
                >
                  Réinitialiser les filtres
                </Link>
              }
              variant="compact"
            />
          ) : isEmpty ? (
            <EmptyState
              icon={FileText}
              title="Aucun appel d'offres pour l'instant"
              description="Importez votre premier AO pour démarrer l'extraction des engagements et la rédaction assistée de la mémoire technique."
              primaryAction={
                <Link
                  href="/tenders/new"
                  className={cn(buttonVariants({ variant: 'default' }), 'gap-1.5')}
                >
                  <Plus className="h-4 w-4" />
                  Importer un AO
                </Link>
              }
            />
          ) : (
            <TenderListTable items={items} />
          )}
        </CardContent>
      </Card>

      <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  )
}
