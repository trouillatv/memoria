import type { MemorySignal } from '@/lib/memory/signals/operational-contract'
import type { AttentionCard } from './types'
import { presentSituations } from '../presenter'
import { projectAttentionCards } from './project'

export function composeAttentionCardsFromSignals(signals: MemorySignal[]): AttentionCard[] {
  return projectAttentionCards(presentSituations(signals))
}
