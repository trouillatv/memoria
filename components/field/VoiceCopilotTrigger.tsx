'use client'

import { Mic } from 'lucide-react'
import { primeSpeechOutput } from '@/lib/voice/speech-output'

interface Props {
  onOpenOrb: () => void
  disabled?: boolean
}

/**
 * Point d'entrée vocal du copilote : ouvre l'orbe, rien d'autre.
 *
 * Ce composant a longtemps porté un second pipeline d'enregistrement en ligne
 * (MediaRecorder + appel STT + minuterie, ~150 lignes) devenu inatteignable dès
 * que les deux appelants ont basculé sur l'orbe. Il a été retiré avec le lot
 * « expérience vocale » : la capture, la détection de fin de parole et l'envoi
 * vivent désormais dans `VoiceOrbOverlay`, sur une machine à états unique.
 *
 * Ce clic porte aussi le déverrouillage de la synthèse vocale : iOS n'autorise
 * `speechSynthesis` que si une première énonciation part d'un geste utilisateur,
 * et la réponse à prononcer n'existera que plusieurs secondes plus tard.
 */
export function VoiceCopilotTrigger({ onOpenOrb, disabled }: Props) {
  return (
    <button
      type="button"
      onClick={() => { primeSpeechOutput(); onOpenOrb() }}
      disabled={disabled}
      aria-label="Commande vocale"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-violet-300 dark:border-violet-700 text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-950/30 disabled:opacity-40 transition-colors"
    >
      <Mic className="h-4 w-4" />
    </button>
  )
}
