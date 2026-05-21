'use client'

// Sprint Équipes (Vincent 2026-05-21) — Color picker libre.
//
// Remplace les 6 chips préset par :
//   - 12 swatches sobres (anti-fluo, anti-rouge-pur — voir TEAM_COLOR_SWATCHES)
//   - Saisie hex libre avec validation #rrggbb (ou rrggbb)
//   - Aperçu live via TeamBadge
//
// Doctrine V2 : la couleur est un repère visuel. Pas de rouge=mauvais,
// vert=bon. Le picker n'impose donc pas de sémantique, mais évite les
// teintes neon (criardes en grille semaine) et les valeurs hors gamme.

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

export interface TeamColorSwatch {
  hex: string
  label: string
}

/** 12 swatches préset sobres. Aucune n'est saturée à 100% (anti-fluo). */
export const TEAM_COLOR_SWATCHES: TeamColorSwatch[] = [
  { hex: '#0EA5E9', label: 'Ciel' },
  { hex: '#06B6D4', label: 'Cyan' },
  { hex: '#14B8A6', label: 'Sarcelle' },
  { hex: '#10B981', label: 'Émeraude' },
  { hex: '#84CC16', label: 'Lime' },
  { hex: '#F59E0B', label: 'Ambre' },
  { hex: '#F97316', label: 'Orange' },
  { hex: '#EF4444', label: 'Vermillon' },
  { hex: '#F43F5E', label: 'Rose' },
  { hex: '#8B5CF6', label: 'Violet' },
  { hex: '#6366F1', label: 'Indigo' },
  { hex: '#64748B', label: 'Ardoise' },
]

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

/** Normalise une saisie utilisateur en `#rrggbb` lowercase, ou null si invalide. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!HEX_RE.test(trimmed)) return null
  return ('#' + trimmed.replace(/^#/, '')).toLowerCase()
}

interface TeamColorPickerProps {
  /** Couleur courante : nom historique (sky/emerald…) OU hex. `null` = aucune. */
  value: string | null
  onChange: (v: string | null) => void
  /** Permet d'inclure le bouton « Aucune ». Par défaut true. */
  allowNone?: boolean
  className?: string
}

export function TeamColorPicker({
  value,
  onChange,
  allowNone = true,
  className,
}: TeamColorPickerProps) {
  // Le champ texte affiche le hex courant si l'utilisateur a tapé un hex.
  // Sinon il est vide (couleurs nommées historiques restent sélectionnables
  // mais ne réapparaissent pas dans le picker swatch — c'est volontaire,
  // on pousse les utilisateurs vers le hex).
  const [hexInput, setHexInput] = useState(value && value.startsWith('#') ? value : '')
  const [hexError, setHexError] = useState<string | null>(null)

  useEffect(() => {
    if (value && value.startsWith('#')) setHexInput(value)
  }, [value])

  function commitHex(raw: string) {
    if (raw.trim().length === 0) {
      onChange(null)
      setHexError(null)
      return
    }
    const norm = normalizeHex(raw)
    if (!norm) {
      setHexError('Format attendu : #rrggbb')
      return
    }
    setHexError(null)
    onChange(norm)
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Swatches préset */}
      <div role="radiogroup" aria-label="Couleur de l'équipe" className="flex flex-wrap gap-1.5">
        {allowNone && (
          <button
            type="button"
            role="radio"
            aria-checked={value === null}
            data-testid="team-color-none"
            onClick={() => {
              onChange(null)
              setHexInput('')
              setHexError(null)
            }}
            className={cn(
              'h-7 px-2.5 rounded-full border text-xs text-muted-foreground transition-colors',
              value === null
                ? 'border-foreground bg-muted'
                : 'border-border hover:bg-muted/50',
            )}
          >
            Aucune
          </button>
        )}
        {TEAM_COLOR_SWATCHES.map((s) => {
          const active = value?.toLowerCase() === s.hex.toLowerCase()
          return (
            <button
              key={s.hex}
              type="button"
              role="radio"
              aria-checked={active}
              title={s.label}
              data-testid={`team-color-swatch-${s.hex.replace('#', '').toLowerCase()}`}
              onClick={() => {
                onChange(s.hex.toLowerCase())
                setHexInput(s.hex.toLowerCase())
                setHexError(null)
              }}
              className={cn(
                'h-7 w-7 rounded-full border transition-all',
                active
                  ? 'border-foreground ring-2 ring-foreground/20 ring-offset-1'
                  : 'border-border hover:scale-110',
              )}
              style={{ backgroundColor: s.hex }}
              aria-label={s.label}
            />
          )
        })}
      </div>

      {/* Hex libre */}
      <div className="flex items-center gap-2">
        <label htmlFor="team-color-hex" className="text-xs text-muted-foreground shrink-0">
          ou hex personnalisé
        </label>
        <input
          id="team-color-hex"
          type="text"
          data-testid="team-color-hex-input"
          placeholder="#0EA5E9"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitHex(hexInput)
            }
          }}
          maxLength={7}
          className={cn(
            'h-7 w-24 rounded-md border bg-background px-2 text-xs font-mono uppercase tracking-tight',
            hexError ? 'border-rose-500' : 'border-border',
          )}
        />
        {hexInput && !hexError && (
          <span
            className="inline-block h-5 w-5 rounded border border-border"
            style={{ backgroundColor: normalizeHex(hexInput) ?? 'transparent' }}
            aria-hidden
          />
        )}
        {hexError && (
          <span className="text-[11px] text-rose-600" role="alert">
            {hexError}
          </span>
        )}
      </div>
    </div>
  )
}
