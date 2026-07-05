import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOpenActionsHealth } from '@/lib/db/site-actions'
import { MobileTabBar } from './m/MobileTabBar'
import { SyncIndicator } from './sync-indicator'
import { SyncToastBridge } from './sync-toast-bridge'
import { FieldSyncDrainer } from './sync-drainer'
import { ThemeSync } from '@/components/layout/ThemeSync'
import { PageViewLogger } from '@/app/(dashboard)/PageViewLogger'

export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.must_change_password) redirect('/change-password')

  // Allow chef_equipe (the agent role) AND admin/manager (for QA/demo).
  // chef_equipe: production user. admin/manager: dev only, can verify the agent UX.
  const allowedRoles = ['chef_equipe', 'admin', 'manager']
  if (!allowedRoles.includes(user.role)) redirect('/login')

  // Compteur d'actions ouvertes — visible sur tout le terrain (ne pas oublier
  // ce qui reste à faire). Résilient si le socle n'est pas migré.
  const actionsHealth = await getOpenActionsHealth()

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <header className="sticky top-0 z-10 backdrop-blur-sm border-b border-foreground/[0.08] bg-background/95">
        <div className="max-w-md mx-auto flex items-center justify-between px-3 py-3.5">
          {/* Retour accueil + identité produit (remplace le « Bonjour <prénom> »
              redondant : le prénom est déjà repris en grand dans le corps de /m). */}
          <Link href="/m" className="text-sm font-semibold tracking-tight">
            MemorIA
          </Link>
          {/* Sites/Actions sont désormais dans la barre du bas : on ne garde en
              haut que l'identité et le point de synchronisation (discret). */}
          <div className="flex items-center gap-2.5">
            <SyncIndicator />
          </div>
        </div>
      </header>
      {/* pb pour dégager la barre de nav fixe (le socle du cockpit). Les réglages
          (compte, thème, déconnexion, bascule bureau) vivent désormais dans Profil. */}
      <main className="max-w-md mx-auto px-3 pt-5 pb-24">{children}</main>
      <MobileTabBar actionsCount={actionsHealth.total} />
      {/* Réapplique le thème persisté de l'user en entrant sur le terrain. */}
      <ThemeSync theme={user.theme_preference} />
      {/* Instrumentation : ouverture des surfaces terrain (/m…) — savoir si le
          pilote vit côté chef. Niveau route/feature, pas de surveillance. */}
      <PageViewLogger />
      <SyncToastBridge />
      <FieldSyncDrainer userId={user.id} />
    </div>
  )
}
