// Architecture documentaire générique — couche DB (migration 073, phase 1).
//
// Spec : docs/superpowers/specs/2026-05-19-document-lifecycle-design.md.
// Le document est un nœud du graphe mémoire (pas un fichier attaché). Cette
// couche est volontairement MINCE : CRUD + liens + statut. L'upload,
// l'extraction, le chunking/embeddings (réutilisant le pipeline existant) =
// phase 2 ; la visionneuse + filtrage visibility_level = phase 3.
//
// Doctrine : aucun accès indexé par personne ; l'audit ouverture/
// téléchargement (logAuditEvent) se fait au niveau Server Action (phase 3),
// pas ici. visibility_level est filtré au niveau applicatif/chunk metadata.
// Discipline coût IA : analysé UNE fois (analysis_status), jamais au render.

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  DbDocument,
  DbDocumentCollection,
  DbDocumentLink,
  DocumentAnalysisStatus,
  DocumentTargetType,
} from '@/types/db'

// --- Collections (C : obligatoire à l'upload) -------------------------------

export async function createDocumentCollection(input: {
  name: string
  scope_type?: string | null
  scope_id?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('document_collections')
    .insert({
      name: input.name,
      scope_type: input.scope_type ?? null,
      scope_id: input.scope_id ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function listDocumentCollections(): Promise<DbDocumentCollection[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('document_collections')
    .select('*')
    .is('deleted_at', null)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as DbDocumentCollection[]
}

// --- Documents --------------------------------------------------------------

/**
 * Crée un document (métadonnées + chemin storage). `collection_id` est
 * OBLIGATOIRE (décision C). `analysis_status` démarre à 'pending' : le
 * pipeline async (phase 2) le fera évoluer ; jamais déclenché à l'affichage.
 */
export async function createDocument(input: {
  collection_id: string
  document_type: DbDocument['document_type']
  storage_path: string
  filename: string
  visibility_level?: DbDocument['visibility_level']
  tags?: string[]
  size_bytes?: number | null
  page_count?: number | null
  content_hash?: string | null
  effective_date?: string | null
  expires_date?: string | null
  supersedes_document_id?: string | null
  created_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('documents')
    .insert({
      collection_id: input.collection_id,
      document_type: input.document_type,
      storage_path: input.storage_path,
      filename: input.filename,
      visibility_level: input.visibility_level ?? 'manager',
      tags: input.tags ?? [],
      size_bytes: input.size_bytes ?? null,
      page_count: input.page_count ?? null,
      content_hash: input.content_hash ?? null,
      effective_date: input.effective_date ?? null,
      expires_date: input.expires_date ?? null,
      supersedes_document_id: input.supersedes_document_id ?? null,
      analysis_status: 'pending',
      created_by: input.created_by,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function getDocument(id: string): Promise<DbDocument | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return (data as DbDocument | null) ?? null
}

export async function listDocumentsByCollection(
  collectionId: string,
): Promise<DbDocument[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('collection_id', collectionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as DbDocument[]
}

/**
 * Documents rattachés à une entité (contrat, site, AO…). Le contrat
 * (tranche 4 V6.3) est un simple consommateur : `listDocumentsForTarget
 * ('contract', contractId)`.
 */
export async function listDocumentsForTarget(
  targetType: DocumentTargetType,
  targetId: string,
): Promise<DbDocument[]> {
  const supabase = createAdminClient()
  const { data: links, error: lErr } = await supabase
    .from('document_links')
    .select('document_id')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
  if (lErr) throw lErr
  const ids = (links ?? []).map((l) => (l as { document_id: string }).document_id)
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .in('id', ids)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as DbDocument[]
}

// --- Liens polymorphes (A) --------------------------------------------------

export async function addDocumentLink(
  documentId: string,
  targetType: DocumentTargetType,
  targetId: string,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('document_links')
    .upsert(
      { document_id: documentId, target_type: targetType, target_id: targetId },
      { onConflict: 'document_id,target_type,target_id', ignoreDuplicates: true },
    )
  if (error) throw error
}

export async function listDocumentLinks(documentId: string): Promise<DbDocumentLink[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('document_links')
    .select('*')
    .eq('document_id', documentId)
  if (error) throw error
  return (data ?? []) as DbDocumentLink[]
}

// --- Pipeline (I) : statut d'analyse ---------------------------------------

/**
 * Transition de `analysis_status` (pipeline async phase 2 / relance explicite
 * « Réanalyser »). Jamais appelé depuis un render. `failed_reason` posé
 * uniquement quand status='failed'.
 */
export async function updateDocumentAnalysisStatus(
  id: string,
  status: DocumentAnalysisStatus,
  failedReason?: string | null,
): Promise<void> {
  const supabase = createAdminClient()
  const patch: Record<string, unknown> = {
    analysis_status: status,
    updated_at: new Date().toISOString(),
  }
  if (status === 'failed') patch.failed_reason = failedReason ?? 'unknown'
  else patch.failed_reason = null
  const { error } = await supabase.from('documents').update(patch).eq('id', id)
  if (error) throw error
}

/**
 * Soft-delete d'un document + nettoyage des dérivés IA.
 *
 * Doctrine : on conserve la trace historique (deleted_at, jamais hard
 * delete du document ni du fichier storage — restauration possible,
 * audit préservé). En revanche, on supprime/staled les artefacts IA
 * qui pourraient ressurgir dans une lecture :
 *
 *  - `knowledge_chunks` (source_domain='document') → DELETE hard
 *    (regenerable depuis le fichier si restauration, et leur présence
 *    fait fuiter le contenu dans matchAoToKnowledge / recalls).
 *  - `site_reading_candidates` où source_ids[0].id = doc.id → status='stale'
 *    (préserve l'historique des résonances émises, ne re-render plus).
 *
 * Le fichier dans le bucket `documents` est CONSERVÉ (pattern soft delete).
 * Une purge définitive est une décision séparée (non couverte ici).
 *
 * Idempotent : ré-appel sur un doc déjà supprimé fait juste rien.
 */
export async function softDeleteDocument(id: string): Promise<void> {
  const supabase = createAdminClient()
  const now = new Date().toISOString()

  // 1. Marquer le doc supprimé
  const { error: docErr } = await supabase
    .from('documents')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', id)
    .is('deleted_at', null)
  if (docErr) throw docErr

  // 2. Nettoyer knowledge_chunks (re-générables si restauration)
  await supabase
    .from('knowledge_chunks')
    .delete()
    .eq('source_domain', 'document')
    .eq('source_id', id)

  // 3. Staler les résonances qui ont ce doc comme source primaire
  //    (B1 + B2). Filtre côté JS sur source_ids[0].id car PostgREST ne
  //    permet pas un filtre direct sur l'élément 0 d'un jsonb array.
  const { data: candidates } = await supabase
    .from('site_reading_candidates')
    .select('id, source_ids')
    .like('algorithm_version', 'b%_doc_%')
    .eq('status', 'active')
  const toStale = (candidates ?? [])
    .filter((r) => {
      const src = (r as { source_ids: Array<{ type: string; id: string }> }).source_ids ?? []
      return src.length > 0 && src[0]?.id === id
    })
    .map((r) => (r as { id: string }).id)
  if (toStale.length > 0) {
    await supabase
      .from('site_reading_candidates')
      .update({ status: 'stale' })
      .in('id', toStale)
  }
}

/**
 * Pose le texte extrait + la source d'extraction (pipeline analyzeDocument,
 * phase 2). Déterministe : aucune génération LLM. Appelé une seule fois par
 * analyse (ou relance « Réanalyser »), jamais à l'affichage.
 */
export async function setDocumentExtraction(
  id: string,
  input: {
    extracted_text: string
    extraction_source: 'native' | 'ocr'
    page_count?: number | null
  },
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('documents')
    .update({
      extracted_text: input.extracted_text,
      extraction_source: input.extraction_source,
      page_count: input.page_count ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}
