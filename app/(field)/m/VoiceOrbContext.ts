'use client'

import { createContext, useContext } from 'react'

/**
 * Ce que la feuille renvoie à l'orbe après avoir répondu. En session continue
 * l'orbe reste à l'écran plusieurs tours : elle doit pouvoir afficher le fil de
 * la conversation elle-même, sans que l'utilisateur ait à la fermer pour lire.
 * `answer` absent = rien à montrer dans l'orbe. C'est le cas d'une PROPOSITION :
 * elle se valide dans la feuille, avec sa carte et ses boutons ; en afficher le
 * texte seul laisserait croire que l'action est faite. Une clarification, elle,
 * se lit et se répond à la voix — elle passe donc bien par `answer`.
 */
export type VoiceTurnResult = { answer?: string }

export type OpenOrbOptions = {
  siteId: string
  siteName?: string
  /**
   * Envoi de la question au copilote. Renvoyer une promesse fait rester l'orbe
   * à l'écran, en état « réflexion », jusqu'à l'arrivée de la réponse.
   */
  onResult: (text: string) => void | Promise<void | VoiceTurnResult>
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
