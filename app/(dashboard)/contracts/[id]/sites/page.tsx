import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getContract } from '@/lib/db/contracts'
import { listSitesByContract } from '@/lib/db/sites'
import { ContractTabs } from '../contract-tabs'
import { CreateSiteForm } from './create-site-form'

export default async function ContractSitesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contract = await getContract(id)
  if (!contract) notFound()
  const sites = await listSitesByContract(id)

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">{contract.name}</h1>
        <p className="text-sm text-muted-foreground">{contract.client_name}</p>
      </header>

      <ContractTabs contractId={id} active="sites" />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Sites ({sites.length})
          </h2>
        </div>

        <CreateSiteForm contractId={id} clientName={contract.client_name} />

        {sites.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border p-4">
            Aucun site pour ce contrat. Ajoutez-en un ci-dessus pour commencer.
          </p>
        ) : (
          <ul className="space-y-2">
            {sites.map((s) => (
              <li key={s.id} className="rounded-lg border p-4 bg-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{s.name}</div>
                    {s.address && <div className="text-xs text-muted-foreground">{s.address}</div>}
                    {s.notes && <div className="text-xs text-muted-foreground italic mt-1">{s.notes}</div>}
                  </div>
                  <Link
                    href={`/contracts/${id}/missions?site=${s.id}`}
                    className="text-xs text-foreground hover:underline whitespace-nowrap shrink-0"
                  >
                    Voir missions →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
