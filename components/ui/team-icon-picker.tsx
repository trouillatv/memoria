'use client'

// Sprint Équipes (Vincent 2026-05-21) — Sélecteur d'icône d'équipe.
//
// Whitelist d'icônes lucide-react pertinentes pour une entreprise de
// nettoyage (NC). Stockage en base : clé kebab-case (= `TeamIconName`).
//
// Doctrine V2 : l'icône est un repère visuel, jamais sémantique. Pas
// d'icône « rapide » vs « lente ». Pas d'icône « performance ».
//
// Ajout d'une icône :
//   1. Importer le composant lucide
//   2. L'ajouter à TEAM_ICONS avec une clé kebab-case
//   3. (Optionnel) Ajouter un label FR pour le tooltip dans TEAM_ICON_LABELS
//
// IMPORTANT : la migration 077 valide `[a-z0-9-]+` côté DB — toute clé
// hors de cette whitelist est acceptée par le CHECK mais ne s'affichera
// pas (TeamBadge ignore les icônes inconnues, voir fallback dot).

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  TEAM_ICONS,
  TEAM_ICON_KEYS,
  TEAM_ICON_LABELS,
  type TeamIconName,
} from './team-meta'

// Données d'icônes déplacées dans team-meta.ts (SERVER-SAFE) — voir le commentaire
// d'en-tête de ce fichier : un module 'use client' ne peut pas fournir ces valeurs
// au code serveur (action de validation + rendu de TeamBadge). On réexporte ici
// pour les importateurs CLIENT existants.
export { TEAM_ICONS, TEAM_ICON_KEYS, TEAM_ICON_LABELS }
export type { TeamIconName }

// ----------------------------------------------------------------------------
// Picker UI
// ----------------------------------------------------------------------------

interface TeamIconPickerProps {
  value: TeamIconName | null
  onChange: (v: TeamIconName | null) => void
  /** Permet d'inclure le bouton « Aucune ». Par défaut true. */
  allowNone?: boolean
  className?: string
}

export function TeamIconPicker({
  value,
  onChange,
  allowNone = true,
  className,
}: TeamIconPickerProps) {
  const [hover, setHover] = useState<TeamIconName | null>(null)

  return (
    <div className={cn('space-y-2', className)}>
      <div role="radiogroup" aria-label="Icône de l'équipe" className="flex flex-wrap gap-1.5">
        {allowNone && (
          <button
            type="button"
            role="radio"
            aria-checked={value === null}
            data-testid="team-icon-none"
            onClick={() => onChange(null)}
            className={cn(
              'h-9 px-2.5 rounded-md border text-xs text-muted-foreground transition-colors',
              value === null
                ? 'border-foreground bg-muted'
                : 'border-border hover:bg-muted/50',
            )}
          >
            Aucune
          </button>
        )}
        {TEAM_ICON_KEYS.map((k) => {
          const Icon = TEAM_ICONS[k]
          const active = value === k
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`team-icon-${k}`}
              onClick={() => onChange(k)}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover(null)}
              title={TEAM_ICON_LABELS[k]}
              className={cn(
                'h-9 w-9 rounded-md border flex items-center justify-center transition-all',
                active
                  ? 'border-foreground bg-muted ring-1 ring-foreground/20'
                  : 'border-border hover:border-foreground/40 hover:bg-muted/40',
              )}
              aria-label={TEAM_ICON_LABELS[k]}
            >
              <Icon className="h-4 w-4" />
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground h-4">
        {hover ? TEAM_ICON_LABELS[hover] : value ? TEAM_ICON_LABELS[value] : ' '}
      </p>
    </div>
  )
}
