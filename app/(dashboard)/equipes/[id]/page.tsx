// /EQUIPES V2 (Batch D) — /equipes/[id] n'est plus l'expérience principale.
// Redirection de compatibilité (deep-links existants) vers la vue détail
// pleine largeur de la page unique /equipes. Aucune logique dupliquée ici —
// voir app/(dashboard)/equipes/page.tsx, EquipesDetailView.tsx et
// loadTeamDrawerData.ts pour le contenu réel de la fiche équipe.

import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'

export const dynamic = 'force-dynamic'

export default async function TeamProfileRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const me = await getCurrentUserWithProfile()
  if (!me) redirect('/login')
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/m')
  redirect(`/equipes?team=${id}`)
}
