import type { MemorySignal, SignalFact } from '@/lib/memory/signals/operational-contract'
import type { Situation, SituationKind, SituationSource } from './situation'
import { openSourceCapability, promiseResolutionCapabilities } from './capabilities'
import { localDateOf } from '@/lib/time/local-date'

function factString(signal: MemorySignal, key: string): string | null {
  const fact = signal.facts.find((item: SignalFact) => item.key === key)
  const value = fact?.value
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function daysBetween(later: string, earlier: string): number | null {
  const laterTimestamp = parseTimestamp(later)
  const earlierTimestamp = parseTimestamp(earlier)
  if (laterTimestamp === null || earlierTimestamp === null) return null
  const diff = laterTimestamp - earlierTimestamp
  if (diff < 0) return 0
  return Math.floor(diff / (24 * 60 * 60 * 1000))
}

function formatFrenchDate(value: string | null): string | null {
  if (!value) return null
  const timestamp = parseTimestamp(value)
  if (timestamp === null) return null
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(timestamp))
}

function sourceFromSignal(signal: MemorySignal): SituationSource | null {
  const source = signal.sources[0]
  if (!source) return null
  return {
    type: source.type,
    id: source.id,
    label: source.label,
    href: source.href,
  }
}

function siteName(signal: MemorySignal): string {
  return factString(signal, 'site_name') ?? signal.siteId
}

function organizationName(signal: MemorySignal): string | null {
  return factString(signal, 'organization_name')
}

function promiseExpiredSituation(signal: MemorySignal, now: string): Situation {
  const source = sourceFromSignal(signal)
  const dueAt = signal.facts.find((item) => typeof item.dueAt === 'string' && item.dueAt.length > 0)?.dueAt ?? null
  const ageDays = dueAt ? daysBetween(now, dueAt) : null
  const dateLabel = formatFrenchDate(dueAt)
  const dueLabel = dateLabel ? `Échéance dépassée depuis ${ageDays ?? 0} jour${ageDays === 1 ? '' : 's'}` : 'Échéance dépassée'
  const title = factString(signal, 'promise_text') ? 'Promesse non tenue' : 'Promesse échue'

  return {
    id: signal.id,
    signalId: signal.id,
    kind: 'expired_promise',
    severity: signal.severity,
    title,
    explanation: dateLabel ? `Le planning était attendu le ${dateLabel}.` : 'Le planning attendu n’a pas été confirmé.',
    site: {
      id: signal.siteId,
      name: siteName(signal),
      organizationId: signal.organizationId,
      organizationName: organizationName(signal),
    },
    timing: {
      occurredAt: signal.facts.find((item) => typeof item.occurredAt === 'string' && item.occurredAt.length > 0)?.occurredAt ?? null,
      dueAt,
      detectedAt: signal.detectedAt,
      ageDays,
      label: dueLabel,
    },
    source,
    subject: signal.subject ?? null,
    capabilities: [...openSourceCapability(source), ...promiseResolutionCapabilities(signal.subject ?? null)],
  }
}

function promiseWithoutDueDateSituation(signal: MemorySignal, now: string): Situation {
  const source = sourceFromSignal(signal)
  const occurredAt = signal.facts.find((item) => typeof item.occurredAt === 'string' && item.occurredAt.length > 0)?.occurredAt ?? null
  const ageDays = occurredAt ? daysBetween(now, occurredAt) : null
  const label = ageDays === null
    ? 'Annonce à confirmer'
    : `Aucune confirmation depuis ${ageDays} jour${ageDays === 1 ? '' : 's'}`

  return {
    id: signal.id,
    signalId: signal.id,
    kind: 'unconfirmed_promise',
    severity: signal.severity,
    title: 'Annonce à confirmer',
    explanation: ageDays === null
      ? 'Aucune échéance structurée n’est disponible pour cette annonce.'
      : `Annonce faite il y a ${ageDays} jour${ageDays === 1 ? '' : 's'}, sans retour confirmé.`,
    site: {
      id: signal.siteId,
      name: siteName(signal),
      organizationId: signal.organizationId,
      organizationName: organizationName(signal),
    },
    timing: {
      occurredAt,
      dueAt: null,
      detectedAt: signal.detectedAt,
      ageDays,
      label,
    },
    source,
    subject: signal.subject ?? null,
    capabilities: [...openSourceCapability(source), ...promiseResolutionCapabilities(signal.subject ?? null)],
  }
}

// « Aujourd'hui » ou « demain » en date CIVILE Nouméa — jamais une différence
// brute d'heures (stable sur toute la journée de consultation).
function dueTodayOrTomorrowLabel(dueAt: string | null, now: string): string {
  if (!dueAt) return 'Échéance proche'
  const dueDate = new Date(dueAt)
  const nowDate = new Date(now)
  if (!Number.isFinite(dueDate.getTime()) || !Number.isFinite(nowDate.getTime())) return 'Échéance proche'
  return localDateOf(dueDate) === localDateOf(nowDate) ? 'Échéance aujourd\'hui' : 'Échéance demain'
}

