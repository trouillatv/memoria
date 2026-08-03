// Lot — Liens causaux entre fils thématiques inter-PV (mig 269)
//
// Doctrine :
//   status='confirmed' avec source='human' = seule source de vérité du graphe.
//   status='suggested' = aide à la décision, jamais affiché comme certitude.
//
// Convention de lecture :
//   from_thread_id ──link_type──▶ to_thread_id
//   La flèche va du préalable / de la cause vers la conséquence.
//   Ex. : Rapport G3 ──enables──▶ Validation MOE

import { createAdminClient } from '@/lib/supabase/admin'

export type SubjectLinkType = 'requires' | 'enables' | 'causes' | 'validates' | 'replaces' | 'relates_to'
export type SubjectLinkStatus = 'suggested' | 'confirmed' | 'rejected'
export type SubjectLinkSource = 'human' | 'extraction' | 'cooccurrence'

export interface SubjectThreadLink {
  id: string
  siteId: string
  fromThreadId: string
  toThreadId: string
  linkType: SubjectLinkType
  status: SubjectLinkStatus
  source: SubjectLinkSource
  confidence: number | null
  justification: string | null
  createdBy: string | null
  confirmedBy: string | null
  confirmedAt: string | null
  createdAt: string
  evidenceRunId: string | null
  evidenceProposalId: string | null
  // Champs joints optionnels (pour l'affichage)
  fromLabel?: string | null
  toLabel?: string | null
}

export const LINK_TYPE_LABELS: Record<SubjectLinkType, { label: string; description: string }> = {
  requires:   { label: 'nécessite',     description: "Ce sujet requiert l'autre au préalable" },
  enables:    { label: 'permet',        description: "Ce sujet rend l'autre possible" },
  causes:     { label: 'entraîne',      description: "Ce sujet provoque ou déclenche l'autre" },
  validates:  { label: 'valide',        description: "Ce sujet valide ou qualifie l'autre" },
  replaces:   { label: 'remplace',      description: "Ce sujet rend l'autre obsolète" },
  relates_to: { label: 'est associé à', description: 'Lien thématique sans causalité directe' },
}

type RawRow = {
  id: string
  site_id: string
  from_thread_id: string
  to_thread_id: string
  link_type: string
  status: string
  source: string
  confidence: number | null
  justification: string | null
  created_by: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  created_at: string
  evidence_run_id: string | null
  evidence_proposal_id: string | null
}

function mapRow(r: RawRow): SubjectThreadLink {
  return {
    id: r.id,
    siteId: r.site_id,
    fromThreadId: r.from_thread_id,
    toThreadId: r.to_thread_id,
    linkType: r.link_type as SubjectLinkType,
    status: r.status as SubjectLinkStatus,
    source: r.source as SubjectLinkSource,
    confidence: r.confidence,
    justification: r.justification,
    createdBy: r.created_by,
    confirmedBy: r.confirmed_by,
    confirmedAt: r.confirmed_at,
    createdAt: r.created_at,
    evidenceRunId: r.evidence_run_id,
    evidenceProposalId: r.evidence_proposal_id,
  }
}

/**
 * Retourne tous les liens (sortants + entrants) pour un fil thématique donné.
 * Les liens rejected sont exclus par défaut.
 */
export async function listLinksForThread(
  threadId: string,
  { includeRejected = false }: { includeRejected?: boolean } = {},
): Promise<{ outgoing: SubjectThreadLink[]; incoming: SubjectThreadLink[] }> {
  const supabase = createAdminClient()

  let outQuery = supabase
    .from('subject_thread_links')
    .select('*')
    .eq('from_thread_id', threadId)
  if (!includeRejected) outQuery = outQuery.neq('status', 'rejected')

  let inQuery = supabase
    .from('subject_thread_links')
    .select('*')
    .eq('to_thread_id', threadId)
  if (!includeRejected) inQuery = inQuery.neq('status', 'rejected')

  const [outRaw, inRaw] = await Promise.all([outQuery, inQuery])

  if (outRaw.error) throw new Error(outRaw.error.message)
  if (inRaw.error) throw new Error(inRaw.error.message)

  return {
    outgoing: ((outRaw.data ?? []) as RawRow[]).map(mapRow),
    incoming: ((inRaw.data ?? []) as RawRow[]).map(mapRow),
  }
}

