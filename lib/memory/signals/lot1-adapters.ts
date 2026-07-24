import type { AttentionItem } from '@/lib/db/attention'
import type { NowDashboardItem } from '@/lib/db/now-dashboard'
import type { MemorySignal, OperationalSignalMeta } from './operational-contract'

type AttentionItemWithMeta = AttentionItem & { signal?: OperationalSignalMeta }

/**
 * Normalise les sorties actuelles sans déduire une catégorie depuis le texte.
 * Les anciennes lignes non annotées sont volontairement ignorées : elles
 * doivent être annotées à leur point de production avant d'entrer dans le flux.
 */
export function attentionItemToMemorySignal(
  item: AttentionItem,
  now = new Date().toISOString(),
): MemorySignal | null {
  const meta = (item as AttentionItemWithMeta).signal
  if (!meta) return null
  return {
    id: `attention:${meta.dedupeKey}`,
    organizationId: item.organizationId,
    siteId: item.siteId ?? siteIdFromHref(item.href),
    category: meta.category,
    trigger: meta.trigger,
    severity: item.tier === 'red' ? 'critical' : 'warning',
    importance: item.tier === 'red' ? 'critical' : 'high',
    urgency: item.tier === 'red' ? 'now' : 'today',
    state: 'active',
    actionability: meta.actionability,
    origin: meta.origin,
    facts: [
      { key: 'what', value: item.what, sourceIds: meta.sources.map((source) => source.id) },
      { key: 'why', value: item.why, sourceIds: meta.sources.map((source) => source.id) },
    ],
    rules: [{ id: meta.trigger, version: '1' }],
    sources: meta.sources,
    actions: meta.actionability === 'direct'
      ? [{ kind: 'open', label: 'Ouvrir', href: item.href }]
      : [],
    presentations: [],
    confidence: null,
    dedupeKey: meta.dedupeKey,
    detectedAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
    resolvedBy: null,
  }
}

export function nowItemToMemorySignal(
  item: NowDashboardItem,
  now = new Date().toISOString(),
): MemorySignal {
  const category = 'priority' as const
  const dedupeKey = `now:${item.id}`
  const trigger = item.sourceType === 'passage'
    ? 'imminent_passage' as const
    : item.sourceType === 'deadline'
      ? 'overdue_deadline' as const
      : 'old_action' as const
  return {
    id: dedupeKey,
    organizationId: item.organization.id,
    siteId: item.siteId,
    category,
    trigger,
    severity: item.priority === 'urgent' ? 'critical' : item.priority === 'today' ? 'warning' : 'info',
    importance: item.priority === 'urgent' ? 'high' : 'normal',
    urgency: item.priority === 'urgent' ? 'now' : item.priority === 'today' ? 'today' : 'week',
    state: 'active',
    actionability: 'direct',
    origin: 'rules',
    facts: [{ key: 'title', value: item.title, sourceIds: [item.id] }],
    rules: [{ id: trigger, version: '1' }],
    sources: [{ type: item.sourceType, id: item.id, href: item.href, label: item.title }],
    actions: [{ kind: item.actionId ? 'complete' : 'prepare', label: item.actionId ? 'Traiter' : 'Préparer', href: item.href }],
    presentations: [],
    confidence: null,
    dedupeKey,
    detectedAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
    resolvedBy: null,
  }
}

function siteIdFromHref(href: string): string {
  const match = href.match(/\/sites\/([^/]+)/)
  return match?.[1] ?? ''
}
