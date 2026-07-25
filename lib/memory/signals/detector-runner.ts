import type { MemorySignalDetector } from './detector'
import type { MemorySignal } from './operational-contract'

export type SignalDetectorRegistration<TContext = unknown> = {
  detector: MemorySignalDetector<TContext>
  context: TContext
}

const severityRank: Record<MemorySignal['severity'], number> = {
  critical: 3,
  warning: 2,
  info: 1,
}

const importanceRank: Record<MemorySignal['importance'], number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
}

const urgencyRank: Record<MemorySignal['urgency'], number> = {
  now: 4,
  today: 3,
  week: 2,
  later: 1,
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

function compareSignals(left: MemorySignal, right: MemorySignal): number {
  return (
    severityRank[right.severity] - severityRank[left.severity] ||
    importanceRank[right.importance] - importanceRank[left.importance] ||
    urgencyRank[right.urgency] - urgencyRank[left.urgency] ||
    timestamp(right.detectedAt) - timestamp(left.detectedAt) ||
    left.dedupeKey.localeCompare(right.dedupeKey) ||
    left.id.localeCompare(right.id)
  )
}

function isBetterDuplicate(candidate: MemorySignal, current: MemorySignal): boolean {
  return (
    severityRank[candidate.severity] > severityRank[current.severity] ||
    (severityRank[candidate.severity] === severityRank[current.severity] &&
      (importanceRank[candidate.importance] > importanceRank[current.importance] ||
        (importanceRank[candidate.importance] === importanceRank[current.importance] &&
          timestamp(candidate.detectedAt) > timestamp(current.detectedAt))))
  )
}

/** Exécute des détecteurs déjà alimentés et projette leurs signaux sans les modifier. */
export function runSignalDetectors(
  registrations: readonly SignalDetectorRegistration<any>[],
  now?: string,
): MemorySignal[] {
  const uniqueSignals = new Map<string, MemorySignal>()

  for (const { detector, context } of registrations) {
    for (const signal of detector.detect(context, now)) {
      const existing = uniqueSignals.get(signal.dedupeKey)
      if (!existing || isBetterDuplicate(signal, existing)) {
        uniqueSignals.set(signal.dedupeKey, signal)
      }
    }
  }

  return [...uniqueSignals.values()].sort(compareSignals)
}
