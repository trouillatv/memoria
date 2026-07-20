import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteDocumentFiche } from '@/lib/knowledge/document-fiche'
import { DocumentFicheBody } from '../../views/document/DocumentFiche'

export const dynamic = 'force-dynamic'

// Accès DIRECT à /sites/<id>/document/<docId> : lien partagé, favori, rechargement.
// Même corps que le panneau, jamais un second rendu concurrent.
export default async function DocumentFichePage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, documentId } = await params
  const [identity, doc] = await Promise.all([
    getSiteIdentity(id),
    getSiteDocumentFiche(id, documentId, user.role).catch(() => null),
  ])
  if (!identity || !doc) notFound()

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-1 py-6">
      <Link
        href={`/sites/${id}?tab=documents-preuves`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>
      <div className="rounded-[22px] border bg-card shadow-sm">
        <DocumentFicheBody document={doc} variant="page" />
      </div>
    </div>
  )
}
