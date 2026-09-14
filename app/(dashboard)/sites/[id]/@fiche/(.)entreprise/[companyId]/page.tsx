import { requireDeskUser } from '@/lib/auth/page-guard'
import { notFound } from 'next/navigation'
import { getSiteCompanyFiche } from '@/lib/knowledge/site-intervenants-consolidated'
import { SiteCompanyFichePanel } from '../../../views/intervenants/SiteCompanyFichePanel'

export const dynamic = 'force-dynamic'

export default async function SiteCompanyFicheInterceptee({ params }: { params: Promise<{ id: string; companyId: string }> }) {
  await requireDeskUser()
  const { id, companyId } = await params
  const company = await getSiteCompanyFiche(id, companyId).catch(() => null)
  if (!company) notFound()
  return <SiteCompanyFichePanel company={company} />
}
