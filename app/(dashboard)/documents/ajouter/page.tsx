import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Upload } from 'lucide-react'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { listDocumentCollections } from '@/lib/db/documents'
import { listContracts } from '@/lib/db/contracts'
import { listSites, listClients } from '@/lib/db/sites'
import { listTenders } from '@/lib/db/tenders'
import { listTeams } from '@/lib/db/teams'
import { NewCollectionForm } from '../NewCollectionForm'
import { UploadDocumentForm } from '../UploadDocumentForm'

// /documents/ajouter — upload UNITAIRE (split de surface C). La consultation
// vit sur /documents ; l'import par lot sur /documents/import.

export const dynamic = 'force-dynamic'

export default async function AddDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ target_type?: string; target_id?: string }>
}) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') notFound()

  const sp = await searchParams
  const [collections, contracts, sites, clients, tenders, teams] = await Promise.all([
    listDocumentCollections(),
    listContracts(),
    listSites(),
    listClients(),
    listTenders(),
    listTeams(),
  ])

  // Entités rattachables chargées EN BASE (jamais d'UUID à saisir).
  const linkTargets: Record<string, { id: string; label: string }[]> = {
    contract: contracts.map((c) => ({ id: c.id, label: c.name })),
    site: sites.map((s) => ({ id: s.id, label: s.name })),
    client: clients.map((c) => ({ id: c.id, label: c.name })),
    tender: tenders.map((t) => ({ id: t.id, label: t.title })),
    team: teams.map((t) => ({ id: t.id, label: t.name })),
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-1">
        <Link href="/documents" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> Bibliothèque
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">Ajouter un document</h1>
          <Link
            href="/documents/import"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 h-9 text-sm font-medium hover:bg-muted/50 transition-colors shrink-0"
          >
            <Upload className="h-4 w-4" />
            Importer par lot
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Un document est toujours classé dans une collection. Crée-en une si besoin,
          puis téléverse.
        </p>
      </header>

      <section className="rounded-lg border bg-card p-4">
        <NewCollectionForm />
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Téléverser un document
        </h2>
        <UploadDocumentForm
          collections={collections.map((c) => ({ id: c.id, name: c.name }))}
          linkTargets={linkTargets}
          prefillTargetType={sp.target_type}
          prefillTargetId={sp.target_id}
        />
      </section>
    </div>
  )
}
