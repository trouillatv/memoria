import type { MemorySignal } from './operational-contract'
import { createSignalDetectorRegistration, runSignalDetectors } from './detector-runner'
import { buildPromiseCandidates, type StructuredPromiseRecord } from './promise-candidates'
import {
  detectPromiseExpiredSignals,
  type PromiseDetectionContext,
} from './promise-detector'
import { detectPromiseNeedsConfirmationSignals } from './promise-follow-up-detector'
import type { MemorySignalDetector } from './detector'

const promiseExpiredDetector: MemorySignalDetector<PromiseDetectionContext> = {
  id: 'promise-expired',
  version: '1',
  detect: detectPromiseExpiredSignals,
}

const promiseNeedsConfirmationDetector: MemorySignalDetector<PromiseDetectionContext> = {
  id: 'promise-needs-confirmation',
  version: '1',
  detect: detectPromiseNeedsConfirmationSignals,
}

/**
 * Composition pure du pipeline promesses:
 * read model structure -> builder -> deux detecteurs -> runner.
 */
export function detectPromiseSignalsFromRecords(
  records: StructuredPromiseRecord[],
  now = new Date().toISOString(),
): MemorySignal[] {
  const context: PromiseDetectionContext = {
    promises: buildPromiseCandidates(records),
  }

  return runSignalDetectors(
    [
      createSignalDetectorRegistration(promiseExpiredDetector, context),
      createSignalDetectorRegistration(promiseNeedsConfirmationDetector, context),
    ],
    now,
  )
}
