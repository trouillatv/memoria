import { notFound } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteActionFiche } from '@/lib/knowledge/action-fiche'
import { MobileActionView } from './MobileActionView'

export const dynamic = 'force-dynamic'

export default async function MobileActionPage({
  params,
}: {
  params: Promise<{ siteId: string; actionId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const { siteId, actionId } = await params
  const action = await getSiteActionFiche(siteId, actionId).catch(() => null)
  if (!action) notFound()

  return <MobileActionView action={action} siteId={siteId} />
}
