import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import {
  listDocumentCollections,
  listDocumentsByCollection,
  listOrphanDocuments,
  getDocumentLinkLabels,
} from '@/lib/db/documents'
import { NewCollectionForm } from './NewCollectionForm'
import { CollectionLibrary, type LibGroup } from './CollectionLibrary'

// Bibliothèque documentaire — CONSULTATION uniquement (split de surface C).
// L'ajout vit ailleurs : /documents/ajouter (unitaire) · /documents/import (lot).
// ZÉRO IA (pas de recall, pas de résumé). Role-gaté manager/admin.

export default async function DocumentsPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') notFound()

  const collections = await listDocumentCollections()
  const [byCollection, orphans] = await Promise.all([
    Promise.all(
      collections.map(async (c) => ({ collection: c, docs: await listDocumentsByCollection(c.id) })),
    ),
    listOrphanDocuments(),
  ])
  for (const c of byCollection) {
    c.docs.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  }
  const linkLabels = await getDocumentLinkLabels([
    ...byCollection.flatMap((c) => c.docs.map((d) => d.id)),
    ...orphans.map((d) => d.id),
  ])
  const linkLabelsRecord = Object.fromEntries(linkLabels) as Record<string, { type: string; label: string }[]>

  const toLibDoc = (d: { id: string; filename: string; document_type: string; memory_tier: 'vivante' | 'consultable' | 'froide' | null; analysis_status: string; created_at: string }) =>
    ({ id: d.id, filename: d.filename, document_type: d.document_type, memory_tier: d.memory_tier, analysis_status: d.analysis_status, created_at: d.created_at })
  const groups: LibGroup[] = [
    ...byCollection.map(({ collection, docs }) => ({ collectionId: collection.id, name: collection.name, docs: docs.map(toLibDoc) })),
    ...(orphans.length > 0 ? [{ collectionId: null, name: 'Sans collection', docs: orphans.map(toLibDoc) }] : []),
  ]

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
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Collections ({collections.length})
          </h2>
          {groups.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              Glissez un document d&apos;une collection à l&apos;autre · renommez / réordonnez / supprimez via les icônes.
            </span>
          )}
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4">
            Votre bibliothèque démarre ici. Créez une première collection ci-dessus
            (ex. « Contrats », « Sécurité », « Procédures ») pour commencer à y ranger vos documents.
          </p>
        ) : (
          <CollectionLibrary groups={groups} linkLabels={linkLabelsRecord} />
        )}
      </section>
    </div>
  )
}
