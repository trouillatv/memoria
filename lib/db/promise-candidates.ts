import { createAdminClient } from '@/lib/supabase/admin'
import type { SourceRef } from '@/lib/memory/signals/operational-contract'
import type { StructuredPromiseRecord } from '@/lib/memory/signals/promise-candidates'

type UnknownRecord = Record<string, unknown>

const CAPTURED_SELECT =
  'id, organization_id, site_id, kind, status, title, body, source_type, source_id, created_at'
const PROPOSAL_SELECT =
  'id, organization_id, site_id, kind, status, title, body, payload, report_id, source_capture_ids, dedupe_key, promoted_object_id, created_at'

const TERMINAL_CAPTURED_STATUSES = new Set(['resolved', 'obsolete', 'dismissed'])
const TERMINAL_PROPOSAL_STATUSES = new Set(['confirmed', 'fulfilled', 'dismissed', 'superseded'])
const IMPORTANCE_VALUES = new Set(['critical', 'high', 'normal', 'low'])

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function hasTimezoneAwareIso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function sourceRefFor(siteId: string, type: unknown, id: unknown, label?: string): SourceRef | null {
  const sourceId = stringValue(id)
  const sourceType = stringValue(type)
  if (!sourceId || !sourceType) return null

  if (sourceType === 'visit' || sourceType === 'report') {
    return {
      type: 'visit',
      id: sourceId,
      href: `/sites/${siteId}/visites/${sourceId}`,
      label: label ?? 'Voir la visite',
    }
  }

  if (sourceType === 'capture') {
    return {
      type: 'capture',
      id: sourceId,
      href: `/sites/${siteId}/observation/${sourceId}`,
      label: label ?? 'Voir la capture',
    }
  }

  if (sourceType === 'meeting' || sourceType === 'call' || sourceType === 'manual') {
    return {
      type: sourceType,
      id: sourceId,
      href: `/sites/${siteId}/chronologie?source=${encodeURIComponent(sourceId)}`,
      label: label ?? 'Voir la source',
    }
  }

  return null
}

function sourceFromProposal(row: UnknownRecord): SourceRef | null {
  const siteId = stringValue(row.site_id)
  if (!siteId) return null

  const reportId = stringValue(row.report_id)
  if (reportId) {
    return sourceRefFor(siteId, 'report', reportId)
  }

  const captureIds = Array.isArray(row.source_capture_ids) ? row.source_capture_ids : []
  const captureId = captureIds.find((value): value is string => typeof value === 'string' && value.length > 0)
  return sourceRefFor(siteId, 'capture', captureId)
}

function payloadOf(row: UnknownRecord): UnknownRecord | null {
  return isRecord(row.payload) ? row.payload : null
}

function isExplicitCommitment(payload: UnknownRecord): boolean {
  return payload.commitment === true || payload.temporalNature === 'promise'
}

function importanceOf(payload: UnknownRecord | null): StructuredPromiseRecord['importance'] {
  const value = payload?.importance
  return typeof value === 'string' && IMPORTANCE_VALUES.has(value)
    ? (value as StructuredPromiseRecord['importance'])
    : 'normal'
}

function blockingOf(payload: UnknownRecord | null): boolean {
  return payload?.blocking === true
}

function capturedRecord(row: UnknownRecord, siteName: string): StructuredPromiseRecord | null {
  const organizationId = stringValue(row.organization_id)
  const siteId = stringValue(row.site_id)
  const id = stringValue(row.id)
  const title = stringValue(row.title)
  const source = sourceRefFor(siteId ?? '', row.source_type, row.source_id)
  if (!organizationId || !siteId || !id || row.kind !== 'promise' || row.status !== 'active' || !title || !source) return null

  return {
    id,
    organizationId,
    siteId,
    siteName,
    kind: 'promise',
    title,
    body: typeof row.body === 'string' ? row.body : null,
    source,
    subject: { table: 'captured_knowledge', id, organizationId, siteId },
    occurredAt: typeof row.created_at === 'string' ? row.created_at : null,
    dueAt: null,
    confirmedAt: null,
    confirmationSourceIds: [],
    relatedProofSourceIds: [],
    importance: 'normal',
    blocking: false,
  }
}

