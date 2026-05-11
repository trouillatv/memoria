import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { LogoutButton } from './m/logout-button'
import { SyncIndicator } from './sync-indicator'
import { SyncToastBridge } from './sync-toast-bridge'

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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-sm">
            Bonjour <span className="font-semibold">{firstName}</span>
          </div>
          <SyncIndicator />
        </div>
      </header>
      <main className="px-4 py-4">{children}</main>
      <footer className="px-4 py-6 mt-12 border-t flex items-center gap-4">
        <Link
          href="/account"
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Mon compte
        </Link>
        <LogoutButton />
      </footer>
      <SyncToastBridge />
    </div>
  )
}
