'use client'

import { useRouter } from 'next/navigation'
import { COOKIE_PWA_DESKTOP_UNTIL, makePwaDesktopUntilValue } from '@/lib/navigation/pwa-mode'

/**
 * Échappatoire bureau depuis la PWA terrain. Pose un cookie temporaire
 * (15 min, glissant à chaque navigation) qui signale au routing serveur
 * d'envoyer vers /dashboard plutôt que /m. La préférence utilisateur
 * en base n'est PAS modifiée : ce choix est ponctuel, pas permanent.
 * La prochaine ouverture de la PWA après expiration revient sur /m.
 */
export function SwitchToDesktopLink() {
  const router = useRouter()

  function handleClick() {
    document.cookie = `${COOKIE_PWA_DESKTOP_UNTIL}=${makePwaDesktopUntilValue()}; path=/; SameSite=Lax`
    router.push('/dashboard')
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-xs text-muted-foreground hover:text-foreground"
    >
      Vue bureau
    </button>
  )
}
