import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteCompanyFiche } from '@/lib/knowledge/site-intervenants-consolidated'
import { SiteCompanyFicheBody } from '../../views/intervenants/SiteCompanyFiche'

export const dynamic = 'force-dynamic'

export default async function SiteCompanyFichePage({ params }: { params: Promise<{ id: string; companyId: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')
  const { id, companyId } = await params
  const [identity, company] = await Promise.all([
    getSiteIdentity(id),
    getSiteCompanyFiche(id, companyId).catch(() => null),
  ])
  if (!identity || !company) notFound()
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-1 py-6">
      <Link href={`/sites/${id}?tab=intervenants`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>
      <div className="rounded-[22px] border bg-card shadow-sm">
        <SiteCompanyFicheBody company={company} variant="page" />
      </div>
    </div>
  )
}
