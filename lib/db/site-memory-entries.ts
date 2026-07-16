import 'server-only'

// ── LA MÉMOIRE DU CHANTIER ET SES POINTS DE VIGILANCE ────────────────────────
// Les deux derniers objets du cycle « proposé → confirmé → projeté → visible ».
// Écriture uniquement à la PROMOTION : ces tables ne contiennent que ce qu'un
// humain a validé. Rien n'y entre par déduction.

import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'

/** La nature d'une information — choisie par l'HUMAIN, jamais déduite. */
export type KnowledgeEntryKind = 'current_information' | 'durable_knowledge' | 'observed_pattern'

/**
 * Les deux natures qu'un humain peut choisir en confirmant.
 *
 * `observed_pattern` n'en fait PAS partie : une habitude exige plusieurs
 * observations indépendantes (« les accès sont arrivés tard » × 3 visites). La
 * proposer au premier passage transformerait une circonstance en règle.
 */
export const CHOOSABLE_KNOWLEDGE_KINDS = ['current_information', 'durable_knowledge'] as const

export function isChoosableKnowledgeKind(k: string): k is 'current_information' | 'durable_knowledge' {
  return (CHOOSABLE_KNOWLEDGE_KINDS as readonly string[]).includes(k)
}

/** Le mot du conducteur pour chaque nature. Jamais 'durable_knowledge'. */
export function knowledgeKindLabel(kind: KnowledgeEntryKind): string {
  switch (kind) {
    case 'current_information': return 'Information actuelle'
    case 'durable_knowledge': return 'Connaissance durable'
    case 'observed_pattern': return 'Habitude observée'
  }
}

/** Le geste, dit avec le verbe métier. */
export function knowledgeKindAction(kind: 'current_information' | 'durable_knowledge'): string {
  return kind === 'current_information'
    ? 'Conserver comme information actuelle'
    : 'Ajouter à la mémoire du chantier'
}

export interface CreateKnowledgeEntryInput {
  organizationId: string
  siteId: string
  kind: 'current_information' | 'durable_knowledge'
  title: string
  body?: string | null
  sourceReportId?: string | null
  sourceCaptureIds?: string[]
  confirmedBy: string | null
}

/** Entre dans la mémoire du chantier — uniquement par un geste humain. */
export async function createKnowledgeEntry(input: CreateKnowledgeEntryInput): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('site_knowledge_entries')
    .insert({
      organization_id: input.organizationId,
      site_id: input.siteId,
      kind: input.kind,
      title: input.title.trim(),
      body: input.body?.trim() || null,
      source_report_id: input.sourceReportId ?? null,
      source_capture_ids: input.sourceCaptureIds ?? [],
      confirmed_by: input.confirmedBy,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  // La MUTATION invalide la projection — jamais l'écran.
  invalidateSiteProjection(input.siteId)
  return (data as { id: string }).id
}

export interface CreateWatchpointInput {
  organizationId: string
  siteId: string
  title: string
  body?: string | null
  reportId?: string | null
  sourceCaptureIds?: string[]
  confirmedBy: string | null
}

/**
 * Retient un point de vigilance. Il naît 'active' et le RESTE : une vigilance ne
 * devient jamais une réserve automatiquement — la portée contractuelle d'une
 * réserve engage l'entreprise, et ce geste appartient à l'humain.
 */
export async function createWatchpoint(input: CreateWatchpointInput): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('site_watchpoints')
    .insert({
      organization_id: input.organizationId,
      site_id: input.siteId,
      title: input.title.trim(),
      body: input.body?.trim() || null,
      report_id: input.reportId ?? null,
      source_capture_ids: input.sourceCaptureIds ?? [],
      confirmed_by: input.confirmedBy,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  invalidateSiteProjection(input.siteId)
  return (data as { id: string }).id
}
