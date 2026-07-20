import { requireDeskUser } from '@/lib/auth/page-guard'
import { notFound } from 'next/navigation'
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
  // Une route INTERCEPTÉE est une page : elle s atteint aussi en tapant l URL.
  // Le panneau ne doit pas être une porte plus large que la page directe.
  const user = await requireDeskUser()

  const { id, documentId } = await params
  const doc = await getSiteDocumentFiche(id, documentId, user.role).catch(() => null)
  if (!doc) notFound()
  return <DocumentFichePanel document={doc} />
}
