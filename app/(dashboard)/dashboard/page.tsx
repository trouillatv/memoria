import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOnboardingProgress } from '@/lib/db/onboarding'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getOrganizationIdentityMap } from '@/lib/db/organisations'
import type { OrgLabels } from '@/components/dashboard/OrgBadge'
import { getUpcomingItems } from '@/lib/db/upcoming-items'
import { getSitesDashboard, isSiteAccessible, type SiteDashboardItem } from '@/lib/db/sites-dashboard'
import { getMemoryReview, type MemoryReview } from '@/lib/knowledge/memory-review'
import { getHomeHeroDelta } from '@/lib/documents/home-hero-delta'
import { getSiteActionsPilotage, emptyActionsPilotage, buildVisiblePilotageActions } from '@/lib/knowledge/actions-pilotage'
import { readSiteActionSummaries } from '@/lib/knowledge/repository'
import { isActionOverdue, daysBetween } from '@/lib/knowledge/overdue-action'
import { todayLocalIso } from '@/lib/time/local-date'
import { getDashboardDeadlinesToPlan } from '@/lib/db/dashboard-deadlines'
import { WelcomeCard } from './WelcomeCard'
import {
  DashboardPremium,
  Hero,
  HeroSkeleton,
  MemorySouvient,
  MemorySouvientSkeleton,
  ActionsDuChantier,
  ActionsDuChantierSkeleton,
} from './DashboardPremium'

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

async function ActiveActions({ site }: { site: SiteDashboardItem }) {
  const [pilotage, rawRows] = await Promise.all([
    getSiteActionsPilotage(site.id).catch(() => emptyActionsPilotage()),
    readSiteActionSummaries(site.id).catch(() => []),
  ])
  const today = todayLocalIso()
  const rawById = new Map(rawRows.map((r) => [r.id, r]))
  // FIX 3/4 (review ChatGPT/Vincent SHA 40a4ba65) — lateCount reconcilié par
  // targetActionId sur la population RÉELLEMENT visible, jamais une approximation
  // par thread (l'ancien groupActionsByThread ne couvrait pas unattachedActions).
  const visible = buildVisiblePilotageActions(pilotage)
  const overdueDaysByActionId: Record<string, number> = {}
  for (const { cbo } of visible) {
    if (!cbo.targetActionId) continue
    const raw = rawById.get(cbo.targetActionId)
    if (!raw) continue
    if (isActionOverdue(raw.status, raw.due_date, raw.due_date_status, today)) {
      overdueDaysByActionId[cbo.targetActionId] = daysBetween(raw.due_date as string, today)
    }
  }
  const lateCount = Object.keys(overdueDaysByActionId).length
  return <ActionsDuChantier site={site} pilotage={pilotage} lateCount={lateCount} overdueDaysByActionId={overdueDaysByActionId} />
}

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

  // Tier LÉGER : portefeuille "Vos chantiers" (aucune limite, cf. Section 1 —
  // le scroll horizontal gère le volume) — tri par récence réelle sur le
  // portefeuille complet déjà fait côté serveur (sortMode: 'recent'),
  // ChantierSelector affiche l'ordre reçu.
  const [upcoming, siteCards, deadlinesToPlan] = await Promise.all([
    getUpcomingItems(orgIds, 30, organizationMap),
    getSitesDashboard(orgIds, organizationMap, { limit: null, ensureSiteId, sortMode: 'recent' }),
    getDashboardDeadlinesToPlan(orgIds, organizationMap),
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
  const actionsSlot = activeSite ? (
    <Suspense key={activeSite.id} fallback={<ActionsDuChantierSkeleton />}>
      <ActiveActions site={activeSite} />
    </Suspense>
  ) : (
    <ActionsDuChantier site={null} pilotage={emptyActionsPilotage()} lateCount={0} overdueDaysByActionId={{}} />
  )

  return (
    <DashboardPremium
      firstName={user.full_name?.split(' ')[0] ?? ''}
      orgNames={orgNames}
      upcoming={upcoming}
      sites={siteCards}
      activeSiteId={activeSiteId}
      heroSlot={heroSlot}
      memorySlot={memorySlot}
      actionsSlot={actionsSlot}
      orgLabels={orgLabels}
      organizationMap={organizationMap}
      deadlinesToPlan={deadlinesToPlan}
    />
  )
}
