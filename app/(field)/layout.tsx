import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { LogoutButton } from './m/logout-button'
import { SyncIndicator } from './sync-indicator'
import { SyncToastBridge } from './sync-toast-bridge'
import { FieldSyncDrainer } from './sync-drainer'
import { ThemeSync } from '@/components/layout/ThemeSync'
import { ThemeToggle } from '@/components/layout/ThemeToggle'

export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.must_change_password) redirect('/change-password')

  // Allow chef_equipe (the agent role) AND admin/manager (for QA/demo).
  // chef_equipe: production user. admin/manager: dev only, can verify the agent UX.
  const allowedRoles = ['chef_equipe', 'admin', 'manager']
  if (!allowedRoles.includes(user.role)) redirect('/login')

  const baseName = user.full_name ?? user.email
  const firstName = baseName.split(' ')[0] ?? baseName

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 backdrop-blur-sm border-b border-foreground/[0.08] bg-background/95">
        <div className="max-w-md mx-auto flex items-center justify-between px-4 py-3">
          <div className="text-sm">
            Bonjour <span className="font-semibold">{firstName}</span>
          </div>
          <SyncIndicator />
        </div>
      </header>
      <main className="max-w-md mx-auto px-4 py-4">{children}</main>
      <footer className="max-w-md mx-auto px-4 py-6 mt-12 border-t border-foreground/[0.08] flex items-center gap-3 text-sm">
        <LogoutButton />
        <span aria-hidden className="text-muted-foreground/60">·</span>
        <Link
          href="/account"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Mon compte
        </Link>
        {/* Thème : sélecteur accessible directement depuis le terrain (mobile).
            Persiste en base + cross-device, comme le toggle desktop. */}
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </footer>
      {/* Réapplique le thème persisté de l'user en entrant sur le terrain. */}
      <ThemeSync theme={user.theme_preference} />
      <SyncToastBridge />
      <FieldSyncDrainer />
    </div>
  )
}
