import { notFound } from 'next/navigation'
import { getSiteActionFiche } from '@/lib/knowledge/action-fiche'
import { ActionFichePanel } from '../../../views/action/ActionFichePanel'

export const dynamic = 'force-dynamic'

// Route INTERCEPTÉE — second maillon du prototype. Atteinte depuis une fiche
// Décision, l'adresse /sites/<id>/action/<id> s'affiche en panneau par-dessus
// l'onglet, qui reste monté. La chaîne Décision → Action existe donc enfin.
export default async function ActionFicheInterceptee({
  params,
}: {
  params: Promise<{ id: string; actionId: string }>
}) {
  const { id, actionId } = await params
  const action = await getSiteActionFiche(id, actionId).catch(() => null)
  if (!action) notFound()
  return <ActionFichePanel action={action} />
}
