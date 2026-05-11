import Link from 'next/link'
import { FileCheck } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { listContracts } from '@/lib/db/contracts'
import { countEngagementsByContracts } from '@/lib/db/engagements'
import { cn } from '@/lib/utils'

const STATUS_COLORS: Record<string, string> = {
  active:     'bg-emerald-50 border-emerald-200 text-emerald-700',
  paused:     'bg-amber-50 border-amber-200 text-amber-700',
  terminated: 'bg-slate-50 border-slate-200 text-slate-700',
  archived:   'bg-muted border-border text-muted-foreground',
}

export default async function ContractsPage() {
  const contracts = await listContracts()

  // Single query for all engagement counts, no N+1
  const countByContract = await countEngagementsByContracts(contracts.map((c) => c.id))

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Contrats</h1>
          <p className="text-sm text-muted-foreground">
            Contrats opérationnels créés depuis vos AO gagnés. Cockpit Boucle de preuve par contrat.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{contracts.length} contrat{contracts.length > 1 ? 's' : ''}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {contracts.length === 0 ? (
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
                const colorClass = STATUS_COLORS[c.status] ?? STATUS_COLORS.archived
                return (
                  <li key={c.id}>
                    <Link
                      href={`/contracts/${c.id}`}
                      className="flex items-center justify-between gap-3 px-6 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold truncate">{c.name}</span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wider shrink-0 ${colorClass}`}>
                            {c.status}
                          </span>
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
    </div>
  )
}
