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
      { type: 'attention_item', key: 'what', value: item.what, confidence: null, sourceIds: meta.sources.map((source) => source.id), detectedAt: now, occurredAt: null, dueAt: null, validUntil: null },
      { type: 'attention_reason', key: 'why', value: item.why, confidence: null, sourceIds: meta.sources.map((source) => source.id), detectedAt: now, occurredAt: null, dueAt: null, validUntil: null },
    ],
    rules: [{ id: meta.trigger.type, version: '1' }],
    sources: meta.sources,
    actions: meta.actionability === 'direct'
      ? [{ kind: 'open', label: 'Ouvrir', href: item.href }]
      : [],
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
    ? { type: 'imminent_passage' as const, reason: 'passage_imminent' as const }
    : item.sourceType === 'deadline'
      ? { type: 'overdue_deadline' as const, reason: 'deadline_overdue' as const }
      : { type: 'old_action' as const, reason: 'object_aging' as const }
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
    facts: [{ type: item.sourceType, key: 'title', value: item.title, confidence: null, sourceIds: [item.id], detectedAt: now, occurredAt: item.sourceType === 'passage' ? item.startsAt : null, dueAt: item.sourceType === 'passage' ? null : item.dueDate, validUntil: null }],
    rules: [{ id: trigger.type, version: '1' }],
    sources: [{ type: item.sourceType, id: item.id, href: item.href, label: item.title }],
    actions: [{ kind: item.actionId ? 'complete' : 'prepare', label: item.actionId ? 'Traiter' : 'Préparer', href: item.href }],
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
