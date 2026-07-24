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
    severity: item.tier === 'red' ? 'critical' : 'warning',
    state: 'active',
    actionability: meta.actionability,
    origin: meta.origin,
    title: item.what,
    explanation: item.why,
    sources: meta.sources,
    suggestedAction: meta.actionability === 'direct'
      ? { kind: 'open', label: 'Ouvrir', href: item.href }
      : null,
    confidence: null,
    dedupeKey: meta.dedupeKey,
    detectedAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
  }
}

export function nowItemToMemorySignal(
  item: NowDashboardItem,
  now = new Date().toISOString(),
): MemorySignal {
  const category = 'priority' as const
  const dedupeKey = `now:${item.id}`
  return {
    id: dedupeKey,
    organizationId: item.organization.id,
    siteId: item.siteId,
    category,
    severity: item.priority === 'urgent' ? 'critical' : item.priority === 'today' ? 'warning' : 'info',
    state: 'active',
    actionability: 'direct',
    origin: 'rules',
    title: item.title,
    explanation: item.sourceType === 'passage' ? 'Passage imminent à préparer.' : 'Action directement réalisable.',
    sources: [{ type: item.sourceType, id: item.id, href: item.href, label: item.title }],
    suggestedAction: { kind: item.actionId ? 'complete' : 'prepare', label: item.actionId ? 'Traiter' : 'Préparer', href: item.href },
    confidence: null,
    dedupeKey,
    detectedAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
  }
}

function siteIdFromHref(href: string): string {
  const match = href.match(/\/sites\/([^/]+)/)
  return match?.[1] ?? ''
}
