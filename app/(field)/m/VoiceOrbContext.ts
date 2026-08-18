'use client'

import { createContext, useContext } from 'react'
import type { VoiceTurnPayload } from '@/lib/voice/copilot-stream-client'
import type { CopilotProposalKind } from '@/lib/visits/copilot-proposal'

export type { VoiceTurnPayload }

/**
 * Ce que la feuille renvoie à l'orbe après avoir répondu. En session continue
 * l'orbe reste à l'écran plusieurs tours : elle doit pouvoir afficher le fil de
 * la conversation elle-même, sans que l'utilisateur ait à la fermer pour lire.
 * `answer` absent = rien à montrer dans l'orbe. C'est le cas d'une PROPOSITION :
 * elle se valide dans la feuille, avec sa carte et ses boutons ; en afficher le
 * texte seul laisserait croire que l'action est faite. Une clarification, elle,
 * se lit et se répond à la voix — elle passe donc bien par `answer`.
 *
 * `proposalPending` signale ce même cas à l'orbe pour une seconde raison :
 * marquer une pause visuelle avant de rouvrir le micro, plutôt que de repartir
 * comme si rien ne s'était passé (Lot A propositions vocales, Vincent, 2026-08-18).
 */
export type VoiceTurnResult = { answer?: string; proposalPending?: boolean }

/**
 * Proposition en attente de décision humaine, affichée dans le bandeau sticky
 * de l'orbe. Modélisée en collection dès le Lot A même si le système ne
 * produit aujourd'hui qu'une proposition par tour : prépare P6-B sans le
 * brancher (Vincent, 2026-08-18).
 */
export type PendingProposal = {
  id: string
  kind: CopilotProposalKind
  kindLabel: string
  title: string
}

/**
 * Callbacks que l'orbe fournit au tour vocal. `onTranscript` est appelé une
 * fois par tour, que le texte vienne de Gemini Live (téléphone) ou du STT
 * serveur : la feuille ne sait pas qui a transcrit.
 */
export type VoiceTurnHandlers = {
  /**
   * Transcript arrivé du serveur. Renvoie `false` si l'orbe refuse le tour
   * (fermée entre-temps, transcription vide) : l'appelant doit alors abandonner
   * — la réponse est jetée, jamais affichée ni réutilisée au tour suivant.
   */
  onTranscript: (text: string) => boolean
}

export type OpenOrbOptions = {
  siteId: string
  siteName?: string
  /**
   * Un tour vocal complet. L'orbe fournit soit un transcript déjà normalisé
   * (Gemini Live a transcrit sur le téléphone), soit l'audio capturé (repli de
   * panne : le serveur transcrit et répond dans la même requête). La feuille
   * traite les deux formes identiquement — c'est la frontière STT unique.
   * La promesse fait rester l'orbe à l'écran, en état « réflexion », jusqu'à la
   * réponse. Doit LEVER si le tour échoue avant le transcript (l'orbe affiche
   * alors l'erreur de transcription).
   */
  onVoiceTurn: (turn: VoiceTurnPayload, handlers: VoiceTurnHandlers) => Promise<void | VoiceTurnResult>
}

export type VoiceOrbContextValue = {
  openOrb: (opts: OpenOrbOptions) => void
  /** File des propositions en attente — partagée entre l'orbe et la feuille. */
  pendingProposals: PendingProposal[]
  addPendingProposal: (proposal: PendingProposal) => void
  removePendingProposal: (id: string) => void
  /**
   * Bouton « Voir » du bandeau : ferme l'orbe (la feuille est déjà ouverte
   * dessous) puis délègue à la feuille active le scroll vers la carte —
   * l'orbe ne connaît pas le DOM de la feuille.
   */
  viewPendingProposal: (id: string) => void
  /** Appelé par la feuille active pour se faire connaître comme cible du scroll. */
  registerProposalViewHandler: (handler: ((id: string) => void) | null) => void
}

export const VoiceOrbContext = createContext<VoiceOrbContextValue>({
  openOrb: () => {},
  pendingProposals: [],
  addPendingProposal: () => {},
  removePendingProposal: () => {},
  viewPendingProposal: () => {},
  registerProposalViewHandler: () => {},
})

export function useVoiceOrb(): VoiceOrbContextValue {
  return useContext(VoiceOrbContext)
}
