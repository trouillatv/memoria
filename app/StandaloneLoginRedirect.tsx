'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Couche de compatibilité pour les WebAPK historiques (start_url='/').
 * Utilisateur non authentifié en mode standalone → login avec next=/m,
 * pour que la destination terrain soit préservée après l'authentification.
 * Rendu null : invisible, aucun flash.
 */
export function StandaloneLoginRedirect() {
  const router = useRouter()
  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      router.replace('/login?next=/m')
    }
  }, [router])
  return null
}
