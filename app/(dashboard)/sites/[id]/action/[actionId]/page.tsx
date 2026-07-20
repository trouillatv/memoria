import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteActionFiche } from '@/lib/knowledge/action-fiche'
import { ActionFicheBody } from '../../views/action/ActionFiche'

export const dynamic = 'force-dynamic'

// Accès DIRECT à /sites/<id>/action/<id> : lien partagé, favori, rechargement.
// Même corps qu'en panneau, seul le titre change (cf. `variant`).
export default async function ActionFichePage({
  params,
}: {
  params: Promise<{ id: string; actionId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, actionId } = await params
  const [identity, action] = await Promise.all([
    getSiteIdentity(id),
    getSiteActionFiche(id, actionId).catch(() => null),
  ])
  if (!identity || !action) notFound()

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-1 py-6">
      <Link
        href={`/sites/${id}?tab=memoire`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>
      <div className="rounded-[22px] border bg-card shadow-sm">
        <ActionFicheBody action={action} variant="page" />
      </div>
    </div>
  )
}
