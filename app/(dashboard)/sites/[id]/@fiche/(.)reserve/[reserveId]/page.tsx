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
  const { id, reserveId } = await params
  const reserve = await getSiteReserveFiche(id, reserveId).catch(() => null)
  if (!reserve) notFound()
  return <ReserveFichePanel reserve={reserve} />
}
