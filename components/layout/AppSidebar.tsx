'use client'

// Client component depuis Phase 10 — la sidebar lit `usePathname()` directement
// au lieu de recevoir `pathname` en prop. Raison : le layout server est mis en
// cache pendant les navigations soft (App Router) et ne se re-render pas
// systématiquement — l'item actif restait sur l'ancienne page. `usePathname()`
// est branché sur le router client, il se met à jour à chaque transition.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FileText, ClipboardList, FileBarChart, BookOpen, ShieldAlert, FileCheck, Sparkles, FileSearch, Users, Calendar, CalendarCheck, MapPin, ListChecks } from 'lucide-react'
import type { UserRole } from '@/types/db'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
}

const NAV: NavItem[] = [
  { href: '/dashboard',  label: 'Tableau de bord',     icon: Sparkles,      roles: ['admin', 'manager'] },
  { href: '/aujourdhui', label: 'Interventions du jour', icon: ListChecks,  roles: ['admin', 'manager'] },
  { href: '/semaine',    label: 'Semaine',              icon: Calendar,      roles: ['admin', 'manager'] },
  { href: '/briefing',   label: 'Briefing du soir',     icon: CalendarCheck, roles: ['admin', 'manager'] },
  { href: '/missions',  label: 'Missions',         icon: ClipboardList, roles: ['admin', 'manager', 'chef_equipe'] },
  { href: '/equipes',   label: 'Équipes',           icon: Users,         roles: ['admin', 'manager'] },
  { href: '/preuves',   label: 'Dossier de preuves', icon: FileSearch,   roles: ['admin', 'manager'] },
  { href: '/tenders',   label: "Appels d'offres",  icon: FileText,      roles: ['admin', 'manager'] },
  { href: '/contracts', label: 'Contrats',          icon: FileCheck,     roles: ['admin', 'manager'] },
  { href: '/sites',     label: 'Sites',             icon: MapPin,        roles: ['admin', 'manager'] },
  { href: '/library',   label: 'Bibliothèque',     icon: BookOpen,      roles: ['admin', 'manager'] },
  { href: '/reports',   label: 'Rapports',         icon: FileBarChart,  roles: ['admin', 'manager'] },
  { href: '/admin',     label: 'Administration',   icon: ShieldAlert,   roles: ['admin'] },
]

function isActive(pathname: string, href: string): boolean {
  // Exact match, ou sous-route (`/contracts/abc` → highlight Contrats).
  return pathname === href || pathname.startsWith(href + '/')
}

export function AppSidebar({
  role,
  fullName,
}: {
  role: UserRole
  fullName: string
}) {
  const pathname = usePathname() ?? ''
  const visible = NAV.filter((n) => n.roles.includes(role))
  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r bg-card">
      <div className="flex h-16 items-center border-b px-4">
        <Link
          href={role === 'admin' || role === 'manager' ? '/dashboard' : '/missions'}
          className="flex items-center gap-2 font-semibold rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <LayoutDashboard className="h-5 w-5 text-brand-600" />
          <span>MemorIA</span>
        </Link>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {visible.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                active
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  active ? 'text-brand-600' : 'text-muted-foreground',
                )}
              />
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="border-t p-2">
        <Link
          href="/account"
          aria-current={isActive(pathname, '/account') ? 'page' : undefined}
          className={cn(
            'block rounded-md px-2 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
            isActive(pathname, '/account')
              ? 'bg-accent'
              : 'hover:bg-accent',
          )}
          title="Mon compte"
        >
          <div className="text-xs text-muted-foreground truncate">{fullName}</div>
          <div className="text-xs">{role}</div>
        </Link>
      </div>
    </aside>
  )
}
