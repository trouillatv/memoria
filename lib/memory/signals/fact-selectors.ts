import type { MemorySignal, SignalFact } from './operational-contract'

/**
 * Clés de faits transitoires utilisées par les adaptateurs Lot 1.
 * Elles sont centralisées ici pour éviter que les surfaces réinterprètent les
 * chaînes et pour faciliter leur retrait règle par règle.
 */
export const FACT_KEYS = {
  title: 'title',
  siteName: 'site_name',
  actionId: 'action_id',
  canComplete: 'can_complete',
  priority: 'priority',
  sourceType: 'source_type',
  startsAt: 'starts_at',
  where: 'where',
  why: 'why',
  what: 'what',
} as const

function findFact(signal: MemorySignal, key: string): SignalFact | undefined {
  return signal.facts.find((item) => item.key === key)
}

function stringValue(signal: MemorySignal, key: string): string | null {
  const value = findFact(signal, key)?.value
  return typeof value === 'string' && value.length > 0 ? value : null
}

function stringOrNullValue(signal: MemorySignal, key: string): string | null {
  const value = findFact(signal, key)?.value
  return typeof value === 'string' ? value : null
}

export function factTitle(signal: MemorySignal): string | null {
  return stringValue(signal, FACT_KEYS.title)
}

export function factSiteName(signal: MemorySignal): string | null {
  return stringValue(signal, FACT_KEYS.siteName)
}

export function factActionId(signal: MemorySignal): string | null {
  return stringValue(signal, FACT_KEYS.actionId)
}

export function factCanComplete(signal: MemorySignal): boolean {
  return findFact(signal, FACT_KEYS.canComplete)?.value === true
}

export function factPriority(signal: MemorySignal): 'urgent' | 'today' | 'soon' | null {
  const value = stringValue(signal, FACT_KEYS.priority)
  return value === 'urgent' || value === 'today' || value === 'soon' ? value : null
}

export function factSourceType(signal: MemorySignal): 'action' | 'deadline' | 'passage' | null {
  const value = stringValue(signal, FACT_KEYS.sourceType)
  return value === 'action' || value === 'deadline' || value === 'passage' ? value : null
}

export function factStartsAt(signal: MemorySignal): string | null {
  return stringOrNullValue(signal, FACT_KEYS.startsAt)
}

export function factWhere(signal: MemorySignal): string | null {
  return stringValue(signal, FACT_KEYS.where)
}

export function factWhy(signal: MemorySignal): string | null {
  return stringValue(signal, FACT_KEYS.why)
}

export function factWhat(signal: MemorySignal): string | null {
  return stringValue(signal, FACT_KEYS.what)
}

export function factOccurredAt(signal: MemorySignal): string | null {
  return signal.facts.find((item) => typeof item.occurredAt === 'string')?.occurredAt ?? null
}

export function factDueAt(signal: MemorySignal): string | null {
  return signal.facts.find((item) => typeof item.dueAt === 'string')?.dueAt ?? null
}
