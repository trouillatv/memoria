// Le récit N'EST PLUS une page à part : il EST la page de la visite.
//
// Cette adresse a existé le temps d'un lot, et des liens ont pu partir. Elle
// redirige donc au lieu de disparaître — une visite n'a qu'une porte d'entrée,
// mais on ne casse pas ce qui pointait vers l'ancienne.

import { redirect } from 'next/navigation'

export default async function RecitRedirect({
  params,
}: {
  params: Promise<{ id: string; visitId: string }>
}) {
  const { id, visitId } = await params
  redirect(`/sites/${id}/visites/${visitId}`)
}