function promiseExpiringSoonSituation(signal: MemorySignal, now: string): Situation {
  const source = sourceFromSignal(signal)
  const dueAt = signal.facts.find((item) => typeof item.dueAt === 'string' && item.dueAt.length > 0)?.dueAt ?? null
  const dateLabel = formatFrenchDate(dueAt)

  return {
    id: signal.id,
    signalId: signal.id,
    kind: 'upcoming_promise',
    severity: signal.severity,
    title: 'Promesse à sécuriser',
    explanation: dateLabel ? `Engagement attendu le ${dateLabel}.` : 'Engagement à échéance imminente.',
    site: {
      id: signal.siteId,
      name: siteName(signal),
      organizationId: signal.organizationId,
      organizationName: organizationName(signal),
    },
    timing: {
      occurredAt: signal.facts.find((item) => typeof item.occurredAt === 'string' && item.occurredAt.length > 0)?.occurredAt ?? null,
      dueAt,
      detectedAt: signal.detectedAt,
      ageDays: null,
      label: dueTodayOrTomorrowLabel(dueAt, now),
    },
    source,
    subject: signal.subject ?? null,
    capabilities: [...openSourceCapability(source), ...promiseResolutionCapabilities(signal.subject ?? null)],
  }
}

function upcomingActionSituation(signal: MemorySignal, now: string): Situation {
  const source = sourceFromSignal(signal)
  const dueAt = signal.facts.find((item) => typeof item.dueAt === 'string' && item.dueAt.length > 0)?.dueAt ?? null

  return {
    id: signal.id,
    signalId: signal.id,
    kind: 'upcoming_action',
    severity: signal.severity,
    title: factString(signal, 'what') ?? 'Action à échéance proche',
    explanation: null,
    site: {
      id: signal.siteId,
      name: factString(signal, 'where') ?? siteName(signal),
      organizationId: signal.organizationId,
      organizationName: organizationName(signal),
    },
    timing: {
      occurredAt: null,
      dueAt,
      detectedAt: signal.detectedAt,
      ageDays: null,
      label: dueTodayOrTomorrowLabel(dueAt, now),
    },
    source,
    subject: signal.subject ?? null,
    capabilities: openSourceCapability(source),
  }
}

function isPromiseSignal(signal: MemorySignal): boolean {
  return signal.category === 'promise' && signal.trigger.type === 'promise'
}

// Familles d'alertes legacy migrées vers la chaîne Situation → AttentionCard.
// Le signal existe déjà (via lot1-adapters, facts what/why/where) mais n'était
// rendu qu'en AttentionRow. On le présente comme une Situation — mêmes faits,
// juste réexprimés dans le contrat commun. Une famille = un couple (type, reason).
const LEGACY_ATTENTION_KINDS: Record<string, { kind: SituationKind; fallbackTitle: string }> = {
  'old_action:object_aging': { kind: 'stale_action', fallbackTitle: 'Action ancienne' },
  'old_action:deadline_overdue': { kind: 'overdue_action', fallbackTitle: 'Action en retard' },
  'open_reserve:object_aging': { kind: 'open_reserve', fallbackTitle: 'Réserve ouverte' },
  'planning_conflict:planning_conflict': { kind: 'planning_conflict', fallbackTitle: 'Conflit de planning' },
  'missing_attachment:attachment_missing': { kind: 'pending_debrief', fallbackTitle: 'Débrief en attente' },
}

function legacyAttentionEntry(signal: MemorySignal): { kind: SituationKind; fallbackTitle: string } | null {
  return LEGACY_ATTENTION_KINDS[`${signal.trigger.type}:${signal.trigger.reason}`] ?? null
}

// Mapping commun : `what` → titre, `where` → chantier, `why` → timing. Minimal :
// pas d'enrichissement à la source (nom d'organisation absent → pas de badge org).
function legacyAttentionSituation(signal: MemorySignal, kind: SituationKind, fallbackTitle: string): Situation {
  const source = sourceFromSignal(signal)
  return {
    id: signal.id,
    signalId: signal.id,
    kind,
    severity: signal.severity,
    title: factString(signal, 'what') ?? fallbackTitle,
    explanation: null,
    site: {
      id: signal.siteId,
      name: factString(signal, 'where') ?? siteName(signal),
      organizationId: signal.organizationId,
      organizationName: organizationName(signal),
    },
    timing: {
      occurredAt: null,
      dueAt: null,
      detectedAt: signal.detectedAt,
      // L'âge est déjà narré par `why` — on ne recalcule pas un ageDays redondant.
      ageDays: null,
      label: factString(signal, 'why'),
    },
    source,
    // Familles legacy : pas encore d'objet mutable rattaché (viendra plus tard).
    subject: signal.subject ?? null,
    capabilities: openSourceCapability(source),
  }
}

export function presentSituation(signal: MemorySignal, now = new Date().toISOString()): Situation | null {
  // Anticipation d'action : cas dédié (le mapping legacy ne porte pas dueAt).
  if (signal.trigger.type === 'old_action' && signal.trigger.reason === 'deadline_soon') {
    return upcomingActionSituation(signal, now)
  }
  const legacy = legacyAttentionEntry(signal)
  if (legacy) return legacyAttentionSituation(signal, legacy.kind, legacy.fallbackTitle)
  if (!isPromiseSignal(signal)) return null

  switch (signal.trigger.reason) {
    case 'promise_expired':
      return promiseExpiredSituation(signal, now)
    case 'promise_without_due_date':
      return promiseWithoutDueDateSituation(signal, now)
    case 'promise_expiring_soon':
      return promiseExpiringSoonSituation(signal, now)
    default:
      return null
  }
}

export function presentSituations(signals: MemorySignal[], now = new Date().toISOString()): Situation[] {
  return signals.flatMap((signal) => {
    const situation = presentSituation(signal, now)
    return situation ? [situation] : []
  })
}
