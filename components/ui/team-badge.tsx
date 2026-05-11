// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
//
// Badge sobre pour identifier une équipe (couleur prédéfinie + nom).
// Réutilisé Slice 9.3+ (grille semaine).
//
// Doctrine V2 :
//   L'équipe est un CONTENEUR LOGISTIQUE — couleur jamais sémantique
//   (pas "vert = perf"), juste un repère visuel utilisateur.
//   Le composant n'expose JAMAIS de métrique d'équipe.

import { cn } from '@/lib/utils'

export interface TeamBadgeProps {
  name: string
  color?: string | null
  size?: 'sm' | 'md'
  className?: string
}

// Mapping safe — 5 couleurs prédéfinies + slate (fallback neutre).
// Strict whitelist : pas d'injection de classes Tailwind dynamiques.
const COLOR_CLASSES: Record<string, string> = {
  sky:     'bg-sky-50    border-sky-200    text-sky-800',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  amber:   'bg-amber-50  border-amber-200  text-amber-800',
  violet:  'bg-violet-50 border-violet-200 text-violet-800',
  rose:    'bg-rose-50   border-rose-200   text-rose-800',
  slate:   'bg-slate-50  border-slate-200  text-slate-700',
}

export const TEAM_BADGE_COLORS = ['sky', 'emerald', 'amber', 'violet', 'rose', 'slate'] as const
export type TeamBadgeColor = typeof TEAM_BADGE_COLORS[number]

export function TeamBadge({ name, color, size = 'sm', className }: TeamBadgeProps) {
  const klass = COLOR_CLASSES[color ?? ''] ?? COLOR_CLASSES.slate
  return (
    <span
      data-slot="team-badge"
      data-team-color={color ?? 'slate'}
      className={cn(
        'inline-flex items-center rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        klass,
        className,
      )}
    >
      {name}
    </span>
  )
}
