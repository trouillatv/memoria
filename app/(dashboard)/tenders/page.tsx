import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FileText, Plus, SearchX } from 'lucide-react'
import { listTenders } from '@/lib/db/tenders'
import { TenderListTable } from './TenderListTable'
import type { TenderStatus } from '@/types/db'
import { cn } from '@/lib/utils'

export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>
}) {
  const params = await searchParams
  const items = await listTenders({
    status: params.status as TenderStatus | undefined,
    search: params.search,
  })

  const hasActiveFilters = Boolean(params.status || params.search)
  const isEmpty = items.length === 0

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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{items.length} AO</CardTitle>
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
    </div>
  )
}
