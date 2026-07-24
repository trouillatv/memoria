import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOnboardingProgress } from '@/lib/db/onboarding'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getOrganizationIdentityMap } from '@/lib/db/organisations'
import type { OrgLabels } from '@/components/dashboard/OrgBadge'
import { getAttentionDigest } from '@/lib/db/attention'
import { getVisitImpact, emptyVisitImpact } from '@/lib/knowledge/site-events'
import { listLivingASavoir } from '@/lib/db/handover'
import { getUpcomingItems } from '@/lib/db/upcoming-items'
import { getSitesDashboard } from '@/lib/db/sites-dashboard'
import { getNowDashboard } from '@/lib/db/now-dashboard'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import { getMemoryReview, type MemoryReview } from '@/lib/knowledge/memory-review'
import { getPendingWork, type PendingWork } from '@/lib/knowledge/pending-work'
import { WelcomeCard } from './WelcomeCard'
import { DashboardPremium } from './DashboardPremium'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const onboarding = await getOnboardingProgress()
  if (!onboarding.allDone) {
    return (
      <div className="min-h-screen bg-[#f8fafc]">
        <WelcomeCard progress={onboarding} />
      </div>
    )
  }

  const orgIds = await getOrgIdsOfUser()
  const organizationMap = orgIds.length > 1 ? await getOrganizationIdentityMap(orgIds) : null
  const rawOrgLabels = organizationMap
    ? Object.fromEntries(Object.values(organizationMap).map((organization) => [organization.id, organization.slug || organization.name]))
    : null
  const orgLabels: OrgLabels = rawOrgLabels
  const orgNames = rawOrgLabels ? Object.values(rawOrgLabels) : []

  const [attention, visit, aSavoir, upcoming, sites] = await Promise.all([
    getAttentionDigest(5),
    getVisitImpact().catch(() => emptyVisitImpact()),
    listLivingASavoir(4),
    getUpcomingItems(orgIds, 30, organizationMap ?? undefined),
    getSitesDashboard(orgIds, organizationMap ?? undefined),
  ])
  const visitSiteId = visit.sites[0]?.siteId
  const [visitActions, visitReview, visitPending] = visitSiteId
    ? await Promise.all([
        listOpenSiteActions({ statuses: ['open', 'planned'], siteIds: [visitSiteId] }).catch(() => []),
        getMemoryReview(visitSiteId).catch(() => ({ confirmed: [], toReview: [] }) as MemoryReview),
        getPendingWork({ siteIds: [visitSiteId] }).catch(() => ({ actions: [], deadlines: [] }) as PendingWork),
      ])
    : [[], { confirmed: [], toReview: [] } as MemoryReview, { actions: [], deadlines: [] } as PendingWork]
  const now = await getNowDashboard(orgIds, upcoming, organizationMap ?? {})

  return (
    <DashboardPremium
      firstName={user.full_name?.split(' ')[0] ?? ''}
      orgNames={orgNames}
      attention={attention}
      visit={visit}
      upcoming={upcoming}
      sites={sites}
      aSavoir={aSavoir}
      orgLabels={orgLabels}
      organizationMap={organizationMap ?? {}}
      now={now}
      visitActions={visitActions}
      visitReview={visitReview}
      visitPending={visitPending}
    />
  )
}
