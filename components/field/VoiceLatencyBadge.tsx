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

const FLAG_KEY = 'memoria:voice-debug'

/**
 * Résolu une seule fois par chargement de page, puis mémorisé : le drapeau ne
 * change pas en cours de session, et `getSnapshot` doit rester stable.
 *
 * Le paramètre d'URL est recopié dans le stockage : en recette on ouvre l'app
 * une fois avec `?voicedebug=1`, puis on navigue normalement sans le traîner
 * dans chaque URL. `?voicedebug=0` referme.
 */
let flag: boolean | null = null
function voiceDebugEnabled(): boolean {
  if (flag !== null) return flag
  flag = false
  try {
    const param = new URLSearchParams(window.location.search).get('voicedebug')
    if (param === '1') window.localStorage.setItem(FLAG_KEY, '1')
    if (param === '0') window.localStorage.removeItem(FLAG_KEY)
    flag = window.localStorage.getItem(FLAG_KEY) === '1'
  } catch { /* stockage indisponible */ }
  return flag
}

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
