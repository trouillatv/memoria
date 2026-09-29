import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOnboardingProgress } from '@/lib/db/onboarding'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getOrganizationIdentityMap } from '@/lib/db/organisations'
import type { OrgLabels } from '@/components/dashboard/OrgBadge'
import { getAttentionDigest } from '@/lib/db/attention'
import { getUpcomingItems } from '@/lib/db/upcoming-items'
import { getSitesDashboard, isSiteAccessible, type SiteDashboardItem } from '@/lib/db/sites-dashboard'
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
import { DashboardPremium, Hero, HeroSkeleton, MemorySouvient, MemorySouvientSkeleton } from './DashboardPremium'

export const dynamic = 'force-dynamic'

/**
 * Tier LOURD, chantier actif uniquement : Async Server Component streamé sous
 * Suspense key={site.id}. Un changement de chantier remonte ce sous-arbre
 * (nouvelle clé) au lieu de réutiliser le rendu précédent — jamais les
 * chiffres de l'ancien chantier affichés pendant le chargement du nouveau.
 */
async function ActiveHero({ site }: { site: SiteDashboardItem }) {
  const heroDelta = await getHomeHeroDelta(site.id)
  return <Hero site={site} heroDelta={heroDelta} />
}

async function ActiveMemory({ site }: { site: SiteDashboardItem }) {
  const review = await getMemoryReview(site.id, { includeWork: true }).catch(() => ({ confirmed: [], toReview: [] }) as MemoryReview)
  return <MemorySouvient site={site} review={review} />
}

const ATTENTION_MAX = 3

// FIX RECENCE CARROUSEL — pool de candidats pour le tri de présentation par
// récence (ChantierSelector). getSitesDashboard calcule déjà les stats de
// TOUS les chantiers accessibles quel que soit `limit` (ses requêtes Supabase
// ne sont jamais bornées par ce paramètre, seul le slice() final l'est) : élargir
// ce pool ne coûte donc aucune requête supplémentaire. Le carrousel affiché
// reste plafonné à 5 cartes (cf. CAROUSEL_MAX dans DashboardPremium.tsx).
const SITE_CARDS_POOL = 20

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

  // Tier LÉGER : pool de candidats pour le carrousel (max SITE_CARDS_POOL,
  // aucun delta par site) — le tri par récence et le plafond d'affichage à 5
  // cartes sont appliqués en présentation par ChantierSelector.
  const [attention, upcoming, siteCards, deadlinesToPlan, promiseRecords] = await Promise.all([
    getAttentionDigest(5),
    getUpcomingItems(orgIds, 30, organizationMap),
    getSitesDashboard(orgIds, organizationMap, { limit: SITE_CARDS_POOL, ensureSiteId }),
    getDashboardDeadlinesToPlan(orgIds, organizationMap),
    getStructuredPromiseRecords(orgIds),
  ])

  // Le chantier actif : la requête si valide, sinon le premier chantier de
  // l'ordre déjà trié par getSitesDashboard — jamais un nouveau tri, jamais un
  // état côté client, jamais de tracking de dernière visite.
  const activeSiteId = ensureSiteId ?? siteCards[0]?.id ?? null
  const activeSite = siteCards.find((s) => s.id === activeSiteId) ?? null

  // Tier LOURD : uniquement le chantier actif, jamais une boucle sur plusieurs
  // chantiers (cf. doctrine deux-tiers Home V2) — et jamais attendu ici : streamé
  // sous Suspense (cf. ActiveHero/ActiveMemory) pour que le tier léger (cartes,
  // attention, agenda) s'affiche sans attendre ce calcul.
  const heroSlot = activeSite ? (
    <Suspense key={activeSite.id} fallback={<HeroSkeleton />}>
      <ActiveHero site={activeSite} />
    </Suspense>
  ) : (
    <Hero site={null} heroDelta={null} />
  )
  const memorySlot = activeSite ? (
    <Suspense key={activeSite.id} fallback={<MemorySouvientSkeleton />}>
      <ActiveMemory site={activeSite} />
    </Suspense>
  ) : (
    <MemorySouvient site={null} review={{ confirmed: [], toReview: [] }} />
  )

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
      heroSlot={heroSlot}
      memorySlot={memorySlot}
      orgLabels={orgLabels}
      organizationMap={organizationMap}
      deadlinesToPlan={deadlinesToPlan}
    />
  )
}
