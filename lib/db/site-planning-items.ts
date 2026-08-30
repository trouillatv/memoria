import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  validatePlanningDates,
  type PlanningDateBasis,
  type PlanningItemKind,
  type PlanningItemStatus,
  type PlanningTemporalPrecision,
} from '@/lib/planning/planning-item-contract'
export type { PlanningDateBasis, PlanningItemKind, PlanningItemStatus, PlanningTemporalPrecision } from '@/lib/planning/planning-item-contract'

export interface SitePlanningItem {
  id: string
  organizationId: string
  siteId: string
  kind: PlanningItemKind
  title: string
  plannedStart: string | null
  plannedEnd: string | null
  temporalPrecision: PlanningTemporalPrecision
  dateBasis: PlanningDateBasis
  status: PlanningItemStatus
  sourceProposalId: string | null
  canonicalSubjectId: string | null
  supersedesId: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface CreatePlanningItemInput {
  organizationId: string
  siteId: string
  kind: PlanningItemKind
  title: string
  plannedStart?: string | null
  plannedEnd?: string | null
  temporalPrecision?: PlanningTemporalPrecision
  dateBasis?: PlanningDateBasis
  sourceProposalId?: string | null
  canonicalSubjectId?: string | null
  supersedesId?: string | null
  createdBy?: string | null
}

export interface ListPlanningItemsOptions {
  includeSuperseded?: boolean
  includeCancelled?: boolean
}

const SELECT = 'id, organization_id, site_id, kind, title, planned_start, planned_end, temporal_precision, date_basis, status, source_proposal_id, canonical_subject_id, supersedes_id, created_by, created_at, updated_at'

function validateInput(input: CreatePlanningItemInput): { start: string | null; end: string | null } {
  if (!input.title.trim()) throw new Error('Un planning item doit avoir un titre')
  return validatePlanningDates(input)
}

function fromRow(row: Record<string, unknown>): SitePlanningItem {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    siteId: row.site_id as string,
    kind: row.kind as PlanningItemKind,
    title: row.title as string,
    plannedStart: row.planned_start as string | null,
    plannedEnd: row.planned_end as string | null,
    temporalPrecision: row.temporal_precision as PlanningTemporalPrecision,
    dateBasis: row.date_basis as PlanningDateBasis,
    status: row.status as PlanningItemStatus,
    sourceProposalId: row.source_proposal_id as string | null,
    canonicalSubjectId: row.canonical_subject_id as string | null,
    supersedesId: row.supersedes_id as string | null,
    createdBy: row.created_by as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export async function createPlanningItem(input: CreatePlanningItemInput): Promise<string> {
  const { start, end } = validateInput(input)
  const { data, error } = await createAdminClient()
    .from('site_planning_items')
    .insert({
      organization_id: input.organizationId,
      site_id: input.siteId,
      kind: input.kind,
      title: input.title.trim(),
      planned_start: start,
      planned_end: end,
      temporal_precision: input.temporalPrecision ?? 'unknown',
      date_basis: input.dateBasis ?? 'explicit_document',
      status: 'planned',
      source_proposal_id: input.sourceProposalId ?? null,
      canonical_subject_id: input.canonicalSubjectId ?? null,
      supersedes_id: input.supersedesId ?? null,
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Création du planning impossible')
  return (data as { id: string }).id
}

export async function getPlanningItem(id: string): Promise<SitePlanningItem | null> {
  const { data, error } = await createAdminClient()
    .from('site_planning_items')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? fromRow(data as Record<string, unknown>) : null
}

export async function listSitePlanningItems(
  siteId: string,
  { includeSuperseded = false, includeCancelled = false }: ListPlanningItemsOptions = {},
): Promise<SitePlanningItem[]> {
  const statuses: PlanningItemStatus[] = ['planned']
  if (includeSuperseded) statuses.push('superseded')
  if (includeCancelled) statuses.push('cancelled')
  const { data, error } = await createAdminClient()
    .from('site_planning_items')
    .select(SELECT)
    .eq('site_id', siteId)
    .in('status', statuses)
    .order('planned_start', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map(fromRow)
}

export async function supersedePlanningItem(
  oldItemId: string,
  replacement: Omit<CreatePlanningItemInput, 'supersedesId'>,
): Promise<string> {
  const old = await getPlanningItem(oldItemId)
  if (!old) throw new Error('Planning item à remplacer introuvable')
  if (old.status !== 'planned') throw new Error('Seul un planning item actif peut être remplacé')
  if (old.organizationId !== replacement.organizationId || old.siteId !== replacement.siteId) {
    throw new Error('La version remplaçante doit rester dans le même périmètre')
  }
  const id = await createPlanningItem({ ...replacement, supersedesId: oldItemId })
  const { error } = await createAdminClient()
    .from('site_planning_items')
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('id', oldItemId)
    .eq('status', 'planned')
  if (error) throw new Error(error.message)
  return id
}

export async function cancelPlanningItem(id: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('site_planning_items')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'planned')
  if (error) throw new Error(error.message)
}

export interface PlanningItemSourceDocument {
  documentId: string
  filename: string
  /** Extrait textuel brut de la ligne du document ayant produit cet item —
   *  la preuve à afficher en premier (doctrine V1-D.3) ; le document complet
   *  reste une provenance secondaire, jamais le premier niveau de preuve. */
  sourceExcerpt: string | null
}

/**
 * Résout `sourceProposalId → document_extraction_proposal.{document_id,source_excerpt}
 * → documents.filename` pour un lot d'items. C'est un résolveur dédié, distinct
 * de `getProvenance`/`WhyButton` (pipeline visite/mémo) : les planning items
 * viennent de `document_extraction_proposal`, pas de `site_knowledge_proposals`.
 */
export async function getPlanningItemSourceDocuments(
  proposalIds: string[],
): Promise<Map<string, PlanningItemSourceDocument>> {
  const ids = [...new Set(proposalIds)]
  if (ids.length === 0) return new Map()
  const { data, error } = await createAdminClient()
    .from('document_extraction_proposal')
    .select('id, document_id, source_excerpt, documents(filename)')
    .in('id', ids)
  if (error) throw new Error(error.message)
  const map = new Map<string, PlanningItemSourceDocument>()
  for (const row of (data ?? []) as unknown as Array<{ id: string; document_id: string; source_excerpt: string | null; documents: { filename: string } | null }>) {
    if (!row.documents) continue
    map.set(row.id, { documentId: row.document_id, filename: row.documents.filename, sourceExcerpt: row.source_excerpt })
  }
  return map
}
