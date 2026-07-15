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

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { CalendarRange, Settings, Repeat, CalendarOff, GraduationCap, Flag, ChevronRight } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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

/** Ce qui FABRIQUE le planning — jamais une façon de le lire. Trois entrées,
 *  UN moteur : calendrier scolaire et fériés produisent des fermetures
 *  consommées par le même moteur que celles des chantiers. On règle un
 *  roulement pendant plusieurs minutes : c'est un PANNEAU (R4), pas un menu
 *  de trois secondes.
 *
 *  Les FERMETURES n'ont pas d'entrée : une fermeture appartient au CHANTIER,
 *  pas au calendrier (Vincent, R4). Le panneau le dit, et renvoie aux fiches. */
const SETTINGS = [
  {
    label: 'Roulements',
    href: '/roulements',
    icon: Repeat,
    detail: 'Le rythme normal des équipes : semaines A/B, Travail/Repos et horaires.',
  },
  {
    label: 'Calendrier scolaire',
    href: '/calendrier#vacances-scolaires',
    icon: GraduationCap,
    detail: 'Périodes communes appliquées aux chantiers scolaires concernés.',
  },
  {
    label: 'Jours fériés',
    href: '/calendrier#jours-feries',
    icon: Flag,
    detail: 'Calendrier public utilisé par les chantiers concernés.',
  },
] as const

export function PlanningSpaceHeader() {
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const get = (k: string) => searchParams?.get(k) ?? null
  // Le panneau « Configuration du planning » — fermé par défaut.
  const [configOpen, setConfigOpen] = useState(false)

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

      {/* R4 — le PANNEAU remplace le menu au survol : on y reste parfois
          plusieurs minutes (régler un roulement n'est pas un geste de 3 s).
          Même enveloppe (Sheet) que le tiroir du planning : un seul langage. */}
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setConfigOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Settings className="h-4 w-4" /> Configurer le planning
      </button>
      <Sheet open={configOpen} onOpenChange={setConfigOpen}>
        <SheetContent side="right" className="p-0 sm:max-w-sm w-full overflow-y-auto">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="inline-flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" aria-hidden />
              Configuration du planning
            </SheetTitle>
            <SheetDescription>
              Ce qui fabrique le planning — jamais une façon de le lire.
            </SheetDescription>
          </SheetHeader>
          <nav aria-label="Configuration du planning" className="p-2">
            {SETTINGS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setConfigOpen(false)}
                className="flex items-start gap-3 rounded-xl px-3 py-3 hover:bg-muted"
              >
                <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{item.detail}</span>
                </span>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
              </Link>
            ))}
          </nav>
          {/* Une fermeture appartient au CHANTIER, pas au calendrier : elle se
              règle sur sa fiche. Le panneau le dit, il ne crée pas de doublon. */}
          <div className="mx-2 mb-3 rounded-xl border border-dashed px-3 py-3">
            <p className="inline-flex items-start gap-3 text-xs leading-snug text-muted-foreground">
              <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <span className="block text-sm font-medium text-foreground">Fermetures du chantier</span>
                Inventaire, fermeture annuelle, jour exceptionnel : elles se règlent sur la{' '}
                <Link
                  href="/sites"
                  onClick={() => setConfigOpen(false)}
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  fiche du chantier
                </Link>
                {' '}— jamais dans un second calendrier.
              </span>
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  )
}
