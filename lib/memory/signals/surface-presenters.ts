import type { AttentionItem } from '@/lib/db/attention'
import type { NowDashboardItem } from '@/lib/db/now-dashboard'
import type { OrganizationIdentity, OrganizationIdentityMap } from '@/lib/db/organisations'
import type { MemorySignal } from './operational-contract'
import {
  factActionId,
  factCanComplete,
  factDueAt,
  factPriority,
  factSiteName,
  factSourceType,
  factStartsAt,
  factTitle,
  factWhat,
  factWhere,
  factWhy,
} from './fact-selectors'

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
      what: factWhat(signal) ?? factTitle(signal) ?? signal.trigger.type,
      where: factWhere(signal) ?? signal.siteId,
      why: factWhy(signal) ?? signal.trigger.reason,
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
      const sourceType = factSourceType(signal) ?? (signal.sources[0]?.type as NowDashboardItem['sourceType'] | undefined) ?? 'action'
      const priority = factPriority(signal) ?? 'today'
      const actionId = factActionId(signal)
      return {
        id: signal.id,
        sourceType,
        title: factTitle(signal) ?? signal.sources[0]?.label ?? signal.id,
        siteId: signal.siteId,
        siteName: factSiteName(signal) ?? signal.siteId,
        organization: organizationFor(signal, organizationMap),
        href: signal.sources[0]?.href ?? `/sites/${signal.siteId}`,
        dueDate: factDueAt(signal),
        startsAt: factStartsAt(signal),
        priority,
        canComplete: factCanComplete(signal),
        actionId,
      }
    })
}
