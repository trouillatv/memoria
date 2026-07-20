import { requireDeskUser } from '@/lib/auth/page-guard'
import { notFound } from 'next/navigation'
import { getSiteIntervenantFiche } from '@/lib/knowledge/site-intervenants-view'
import { IntervenantFichePanel } from '../../../views/intervenants/IntervenantFichePanel'

export const dynamic = 'force-dynamic'

// Route INTERCEPTÉE : /sites/<id>/intervenant/<id> s'affiche en panneau par-dessus
// l'onglet courant, qui reste monté.
export default async function IntervenantFicheInterceptee({
  params,
}: {
  params: Promise<{ id: string; intervenantId: string }>
}) {
  // Une route INTERCEPTÉE est une page : elle s atteint aussi en tapant l URL.
  // Le panneau ne doit pas etre une porte plus large que la page directe.
  await requireDeskUser()

  const { id, intervenantId } = await params
  const person = await getSiteIntervenantFiche(id, { intervenantId }).catch(() => null)
  if (!person) notFound()
  return <IntervenantFichePanel siteId={id} person={person} />
}
