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
import { getMemoryReview, type MemoryReview } from '@/lib/knowledge/memory-review'
import { getDashboardDeadlinesToPlan } from '@/lib/db/dashboard-deadlines'
import { getStructuredPromiseRecords } from '@/lib/db/promise-candidates'
import { attentionItemToMemorySignal, nowItemToMemorySignal } from '@/lib/memory/signals/lot1-adapters'
import { detectPromiseSignalsFromRecords } from '@/lib/memory/signals/promise-pipeline'
import { composeAttentionCardsFromSignals } from '@/lib/situations/attention/compose'
import { composeNowCardsFromSignals } from '@/lib/situations/now/compose'
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

  const [attention, visit, aSavoir, upcoming, sites, deadlinesToPlan, promiseRecords] = await Promise.all([
    getAttentionDigest(5),
    getVisitImpact().catch(() => emptyVisitImpact()),
    listLivingASavoir(4),
    getUpcomingItems(orgIds, 30, organizationMap ?? undefined),
    getSitesDashboard(orgIds, organizationMap ?? undefined),
    getDashboardDeadlinesToPlan(orgIds, organizationMap ?? {}),
    getStructuredPromiseRecords(orgIds),
  ])
  const visitReviews = Object.fromEntries(await Promise.all(
    visit.sites.map(async (site) => [
      site.siteId,
      await getMemoryReview(site.siteId, { includeWork: true }).catch(() => ({ confirmed: [], toReview: [] }) as MemoryReview),
    ] as const),
  )) as Record<string, MemoryReview>
  const promiseSignals = detectPromiseSignalsFromRecords(promiseRecords)
  const now = await getNowDashboard(orgIds, upcoming, organizationMap ?? {})
  const legacyAttentionSignals = [
    ...attention.red.map((item) => attentionItemToMemorySignal(item)),
    ...attention.orange.map((item) => attentionItemToMemorySignal(item)),
  ].filter((signal): signal is NonNullable<typeof signal> => signal !== null)
  const attentionCards = composeAttentionCardsFromSignals(promiseSignals)
  const nowCards = composeNowCardsFromSignals(promiseSignals)
  const nowSignals = now.items.map((item) => nowItemToMemorySignal(item))

  return (
    <DashboardPremium
      firstName={user.full_name?.split(' ')[0] ?? ''}
      orgNames={orgNames}
      attentionSignals={legacyAttentionSignals}
      attentionCards={attentionCards}
      nowCards={nowCards}
      visit={visit}
      upcoming={upcoming}
      sites={sites}
      aSavoir={aSavoir}
      orgLabels={orgLabels}
      organizationMap={organizationMap ?? {}}
      now={now}
      nowSignals={nowSignals}
      visitReviews={visitReviews}
      deadlinesToPlan={deadlinesToPlan}
    />
  )
}
