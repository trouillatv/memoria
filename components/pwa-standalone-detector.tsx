'use client'

// Détecte le mode standalone (PWA installée sur l'écran d'accueil) et pose un
// cookie `pwa_standalone=1` lisible côté serveur. Cela permet au routing
// post-connexion de rediriger vers /m sans attendre la préférence utilisateur.
//
// Cas du premier lancement (cookie absent) : le routing serveur a déjà atterri
// ailleurs (ex. /dashboard). Ce composant détecte standalone, pose le cookie,
// puis redirige immédiatement vers /m via window.location.replace (rechargement
// complet — le middleware vérifiera l'auth).
//
// Pages d'auth exclues : on ne redirige pas depuis /login ou /change-password
// pour éviter une boucle avec le middleware.

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const AUTH_PATHS = ['/login', '/change-password', '/forgot-password', '/accept-invite']

export function PwaStandaloneDetector() {
  const pathname = usePathname()

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean }
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      nav.standalone === true

    if (isStandalone) {
      document.cookie = 'pwa_standalone=1; path=/; max-age=31536000; SameSite=Lax'

      const isAuthPage = AUTH_PATHS.some((p) => pathname.startsWith(p))
      const isAlreadyMobile = pathname.startsWith('/m')

      if (!isAlreadyMobile && !isAuthPage) {
        // Premier lancement : le cookie vient d'être posé, rediriger vers /m.
        // On utilise window.location.replace pour forcer un rechargement complet
        // (le middleware et le cookie seront relus ensemble).
        window.location.replace('/m')
      }
    } else {
      // Navigateur classique : retirer le cookie pour ne pas biaiser le routing
      // lors d'un accès desktop depuis un compte qui a déjà ouvert la PWA.
      document.cookie = 'pwa_standalone=; path=/; max-age=0; SameSite=Lax'
    }
  // pathname intentionnellement exclu des dépendances : l'effet ne doit
  // s'exécuter qu'au montage initial, pas à chaque navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
