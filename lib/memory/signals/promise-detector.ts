import type { MemorySignal, SourceRef, PromiseSubjectRef } from './operational-contract'

export type PromiseCandidate = {
  id: string
  organizationId: string
  siteId: string
  siteName: string
  text: string
  source: SourceRef
  /** Objet persistant résoluble (T2) — porté jusqu'au signal, puis à la Situation. */
  subject: PromiseSubjectRef
  occurredAt: string | null
  /** Identifiant persistant : jamais un index de phrase ou de tableau. */
  /** Date ISO déjà résolue avec le fuseau du contexte ; le détecteur ne l'invente pas. */
  dueAt: string | null
  confirmedAt: string | null
  confirmationSourceIds: string[]
  relatedProofSourceIds: string[]
  replacedAt?: string | null
  cancelledAt?: string | null
  importance: 'critical' | 'high' | 'normal' | 'low'
  blocking: boolean
}

export type PromiseDetectionContext = {
  promises: PromiseCandidate[]
}

function hasExplicitTimezone(value: string): boolean {
  return /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
}

function dueTimestamp(value: string): number | null {
  if (!hasExplicitTimezone(value)) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

/**
 * V1 déterministe : ne traite que des promesses déjà structurées avec une
 * échéance résolue. La résolution des expressions (« vendredi », « sous peu »)
 * appartient au read model qui construit PromiseCandidate.
 */
export function detectPromiseExpiredSignals(
  context: PromiseDetectionContext,
  now = new Date().toISOString(),
): MemorySignal[] {
  const nowTimestamp = Date.parse(now)
  if (!Number.isFinite(nowTimestamp)) return []

  return context.promises.flatMap((promise) => {
    if (!promise.dueAt || promise.confirmedAt || promise.replacedAt || promise.cancelledAt || promise.confirmationSourceIds.length > 0) return []
    const dueTimestampValue = dueTimestamp(promise.dueAt)
    if (dueTimestampValue === null || dueTimestampValue >= nowTimestamp) return []

    const critical = promise.blocking
    return [{
      id: `promise-expired:${promise.siteId}:${promise.id}`,
      organizationId: promise.organizationId,
      siteId: promise.siteId,
      category: 'promise',
      trigger: { type: 'promise', reason: 'promise_expired' },
      severity: critical ? 'critical' : 'warning',
      importance: promise.importance,
      urgency: critical ? 'now' : 'today',
      state: 'active',
      actionability: 'investigate',
      origin: 'rules',
      facts: [
        {
          type: 'promise', key: 'promise_text', value: promise.text, confidence: null,
          sourceIds: [promise.source.id, ...promise.confirmationSourceIds, ...promise.relatedProofSourceIds], detectedAt: now, occurredAt: promise.occurredAt, dueAt: promise.dueAt, validUntil: null,
        },
        {
          type: 'site', key: 'site_name', value: promise.siteName, confidence: null,
          sourceIds: [], detectedAt: now, occurredAt: null, dueAt: null, validUntil: null,
        },
      ],
      rules: [{ id: 'promise_expired', version: '1' }],
      sources: [promise.source],
      subject: promise.subject,
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

/** Nom historique conservé pour les consommateurs existants. */
export const detectPromiseSignals = detectPromiseExpiredSignals
