import type { MemorySignal, SourceRef } from './operational-contract'

export type PromiseCandidate = {
  id: string
  organizationId: string
  siteId: string
  text: string
  source: SourceRef
  occurredAt: string | null
  /** Date déjà résolue par le read model ; le détecteur ne parse pas le texte. */
  dueAt: string | null
  confirmedAt: string | null
  proofSourceIds: string[]
}

export type PromiseDetectionContext = {
  promises: PromiseCandidate[]
}

function dueTimestamp(value: string): number | null {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : null
}

/**
 * V1 déterministe : ne traite que des promesses déjà structurées avec une
 * échéance résolue. La résolution des expressions (« vendredi », « sous peu »)
 * appartient au read model qui construit PromiseCandidate.
 */
export function detectPromiseSignals(
  context: PromiseDetectionContext,
  now = new Date().toISOString(),
): MemorySignal[] {
  const nowTimestamp = Date.parse(now)
  if (!Number.isFinite(nowTimestamp)) return []

  return context.promises.flatMap((promise) => {
    if (!promise.dueAt || promise.confirmedAt || promise.proofSourceIds.length > 0) return []
    const dueTimestampValue = dueTimestamp(promise.dueAt)
    if (dueTimestampValue === null || dueTimestampValue >= nowTimestamp) return []

    const ageDays = Math.max(1, Math.floor((nowTimestamp - dueTimestampValue) / 86_400_000))
    const critical = ageDays >= 7
    const sourceIds = [promise.source.id, ...promise.proofSourceIds]
    return [{
      id: `promise-expired:${promise.siteId}:${promise.id}`,
      organizationId: promise.organizationId,
      siteId: promise.siteId,
      category: 'promise',
      trigger: { type: 'promise', reason: 'promise_expired' },
      severity: critical ? 'critical' : 'warning',
      importance: critical ? 'critical' : 'high',
      urgency: critical ? 'now' : 'today',
      state: 'active',
      actionability: 'investigate',
      origin: 'rules',
      facts: [
        {
          type: 'promise', key: 'promise_text', value: promise.text, confidence: null,
          sourceIds, detectedAt: now, occurredAt: promise.occurredAt, dueAt: promise.dueAt, validUntil: null,
        },
      ],
      rules: [{ id: 'promise_expired', version: '1' }],
      sources: [promise.source],
      actions: [{ kind: 'investigate', label: 'Vérifier', href: promise.source.href }],
      confidence: null,
      dedupeKey: `promise-expired:${promise.siteId}:${promise.id}`,
      detectedAt: now,
      acknowledgedAt: null,
      resolvedAt: null,
      resolvedBy: null,
    } satisfies MemorySignal]
  })
}
