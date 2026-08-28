'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Rail horizontal défilant qui garde la PILL ACTIVE visible (P0.5). Au montage et
 * à chaque changement d'onglet actif, l'élément `[aria-current="page"]` est centré
 * dans le rail — sinon, en sélectionnant une pill située à droite, le rail repart
 * à gauche au rendu et l'onglet actif sort de l'écran.
 *
 * Composant PARTAGÉ (mobile + desktop) : une seule logique, jamais dupliquée par
 * écran. Ne scrolle QUE son conteneur (jamais la page). Les enfants portent leurs
 * propres liens ; il suffit que la pill active ait `aria-current="page"`.
 */
export function ScrollActiveRail({
  children,
  className,
  ariaLabel,
  activeKey,
}: {
  children: ReactNode
  className?: string
  ariaLabel?: string
  /** Clé de l'onglet actif : recentre le rail quand elle change. */
  activeKey?: string
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const active = c.querySelector('[aria-current="page"]') as HTMLElement | null
    if (!active) return
    const left = active.offsetLeft - (c.clientWidth - active.clientWidth) / 2
    c.scrollTo({ left: Math.max(0, left), behavior: 'auto' })
  }, [activeKey])
  return (
    <nav ref={ref} aria-label={ariaLabel} className={className}>
      {children}
    </nav>
  )
}
