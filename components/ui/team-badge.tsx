// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
// Phase 10 — Slice : support des couleurs hex (les seeds NC stockent du hex,
// pas des noms tailwind). On garde la whitelist nommée pour la compat ancienne
// + on accepte tout #rrggbb via styles inline (sûr : pas d'injection de classe).
//
// Doctrine V2 :
//   L'équipe est un CONTENEUR LOGISTIQUE — couleur jamais sémantique
//   (pas "vert = perf"), juste un repère visuel utilisateur.
//   Le composant n'expose JAMAIS de métrique d'équipe.

import { cn } from '@/lib/utils'

export interface TeamBadgeProps {
  name: string
  /** Soit une clé nommée (sky/emerald/amber/violet/rose/slate), soit un hex `#rrggbb`. */
  color?: string | null
  size?: 'sm' | 'md'
  className?: string
}

// Mapping safe — 5 couleurs nommées + slate (fallback neutre).
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

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

/** Mix un hex avec du blanc à `ratio` (0=blanc, 1=couleur). Renvoie rgb(). */
function mixWithWhite(hex: string, ratio: number): string {
  const clean = hex.replace(/^#/, '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c * ratio + 255 * (1 - ratio))
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

/** Mix un hex avec du noir (assombrit pour contraste texte sur fond pâle). */
function darken(hex: string, ratio: number): string {
  const clean = hex.replace(/^#/, '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const f = (c: number) => Math.round(c * ratio)
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`
}

export function TeamBadge({ name, color, size = 'sm', className }: TeamBadgeProps) {
  const raw = color ?? ''
  const isHex = HEX_RE.test(raw)
  const namedClass = !isHex ? COLOR_CLASSES[raw] : undefined
  const usesFallback = !isHex && !namedClass

  const inlineStyle =
    isHex
      ? {
          backgroundColor: mixWithWhite(raw, 0.12), // fond très pâle
          borderColor: mixWithWhite(raw, 0.35),
          color: darken(raw, 0.55),
        }
      : undefined

  return (
    <span
      data-slot="team-badge"
      data-team-color={isHex ? raw : (color ?? 'slate')}
      style={inlineStyle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        namedClass ?? (usesFallback ? COLOR_CLASSES.slate : undefined),
        className,
      )}
    >
      {isHex && (
        <span
          className={cn('inline-block rounded-full', size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2')}
          style={{ backgroundColor: raw }}
          aria-hidden
        />
      )}
      {name}
    </span>
  )
}
