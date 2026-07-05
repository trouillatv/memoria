'use client'

// Barre de navigation basse — le socle du « cockpit de terrain ». 5 slots, avec
// l'ACTION PRINCIPALE au centre (➕ Visite) : démarrer une visite est le geste le
// plus fréquent, il doit être à portée du pouce PARTOUT. Les 4 destinations :
// Aujourd'hui · Chantiers · Actions · Profil. Masquée dans les parcours immersifs
// (visite/capture/import) qui ont déjà leur propre bas d'écran.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Building2, Plus, CheckSquare, User } from 'lucide-react'

type Item = { href: string; label: string; Icon: typeof Home; isActive: (p: string) => boolean; badge?: boolean }

const LEFT: Item[] = [
  { href: '/m', label: "Aujourd'hui", Icon: Home, isActive: (p) => p === '/m' },
  { href: '/m/chantiers', label: 'Chantiers', Icon: Building2, isActive: (p) => p.startsWith('/m/chantiers') || p.startsWith('/m/sites') || p.startsWith('/m/site/') },
]
const RIGHT: Item[] = [
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
      <div className="mx-auto grid max-w-md grid-cols-5 items-end">
        {LEFT.map((it) => <Tab key={it.href} item={it} pathname={pathname} actionsCount={actionsCount} />)}

        {/* Action principale — démarrer une visite en 1 tap, depuis n'importe où. */}
        <div className="flex flex-col items-center gap-1 pb-1.5">
          <Link
            href="/m/demarrer"
            aria-label="Démarrer une visite"
            className={`-mt-5 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-background active:scale-95 ${pathname.startsWith('/m/demarrer') ? 'bg-emerald-700' : 'bg-emerald-600'}`}
          >
            <Plus className="h-7 w-7" />
          </Link>
          <span className={`text-[11px] font-medium ${pathname.startsWith('/m/demarrer') ? 'text-emerald-600' : 'text-muted-foreground'}`}>Visite</span>
        </div>

        {RIGHT.map((it) => <Tab key={it.href} item={it} pathname={pathname} actionsCount={actionsCount} />)}
      </div>
    </nav>
  )
}

function Tab({ item, pathname, actionsCount }: { item: Item; pathname: string; actionsCount: number }) {
  const active = item.isActive(pathname)
  const { Icon } = item
  return (
    <Link
      href={item.href}
      className={`relative flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors ${active ? 'text-emerald-600' : 'text-muted-foreground'}`}
    >
      <span className="relative">
        <Icon className="h-5 w-5" />
        {item.badge && actionsCount > 0 && (
          <span className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {actionsCount > 99 ? '99+' : actionsCount}
          </span>
        )}
      </span>
      {item.label}
    </Link>
  )
}
