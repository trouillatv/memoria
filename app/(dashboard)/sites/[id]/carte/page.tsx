import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// La carte n'est PLUS un écran à part : c'est une LECTURE du Journal (refonte
// 2026-06-29, retour Vincent). L'ancienne URL redirige vers le journal, où la
// « Carte des observations » est embarquée.
export default async function SiteCarteRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/sites/${id}/chronicle`)
}
