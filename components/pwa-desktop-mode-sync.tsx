'use client'

// Synchronise le mode bureau temporaire de la PWA avec le routing.
//
// Monté dans les deux layouts authentifiés (field + dashboard) avec le userId
// et le contexte courant. Utilise window.matchMedia pour détecter le mode
// standalone directement, sans dépendre du cookie (disponible dès le premier
// lancement avant que PwaStandaloneDetector n'ait posé le cookie).
//
// Logique :
//   - context='field'     → si mode bureau actif → aller sur /dashboard
//   - context='dashboard' → si mode bureau actif → prolonger (fenêtre glissante)
//                           si mode bureau expiré → effacer + aller sur /m

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  readPwaDesktopPreference,
  isPwaDesktopPreferenceActive,
  writePwaDesktopPreference,
  clearPwaDesktopPreference,
} from '@/lib/navigation/pwa-mode'

export function PwaDesktopModeSync({
  userId,
  context,
}: {
  userId: string
  context: 'field' | 'dashboard'
}) {
  const router = useRouter()

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean }
    const isPwa =
      window.matchMedia('(display-mode: standalone)').matches ||
      nav.standalone === true

    if (!isPwa) return

    const pref = readPwaDesktopPreference(userId)
    const desktopActive = isPwaDesktopPreferenceActive(pref)

    if (context === 'field') {
      if (desktopActive) {
        router.replace('/dashboard')
      }
    } else {
      if (desktopActive) {
        writePwaDesktopPreference(userId)
      } else {
        clearPwaDesktopPreference(userId)
        router.replace('/m')
      }
    }
  // Effet au montage uniquement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
