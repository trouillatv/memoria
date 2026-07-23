'use client'

// Détecte le mode standalone (PWA installée sur l'écran d'accueil) et pose le
// cookie `pwa_standalone=1` lisible côté serveur.
//
// Cas du premier lancement sans cookie : le routing serveur a atterri ailleurs
// (ex. /dashboard pour un manager). Ce composant détecte standalone, pose le
// cookie, puis redirige immédiatement vers /m — SAUF si le cookie de mode bureau
// temporaire (`pwa_desktop_until`) est encore valide (l'utilisateur a explicitement
// demandé la vue bureau pour cette session).
//
// Pages d'auth exclues pour éviter une boucle avec le middleware.

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { COOKIE_PWA_STANDALONE, COOKIE_PWA_DESKTOP_UNTIL, isPwaDesktopActive } from '@/lib/navigation/pwa-mode'

const AUTH_PATHS = ['/login', '/change-password', '/forgot-password', '/accept-invite']

function readCookie(name: string): string | undefined {
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.split('=')[1]
}

export function PwaStandaloneDetector() {
  const pathname = usePathname()

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean }
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      nav.standalone === true

    if (isStandalone) {
      document.cookie = `${COOKIE_PWA_STANDALONE}=1; path=/; max-age=31536000; SameSite=Lax`

      const isAuthPage = AUTH_PATHS.some((p) => pathname.startsWith(p))
      const isAlreadyMobile = pathname.startsWith('/m')
      const desktopActive = isPwaDesktopActive(readCookie(COOKIE_PWA_DESKTOP_UNTIL))

      if (!isAlreadyMobile && !isAuthPage && !desktopActive) {
        // Premier lancement sans cookie (ou fenêtre bureau expirée) : revenir
        // sur /m. Rechargement complet pour que le middleware relise les cookies.
        window.location.replace('/m')
      }
    } else {
      // Navigateur classique : retirer le cookie pour ne pas biaiser le routing.
      document.cookie = `${COOKIE_PWA_STANDALONE}=; path=/; max-age=0; SameSite=Lax`
    }
  // Effet au montage uniquement — pas à chaque navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
