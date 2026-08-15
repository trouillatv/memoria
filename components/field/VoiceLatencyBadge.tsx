'use client'

// Affichage de la mesure de latence vocale — outil de recette terrain, invisible
// en usage normal.
//
// La mesure part dans `console.info`, mais une console n'est pas lisible sur un
// téléphone en chantier : sans cette ligne, l'instrument n'existerait que pour
// quelqu'un branché en débogage distant. Elle reste donc strictement fermée par
// défaut et ne s'ouvre que sur `?voicedebug=1` — même convention que les
// inspections existantes (`?v2=1`).

import { useSyncExternalStore } from 'react'
import {
  subscribeVoiceLatency,
  getVoiceLatencySnapshot,
  getServerVoiceLatencySnapshot,
  formatVoiceLatency,
} from '@/lib/voice/voice-latency'
// Drapeau partagé avec la trace multi-tours : une seule recette ouvre les deux
// instruments à la fois (cf. `lib/voice/voice-debug.ts`).
import { voiceDebugEnabled } from '@/lib/voice/voice-debug'

const NEVER_CHANGES = () => () => {}

export function VoiceLatencyBadge() {
  const enabled = useSyncExternalStore(NEVER_CHANGES, voiceDebugEnabled, () => false)
  const report = useSyncExternalStore(
    subscribeVoiceLatency,
    getVoiceLatencySnapshot,
    getServerVoiceLatencySnapshot,
  )

  if (!enabled) return null
  const line = formatVoiceLatency(report)
  if (!line) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-2 z-[70] flex justify-center px-3">
      <p className="rounded-full bg-black/70 px-3 py-1 font-mono text-[10px] leading-tight text-white/70">
        {line}
      </p>
    </div>
  )
}
