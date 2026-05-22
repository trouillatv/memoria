// Collecteur — couche server-only.
//
// Pipeline : detect (lance les détecteurs) → flatten. PAS de classement ici
// (c'est la surface qui décide, cf. surface.ts). Chaque détecteur est isolé :
// s'il échoue, il rend [] sans casser les autres.

import 'server-only'
import type { MemorySignal } from './types'
import { detectHandoverAcknowledged } from './detectors/handover-acknowledged'
import { detectFreshFieldMemory } from './detectors/fresh-field-memory'
import { detectContinuityStable } from './detectors/continuity-stable'
import { detectMemoryAwaiting } from './detectors/memory-awaiting'
import { detectRelayInstability } from './detectors/relay-instability'
import { detectUnusualSilence } from './detectors/unusual-silence'

const DETECTORS: Array<() => Promise<MemorySignal[]>> = [
  // Santé d'abord (le moteur naît équilibré).
  detectHandoverAcknowledged,
  detectFreshFieldMemory,
  detectContinuityStable,
  // Fragilité.
  detectMemoryAwaiting,
  detectRelayInstability,
  detectUnusualSilence,
]

export async function collectMemorySignals(): Promise<MemorySignal[]> {
  const results = await Promise.all(
    DETECTORS.map((d) =>
      d().catch((e) => {
        console.error('[memory-signals] détecteur en échec:', e)
        return [] as MemorySignal[]
      }),
    ),
  )
  return results.flat()
}
