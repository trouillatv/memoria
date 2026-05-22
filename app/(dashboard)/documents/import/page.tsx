import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { listDocumentCollections } from '@/lib/db/documents'
import { listContracts } from '@/lib/db/contracts'
import { listSites, listClients } from '@/lib/db/sites'
import { listTenders } from '@/lib/db/tenders'
import { listTeams } from '@/lib/db/teams'
import { BatchImportForm } from './BatchImportForm'

// Import par lot (Phase 2 V1) — dépôt multi-fichiers → triage → validation
// humaine → import séquentiel borné. Réutilise uploadDocumentAction + l'embedding
// sélectif déjà livré. Manager/admin uniquement (cohérent /documents).

export const dynamic = 'force-dynamic'

export default async function DocumentsImportPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') notFound()

  const [collections, contracts, sites, clients, tenders, teams] = await Promise.all([
    listDocumentCollections(),
    listContracts(),
    listSites(),
    listClients(),
    listTenders(),
    listTeams(),
  ])

  const linkTargets: Record<string, { id: string; label: string }[]> = {
    contract: contracts.map((c) => ({ id: c.id, label: c.name })),
    site: sites.map((s) => ({ id: s.id, label: s.name })),
    client: clients.map((c) => ({ id: c.id, label: c.name })),
    tender: tenders.map((t) => ({ id: t.id, label: t.title })),
    team: teams.map((t) => ({ id: t.id, label: t.name })),
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="space-y-1">
        <Link href="/documents" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> Bibliothèque
        </Link>
        <h1 className="text-2xl font-semibold">Importer par lot</h1>
        <p className="text-sm text-muted-foreground">
          Déposez plusieurs PDF. MemorIA propose une couche mémoire et l’indexation
          pour chacun — <strong>vous validez avant l’import</strong>. Rien n’est envoyé tant que
          vous ne lancez pas.
        </p>
      </header>

      <BatchImportForm
        collections={collections.map((c) => ({ id: c.id, name: c.name }))}
        linkTargets={linkTargets}
      />
    </div>
  )
}
