// lib/db/captured-knowledge.ts
// La connaissance tacite captée (mig 170). Primitive NEUTRE qualifiée par `kind`
// (label extensible) et RELIÉE (site/sujet/action/zone). RÈGLE : jamais sans
// tentative de lien. V1 = saisie manuelle (l'IA proposera plus tard).

import { createAdminClient } from '@/lib/supabase/admin'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { getOpenDossierIdForSite } from '@/lib/db/dossiers'

export type KnowledgeSourceType = 'visit' | 'meeting' | 'call' | 'manual'
export type KnowledgeStatus = 'active' | 'resolved' | 'obsolete' | 'dismissed'

export interface CapturedKnowledgeRow {
  id: string
  site_id: string
  source_type: KnowledgeSourceType
  source_id: string | null
  kind: string
  title: string
  body: string | null
  status: KnowledgeStatus
  /** Réponse trouvée quand une question est vérifiée (mig 178) — pas juste un statut. */
  resolution: string | null
  resolved_at: string | null
  subject_id: string | null
  action_id: string | null
  zone_id: string | null
  source_capture_ids: string[]
  created_at: string
}

export interface AddCapturedKnowledgeInput {
  siteId: string
  sourceType: KnowledgeSourceType
  sourceId?: string | null
  kind: string
  title: string
  body?: string | null
  subjectId?: string | null
  actionId?: string | null
  zoneId?: string | null
  sourceCaptureIds?: string[]
  createdBy: string | null
}

export async function addCapturedKnowledge(input: AddCapturedKnowledgeInput): Promise<string> {
  const supabase = createAdminClient()
  const { data: site } = await supabase.from('sites').select('organization_id').eq('id', input.siteId).maybeSingle()
  if (!site?.organization_id) throw new Error('Chantier introuvable ou sans organisation')
  const membership = await requireOrganizationMembership(site.organization_id)
  if (!membership.ok) throw new Error(membership.error)
  const orgId = site.organization_id
  // Rattache l'info au dossier d'opération ouvert du lieu (null si lieu legacy).
  const dossierId = await getOpenDossierIdForSite(input.siteId).catch(() => null)
  const { data, error } = await supabase
    .from('captured_knowledge')
    .insert({
      organization_id: orgId,
      site_id: input.siteId,
      dossier_id: dossierId,
      source_type: input.sourceType,
      source_id: input.sourceId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      subject_id: input.subjectId ?? null,
      action_id: input.actionId ?? null,
      zone_id: input.zoneId ?? null,
      source_capture_ids: input.sourceCaptureIds ?? [],
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

const SELECT =
  'id, site_id, source_type, source_id, kind, title, body, status, resolution, resolved_at, subject_id, action_id, zone_id, source_capture_ids, created_at'

/** Les infos utiles d'une source (ex. une visite) — pour le débrief. */
export async function listCapturedKnowledgeBySource(sourceId: string): Promise<CapturedKnowledgeRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('captured_knowledge')
    .select(SELECT)
    .eq('source_id', sourceId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CapturedKnowledgeRow[]
}

/** Les infos utiles rattachées à un point suivi — pour le dossier vivant. */
export async function listCapturedKnowledgeBySubject(subjectId: string): Promise<CapturedKnowledgeRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('captured_knowledge')
    .select(SELECT)
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CapturedKnowledgeRow[]
}

/** Change le statut d'une info captée (ex. question active → resolved). */
export async function setCapturedKnowledgeStatus(id: string, status: KnowledgeStatus): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('captured_knowledge')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/**
 * Vérifie une question EN CONSERVANT la réponse trouvée (mig 178). La valeur
 * d'un point à vérifier n'est pas « résolu » mais CE QU'ON A TROUVÉ — gardé pour
 * la réponse AO. La réponse est facultative (on peut clore sans), mais c'est le
 * chemin encouragé.
 */
export async function resolveCapturedKnowledgeWithAnswer(id: string, answer: string | null): Promise<void> {
  const supabase = createAdminClient()
  const trimmed = answer?.trim() || null
  const { error } = await supabase
    .from('captured_knowledge')
    .update({
      status: 'resolved',
      resolution: trimmed,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

/** Les points VÉRIFIÉS d'un dossier (question résolue + sa réponse) — pour les
 *  afficher « Q → R » et les verser dans la synthèse AO. Plus récents d'abord. */
export async function listResolvedQuestionsByDossier(
  dossierId: string,
): Promise<Array<{ id: string; question: string; answer: string | null; resolvedAt: string | null }>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('captured_knowledge')
    .select('id, title, resolution, resolved_at')
    .eq('dossier_id', dossierId)
    .eq('kind', 'question')
    .eq('status', 'resolved')
    .order('resolved_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; title: string; resolution: string | null; resolved_at: string | null }>)
    .map((r) => ({ id: r.id, question: r.title, answer: r.resolution, resolvedAt: r.resolved_at }))
}

/** Les infos utiles actives d'un DOSSIER (opération) — scopées à l'opération. */
export async function listActiveCapturedKnowledgeByDossier(dossierId: string, limit = 200): Promise<CapturedKnowledgeRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('captured_knowledge')
    .select(SELECT)
    .eq('dossier_id', dossierId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as CapturedKnowledgeRow[]
}

/** Les infos utiles actives d'un site (pour le futur « ressortir », plus tard). */
export async function listActiveCapturedKnowledgeBySite(siteId: string, limit = 100): Promise<CapturedKnowledgeRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('captured_knowledge')
    .select(SELECT)
    .eq('site_id', siteId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as CapturedKnowledgeRow[]
}
