// Anticipation (option A validée) : une promesse dont l'échéance tombe
// AUJOURD'HUI ou DEMAIN en date civile Nouméa, pas encore dépassée, entre dans
// le flux Attention avec le label « À anticiper ». Jamais « critique » : ce mot
// reste réservé au dépassé ou au bloquant.
//
// Règle par DATE CIVILE (pas une différence brute d'heures) : une échéance à
// J+1 est « demain » toute la journée — elle n'apparaît pas à 47 h 59 pour
// disparaître selon l'heure de consultation.
//
// Déduplication par construction avec promise_expired : ici dueAt >= now,
// là-bas dueAt < now — mutuellement exclusifs au même instant.

import type { MemorySignal } from './operational-contract'
import type { PromiseCandidate, PromiseDetectionContext } from './promise-detector'
import { localDateOf, addDaysLocal } from '@/lib/time/local-date'

function hasExplicitTimezone(value: string): boolean {
  return /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
}

function dueTimestamp(value: string): number | null {
  if (!hasExplicitTimezone(value)) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function buildSignal(promise: PromiseCandidate, now: string, dueIsToday: boolean): MemorySignal {
  return {
    id: `promise-upcoming:${promise.siteId}:${promise.id}`,
    organizationId: promise.organizationId,
    siteId: promise.siteId,
    category: 'promise',
    trigger: { type: 'promise', reason: 'promise_expiring_soon' },
    // « Critique » réservé au bloquant — une anticipation ordinaire reste warning.
    severity: promise.blocking ? 'critical' : 'warning',
    importance: promise.importance,
    urgency: dueIsToday ? 'today' : 'week',
    state: 'active',
    actionability: 'investigate',
    origin: 'rules',
    facts: [
      {
        type: 'promise', key: 'promise_text', value: promise.text, confidence: null,
        sourceIds: [promise.source.id, ...promise.confirmationSourceIds, ...promise.relatedProofSourceIds],
        detectedAt: now, occurredAt: promise.occurredAt, dueAt: promise.dueAt, validUntil: null,
      },
      {
        type: 'site', key: 'site_name', value: promise.siteName, confidence: null,
        sourceIds: [], detectedAt: now, occurredAt: null, dueAt: null, validUntil: null,
      },
    ],
    rules: [{ id: 'promise_expiring_soon', version: '1' }],
    sources: [promise.source],
    subject: promise.subject,
    actions: [{ kind: 'investigate', label: 'Confirmer', href: promise.source.href }],
    confidence: null,
    dedupeKey: `promise-upcoming:${promise.siteId}:${promise.id}`,
    detectedAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
    resolvedBy: null,
  }
}

/** Promesse à sécuriser : échéance aujourd'hui ou demain (civil Nouméa), non dépassée. */
export function detectPromiseExpiringSoonSignals(
  context: PromiseDetectionContext,
  now = new Date().toISOString(),
): MemorySignal[] {
  const nowTimestamp = Date.parse(now)
  if (!Number.isFinite(nowTimestamp)) return []
  const todayLocal = localDateOf(new Date(nowTimestamp))
  const tomorrowLocal = addDaysLocal(todayLocal, 1)

  return context.promises.flatMap((promise) => {
    if (!promise.dueAt || promise.confirmedAt || promise.replacedAt || promise.cancelledAt || promise.confirmationSourceIds.length > 0) return []
    const dueTimestampValue = dueTimestamp(promise.dueAt)
    // Déjà dépassée → territoire de promise_expired, jamais les deux.
    if (dueTimestampValue === null || dueTimestampValue < nowTimestamp) return []

    const dueLocal = localDateOf(new Date(dueTimestampValue))
    if (dueLocal !== todayLocal && dueLocal !== tomorrowLocal) return []

    return [buildSignal(promise, now, dueLocal === todayLocal)]
  })
}
