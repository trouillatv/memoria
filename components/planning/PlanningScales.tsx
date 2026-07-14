// UN SEUL PLANNING, TROIS ÉCHELLES DE TEMPS.
//
// Le mois, la semaine et le jour ne sont pas trois écrans concurrents : ce sont
// trois façons de regarder le même planning. Le mois répond « qui travaille où,
// et où sont les trous » ; la semaine ouvre le détail et les gestes ; le jour
// exécute. On change d'échelle, jamais d'application.
//
// Le roulement, lui, ne figure pas ici : il FABRIQUE le planning, il n'est pas
// une façon de le lire. C'est un réglage, comme les horaires d'ouverture.
//
// Aucun calcul : de la navigation, rien d'autre.

import Link from 'next/link'
import { cn } from '@/lib/utils'

export type PlanningScale = 'mois' | 'semaine' | 'jour'

const SCALES: Array<{ key: PlanningScale; label: string; href: string }> = [
  { key: 'mois', label: 'Mois', href: '/mois' },
  { key: 'semaine', label: 'Semaine', href: '/semaine' },
  { key: 'jour', label: 'Jour', href: '/aujourdhui' },
]

export function PlanningScales({ active }: { active: PlanningScale }) {
  return (
    <nav aria-label="Échelle de temps" className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
      {SCALES.map((scale) => (
        <Link
          key={scale.key}
          href={scale.href}
          aria-current={active === scale.key ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1 transition-colors',
            active === scale.key
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {scale.label}
        </Link>
      ))}
    </nav>
  )
}
