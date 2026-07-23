'use client'

import { useState } from 'react'

function logoInitials(label: string): string {
  const parts = label.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return label.slice(0, 2).toUpperCase()
}

const SIZE_MAP: Record<string, string> = {
  xs: 'h-4 w-4 text-[6px]',
  sm: 'h-5 w-5 text-[7px]',
  md: 'h-6 w-6 text-[8px]',
  lg: 'h-8 w-8 text-[10px]',
}

const VARIANT_MAP: Record<string, string> = {
  square:  'rounded-none',
  rounded: 'rounded-sm',
  circle:  'rounded-full',
}

/**
 * Composant présentation unifié pour logos d'entité (organisation, client…).
 * - logo valide : <img> avec onError → fallback initiales
 * - absence ou erreur : carré/rond coloré + initiales
 * Réutilisé par OrgBadgeRich ; prévu pour les fiches client (Lot B).
 */
export function EntityLogo({
  src,
  label,
  size = 'sm',
  variant = 'rounded',
  fallbackColor,
  alt = '',
}: {
  /** URL signée ou null. */
  src: string | null
  /** Nom de l'entité — sert de fallback initiales et d'alt par défaut. */
  label: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** square = org-like ■ ; circle = avatar ● ; rounded = intermédiaire. */
  variant?: 'square' | 'rounded' | 'circle'
  /** Couleur du fallback. Défaut : gris neutre #6b7280. */
  fallbackColor?: string | null
  /** Vide → decoratif (aria-hidden). Fourni → texte alt pour lecteurs d'écran. */
  alt?: string
}) {
  const [imgError, setImgError] = useState(false)
  const cls = `${SIZE_MAP[size]} ${VARIANT_MAP[variant]} shrink-0`

  if (src && !imgError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        aria-hidden={alt ? undefined : true}
        className={`${cls} object-contain`}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <span
      className={`${cls} inline-flex items-center justify-center font-bold text-white`}
      style={{ backgroundColor: fallbackColor ?? '#6b7280' }}
      aria-hidden={alt ? undefined : true}
    >
      {logoInitials(label)}
    </span>
  )
}
