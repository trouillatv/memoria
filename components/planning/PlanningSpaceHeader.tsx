'use client'

// L'EN-TÊTE DE L'ESPACE PLANNING — il survit au changement d'échelle.
//
// Il vit dans la mise en page du groupe, donc il n'est pas re-rendu quand on
// passe du mois à la semaine : le conducteur ne change pas d'écran, il change de
// zoom. C'est toute la différence entre un agenda et un menu.
//
// R3 — CONTINUITÉ : changer d'échelle ne repart JAMAIS à zéro. On lit la période
// courante dans l'URL (mois `m`, semaine `week` ou jour `date`), on en tire une
// date-repère, et on construit les trois liens pour qu'ils retombent sur la MÊME
// période — plus le mode de lecture (`view` = par chantier / par équipe). On zoome
// sur la même réalité, on ne réinitialise pas le contexte.

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { CalendarRange, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Petites conversions de dates, PURES (UTC) — pas d'appel réseau, pas de
//    « aujourd'hui » : les liens ne dépendent que de l'URL, donc pas de
//    divergence entre le rendu serveur et le client. ─────────────────────────

/** Le paramètre de semaine ISO (YYYY-Www) d'une date. */
function isoWeekParamOf(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`)
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const year = d.getUTCFullYear()
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Le lundi (YYYY-MM-DD) d'une semaine ISO (YYYY-Www). */
function mondayOfIsoWeek(param: string): string | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(param)
  if (!m) return null
  const year = Number(m[1])
  const week = Number(m[2])
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay()
  const week1Monday = jan4.getTime() - (jan4Dow - 1) * 86_400_000
  return new Date(week1Monday + (week - 1) * 7 * 86_400_000).toISOString().slice(0, 10)
}

/** La date-repère de la période affichée, quelle que soit l'échelle. `null` si
 *  l'URL ne la précise pas encore (première arrivée) — on retombe alors sur des
 *  liens neutres, sans rien casser. */
function focusDateFromUrl(pathname: string, get: (k: string) => string | null): string | null {
  if (pathname.startsWith('/mois')) {
    const m = get('m')
    // Le MILIEU du mois (le 15) : sa semaine tombe toujours DANS le mois, donc
    // Mois → Semaine → Mois ne dérive pas vers le mois voisin au bord.
    return /^\d{4}-\d{2}$/.test(m ?? '') ? `${m}-15` : null
  }
  if (pathname.startsWith('/semaine')) {
    const w = get('week')
    return w ? mondayOfIsoWeek(w) : null
  }
  if (pathname.startsWith('/aujourdhui')) {
    const d = get('date')
    return /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') ? d : null
  }
  return null
}

function buildHref(base: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

/** Ce qui fabrique le planning — on y va rarement, on n'y vit pas. */
const SETTINGS = [
  { label: 'Planning habituel', href: '/roulements', detail: 'Le rythme normal des équipes.' },
  { label: 'Jours fermés', href: '/calendrier', detail: 'Fermetures, fériés, vacances scolaires.' },
] as const

export function PlanningSpaceHeader() {
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const get = (k: string) => searchParams?.get(k) ?? null

  const focus = focusDateFromUrl(pathname, get)
  // Le mode de lecture suit le zoom (le Jour n'a pas d'axe équipe : c'est un flux).
  const view = get('view') === 'team' ? 'team' : undefined

  const scales = [
    { label: 'Mois', base: '/mois', href: buildHref('/mois', { m: focus?.slice(0, 7), view }) },
    { label: 'Semaine', base: '/semaine', href: buildHref('/semaine', { week: focus ? isoWeekParamOf(focus) : undefined, view }) },
    { label: 'Jour', base: '/aujourdhui', href: buildHref('/aujourdhui', { date: focus ?? undefined }) },
  ] as const

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="inline-flex items-center gap-2 text-xl font-semibold leading-none">
          <CalendarRange className="h-5 w-5 text-muted-foreground" />
          Planning
        </h1>

        <nav aria-label="Échelle de temps" className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
          {scales.map((scale) => {
            const active = pathname === scale.base || pathname.startsWith(scale.base + '/')
            return (
              <Link
                key={scale.base}
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
