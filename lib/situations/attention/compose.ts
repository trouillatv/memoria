import type { MemorySignal } from '@/lib/memory/signals/operational-contract'
import type { AttentionCard } from './types'
import type { PriorityContext } from './priority-weights'
import { DEFAULT_PRIORITY_CONTEXT } from './priority-weights'
import { presentSituations } from '../presenter'
import { projectAttentionCards } from './project'

export function composeAttentionCardsFromSignals(
  signals: MemorySignal[],
  context: PriorityContext = DEFAULT_PRIORITY_CONTEXT,
): AttentionCard[] {
  return projectAttentionCards(presentSituations(signals), new Date(), context)
}
