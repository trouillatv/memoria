import Link from 'next/link'
import { ListTodo } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOpenActionsHealth } from '@/lib/db/site-actions'
import { LogoutButton } from './m/logout-button'
import { SyncIndicator } from './sync-indicator'
import { SyncToastBridge } from './sync-toast-bridge'
import { FieldSyncDrainer } from './sync-drainer'
import { ThemeSync } from '@/components/layout/ThemeSync'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { PageViewLogger } from '@/app/(dashboard)/PageViewLogger'

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

  // Compteur d'actions ouvertes — visible sur tout le terrain (ne pas oublier
  // ce qui reste à faire). Résilient si le socle n'est pas migré.
  const actionsHealth = await getOpenActionsHealth()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 backdrop-blur-sm border-b border-foreground/[0.08] bg-background/95">
        <div className="max-w-md mx-auto flex items-center justify-between px-4 py-3">
          <div className="text-sm">
            Bonjour <span className="font-semibold">{firstName}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Toujours visible : porte d'entrée vers les actions ouvertes. */}
            <Link
              href="/m/actions"
              aria-label="Actions ouvertes"
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors active:scale-[0.97] ${
                actionsHealth.critique > 0
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              <ListTodo className="h-3.5 w-3.5" />
              Actions
              {actionsHealth.total > 0 && (
                <span className="tabular-nums font-semibold">{actionsHealth.total}</span>
              )}
            </Link>
            <SyncIndicator />
          </div>
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
        {/* Échappatoire bureau : un manager ne doit jamais être coincé sur /m. */}
        {(user.role === 'admin' || user.role === 'manager') && (
          <>
            <span aria-hidden className="text-muted-foreground/60">·</span>
            <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">
              Vue bureau
            </Link>
          </>
        )}
        {/* Thème : sélecteur accessible directement depuis le terrain (mobile).
            Persiste en base + cross-device, comme le toggle desktop. */}
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </footer>
      {/* Réapplique le thème persisté de l'user en entrant sur le terrain. */}
      <ThemeSync theme={user.theme_preference} />
      {/* Instrumentation : ouverture des surfaces terrain (/m…) — savoir si le
          pilote vit côté chef. Niveau route/feature, pas de surveillance. */}
      <PageViewLogger />
      <SyncToastBridge />
      <FieldSyncDrainer />
    </div>
  )
}
