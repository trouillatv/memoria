import type { MemorySignal, SignalFact } from '@/lib/memory/signals/operational-contract'
import type { Situation, SituationKind, SituationSource, SituationTiming } from './situation'
import { openSourceCapability } from './capabilities'

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
    capabilities: openSourceCapability(source),
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
    capabilities: openSourceCapability(source),
  }
}

function isPromiseSignal(signal: MemorySignal): boolean {
  return signal.category === 'promise' && signal.trigger.type === 'promise'
}

function isStaleActionSignal(signal: MemorySignal): boolean {
  return signal.trigger.type === 'old_action' && signal.trigger.reason === 'object_aging'
}

// Migration progressive « action ancienne » : le signal existe déjà (staleness,
// old_action, via lot1-adapters) mais n'était rendu qu'en AttentionRow legacy.
// On le présente désormais comme une Situation — mêmes faits (what/why/where),
// juste réexprimés dans le contrat commun. Minimal : pas d'enrichissement du
// signal à la source (nom d'organisation absent → pas de badge org pour l'instant).
function staleActionSituation(signal: MemorySignal): Situation {
  const source = sourceFromSignal(signal)
  return {
    id: signal.id,
    signalId: signal.id,
    kind: 'stale_action',
    severity: signal.severity,
    title: factString(signal, 'what') ?? 'Action ancienne',
    explanation: null,
    site: {
      id: signal.siteId,
      // `where` porte déjà le nom lisible du chantier (cf. digest legacy).
      name: factString(signal, 'where') ?? siteName(signal),
      organizationId: signal.organizationId,
      organizationName: organizationName(signal),
    },
    timing: {
      occurredAt: null,
      dueAt: null,
      detectedAt: signal.detectedAt,
      // L'âge est déjà narré par `why` (« ouverte depuis X j ») — on ne recalcule
      // pas un ageDays qui ferait double emploi.
      ageDays: null,
      label: factString(signal, 'why'),
    },
    source,
    capabilities: openSourceCapability(source),
  }
}

export function presentSituation(signal: MemorySignal, now = new Date().toISOString()): Situation | null {
  if (isStaleActionSignal(signal)) return staleActionSituation(signal)
  if (!isPromiseSignal(signal)) return null

  switch (signal.trigger.reason) {
    case 'promise_expired':
      return promiseExpiredSituation(signal, now)
    case 'promise_without_due_date':
      return promiseWithoutDueDateSituation(signal, now)
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
