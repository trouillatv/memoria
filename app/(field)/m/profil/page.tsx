import Link from 'next/link'
import { User, ChevronRight, UserCircle2, Moon } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { LogoutButton } from '../logout-button'
import { SwitchToDesktopLink } from '../../switch-to-desktop-link'
import { ThemeToggle } from '@/components/layout/ThemeToggle'

export const dynamic = 'force-dynamic'

/**
 * Profil — ce qui concerne l'UTILISATEUR (pas le chantier). Règle appliquée :
 * un item n'existe que s'il a une vraie destination aujourd'hui. On ne câble donc
 * PAS de faux menus (Mon activité / Outils / Aide / la plupart des préférences)
 * tant que la feature n'existe pas — ils viendront quand ils auront un sens.
 * La synchronisation détaillée est retirée d'ici (le point discret reste en haut).
 */
export default async function ProfilPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserCircle2 className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{user.full_name || 'Mon profil'}</h1>
          {user.email && <p className="truncate text-sm text-muted-foreground">{user.email}</p>}
        </div>
      </header>

      {/* Mon compte — mes informations (nom, société, équipe vivent sur /account). */}
      <section className="space-y-1.5">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mon compte</h2>
        <ul className="overflow-hidden rounded-xl border bg-card divide-y">
          <li>
            <Link href="/account" className="flex items-center gap-3 px-3.5 py-3 text-sm active:bg-accent">
              <User className="h-5 w-5 text-muted-foreground" />
              <span className="flex-1 font-medium">Mes informations</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </li>
        </ul>
      </section>

      {/* Préférences — uniquement ce qui existe réellement (le thème). Notifications,
          qualité photo, hors-ligne, langue viendront quand ce seront de vrais réglages. */}
      <section className="space-y-1.5">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Préférences</h2>
        <ul className="overflow-hidden rounded-xl border bg-card divide-y">
          <li className="flex items-center gap-3 px-3.5 py-3 text-sm">
            <Moon className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 font-medium">Thème</span>
            <ThemeToggle />
          </li>
        </ul>
      </section>

      {(user.role === 'admin' || user.role === 'manager') && (
        <div className="rounded-xl border bg-card px-3.5 py-3 text-sm">
          <SwitchToDesktopLink userId={user.id} />
        </div>
      )}

      <div className="pt-1">
        <LogoutButton />
      </div>
    </div>
  )
}
