'use client'

// Détecte le mode standalone (PWA installée sur l'écran d'accueil) et pose
// le cookie `pwa_standalone=1` lisible côté serveur pour le routing.

import { useEffect } from 'react'
import { COOKIE_PWA_STANDALONE } from '@/lib/navigation/pwa-mode'

export function PwaStandaloneDetector() {
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean }
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      nav.standalone === true

    if (isStandalone) {
      document.cookie = `${COOKIE_PWA_STANDALONE}=1; path=/; max-age=31536000; SameSite=Lax`
    } else {
      document.cookie = `${COOKIE_PWA_STANDALONE}=; path=/; max-age=0; SameSite=Lax`
    }
  }, [])

  return null
}
