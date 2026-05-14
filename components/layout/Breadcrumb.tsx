'use client'

// Client component depuis Phase 10 — usePathname() pour rester synchro pendant
// les soft navigations (le layout server-rendered ne se re-render pas).

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Home } from 'lucide-react'
import { useBreadcrumbLabels, useBreadcrumbPrefix } from './BreadcrumbProvider'

const LABELS: Record<string, string> = {
  dashboard: 'Tableau de bord',
  semaine: 'Semaine',
  briefing: 'Briefing du soir',
  missions: 'Missions',
  equipes: 'Équipes',
  preuves: 'Dossier de preuves',
  tenders: "Appels d'offres",
  contracts: 'Contrats',
  sites: 'Sites',
  preparation: 'Préparation',
  library: 'Bibliothèque',
  reports: 'Rapports',
  admin: 'Administration',
  monitoring: 'Monitoring',
  users: 'Utilisateurs',
  account: 'Mon compte',
  interventions: 'Interventions',
  new: 'Nouveau',
  edit: 'Édition',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Crumb {
  href: string
  label: string
}

function buildCrumbs(
  pathname: string,
  dynamicLabels: ReadonlyMap<string, string>,
): Crumb[] {
  const segments = pathname.split('/').filter(Boolean)
  const out: Crumb[] = []
  let accum = ''
  for (const seg of segments) {
    accum += '/' + seg
    if (UUID_RE.test(seg)) {
      // Si un label dynamique a été enregistré pour cet UUID, on l'affiche.
      const dyn = dynamicLabels.get(seg)
      if (dyn && dyn.trim().length > 0) {
        out.push({ href: accum, label: dyn })
      }
      continue
    }
    const label = LABELS[seg] ?? seg
    out.push({ href: accum, label })
  }
  return out
}

export function Breadcrumb() {
  const pathname = usePathname() ?? ''
  const dynamicLabels = useBreadcrumbLabels()
  const prefixCrumbs = useBreadcrumbPrefix()
  // Les crumbs de préfixe sont rendus AVANT ceux dérivés du pathname.
  // Permet aux routes plates (ex. /interventions/[id]) de remonter un
  // contexte parent (Contrats > Nom contrat) injecté côté page.
  const crumbs = [...prefixCrumbs, ...buildCrumbs(pathname, dynamicLabels)]
  if (crumbs.length === 0) return null

  // Toujours préfixer par un Accueil (icône maison) pour donner un chemin complet
  // même sur les pages de premier niveau (ex. /semaine → 🏠 › Semaine).
  const onHome = pathname === '/dashboard'
  const lastIdx = crumbs.length - 1

  return (
    <nav aria-label="Fil d'Ariane" className="min-w-0 flex-1">
      <ol className="flex items-center gap-1 text-xs text-muted-foreground/70 min-w-0">
        <li className="flex items-center shrink-0">
          {onHome ? (
            <span
              className="inline-flex items-center text-muted-foreground/60"
              aria-current="page"
            >
              <Home className="h-3 w-3" aria-hidden />
              <span className="sr-only">Accueil</span>
            </span>
          ) : (
            <Link
              href="/dashboard"
              className="inline-flex items-center text-muted-foreground/60 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:underline"
              title="Accueil"
            >
              <Home className="h-3 w-3" aria-hidden />
              <span className="sr-only">Accueil</span>
            </Link>
          )}
        </li>

        {crumbs.map((c, i) => {
          const isLast = i === lastIdx
          // Sur /dashboard, l'icône maison fait office de "Tableau de bord" — on
          // évite la redondance "🏠 › Tableau de bord".
          if (onHome) return null
          return (
            <li key={`${i}-${c.href}`} className="flex items-center gap-1 min-w-0">
              <ChevronRight
                className="h-3 w-3 shrink-0 text-muted-foreground/40"
                aria-hidden
              />
              {isLast ? (
                <span
                  className="truncate text-foreground/80"
                  aria-current="page"
                >
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="truncate hover:text-foreground transition-colors focus-visible:outline-none focus-visible:underline"
                >
                  {c.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
