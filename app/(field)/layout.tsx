import Link from 'next/link'
import { redirect } from 'next/navigation'
import { User } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOpenActionsHealth } from '@/lib/db/site-actions'
import { MobileTabBar } from './m/MobileTabBar'
import { SyncIndicator } from './sync-indicator'
import { SyncToastBridge } from './sync-toast-bridge'
import { FieldSyncDrainer } from './sync-drainer'
import { ThemeSync } from '@/components/layout/ThemeSync'
import { PageViewLogger } from '@/app/(dashboard)/PageViewLogger'
import { PwaDesktopModeSync } from '@/components/pwa-desktop-mode-sync'

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
          {/* « Moi » n'est plus un onglet de la barre du bas (décision Vincent) :
              il vit ici, en avatar discret en haut à droite — on ne l'ouvre jamais
              dans l'urgence terrain. À côté, le point de synchronisation. */}
          <div className="flex items-center gap-2.5">
            <SyncIndicator />
            <Link
              href="/m/profil"
              aria-label="Moi"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-foreground/10 active:opacity-70"
            >
              {(() => {
              const initials = avatarInitials(user.full_name, user.email)
              return initials
                ? <span className="text-[11px] font-semibold tabular-nums">{initials}</span>
                : <User className="h-4 w-4" />
            })()}
            </Link>
          </div>
        </div>
      </header>
      {/* pb pour dégager la barre de nav fixe (le socle du cockpit). Les réglages
          (compte, thème, déconnexion, bascule bureau) vivent désormais dans Profil. */}
      <main className="max-w-md mx-auto px-3 pt-5 pb-24">{children}</main>
      {/* Badge = ce qui mérite l'œil AUJOURD'HUI (pas l'inventaire des ouvertes) :
          silencieux quand rien ne réclame — même modèle que l'accueil. */}
      <MobileTabBar actionsCount={actionsHealth.attention} />
      {/* Réapplique le thème persisté de l'user en entrant sur le terrain. */}
      <ThemeSync theme={user.theme_preference} />
      {/* Instrumentation : ouverture des surfaces terrain (/m…) — savoir si le
          pilote vit côté chef. Niveau route/feature, pas de surveillance. */}
      <PageViewLogger />
      <SyncToastBridge />
      <FieldSyncDrainer userId={user.id} />
      <PwaDesktopModeSync userId={user.id} context="field" />
    </div>
  )
}

/** Initiales pour l'avatar « Moi » (1-2 lettres). null → icône générique. */
function avatarInitials(fullName: string | null, email: string | null): string | null {
  const src = fullName?.trim() || email?.split('@')[0]?.trim()
  if (!src) return null
  const parts = src.split(/[\s._-]+/).filter(Boolean)
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase()
}
