import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus } from 'lucide-react'
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
          <TenderListTable items={items} />
        </CardContent>
      </Card>
    </div>
  )
}
