'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'

/**
 * Réapplique le thème PERSISTÉ de l'utilisateur (lu en base via le layout) au
 * chargement, pour que sa préférence le suive d'un appareil/navigateur à
 * l'autre — pas seulement via le localStorage de next-themes. Best-effort,
 * une fois (le layout n'est pas remonté entre navigations soft).
 *
 * Ne rend rien.
 */
export function ThemeSync({ theme }: { theme: string | null }) {
  const { setTheme } = useTheme()
  useEffect(() => {
    if (theme) setTheme(theme)
  }, [theme, setTheme])
  return null
}
