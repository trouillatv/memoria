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
  /** Idempotence Copilote (P4-C) — clé générée côté client, absente hors Copilote. */
  copilotProposalId?: string | null
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
      copilot_proposal_id: input.copilotProposalId ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  // La MUTATION invalide la projection — jamais l'écran.
  invalidateSiteProjection(input.siteId)
  return (data as { id: string }).id
}

/** Une entrée de la mémoire, telle que les surfaces la lisent. */
export interface KnowledgeEntry {
  id: string
  kind: KnowledgeEntryKind
  title: string
  body: string | null
  sourceReportId: string | null
  validFrom: string
  confirmedAt: string
}

/**
 * CE QUE LE CHANTIER SAIT — lu depuis l'objet réel, jamais depuis la proposition
 * qui l'a fait naître. Lire le statut de la proposition dirait « confirmé » sans
 * jamais dire CE QUI a été retenu ni sous quelle nature : la question posée à
 * l'humain (« vraie en ce moment, ou durablement ? ») resterait sans effet
 * visible — et une question dont la réponse ne sert à rien ne se pose pas.
 *
 * 'superseded' et 'archived' sortent de la lecture courante : une information
 * remplacée ne disparaît pas, elle cesse d'être ce que le chantier sait.
 */
export async function listKnowledgeEntries(siteId: string): Promise<KnowledgeEntry[]> {
  const { data } = await createAdminClient()
    .from('site_knowledge_entries')
    .select('id, kind, title, body, source_report_id, valid_from, confirmed_at')
    .eq('site_id', siteId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('confirmed_at', { ascending: false })
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    kind: r.kind as KnowledgeEntryKind,
    title: r.title as string,
    body: (r.body as string) ?? null,
    sourceReportId: (r.source_report_id as string) ?? null,
    validFrom: r.valid_from as string,
    confirmedAt: r.confirmed_at as string,
  }))
}

/**
 * P5-F2a — geste humain explicite (bouton « Marquer comme obsolète »), jamais
 * une expiration automatique : aucun TTL, aucun cron, aucun calcul d'âge ne
 * doit jamais appeler cette fonction. Idempotent : archiver une entrée déjà
 * 'superseded' ou 'archived' ne fait rien (pas d'erreur — un second clic ne
 * doit pas surprendre l'utilisateur). `siteId` revérifié dans le WHERE, en
 * plus du contrôle d'accès fait par l'appelant (défense en profondeur, même
 * discipline que supersede_knowledge_entry).
 */
export async function archiveKnowledgeEntry(entryId: string, siteId: string): Promise<void> {
  await createAdminClient()
    .from('site_knowledge_entries')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', entryId)
    .eq('site_id', siteId)
    .eq('status', 'active')
  invalidateSiteProjection(siteId)
}

export interface SupersedeKnowledgeEntryInput {
  organizationId: string
  siteId: string
  oldEntryId: string
  title: string
  body?: string | null
  sourceReportId?: string | null
  confirmedBy: string | null
  /** Idempotence — même discipline que tous les autres writers Copilote. */
  copilotProposalId: string
}

export type SupersedeKnowledgeEntryResult =
  | { ok: true; newEntryId: string }
  | { ok: false; error: string }

/**
 * P5-F2a — supersession explicite : déclenchée UNIQUEMENT par un langage de
 * correction repéré dans la phrase (« finalement… », « correction, ce n'est
 * plus X, c'est Y »), jamais par une simple ressemblance de sujet. Passe par
 * la RPC transactionnelle `supersede_knowledge_entry` (mig 334, SECURITY
 * DEFINER) : soit la nouvelle entrée existe et l'ancienne est supersédée, soit
 * rien ne change — deux écritures JS successives ne peuvent pas garantir cet
 * invariant. La RPC porte ses propres gardes (entrée active, current_information
 * uniquement en V1, organization_id/site_id vérifiés) ; ce wrapper ne fait que
 * l'idempotence, comme tous les autres writers Copilote.
 *
 * Primitive testée dès F2a — sans parcours UI de recherche de candidat : ce
 * parcours (proposer les 5 entrées actives les plus récentes, aucune
 * présélection) est le premier consommateur naturel de F2b.
 */
export async function supersedeKnowledgeEntry(input: SupersedeKnowledgeEntryInput): Promise<SupersedeKnowledgeEntryResult> {
  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut créer qu'une seule supersession.
  const { data: existing } = await admin
    .from('site_knowledge_entries')
    .select('id')
    .eq('copilot_proposal_id', input.copilotProposalId)
    .maybeSingle()
  if (existing) {
    return { ok: true, newEntryId: (existing as { id: string }).id }
  }

  const { data, error } = await admin.rpc('supersede_knowledge_entry', {
    p_old_entry_id: input.oldEntryId,
    p_organization_id: input.organizationId,
    p_site_id: input.siteId,
    p_title: input.title.trim(),
    p_body: input.body?.trim() || null,
    p_source_report_id: input.sourceReportId ?? null,
    p_confirmed_by: input.confirmedBy,
    p_copilot_proposal_id: input.copilotProposalId,
  })
  if (error || !data) return { ok: false, error: error?.message ?? 'Supersession impossible.' }

  invalidateSiteProjection(input.siteId)
  return { ok: true, newEntryId: data as string }
}

export interface Watchpoint {
  id: string
  title: string
  body: string | null
  sourceReportId: string | null
  confirmedAt: string
}

/** Les points de vigilance ACTIFS — ceux que personne n'a levés ni convertis. */
export async function listWatchpoints(siteId: string): Promise<Watchpoint[]> {
  const { data } = await createAdminClient()
    .from('site_watchpoints')
    .select('id, title, body, report_id, confirmed_at')
    .eq('site_id', siteId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('confirmed_at', { ascending: false })
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    body: (r.body as string) ?? null,
    sourceReportId: (r.report_id as string) ?? null,
    confirmedAt: r.confirmed_at as string,
  }))
}

export interface CreateWatchpointInput {
  organizationId: string
  siteId: string
  title: string
  body?: string | null
  reportId?: string | null
  sourceCaptureIds?: string[]
  confirmedBy: string | null
  /** Idempotence Copilote (P4-E1) — clé générée côté client, absente hors Copilote. */
  copilotProposalId?: string | null
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
      copilot_proposal_id: input.copilotProposalId ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  invalidateSiteProjection(input.siteId)
  return (data as { id: string }).id
}
