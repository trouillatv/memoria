'use client'

// Barre de navigation basse — le socle du « cockpit de terrain » (refonte nav).
// 5 portes, toujours à portée du pouce : Aujourd'hui (ma journée) · Sites (où je
// suis) · Chantiers (ce que je pilote) · Actions (à faire) · Profil.
//
// Masquée dans les parcours IMMERSIFS qui ont déjà leur propre bas d'écran
// (visite, capture, import) pour éviter deux barres — elle revient dès qu'on
// ressort. La réconciliation fine (nav visible partout) viendra avec la refonte
// des écrans profonds.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Building2, CheckSquare, User } from 'lucide-react'

const ITEMS: Array<{
  href: string
  label: string
  Icon: typeof Home
  isActive: (p: string) => boolean
  badge?: boolean
}> = [
  { href: '/m', label: "Aujourd'hui", Icon: Home, isActive: (p) => p === '/m' },
  // « Sites » (proximité GPS) reviendra quand le « près de moi » sera réel — sinon
  // c'est un doublon de Chantiers. Le chantier est le vrai centre du conducteur.
  { href: '/m/chantiers', label: 'Chantiers', Icon: Building2, isActive: (p) => p.startsWith('/m/chantiers') || p.startsWith('/m/sites') || p.startsWith('/m/site/') },
  { href: '/m/actions', label: 'Actions', Icon: CheckSquare, isActive: (p) => p.startsWith('/m/actions'), badge: true },
  { href: '/m/profil', label: 'Profil', Icon: User, isActive: (p) => p.startsWith('/m/profil') },
]

// Parcours immersifs (bas d'écran propre) — on n'y superpose pas la barre.
const IMMERSIVE = ['/m/visite/', '/m/site/', '/m/import', '/m/intervention/']

export function MobileTabBar({ actionsCount }: { actionsCount: number }) {
  const pathname = usePathname() ?? '/m'
  if (IMMERSIVE.some((p) => pathname.startsWith(p))) return null

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-foreground/[0.08] bg-background/95 backdrop-blur safe-bottom">
      <div className="mx-auto grid max-w-md grid-cols-4">
        {ITEMS.map(({ href, label, Icon, isActive, badge }) => {
          const active = isActive(pathname)
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors ${active ? 'text-emerald-600' : 'text-muted-foreground'}`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {badge && actionsCount > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
                    {actionsCount > 99 ? '99+' : actionsCount}
                  </span>
                )}
              </span>
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
