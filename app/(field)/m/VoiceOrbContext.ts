'use client'

import { createContext, useContext } from 'react'

export type OpenOrbOptions = {
  siteId: string
  siteName?: string
  /**
   * Envoi de la question au copilote. Renvoyer une promesse fait rester l'orbe
   * à l'écran, en état « réflexion », jusqu'à l'arrivée de la réponse.
   */
  onResult: (text: string) => void | Promise<void>
}

export type VoiceOrbContextValue = {
  openOrb: (opts: OpenOrbOptions) => void
}

export const VoiceOrbContext = createContext<VoiceOrbContextValue>({
  openOrb: () => {},
})

export function useVoiceOrb(): VoiceOrbContextValue {
  return useContext(VoiceOrbContext)
}
