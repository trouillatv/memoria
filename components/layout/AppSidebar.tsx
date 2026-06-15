'use client'

// Client component depuis Phase 10 — la sidebar lit `usePathname()` directement
// au lieu de recevoir `pathname` en prop. Raison : le layout server est mis en
// cache pendant les navigations soft (App Router) et ne se re-render pas
// systématiquement — l'item actif restait sur l'ancienne page. `usePathname()`
// est branché sur le router client, il se met à jour à chaque transition.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { UserRole } from '@/types/db'
import { cn } from '@/lib/utils'
import { NAV, isActive } from './nav-items'
import { BrandLegalDialog } from './BrandLegalDialog'

export function AppSidebar({
  role,
  fullName,
  actionsCount = 0,
  actionsCritical = 0,
}: {
  role: UserRole
  fullName: string
  /** Compteur d'actions ouvertes (badge sur l'entrée Actions). */
  actionsCount?: number
  /** Actions critiques (≥ 14 j) → pastille rouge. */
  actionsCritical?: number
}) {
  const pathname = usePathname() ?? ''
  const visible = NAV.filter((n) => n.roles.includes(role))
  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r bg-card">
      <div className="flex h-16 items-center border-b px-4">
        <BrandLegalDialog />
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-4 space-y-1">
        {visible.map(({ href, label, icon: Icon, groupStart }) => {
          const active = isActive(pathname, href)
          const link = (
            <Link
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
              {href === '/actions' && actionsCount > 0 && (
                <span
                  className={cn(
                    'ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                    actionsCritical > 0
                      ? 'bg-red-100 text-red-700'
                      : 'bg-muted text-muted-foreground',
                  )}
                  title={
                    actionsCritical > 0
                      ? `${actionsCount} actions ouvertes · ${actionsCritical} critique${actionsCritical > 1 ? 's' : ''} (≥ 14 j)`
                      : `${actionsCount} actions ouvertes`
                  }
                >
                  {actionsCritical > 0 && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                  {actionsCount}
                </span>
              )}
            </Link>
          )
          if (!groupStart) return <div key={href}>{link}</div>
          return (
            <div key={href} className="pt-3 space-y-1">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {groupStart}
              </div>
              {link}
            </div>
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