/**
 * Retourne tous les liens confirmés pour un chantier (pour le graphe global).
 */
export async function listConfirmedLinksForSite(siteId: string): Promise<SubjectThreadLink[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('subject_thread_links')
    .select('*')
    .eq('site_id', siteId)
    .eq('status', 'confirmed')
  if (error) throw new Error(error.message)
  return ((data ?? []) as RawRow[]).map(mapRow)
}

/**
 * Crée un lien manuel (source='human', status='confirmed' par défaut).
 */
export async function createSubjectLink(input: {
  siteId: string
  fromThreadId: string
  toThreadId: string
  linkType: SubjectLinkType
  justification?: string | null
  createdBy: string
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('subject_thread_links')
    .insert({
      site_id: input.siteId,
      from_thread_id: input.fromThreadId,
      to_thread_id: input.toThreadId,
      link_type: input.linkType,
      status: 'confirmed',
      source: 'human',
      justification: input.justification ?? null,
      created_by: input.createdBy,
      confirmed_by: input.createdBy,
      confirmed_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

/**
 * Confirme un lien suggéré.
 */
export async function confirmSubjectLink(linkId: string, confirmedBy: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('subject_thread_links')
    .update({ status: 'confirmed', confirmed_by: confirmedBy, confirmed_at: new Date().toISOString() })
    .eq('id', linkId)
  if (error) throw new Error(error.message)
}

/**
 * Rejette un lien (suggested ou confirmed).
 */
export async function rejectSubjectLink(linkId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('subject_thread_links')
    .update({ status: 'rejected' })
    .eq('id', linkId)
  if (error) throw new Error(error.message)
}

/**
 * Compte les suggestions en attente (status='suggested') par canonical_subject_id pour un chantier.
 * Retourne un Record canonicalSubjectId → nombre de suggestions impliquant ce sujet.
 */
export async function getSuggestedLinkCountsBySite(siteId: string): Promise<Record<string, number>> {
  const supabase = createAdminClient()

  const { data: links } = await supabase
    .from('subject_thread_links')
    .select('from_thread_id, to_thread_id')
    .eq('site_id', siteId)
    .eq('status', 'suggested')

  if (!links?.length) return {}

  const threadIds = new Set<string>()
  for (const l of links as Array<{ from_thread_id: string; to_thread_id: string }>) {
    threadIds.add(l.from_thread_id)
    threadIds.add(l.to_thread_id)
  }

  const { data: stiRows } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .in('subject_thread_id', [...threadIds])
    .eq('site_id', siteId)

  const threadToCs = new Map<string, string>(
    ((stiRows ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>)
      .map((r) => [r.subject_thread_id, r.canonical_subject_id])
  )

  const counts: Record<string, number> = {}
  for (const l of links as Array<{ from_thread_id: string; to_thread_id: string }>) {
    const fromCs = threadToCs.get(l.from_thread_id)
    const toCs   = threadToCs.get(l.to_thread_id)
    if (fromCs) counts[fromCs] = (counts[fromCs] ?? 0) + 1
    if (toCs && toCs !== fromCs) counts[toCs] = (counts[toCs] ?? 0) + 1
  }

  return counts
}

/**
 * Supprime définitivement un lien (uniquement les liens humains confirmés).
 */
export async function deleteSubjectLink(linkId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('subject_thread_links')
    .delete()
    .eq('id', linkId)
    .eq('source', 'human')
  if (error) throw new Error(error.message)
}

/**
 * Retourne les labels canoniques des threads voisins d'un fil (pour l'affichage).
 * Charge les proposals les plus récentes pour chaque thread.
 */
export async function getThreadLabelsForSite(siteId: string): Promise<Map<string, string>> {
  const supabase = createAdminClient()
  // Sélectionne le label de la proposition la plus récente par thread
  const { data, error } = await supabase
    .from('document_extraction_proposal')
    .select('subject_thread_id, label, extraction_run_id')
    .eq('target_site_id', siteId)
    .not('subject_thread_id', 'is', null)
  if (error) throw new Error(error.message)

  type Row = { subject_thread_id: string; label: string; extraction_run_id: string }
  const rows = (data ?? []) as Row[]

  // Dernier label par thread (on prend simplement le dernier trouvé dans la liste)
  const map = new Map<string, string>()
  for (const row of rows) {
    map.set(row.subject_thread_id, row.label)
  }
  return map
}
