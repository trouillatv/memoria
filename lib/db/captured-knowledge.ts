// lib/db/captured-knowledge.ts
// La connaissance tacite captée (mig 170). Primitive NEUTRE qualifiée par `kind`
// (label extensible) et RELIÉE (site/sujet/action/zone). RÈGLE : jamais sans
// tentative de lien. V1 = saisie manuelle (l'IA proposera plus tard).

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
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
  const orgId = await getOrgId().catch(() => null)
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
  'id, site_id, source_type, source_id, kind, title, body, status, subject_id, action_id, zone_id, source_capture_ids, created_at'

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
