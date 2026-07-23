'use client'

import { useRouter } from 'next/navigation'
import { writePwaDesktopPreference } from '@/lib/navigation/pwa-mode'

/**
 * Échappatoire bureau depuis la PWA terrain. Écrit la préférence temporaire
 * (15 min, glissante à chaque navigation dans le dashboard) dans localStorage,
 * liée au userId pour éviter qu'un utilisateur B hérite du choix de l'utilisateur A
 * sur un téléphone partagé. La préférence utilisateur en base n'est PAS modifiée.
 */
export function SwitchToDesktopLink({ userId }: { userId: string }) {
  const router = useRouter()

  function handleClick() {
    writePwaDesktopPreference(userId)
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
