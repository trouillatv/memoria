// L'ATELIER A ÉTÉ VALIDÉ — il EST le compte-rendu (Vincent, 2026-07-22).
//
// Cette adresse a servi le temps de l'essai : on basculait ici par un lien, on
// revenait par le lien inverse, et les deux mises en page écrivaient le même
// `report_document`. L'essai est tranché — la mise en page en trois marches a
// remplacé l'ancienne à `../compte-rendu`.
//
// Il ne reste donc que la redirection. Elle n'est pas de la politesse : cette
// URL a circulé (elle a été ouverte, testée, envoyée), et un 404 ferait croire
// à une régression là où il y a eu une promotion. `replace` plutôt qu'un lien :
// on ne laisse pas dans l'historique une adresse qui n'a plus de contenu.
//
// Le jour où plus personne ne l'ouvre, ce dossier se supprime sans rien casser.

import { redirect, RedirectType } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function VisitCrAtelierRedirect({
  params,
}: {
  params: Promise<{ id: string; visitId: string }>
}) {
  const { id, visitId } = await params
  redirect(`/sites/${id}/visites/${visitId}/compte-rendu`, RedirectType.replace)
}
