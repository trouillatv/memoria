import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import {
  listDocumentCollections,
  listDocumentsByCollection,
} from '@/lib/db/documents'
import { listContracts } from '@/lib/db/contracts'
import { listSites, listClients } from '@/lib/db/sites'
import { listTenders } from '@/lib/db/tenders'
import { listTeams } from '@/lib/db/teams'
import { analysisStatusLabel } from '@/lib/documents/labels'
import { NewCollectionForm } from './NewCollectionForm'
import { UploadDocumentForm } from './UploadDocumentForm'
import { DocumentRowActions } from './DocumentRowActions'

// Bibliothèque documentaire — UI phase 4a. Lecture/organisation/upload par
// un humain. ZÉRO IA (pas de recall, pas de résumé, pas d'injection agents).
// Role-gaté manager/admin (cohérent visionneuse).

export default async function DocumentsPage({
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
  const byCollection = await Promise.all(
    collections.map(async (c) => ({
      collection: c,
      docs: await listDocumentsByCollection(c.id),
    })),
  )

  // Entités rattachables chargées EN BASE (jamais d'UUID à saisir).
  // Bornées (pilote) ; intervention/tenant hors picker (cf. form).
  const linkTargets: Record<string, { id: string; label: string }[]> = {
    contract: contracts.map((c) => ({ id: c.id, label: c.name })),
    site: sites.map((s) => ({ id: s.id, label: s.name })),
    client: clients.map((c) => ({ id: c.id, label: c.name })),
    tender: tenders.map((t) => ({ id: t.id, label: t.title })),
    team: teams.map((t) => ({ id: t.id, label: t.name })),
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">Bibliothèque documentaire</h1>
        <p className="text-sm text-muted-foreground">
          Un document est toujours classé dans une collection et relisible à
          la source.
        </p>
      </header>

      <section className="rounded-lg border bg-card p-4">
        <NewCollectionForm />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Téléverser un document
          </h2>
          <Link
            href="/documents/import"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 h-8 text-xs font-medium hover:bg-muted/50 transition-colors"
          >
            Importer par lot
          </Link>
        </div>
        <UploadDocumentForm
          collections={collections.map((c) => ({ id: c.id, name: c.name }))}
          linkTargets={linkTargets}
          prefillTargetType={sp.target_type}
          prefillTargetId={sp.target_id}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Collections ({collections.length})
        </h2>
        {collections.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border p-4">
            Aucune collection. Crée la première ci-dessus.
          </p>
        ) : (
          byCollection.map(({ collection, docs }) => (
            <div key={collection.id} className="rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold mb-2">
                {collection.name}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  · {docs.length} document{docs.length > 1 ? 's' : ''}
                </span>
              </h3>
              {docs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Vide.</p>
              ) : (
                <ul className="divide-y">
                  {docs.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm flex-wrap"
                    >
                      <span className="min-w-0">
                        <Link
                          href={`/documents/${d.id}`}
                          className="font-medium underline hover:text-foreground break-words"
                        >
                          {d.filename}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {' '}· {d.document_type}
                          {' '}· {analysisStatusLabel(d.analysis_status)}
                        </span>
                      </span>
                      <DocumentRowActions
                        documentId={d.id}
                        filename={d.filename}
                        analysisStatus={d.analysis_status}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  )
}
