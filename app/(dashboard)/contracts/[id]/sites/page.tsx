import { notFound } from 'next/navigation'
import { requireDeskUser } from '@/lib/auth/page-guard'
import { getContract } from '@/lib/db/contracts'
import { listSitesByContract, listSiteNotes } from '@/lib/db/sites'
import { ContractTabs } from '../contract-tabs'
import { CreateSiteForm } from './create-site-form'
import { SiteRow } from './SiteRow'
import { DynamicCrumb } from '@/components/layout/BreadcrumbProvider'

const NOTES_PER_SITE = 5

export default async function ContractSitesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDeskUser()
  const { id } = await params
  const contract = await getContract(id)
  if (!contract) notFound()
  const sites = await listSitesByContract(id)
  // Mémoire des lieux : pré-charger les 5 dernières notes par site (parallèle).
  const notesBySite = new Map<string, Awaited<ReturnType<typeof listSiteNotes>>>()
  await Promise.all(
    sites.map(async (s) => {
      const notes = await listSiteNotes(s.id, NOTES_PER_SITE)
      notesBySite.set(s.id, notes)
    }),
  )

  return (
    <div className="space-y-6 w-full">
      <DynamicCrumb segmentId={contract.id} label={contract.name} />
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
              <SiteRow
                key={s.id}
                contractId={id}
                site={s}
                notes={notesBySite.get(s.id) ?? []}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
