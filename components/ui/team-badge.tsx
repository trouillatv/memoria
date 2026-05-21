// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
// Phase 10 — support hex (seeds NC stockent du hex, pas des noms tailwind).
// Sprint Équipes (Vincent 2026-05-21) — Migration 077 :
//   - Identité étendue : `icon` (pictogramme lucide) à côté du nom
//   - Mode contrasté `mono` : initiales + icône, sans couleur (impression N&B,
//     daltoniens, ou densité visuelle critique)
//
// Doctrine V2 inchangée :
//   L'équipe est un CONTENEUR LOGISTIQUE — couleur/icône jamais sémantiques.
//   Le composant n'expose JAMAIS de métrique d'équipe.

import { cn } from '@/lib/utils'
import { TEAM_ICONS, type TeamIconName } from './team-icon-picker'

export interface TeamBadgeProps {
  name: string
  /** Soit une clé nommée (sky/emerald/amber/violet/rose/slate), soit un hex `#rrggbb`. */
  color?: string | null
  /** Pictogramme lucide en kebab-case (cf. TEAM_ICONS). Optionnel. */
  icon?: string | null
  size?: 'sm' | 'md'
  /**
   * Variantes visuelles :
   *  - `colored` (défaut) : couleur de fond pâle + texte sombre + icône
   *  - `mono`             : pas de couleur, juste l'icône + le nom — pour impression
   *                         N&B, daltoniens, ou cellule très dense
   *  - `dot`              : icône absente, juste un point coloré devant — pour
   *                         contextes ultra-compacts (cellules de semaine)
   */
  variant?: 'colored' | 'mono' | 'dot'
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

/** Convertit un nom nommé en hex équivalent pour le mode `dot`/`mono`. */
const NAMED_HEX: Record<string, string> = {
  sky:     '#0EA5E9',
  emerald: '#10B981',
  amber:   '#F59E0B',
  violet:  '#8B5CF6',
  rose:    '#F43F5E',
  slate:   '#64748B',
}

export function TeamBadge({
  name,
  color,
  icon,
  size = 'sm',
  variant = 'colored',
  className,
}: TeamBadgeProps) {
  const raw = color ?? ''
  const isHex = HEX_RE.test(raw)
  const namedClass = !isHex ? COLOR_CLASSES[raw] : undefined
  const usesFallback = !isHex && !namedClass
  const hexForDot = isHex ? raw : NAMED_HEX[raw] ?? '#64748B'

  // Icône résolue (si fournie ET dans la whitelist)
  const IconCmp = icon && (TEAM_ICONS as Record<string, unknown>)[icon as TeamIconName]
    ? TEAM_ICONS[icon as TeamIconName]
    : null
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'

  // ─── Variante mono (sans couleur) ─────────────────────────────────────────
  if (variant === 'mono') {
    return (
      <span
        data-slot="team-badge"
        data-team-color={isHex ? raw : (color ?? 'slate')}
        data-team-variant="mono"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-border bg-background font-medium whitespace-nowrap text-foreground',
          size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
          className,
        )}
      >
        {IconCmp && <IconCmp className={iconSize} aria-hidden />}
        {name}
      </span>
    )
  }

  // ─── Variante dot (point seul + nom) ──────────────────────────────────────
  if (variant === 'dot') {
    return (
      <span
        data-slot="team-badge"
        data-team-color={isHex ? raw : (color ?? 'slate')}
        data-team-variant="dot"
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap text-foreground',
          size === 'sm' ? 'text-[10px]' : 'text-xs',
          className,
        )}
      >
        <span
          className={cn('inline-block rounded-full', size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2')}
          style={{ backgroundColor: hexForDot }}
          aria-hidden
        />
        {IconCmp && <IconCmp className={iconSize} aria-hidden />}
        {name}
      </span>
    )
  }

  // ─── Variante colored (défaut) ────────────────────────────────────────────
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
      data-team-variant="colored"
      style={inlineStyle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        namedClass ?? (usesFallback ? COLOR_CLASSES.slate : undefined),
        className,
      )}
    >
      {IconCmp ? (
        <IconCmp className={iconSize} aria-hidden />
      ) : (
        isHex && (
          <span
            className={cn('inline-block rounded-full', size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2')}
            style={{ backgroundColor: raw }}
            aria-hidden
          />
        )
      )}
      {name}
    </span>
  )
}
