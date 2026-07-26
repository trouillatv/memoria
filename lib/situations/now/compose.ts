import type { MemorySignal } from '@/lib/memory/signals/operational-contract'
import { presentSituations } from '../presenter'
import { projectNowCards } from './project'

export function composeNowCardsFromSignals(signals: MemorySignal[]) {
  return projectNowCards(presentSituations(signals))
}
