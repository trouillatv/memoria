import { requireDeskUser } from '@/lib/auth/page-guard'
import { notFound } from 'next/navigation'
import { getSiteReserveFiche } from '@/lib/knowledge/reserve-fiche'
import { ReserveFichePanel } from '../../../views/reserve/ReserveFichePanel'

export const dynamic = 'force-dynamic'

// Route INTERCEPTÉE : /sites/<id>/reserve/<reserveId> s'affiche en panneau
// par-dessus l'onglet courant, qui reste monté.
export default async function ReserveFicheInterceptee({
  params,
}: {
  params: Promise<{ id: string; reserveId: string }>
}) {
  // Une route INTERCEPTÉE est une page : elle s atteint aussi en tapant l URL.
  // Le panneau ne doit pas etre une porte plus large que la page directe.
  await requireDeskUser()

  const { id, reserveId } = await params
  const reserve = await getSiteReserveFiche(id, reserveId).catch(() => null)
  if (!reserve) notFound()
  return <ReserveFichePanel reserve={reserve} />
}
