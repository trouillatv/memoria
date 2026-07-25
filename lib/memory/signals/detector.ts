import type { MemorySignal } from './operational-contract'

export interface MemorySignalDetector<TContext> {
  id: string
  version: string
  detect(context: TContext, now?: string): MemorySignal[]
}
