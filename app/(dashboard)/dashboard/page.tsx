import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOnboardingProgress } from '@/lib/db/onboarding'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getOrganizationIdentityMap } from '@/lib/db/organisations'
import type { OrgLabels } from '@/components/dashboard/OrgBadge'
import { getAttentionDigest } from '@/lib/db/attention'
import { getUpcomingItems } from '@/lib/db/upcoming-items'
import { getSitesDashboard, isSiteAccessible } from '@/lib/db/sites-dashboard'
import { getNowDashboard } from '@/lib/db/now-dashboard'
import { getMemoryReview, type MemoryReview } from '@/lib/knowledge/memory-review'
import { getHomeHeroDelta } from '@/lib/documents/home-hero-delta'
import { getDashboardDeadlinesToPlan } from '@/lib/db/dashboard-deadlines'
import { getStructuredPromiseRecords } from '@/lib/db/promise-candidates'
import { attentionItemToMemorySignal } from '@/lib/memory/signals/lot1-adapters'
import { detectPromiseSignalsFromRecords } from '@/lib/memory/signals/promise-pipeline'
import { detectActionDueSoonSignals } from '@/lib/memory/signals/action-due-soon-detector'
import { getForgottenVisitCandidates } from '@/lib/db/forgotten-visits'
import { detectMissedVisitSignals } from '@/lib/memory/signals/missed-visit-detector'
import { composeAttentionCardsFromSignals } from '@/lib/situations/attention/compose'
import { sortAttentionCards } from '@/lib/situations/attention/project'
import { WelcomeCard } from './WelcomeCard'
import { DashboardPremium } from './DashboardPremium'

export const dynamic = 'force-dynamic'

const ATTENTION_MAX = 3

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ chantier?: string }>
}) {
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

  const sp = await searchParams
  const orgIds = await getOrgIdsOfUser()
  // Correction A — toujours résoudre l'identité des organisations (logo inclus),
  // même mono-org : le fallback de organizationFor() sans map réelle renvoie un
  // logoUrl null.
  const organizationMap = await getOrganizationIdentityMap(orgIds)
  const rawOrgLabels = Object.fromEntries(
    Object.values(organizationMap).map((organization) => [organization.id, organization.slug || organization.name]),
  )
  const orgLabels: OrgLabels = rawOrgLabels
  const orgNames = Object.values(rawOrgLabels)

  // Correction B — un `?chantier=` hors périmètre ne doit produire ni nom, ni
  // compteur, ni logo, ni délai distinct : validation contre TOUS les chantiers
  // accessibles avant tout calcul lourd, repli silencieux sinon.
  const requestedSiteId = sp.chantier ?? null
  const requestedSiteValid = requestedSiteId ? await isSiteAccessible(requestedSiteId, orgIds) : false
  const ensureSiteId = requestedSiteValid ? requestedSiteId : null

  // Tier LÉGER : toutes les cartes visibles (max 3), aucun delta par site.
  const [attention, upcoming, siteCards, deadlinesToPlan, promiseRecords] = await Promise.all([
    getAttentionDigest(5),
    getUpcomingItems(orgIds, 30, organizationMap),
    getSitesDashboard(orgIds, organizationMap, { limit: 3, ensureSiteId }),
    getDashboardDeadlinesToPlan(orgIds, organizationMap),
    getStructuredPromiseRecords(orgIds),
  ])

  // Le chantier actif : la requête si valide, sinon le premier chantier de
  // l'ordre déjà trié par getSitesDashboard — jamais un nouveau tri, jamais un
  // état côté client, jamais de tracking de dernière visite.
  const activeSiteId = ensureSiteId ?? siteCards[0]?.id ?? null

  // Tier LOURD : uniquement le chantier actif — jamais une boucle sur plusieurs
  // chantiers (cf. doctrine deux-tiers Home V2).
  const [heroDelta, activeReview] = await Promise.all([
    activeSiteId ? getHomeHeroDelta(activeSiteId) : Promise.resolve(null),
    activeSiteId
      ? getMemoryReview(activeSiteId, { includeWork: true }).catch(() => ({ confirmed: [], toReview: [] }) as MemoryReview)
      : Promise.resolve({ confirmed: [], toReview: [] } as MemoryReview),
  ])

  const promiseSignals = detectPromiseSignalsFromRecords(promiseRecords)
  const now = await getNowDashboard(orgIds, upcoming, organizationMap)
  const legacyAttentionSignals = [
    ...attention.red.map((item) => attentionItemToMemorySignal(item)),
    ...attention.orange.map((item) => attentionItemToMemorySignal(item)),
  ].filter((signal): signal is NonNullable<typeof signal> => signal !== null)
  const actionDueSoonSignals = detectActionDueSoonSignals(now.actions)
  const missedVisitSignals = detectMissedVisitSignals(
    await getForgottenVisitCandidates(orgIds).catch(() => ({ overduePlanned: [], staleSites: [] })),
  )
  const siteIdsToday = new Set(upcoming.filter((i) => i.isToday).map((i) => i.siteId))
  const allSignals = [...promiseSignals, ...legacyAttentionSignals, ...actionDueSoonSignals, ...missedVisitSignals]

  // « Ce qui mérite votre attention » : priorité au chantier actif ; le reste ne
  // complète que s'il manque des places, et jamais en repoussant une carte du
  // chantier actif (siteLabel distingue déjà visuellement l'appartenance).
  const activeSignals = allSignals.filter((s) => s.siteId === activeSiteId)
  const otherSignals = allSignals.filter((s) => s.siteId !== activeSiteId)
  const activeCards = sortAttentionCards(composeAttentionCardsFromSignals(activeSignals, { siteIdsToday })).slice(0, ATTENTION_MAX)
  const fillCount = ATTENTION_MAX - activeCards.length
  const otherCards = fillCount > 0
    ? sortAttentionCards(composeAttentionCardsFromSignals(otherSignals, { siteIdsToday })).slice(0, fillCount)
    : []
  const attentionCards = [...activeCards, ...otherCards]

  return (
    <DashboardPremium
      firstName={user.full_name?.split(' ')[0] ?? ''}
      orgNames={orgNames}
      attentionCards={attentionCards}
      upcoming={upcoming}
      sites={siteCards}
      activeSiteId={activeSiteId}
      heroDelta={heroDelta}
      activeReview={activeReview}
      orgLabels={orgLabels}
      organizationMap={organizationMap}
      deadlinesToPlan={deadlinesToPlan}
    />
  )
}
