import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteDecisionFiche } from '@/lib/knowledge/decision-fiche'
import { DecisionFicheBody } from '../../views/decision/DecisionFiche'

export const dynamic = 'force-dynamic'

// Accès DIRECT à /sites/<id>/decision/<id> : lien partagé, favori, rechargement.
// La même adresse qui s'affiche en panneau dans l'application rend ici une PAGE
// COMPLÈTE — avec le MÊME composant de corps, jamais un second rendu concurrent.
export default async function DecisionFichePage({
  params,
}: {
  params: Promise<{ id: string; decisionId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, decisionId } = await params
  const [identity, decision] = await Promise.all([
    getSiteIdentity(id),
    getSiteDecisionFiche(id, decisionId).catch(() => null),
  ])
  if (!identity || !decision) notFound()

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-1 py-6">
      <Link
        href={`/sites/${id}?tab=memoire`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>
      <div className="rounded-[22px] border bg-card shadow-sm">
        <DecisionFicheBody decision={decision} variant="page" />
      </div>
    </div>
  )
}
