import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppTopbar } from '@/components/layout/AppTopbar'
import { BreadcrumbProvider } from '@/components/layout/BreadcrumbProvider'
import { FeedbackButton } from '@/components/ui/FeedbackButton'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.must_change_password) redirect('/change-password')

  const pathname = (await headers()).get('x-pathname') ?? ''
  const isAccountPage = pathname.startsWith('/account')

  // chef_equipe (agent terrain) ne doit PAS voir le dashboard desktop —
  // SAUF la page /account, accessible à tous les rôles.
  // Belt + suspenders avec le check role dans app/(field)/layout.tsx.
  if (user.role === 'chef_equipe' && !isAccountPage) redirect('/m')

  const fullName = user.full_name || user.email
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
        <AppSidebar role={user.role} fullName={fullName} />
        <div className="md:pl-60">
          <AppTopbar fullName={fullName} role={user.role} />
          <main id="main-content" className="px-4 md:px-8 py-6 pb-24 md:pb-6">{children}</main>
        </div>
      </BreadcrumbProvider>
      {/* Vincent 2026-05-21 — bouton feedback flottant desktop seulement
          (le composant lui-même se masque avec hidden md:inline-flex). */}
      <FeedbackButton />
    </div>
  )
}
