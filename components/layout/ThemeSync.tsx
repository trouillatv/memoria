'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'

/**
 * Sème le thème PERSISTÉ de l'utilisateur (lu en base via le layout) sur un
 * appareil qui n'a pas encore de préférence locale — pour que sa préférence le
 * suive d'un appareil à l'autre au premier chargement.
 *
 * IMPORTANT — ne réapplique PAS la valeur DB si l'appareil a déjà une
 * préférence locale (localStorage `theme` de next-themes). Sinon, après un
 * changement de thème, une navigation entre layouts (ex. /account → /m)
 * réappliquerait la valeur DB pas encore committée (l'écriture est async) et
 * annulerait le choix que l'utilisateur vient de faire — race visible surtout
 * sur mobile, où il fallait alors rafraîchir manuellement. Le choix client le
 * plus récent fait foi sur l'appareil ; la DB ne sert qu'à l'amorçage.
 *
 * Ne rend rien.
 */
export function ThemeSync({ theme }: { theme: string | null }) {
  const { setTheme } = useTheme()
  useEffect(() => {
    if (!theme) return
    try {
      // Pas de préférence locale encore → on adopte celle de la base.
      if (!localStorage.getItem('theme')) setTheme(theme)
    } catch {
      // localStorage indisponible (mode privé strict…) : best-effort.
      setTheme(theme)
    }
  }, [theme, setTheme])
  return null
}
