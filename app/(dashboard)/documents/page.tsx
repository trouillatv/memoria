import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import {
  listDocumentCollections,
  listDocumentsByCollection,
  getDocumentLinkLabels,
} from '@/lib/db/documents'
import { indexationState } from '@/lib/documents/labels'
import { DocumentRowActions } from './DocumentRowActions'
import { NewCollectionForm } from './NewCollectionForm'

// Bibliothèque documentaire — CONSULTATION uniquement (split de surface C).
// L'ajout vit ailleurs : /documents/ajouter (unitaire) · /documents/import (lot).
// ZÉRO IA (pas de recall, pas de résumé). Role-gaté manager/admin.

const TIER_LABEL: Record<string, string> = {
  vivante: 'Vivante',
  consultable: 'Consultable',
  froide: 'Froide',
}
const TARGET_LABEL: Record<string, string> = {
  contract: 'Contrat',
  site: 'Site',
  client: 'Client',
  tender: 'AO',
  team: 'Équipe',
}
function fmtAddedDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default async function DocumentsPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') notFound()

  const collections = await listDocumentCollections()
  const byCollection = await Promise.all(
    collections.map(async (c) => ({
      collection: c,
      docs: await listDocumentsByCollection(c.id),
    })),
  )
  // Tri par date d'ajout (plus récent en haut) dans chaque collection.
  for (const c of byCollection) {
    c.docs.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  }
  // Rattachements résolus en libellés, en batch (« Contrat X · Client Y »).
  const linkLabels = await getDocumentLinkLabels(byCollection.flatMap((c) => c.docs.map((d) => d.id)))

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Bibliothèque documentaire</h1>
          <p className="text-sm text-muted-foreground">
            Consultation. Chaque document est classé dans une collection et
            relisible à la source.
          </p>
        </div>
        <Link
          href="/documents/import"
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 text-white px-3 h-9 text-sm font-medium hover:bg-brand-700 transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" />
          Ajouter des documents
        </Link>
      </header>

      {/* Organisation : créer une collection (le rangement vit dans la Bibliothèque). */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Nouvelle collection
        </h2>
        <NewCollectionForm />
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Collections ({collections.length})
        </h2>
        {collections.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4">
            Votre bibliothèque démarre ici. Créez une première collection ci-dessus
            (ex. « Contrats », « Sécurité », « Procédures ») pour commencer à y ranger vos documents.
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
                <p className="text-xs text-muted-foreground italic">
                  Collection prête — aucun document pour l&apos;instant.
                </p>
              ) : (
                <ul className="divide-y">
                  {docs.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-start justify-between gap-3 py-2 text-sm flex-wrap"
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
                          {d.memory_tier && <>{' '}· {TIER_LABEL[d.memory_tier] ?? d.memory_tier}</>}
                          {' '}· {indexationState(d.analysis_status, d.memory_tier).label}
                          {' '}· ajouté le {fmtAddedDate(d.created_at)}
                        </span>
                        {(linkLabels.get(d.id)?.length ?? 0) > 0 && (
                          <span className="block text-[11px] text-muted-foreground/90 mt-0.5">
                            Rattaché à :{' '}
                            {linkLabels.get(d.id)!.map((l) => `${TARGET_LABEL[l.type] ?? l.type} ${l.label}`).join(' · ')}
                          </span>
                        )}
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
