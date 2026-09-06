'use client'

// Client component depuis Phase 10 — la sidebar lit `usePathname()` directement
// au lieu de recevoir `pathname` en prop. Raison : le layout server est mis en
// cache pendant les navigations soft (App Router) et ne se re-render pas
// systématiquement — l'item actif restait sur l'ancienne page. `usePathname()`
// est branché sur le router client, il se met à jour à chaque transition.
//
// NAV LOT 1 (2026-09-06) — le premier niveau raconte le produit en six lignes
// (Recherche · Aujourd'hui · Chantiers · Actions · Planning · Mémoire) ; la
// profondeur fonctionnelle vit derrière « Plus » (Activité, Organisation) et
// dans le hub Mémoire. Le « mode simplifié » historique est retiré : il
// compensait une nav à 19 entrées qui n'existe plus.

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react'
import type { UserRole } from '@/types/db'
import type { OrgMeta } from '@/lib/db/organisations'
import { cn } from '@/lib/utils'
import { NAV_PRIMARY, NAV_PLUS, NAV_FOOTER, isActive, type NavItem } from './nav-items'
import { BrandLegalDialog } from './BrandLegalDialog'
import { OrgBadgeRich } from '@/components/dashboard/OrgBadge'

export function AppSidebar({
  role,
  fullName,
  actionsCount = 0,
  actionsCritical = 0,
  orgs,
  showIntervenants = false,
}: {
  role: UserRole
  fullName: string
  /** Compteur d'actions ouvertes (badge sur l'entrée Actions). */
  actionsCount?: number
  /** Actions critiques (≥ 14 j) → pastille rouge. */
  actionsCritical?: number
  /** M4a — métadonnées de branding des orgs de l'utilisateur. Absent en mono-org. */
  orgs?: OrgMeta[]
  /** Feature gate serveur INTERVENANTS_PAGE_ENABLED — quand OFF, l'entrée Acteurs
   *  est MASQUÉE (l'ancienne nav montrait un lien menant à un 404). */
  showIntervenants?: boolean
}) {
  const pathname = usePathname() ?? ''

  const allowed = (n: NavItem) =>
    n.roles.includes(role) && (n.envGate !== 'intervenants' || showIntervenants)

  const plusGroups = NAV_PLUS
    .map((g) => ({ ...g, items: g.items.filter(allowed) }))
    .filter((g) => g.items.length > 0)
  const plusHasActive = plusGroups.some((g) => g.items.some((it) => isActive(pathname, it.href)))
  // « Plus » s'ouvre tout seul quand la page courante vit dedans — jamais de
  // page active invisible dans le menu.
  const [plusOpen, setPlusOpen] = useState(false)
  const plusExpanded = plusOpen || plusHasActive

  function renderItem({ href, label, icon: Icon }: NavItem, compact = false) {
    const active = isActive(pathname, href)
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          compact && 'py-1.5',
          active
            ? 'bg-accent text-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-brand-600' : 'text-muted-foreground')} />
        {label}
        {href === '/actions' && actionsCount > 0 && (
          <span
            className={cn(
              'ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
              actionsCritical > 0 ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground',
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
  }

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r bg-card">
      <div className="flex h-16 items-center border-b px-4">
        <BrandLegalDialog />
      </div>
      {orgs && orgs.length > 1 && (
        <div className="border-b px-4 py-2.5 bg-muted/20">
          <p className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            Espace multi-organisation
          </p>
          <div className="flex flex-col gap-1">
            {[...orgs].sort((a, b) => a.label.localeCompare(b.label, 'fr')).slice(0, 3).map((o) => (
              <OrgBadgeRich key={o.id} meta={o} size="md" />
            ))}
            {orgs.length > 3 && (
              <p className="text-[9px] text-muted-foreground/60 pl-1">
                + {orgs.length - 3} autre{orgs.length - 3 > 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      )}
      <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-4 space-y-1">
        {NAV_PRIMARY.filter(allowed).map((it) => renderItem(it))}

        {plusGroups.length > 0 && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setPlusOpen((v) => !v)}
              aria-expanded={plusExpanded}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4 shrink-0" />
              Plus
              {plusExpanded
                ? <ChevronDown className="ml-auto h-3.5 w-3.5" />
                : <ChevronRight className="ml-auto h-3.5 w-3.5" />}
            </button>
            {plusExpanded && (
              <div className="space-y-1 pb-1">
                {plusGroups.map((g) => (
                  <div key={g.title} className="pt-1">
                    <div className="px-3 pb-1 pl-9 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                      {g.title}
                    </div>
                    <div className="space-y-0.5 pl-4">
                      {g.items.map((it) => renderItem(it, true))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {NAV_FOOTER.filter(allowed).map((it) => {
          const link = renderItem(it)
          if (!it.groupStart) return <div key={it.href}>{link}</div>
          return (
            <div key={it.href} className="pt-3 space-y-1">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {it.groupStart}
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
            isActive(pathname, '/account') ? 'bg-accent' : 'hover:bg-accent',
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
