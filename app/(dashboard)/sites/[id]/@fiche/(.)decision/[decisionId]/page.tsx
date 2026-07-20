import { requireDeskUser } from '@/lib/auth/page-guard'
import { notFound } from 'next/navigation'
import { getSiteDecisionFiche } from '@/lib/knowledge/decision-fiche'
import { DecisionFichePanel } from '../../../views/decision/DecisionFichePanel'

export const dynamic = 'force-dynamic'

// Route INTERCEPTÉE : atteinte depuis l'application, l'adresse
// /sites/<id>/decision/<id> s'affiche en PANNEAU par-dessus l'onglet courant,
// qui reste monté. La même adresse ouverte directement rend une page complète
// (voir ../../../decision/[decisionId]/page.tsx) — une seule adresse, deux rendus.
export default async function DecisionFicheInterceptee({
  params,
}: {
  params: Promise<{ id: string; decisionId: string }>
}) {
  // Une route INTERCEPTÉE est une page : elle s atteint aussi en tapant l URL.
  // Le panneau ne doit pas etre une porte plus large que la page directe.
  await requireDeskUser()

  const { id, decisionId } = await params
  const decision = await getSiteDecisionFiche(id, decisionId).catch(() => null)
  if (!decision) notFound()
  return <DecisionFichePanel decision={decision} />
}
