import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteReunionFiche } from '@/lib/knowledge/reunion-fiche'
import { ReunionFicheBody } from '../../views/reunion/ReunionFiche'

export const dynamic = 'force-dynamic'

// Accès DIRECT à /sites/<id>/reunion/<id> : lien partagé, favori, rechargement.
// Même corps que le panneau, jamais un second rendu concurrent.
export default async function ReunionFichePage({
  params,
}: {
  params: Promise<{ id: string; reportId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, reportId } = await params
  const [identity, reunion] = await Promise.all([
    getSiteIdentity(id),
    getSiteReunionFiche(id, reportId).catch(() => null),
  ])
  if (!identity || !reunion) notFound()

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-1 py-6">
      <Link
        href={`/sites/${id}?tab=memoire`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>
      <div className="rounded-[22px] border bg-card shadow-sm">
        <ReunionFicheBody reunion={reunion} variant="page" />
      </div>
    </div>
  )
}
