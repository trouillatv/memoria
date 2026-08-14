'use client'

// « Accueil terrain » — LA PORTE DE SORTIE de l'univers desktop (P0-1 Guillaume,
// 2026-08-14). Quand le PWA (WebAPK) se retrouve sur /dashboard — dernière URL
// restaurée par Android, lien externe, réglage Chrome « Version ordinateur » —
// l'utilisateur doit pouvoir revenir au parcours mobile SANS connaître /m.
//
// Deux signaux de visibilité, car ils couvrent deux pannes différentes :
//   - petit écran (CSS max-md) : dashboard affiché sur un téléphone « normal » ;
//   - display-mode: standalone (JS) : le PWA en « Version ordinateur », où la
//     largeur ment — c'est le mode d'affichage qui dit la vérité.
// Sur un vrai poste de travail (grand écran, pas standalone) : invisible.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'

export function FieldHomeEscape({ withLabel = false }: { withLabel?: boolean }) {
  const [standalone, setStandalone] = useState(false)
  useEffect(() => {
    setStandalone(window.matchMedia('(display-mode: standalone)').matches)
  }, [])

  return (
    <Link
      href="/m"
      title="Accueil terrain"
      aria-label="Accueil terrain"
      className={cn(
        'items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        standalone ? 'inline-flex' : 'hidden max-md:inline-flex',
      )}
    >
      <Smartphone className="h-4 w-4 shrink-0" />
      {withLabel && <span>Accueil terrain</span>}
    </Link>
  )
}
