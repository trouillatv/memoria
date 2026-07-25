import type { MemorySignal } from './operational-contract'
import type { PromiseCandidate, PromiseDetectionContext } from './promise-detector'

const FOLLOW_UP_AFTER_DAYS = 7

function timestamp(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function buildSignal(promise: PromiseCandidate, now: string, urgency: 'now' | 'today'): MemorySignal {
  return {
    id: `promise-follow-up:${promise.siteId}:${promise.id}`,
    organizationId: promise.organizationId,
    siteId: promise.siteId,
    category: 'promise',
    trigger: { type: 'promise', reason: 'promise_without_due_date' },
    severity: promise.blocking ? 'critical' : 'warning',
    importance: promise.importance,
    urgency,
    state: 'active',
    actionability: 'investigate',
    origin: 'rules',
    facts: [{
      type: 'promise',
      key: 'promise_text',
      value: promise.text,
      confidence: null,
      sourceIds: [promise.source.id, ...promise.confirmationSourceIds, ...promise.relatedProofSourceIds],
      detectedAt: now,
      occurredAt: promise.occurredAt,
      dueAt: null,
      validUntil: null,
    }],
    rules: [{ id: 'promise_needs_confirmation', version: '1' }],
    sources: [promise.source],
    actions: [
      { kind: 'investigate', label: 'Confirmer', href: promise.source.href },
      { kind: 'create_action', label: 'Créer une action', href: promise.source.href },
    ],
    confidence: null,
    dedupeKey: `promise-follow-up:${promise.siteId}:${promise.id}`,
    detectedAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
    resolvedBy: null,
  }
}

/** Suit une annonce ancienne sans échéance, sans la présenter comme échue. */
export function detectPromiseNeedsConfirmationSignals(
  context: PromiseDetectionContext,
  now = new Date().toISOString(),
): MemorySignal[] {
  const nowTimestamp = timestamp(now)
  if (nowTimestamp === null) return []

  return context.promises.flatMap((promise) => {
    if (
      promise.dueAt !== null ||
      promise.confirmedAt ||
      promise.replacedAt ||
      promise.cancelledAt ||
      promise.confirmationSourceIds.length > 0
    ) return []

    const occurredTimestamp = timestamp(promise.occurredAt)
    if (occurredTimestamp === null) return []
    const age = nowTimestamp - occurredTimestamp
    if (age < FOLLOW_UP_AFTER_DAYS * 24 * 60 * 60 * 1000) return []

    return [buildSignal(promise, now, promise.blocking ? 'now' : 'today')]
  })
}
