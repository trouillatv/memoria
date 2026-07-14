'use client'

// L'EN-TÊTE DE L'ESPACE PLANNING — il survit au changement d'échelle.
//
// Il vit dans la mise en page du groupe, donc il n'est pas re-rendu quand on
// passe du mois à la semaine : le conducteur ne change pas d'écran, il change de
// zoom. C'est toute la différence entre un agenda et un menu.
//
// L'échelle active se lit dans l'URL — pas d'état à synchroniser, pas de dérive
// possible entre deux onglets.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarRange, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const SCALES = [
  { label: 'Mois', href: '/mois' },
  { label: 'Semaine', href: '/semaine' },
  { label: 'Jour', href: '/aujourdhui' },
] as const

/** Ce qui fabrique le planning — on y va rarement, on n'y vit pas. */
const SETTINGS = [
  { label: 'Planning habituel', href: '/roulements', detail: 'Le rythme normal des équipes.' },
  { label: 'Jours fermés', href: '/calendrier', detail: 'Fermetures, fériés, vacances scolaires.' },
] as const

export function PlanningSpaceHeader() {
  const pathname = usePathname() ?? ''

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="inline-flex items-center gap-2 text-xl font-semibold leading-none">
          <CalendarRange className="h-5 w-5 text-muted-foreground" />
          Planning
        </h1>

        <nav aria-label="Échelle de temps" className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
          {SCALES.map((scale) => {
            const active = pathname === scale.href
            return (
              <Link
                key={scale.href}
                href={scale.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-1 transition-colors',
                  active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {scale.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="group relative">
        <button
          type="button"
          aria-haspopup="menu"
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings className="h-4 w-4" /> Configurer
        </button>
        {/* Ouvert au survol ET au focus : le clavier et le doigt doivent y accéder. */}
        <div className="invisible absolute right-0 z-20 mt-1 w-64 rounded-xl border bg-popover p-1.5 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
          {SETTINGS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-2.5 py-2 text-sm hover:bg-muted"
            >
              <span className="block font-medium">{item.label}</span>
              <span className="block text-xs text-muted-foreground">{item.detail}</span>
            </Link>
          ))}
        </div>
      </div>
    </header>
  )
}
