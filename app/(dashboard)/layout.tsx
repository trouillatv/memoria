import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOpenActionsHealth } from '@/lib/db/site-actions'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getOrganizationsMeta } from '@/lib/db/organisations'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppTopbar } from '@/components/layout/AppTopbar'
import { BreadcrumbProvider } from '@/components/layout/BreadcrumbProvider'
import { FeedbackButton } from '@/components/ui/FeedbackButton'
import { PageViewLogger } from './PageViewLogger'
import { ThemeSync } from '@/components/layout/ThemeSync'
import { shouldRedirectDashboardRequestToField, isMobileUserAgent } from '@/lib/navigation/home'
import { PwaDesktopModeSync } from '@/components/pwa-desktop-mode-sync'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.must_change_password) redirect('/change-password')

  const h = await headers()
  const pathname = h.get('x-pathname') ?? ''
  const isMobile = isMobileUserAgent(h.get('user-agent'))
  // home_preference choisit l'accueil au login, pas un verrou de navigation.
  if (shouldRedirectDashboardRequestToField({ ...user, pathname }, isMobile)) redirect('/m')

  const fullName = user.full_name || user.email
  // Compteur global d'actions ouvertes (le danger n'est pas de les créer, c'est
  // de ne plus les regarder). Visible managers/admins, dans la nav.
  const actionsHealth =
    user.role === 'admin' || user.role === 'manager'
      ? await getOpenActionsHealth()
      : { total: 0, critique: 0, surveiller: 0, rythme: 0 }

  // M4a — indicateur multi-org dans la sidebar. Ne charge que si multi-org.
  const orgIds = await getOrgIdsOfUser()
  const orgsMeta = orgIds.length > 1 ? await getOrganizationsMeta(orgIds) : undefined

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Skip-link RGAA — invisible jusqu'au focus clavier */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-foreground focus:text-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        Aller au contenu
      </a>
      <BreadcrumbProvider>
        <AppSidebar
          role={user.role}
          fullName={fullName}
          actionsCount={actionsHealth.total}
          actionsCritical={actionsHealth.critique}
          orgs={orgsMeta}
        />
        <div className="md:pl-60">
          <AppTopbar fullName={fullName} role={user.role} />
          <main
            id="main-content"
            className="px-4 md:px-8 py-6 pb-24 md:pb-6 w-full [&>*]:!mx-0 [&>*]:!w-full [&>*]:!max-w-none"
          >
            {children}
          </main>
        </div>
      </BreadcrumbProvider>
      {/* Vincent 2026-05-21 — bouton feedback flottant desktop seulement
          (le composant lui-même se masque avec hidden md:inline-flex). */}
      <FeedbackButton />
      <PageViewLogger />
      {/* Réapplique le thème persisté de l'user au login (cross-device). */}
      <ThemeSync theme={user.theme_preference} />
      <PwaDesktopModeSync userId={user.id} context="dashboard" />
    </div>
  )
}
