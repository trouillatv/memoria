import Link from 'next/link'
import { User, ChevronRight, SlidersHorizontal, UserCircle2 } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { LogoutButton } from '../logout-button'
import { SwitchToDesktopLink } from '../../switch-to-desktop-link'
import { SyncIndicator } from '../../sync-indicator'
import { ThemeToggle } from '@/components/layout/ThemeToggle'

export const dynamic = 'force-dynamic'

/**
 * Profil — compte, synchronisation, paramètres, déconnexion. C'est ICI que vivent
 * désormais les réglages (déplacés de l'ancien pied de page), et le statut de
 * synchronisation détaillé — le petit point discret reste en haut à droite.
 */
export default async function ProfilPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserCircle2 className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{user.full_name || 'Mon profil'}</h1>
          {user.email && <p className="truncate text-sm text-muted-foreground">{user.email}</p>}
        </div>
      </header>

      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        <li>
          <Link href="/account" className="flex items-center gap-3 px-3.5 py-3 text-sm active:bg-accent">
            <User className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 font-medium">Mon compte</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </li>
        <li>
          <Link href="/account" className="flex items-center gap-3 px-3.5 py-3 text-sm active:bg-accent">
            <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 font-medium">Paramètres</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </li>
        <li className="flex items-center gap-3 px-3.5 py-3 text-sm">
          <span className="flex-1 font-medium">État de synchronisation</span>
          <SyncIndicator />
        </li>
        <li className="flex items-center gap-3 px-3.5 py-3 text-sm">
          <span className="flex-1 font-medium">Thème</span>
          <ThemeToggle />
        </li>
      </ul>

      {(user.role === 'admin' || user.role === 'manager') && (
        <div className="rounded-xl border bg-card px-3.5 py-3 text-sm">
          <SwitchToDesktopLink />
        </div>
      )}

      <div className="pt-1">
        <LogoutButton />
      </div>
    </div>
  )
}
