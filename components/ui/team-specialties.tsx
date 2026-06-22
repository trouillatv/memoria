'use client'

// Sprint Équipes B (Vincent 2026-05-21, migration 078) — Spécialités d'équipe.
//
// Whitelist applicative + composant d'édition (multi-tag, max 12).
//
// Doctrine V2 : les spécialités sont DÉCLARÉES par le manager. Elles ne sont
// JAMAIS inférées, calculées, ou utilisées pour comparer 2 équipes ("équipe A
// meilleure en bio-nettoyage que B"). Servent uniquement au matcher AO.

import { cn } from '@/lib/utils'
// Source unique server-safe (le code serveur valide via cette constante).
import { TEAM_SPECIALTY_MAX } from './team-meta'

export const TEAM_SPECIALTIES = {
  'bio-nettoyage':   { label: 'Bio-nettoyage', short: 'Bio' },
  'vitrerie':        { label: 'Vitrerie', short: 'Vitres' },
  'vitres-hauteur':  { label: 'Vitres en hauteur', short: 'Hauteur' },
  'espaces-verts':   { label: 'Espaces verts', short: 'Verts' },
  'desinfection':    { label: 'Désinfection', short: 'Désinf.' },
  'bureaux':         { label: 'Bureaux', short: 'Bureaux' },
  'hospitalier':     { label: 'Hospitalier', short: 'Hôpital' },
  'industriel':      { label: 'Industriel', short: 'Indus.' },
  'residentiel':     { label: 'Résidentiel', short: 'Résid.' },
  'ecoles':          { label: 'Écoles', short: 'Écoles' },
  'conciergerie':    { label: 'Conciergerie', short: 'Concierge' },
  'monobrosse':      { label: 'Monobrosse', short: 'Mono.' },
} as const

export type TeamSpecialtyKey = keyof typeof TEAM_SPECIALTIES

/** Ordre d'affichage dans le picker. */
export const TEAM_SPECIALTY_KEYS: TeamSpecialtyKey[] = [
  'bio-nettoyage', 'desinfection', 'hospitalier',
  'vitrerie', 'vitres-hauteur', 'monobrosse',
  'espaces-verts', 'bureaux', 'ecoles',
  'industriel', 'residentiel', 'conciergerie',
]

export { TEAM_SPECIALTY_MAX }

// ----------------------------------------------------------------------------
// Affichage badge readonly
// ----------------------------------------------------------------------------

interface SpecialtyBadgeProps {
  k: string
  size?: 'sm' | 'md'
  className?: string
  /** Libellé fourni par le catalogue métier de l'org ; sinon fallback whitelist. */
  label?: string
}

/** Petit badge en lecture seule (utilisé sur la fiche équipe). */
export function SpecialtyBadge({ k, size = 'sm', className, label }: SpecialtyBadgeProps) {
  const meta = (TEAM_SPECIALTIES as Record<string, { label: string; short: string }>)[k]
  const display = label ?? meta?.label
  if (!display) {
    // Tag hors catalogue/whitelist (legacy ou migration) — affiché brut.
    return (
      <span className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground',
        className,
      )}>{k}</span>
    )
  }
  return (
    <span
      data-slot="team-specialty"
      data-specialty={k}
      className={cn(
        'inline-flex items-center rounded-full border border-brand-200 bg-brand-50 text-brand-800 dark:bg-brand-950/30 dark:text-brand-200 dark:border-brand-900',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        className,
      )}
      title={display}
    >
      {display}
    </span>
  )
}

// ----------------------------------------------------------------------------
// Editor multi-tag
// ----------------------------------------------------------------------------

interface TeamSpecialtiesEditorProps {
  value: string[]
  onChange: (v: string[]) => void
  className?: string
  /** Options du catalogue métier de l'org ; sinon fallback whitelist (cleaning). */
  options?: { key: string; label: string }[]
}

export function TeamSpecialtiesEditor({
  value,
  onChange,
  className,
  options,
}: TeamSpecialtiesEditorProps) {
  const set = new Set(value)
  const opts =
    options ??
    TEAM_SPECIALTY_KEYS.map((k) => ({ key: k as string, label: TEAM_SPECIALTIES[k].label }))

  function toggle(k: string) {
    if (set.has(k)) {
      onChange(value.filter((v) => v !== k))
    } else {
      if (value.length >= TEAM_SPECIALTY_MAX) return
      onChange([...value, k])
    }
  }

  const remaining = TEAM_SPECIALTY_MAX - value.length

  return (
    <div className={cn('space-y-2', className)}>
      <div role="group" aria-label="Spécialités déclarées" className="flex flex-wrap gap-1.5">
        {opts.map((o) => {
          const active = set.has(o.key)
          const disabled = !active && value.length >= TEAM_SPECIALTY_MAX
          return (
            <button
              key={o.key}
              type="button"
              data-testid={`team-specialty-${o.key}`}
              onClick={() => !disabled && toggle(o.key)}
              disabled={disabled}
              className={cn(
                'px-2.5 h-7 rounded-full border text-xs transition-colors',
                active
                  ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-300/60 dark:bg-brand-950/30 dark:text-brand-200 dark:border-brand-700'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted/40',
                disabled && 'opacity-40 cursor-not-allowed',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {value.length === 0
          ? `Aucune spécialité — l'équipe peut tout faire (max ${TEAM_SPECIALTY_MAX}).`
          : `${value.length}/${TEAM_SPECIALTY_MAX} sélectionnées · ${remaining} disponible${remaining > 1 ? 's' : ''}`}
      </p>
    </div>
  )
}
