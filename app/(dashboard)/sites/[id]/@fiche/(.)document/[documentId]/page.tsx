import { notFound, redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteDocumentFiche } from '@/lib/knowledge/document-fiche'
import { DocumentFichePanel } from '../../../views/document/DocumentFichePanel'

export const dynamic = 'force-dynamic'

// Route INTERCEPTÉE : /sites/<id>/document/<docId> s'affiche en PANNEAU par-dessus
// l'onglet courant. Le RÔLE est nécessaire ici (contrairement aux autres fiches) :
// l'accès documentaire est role-gaté par `visibility_level`. On ne révèle pas
// l'existence — notFound(), jamais 403.
export default async function DocumentFicheInterceptee({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')

  const { id, documentId } = await params
  const doc = await getSiteDocumentFiche(id, documentId, user.role).catch(() => null)
  if (!doc) notFound()
  return <DocumentFichePanel document={doc} />
}
