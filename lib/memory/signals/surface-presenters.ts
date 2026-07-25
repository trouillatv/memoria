import type { AttentionItem } from '@/lib/db/attention'
import type { NowDashboardItem } from '@/lib/db/now-dashboard'
import type { OrganizationIdentity, OrganizationIdentityMap } from '@/lib/db/organisations'
import type { MemorySignal, SignalFact } from './operational-contract'

function fact(signal: MemorySignal, key: string): SignalFact | undefined {
  return signal.facts.find((item) => item.key === key)
}

function stringFact(signal: MemorySignal, key: string): string | null {
  const value = fact(signal, key)?.value
  return typeof value === 'string' ? value : null
}

function booleanFact(signal: MemorySignal, key: string): boolean {
  return fact(signal, key)?.value === true
}

function organizationFor(signal: MemorySignal, organizationMap: OrganizationIdentityMap): OrganizationIdentity {
  return organizationMap[signal.organizationId] ?? {
    id: signal.organizationId,
    name: signal.organizationId,
    slug: signal.organizationId,
    logoPath: null,
    logoUrl: null,
    brandColor: null,
  }
}

/** Projection conservant la forme attendue par AttentionPanel pendant la migration. */
export function presentAttentionSignals(signals: MemorySignal[]): AttentionItem[] {
  return signals
    .filter((signal) => signal.state === 'active' && signal.category !== 'priority')
    .map((signal) => ({
      siteId: signal.siteId,
      tier: signal.severity === 'critical' ? 'red' : 'orange',
      what: stringFact(signal, 'what') ?? stringFact(signal, 'title') ?? signal.trigger.type,
      where: stringFact(signal, 'where') ?? signal.siteId,
      why: stringFact(signal, 'why') ?? signal.trigger.reason,
      href: signal.sources[0]?.href ?? `/sites/${signal.siteId}`,
      organizationId: signal.organizationId,
      signal: {
        category: signal.category,
        trigger: signal.trigger,
        actionability: signal.actionability,
        origin: signal.origin,
        dedupeKey: signal.dedupeKey,
        sources: signal.sources,
      },
    }))
}

/** Projection conservant la forme attendue par CockpitNow pendant la migration. */
export function presentNowSignals(signals: MemorySignal[], organizationMap: OrganizationIdentityMap): NowDashboardItem[] {
  return signals
    .filter((signal) => signal.state === 'active' && signal.category === 'priority' && signal.actionability === 'direct')
    .map((signal) => {
      const sourceType = (stringFact(signal, 'source_type') ?? signal.sources[0]?.type ?? 'action') as NowDashboardItem['sourceType']
      const priority = (stringFact(signal, 'priority') ?? 'today') as NowDashboardItem['priority']
      const actionId = stringFact(signal, 'action_id')
      return {
        id: signal.id,
        sourceType,
        title: stringFact(signal, 'title') ?? signal.sources[0]?.label ?? signal.id,
        siteId: signal.siteId,
        siteName: stringFact(signal, 'site_name') ?? signal.siteId,
        organization: organizationFor(signal, organizationMap),
        href: signal.sources[0]?.href ?? `/sites/${signal.siteId}`,
        dueDate: fact(signal, 'title')?.dueAt ?? null,
        startsAt: stringFact(signal, 'starts_at'),
        priority,
        canComplete: booleanFact(signal, 'can_complete'),
        actionId,
      }
    })
}
