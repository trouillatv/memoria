import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteIntervenantFiche } from '@/lib/knowledge/site-intervenants-view'
import { IntervenantFicheBody } from '../../views/intervenants/IntervenantFiche'

export const dynamic = 'force-dynamic'

// Accès DIRECT : lien partagé, favori, rechargement. Même corps que le panneau.
export default async function IntervenantFichePage({
  params,
}: {
  params: Promise<{ id: string; intervenantId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, intervenantId } = await params
  const [identity, person] = await Promise.all([
    getSiteIdentity(id),
    getSiteIntervenantFiche(id, { intervenantId }).catch(() => null),
  ])
  if (!identity || !person) notFound()

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-1 py-6">
      <Link
        href={`/sites/${id}?tab=intervenants`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>
      <div className="rounded-[22px] border bg-card shadow-sm">
        <IntervenantFicheBody siteId={id} person={person} variant="page" />
      </div>
    </div>
  )
}
