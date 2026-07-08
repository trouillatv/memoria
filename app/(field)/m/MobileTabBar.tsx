'use client'

// Barre de navigation basse — le socle du « cockpit de terrain ». 4 destinations
// (Aujourd'hui · Chantiers · Actions · Profil) + une ACTION flottante au centre :
// le ➕ n'est PAS un onglet ni une page, il OUVRE une bottom sheet (Créer) — comme
// Slack/Notion/Drive. Plus d'écran intermédiaire vide. Masquée dans les parcours
// immersifs (visite/capture/import) qui ont déjà leur propre bas d'écran.

import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Home, Building2, Plus, CheckSquare, CalendarRange, X } from 'lucide-react'
import { MeetingLauncher } from './MeetingLauncher'
import { VisitLauncherHome } from './VisitLauncherHome'
import { InterventionLauncher } from './InterventionLauncher'

type Item = { href: string; label: string; Icon: typeof Home; isActive: (p: string) => boolean; badge?: boolean }

// Barre = Accueil · Planning · ➕ · Chantiers · Actions (décision Vincent —
// docs/foundations/roadmap-terrain-contextuel.md). « Moi » n'est plus un onglet :
// il vit en avatar en haut à droite (layout). Planning et Actions forment un
// couple — daté (Planning) vs à organiser (Actions) — les deux restent visibles.
const LEFT: Item[] = [
  { href: '/m', label: "Aujourd'hui", Icon: Home, isActive: (p) => p === '/m' },
  { href: '/m/planning', label: 'Planning', Icon: CalendarRange, isActive: (p) => p.startsWith('/m/planning') },
]
const RIGHT: Item[] = [
  { href: '/m/chantiers', label: 'Chantiers', Icon: Building2, isActive: (p) => p.startsWith('/m/chantiers') || p.startsWith('/m/sites') || p.startsWith('/m/site/') },
  { href: '/m/actions', label: 'Actions', Icon: CheckSquare, isActive: (p) => p.startsWith('/m/actions'), badge: true },
]

// Parcours immersifs (bas d'écran propre) — on n'y superpose pas la barre.
const IMMERSIVE = ['/m/visite/', '/m/site/', '/m/import', '/m/intervention/']

export function MobileTabBar({ actionsCount }: { actionsCount: number }) {
  const pathname = usePathname() ?? '/m'
  const [createOpen, setCreateOpen] = useState(false)
  if (IMMERSIVE.some((p) => pathname.startsWith(p))) return null

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-foreground/[0.08] bg-background/95 backdrop-blur safe-bottom">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end">
          {LEFT.map((it) => <Tab key={it.href} item={it} pathname={pathname} actionsCount={actionsCount} />)}

          {/* Action flottante — le ➕ OUVRE la bottom sheet « Créer », il ne navigue
              pas (plus de page-lanceur vide). Sans texte : c'est une action. */}
          <div className="flex items-center justify-center pb-2">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              aria-label="Créer"
              className={`-mt-5 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-background active:scale-95 transition-colors ${createOpen ? 'bg-emerald-700' : 'bg-emerald-600'}`}
            >
              <Plus className="h-7 w-7" />
            </button>
          </div>

          {RIGHT.map((it) => <Tab key={it.href} item={it} pathname={pathname} actionsCount={actionsCount} />)}
        </div>
      </nav>

      {/* Bottom sheet « Créer » — Réunion · Nouvelle visite. Chaque lanceur porte
          ensuite son flux (visite : chantier → intention → mode de démarrage). */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[1px]"
          onClick={() => setCreateOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-t-2xl border-t bg-card p-4 pb-6 shadow-xl safe-bottom"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Créer"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Créer</h2>
              <button type="button" onClick={() => setCreateOpen(false)} aria-label="Fermer" className="rounded-lg p-1 text-muted-foreground active:bg-accent">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <VisitLauncherHome />
              <MeetingLauncher />
              <InterventionLauncher />
            </div>
          </div>
        </div>
      )}
    </>
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