function proposalRecord(row: UnknownRecord, siteName: string): StructuredPromiseRecord | null {
  const organizationId = stringValue(row.organization_id)
  const siteId = stringValue(row.site_id)
  const title = stringValue(row.title)
  const id = stringValue(row.id)
  const source = sourceFromProposal(row)
  const payload = payloadOf(row)
  if (
    !organizationId ||
    !siteId ||
    !id ||
    !title ||
    row.kind !== 'deadline' ||
    row.status !== 'proposed' ||
    row.promoted_object_id !== null ||
    !isExplicitCommitment(payload ?? {}) ||
    !source
  ) {
    return null
  }

  const rawDueAt = payload?.dueAt
  if (rawDueAt !== undefined && rawDueAt !== null && !hasTimezoneAwareIso(rawDueAt)) return null

  return {
    id,
    organizationId,
    siteId,
    siteName,
    kind: 'promise',
    title,
    body: typeof row.body === 'string' ? row.body : null,
    source,
    subject: { table: 'site_knowledge_proposals', id, organizationId, siteId },
    occurredAt: typeof row.created_at === 'string' ? row.created_at : null,
    dueAt: rawDueAt === null || rawDueAt === undefined ? null : rawDueAt,
    confirmedAt: null,
    confirmationSourceIds: [],
    relatedProofSourceIds: [],
    importance: importanceOf(payload),
    blocking: blockingOf(payload),
  }
}

function recordOrder(a: StructuredPromiseRecord, b: StructuredPromiseRecord): number {
  return `${a.id}\u0000${a.title}\u0000${a.source.href}`.localeCompare(
    `${b.id}\u0000${b.title}\u0000${b.source.href}`,
  )
}

function recordKey(record: StructuredPromiseRecord, row: UnknownRecord): string {
  const dedupeKey = stringValue(row.dedupe_key)
  if (dedupeKey) return `dedupe:${record.organizationId}:${record.siteId}:${dedupeKey}`
  return `id:${record.organizationId}:${record.siteId}:${record.id}`
}

/**
 * Read model structuré : il ne reconnaît jamais une promesse depuis du texte.
 * Les deux tables sont filtrées par tenant avant toute projection métier.
 */
export async function getStructuredPromiseRecords(
  organizationIds: string[],
  siteIds?: string[],
): Promise<StructuredPromiseRecord[]> {
  if (organizationIds.length === 0 || siteIds?.length === 0) return []

  const supabase = createAdminClient()
  const capturedQuery = supabase
    .from('captured_knowledge')
    .select(CAPTURED_SELECT)
    .in('organization_id', organizationIds)
  const proposalQuery = supabase
    .from('site_knowledge_proposals')
    .select(PROPOSAL_SELECT)
    .in('organization_id', organizationIds)

  if (siteIds) {
    capturedQuery.in('site_id', siteIds)
    proposalQuery.in('site_id', siteIds)
  }

  const [{ data: capturedRows, error: capturedError }, { data: proposalRows, error: proposalError }] = await Promise.all([
    capturedQuery,
    proposalQuery,
  ])
  if (capturedError) throw capturedError
  if (proposalError) throw proposalError

  // Collect siteIds present in results to resolve names in one query.
  const rawSiteIds = new Set<string>()
  for (const row of (capturedRows ?? []) as unknown[]) {
    if (isRecord(row)) { const sid = stringValue(row.site_id); if (sid) rawSiteIds.add(sid) }
  }
  for (const row of (proposalRows ?? []) as unknown[]) {
    if (isRecord(row)) { const sid = stringValue(row.site_id); if (sid) rawSiteIds.add(sid) }
  }
  const siteNameMap = new Map<string, string>()
  if (rawSiteIds.size > 0) {
    const { data: siteRows } = await supabase.from('sites').select('id, name').in('id', [...rawSiteIds])
    for (const s of (siteRows ?? []) as Array<{ id: string; name: string }>) siteNameMap.set(s.id, s.name)
  }

  const byKey = new Map<string, StructuredPromiseRecord>()
  for (const row of (capturedRows ?? []) as unknown[]) {
    if (!isRecord(row) || TERMINAL_CAPTURED_STATUSES.has(String(row.status))) continue
    if (!organizationIds.includes(String(row.organization_id))) continue
    if (siteIds && !siteIds.includes(String(row.site_id))) continue
    const siteName = siteNameMap.get(stringValue(row.site_id) ?? '') ?? ''
    const record = capturedRecord(row, siteName)
    if (!record) continue
    const key = recordKey(record, row)
    const previous = byKey.get(key)
    if (!previous || recordOrder(record, previous) < 0) byKey.set(key, record)
  }
  for (const row of (proposalRows ?? []) as unknown[]) {
    if (!isRecord(row) || TERMINAL_PROPOSAL_STATUSES.has(String(row.status))) continue
    if (!organizationIds.includes(String(row.organization_id))) continue
    if (siteIds && !siteIds.includes(String(row.site_id))) continue
    const siteName = siteNameMap.get(stringValue(row.site_id) ?? '') ?? ''
    const record = proposalRecord(row, siteName)
    if (!record) continue
    const key = recordKey(record, row)
    const previous = byKey.get(key)
    if (!previous || recordOrder(record, previous) < 0) byKey.set(key, record)
  }

  return [...byKey.values()].sort(recordOrder)
}
