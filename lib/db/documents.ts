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
import { getOrgId } from '@/lib/db/users'
import { getOrgIdsOfUser, requireOrganizationMembership } from '@/lib/auth/memberships'
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
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('document_collections')
    .insert({
      name: input.name,
      scope_type: input.scope_type ?? null,
      scope_id: input.scope_id ?? null,
      ...(orgId ? { organization_id: orgId } : {}),
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function listDocumentCollections(): Promise<DbDocumentCollection[]> {
  const supabase = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return []
  let q = supabase.from('document_collections').select('*').is('deleted_at', null)
    .order('position', { ascending: true }).order('name', { ascending: true })
  q = q.in('organization_id', orgIds)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DbDocumentCollection[]
}

/** Renomme une collection. */
export async function renameDocumentCollection(id: string, name: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('document_collections').update({ name }).eq('id', id)
  if (error) throw error
}

/** Réordonne les collections : position = index dans la liste fournie. */
export async function reorderDocumentCollections(orderedIds: string[]): Promise<void> {
  const supabase = createAdminClient()
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from('document_collections').update({ position: i }).eq('id', id),
    ),
  )
}

/**
 * Supprime une collection (soft delete). Deux modes pour ses documents :
 *  - 'cascade' : soft-delete aussi les documents de la collection.
 *  - 'orphan'  : détache les documents (collection_id = null) → « Sans collection ».
 */
export async function deleteDocumentCollection(
  id: string,
  mode: 'cascade' | 'orphan',
): Promise<void> {
  const supabase = createAdminClient()
  const now = new Date().toISOString()
  if (mode === 'cascade') {
    const { error: docErr } = await supabase
      .from('documents')
      .update({ deleted_at: now })
      .eq('collection_id', id)
      .is('deleted_at', null)
    if (docErr) throw docErr
  } else {
    const { error: orphanErr } = await supabase
      .from('documents')
      .update({ collection_id: null })
      .eq('collection_id', id)
      .is('deleted_at', null)
    if (orphanErr) throw orphanErr
  }
  const { error } = await supabase
    .from('document_collections')
    .update({ deleted_at: now })
    .eq('id', id)
  if (error) throw error
}

/** Documents sans collection (orphelins) — groupe « Sans collection ». */
export async function listOrphanDocuments(): Promise<DbDocument[]> {
  const supabase = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return []
  let q = supabase.from('documents').select('*').is('collection_id', null).is('deleted_at', null).order('created_at', { ascending: false })
  q = q.in('organization_id', orgIds)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DbDocument[]
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
  /** Couche mémoire (vivante/consultable/froide) décidée à l'ingestion. */
  memory_tier?: 'vivante' | 'consultable' | 'froide' | null
  /** Statut initial — 'ready' pour un document volontairement NON indexé. */
  analysis_status?: DbDocument['analysis_status']
  created_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  // Doctrine M3 : org de la COLLECTION, jamais de la session.
  const { data: coll } = await supabase
    .from('document_collections')
    .select('organization_id')
    .eq('id', input.collection_id)
    .maybeSingle()
  if (!coll?.organization_id) throw new Error('Collection introuvable ou sans organisation')
  const orgId = coll.organization_id
  const membership = await requireOrganizationMembership(orgId)
  if (!membership.ok) throw new Error(membership.error)
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
      memory_tier: input.memory_tier ?? null,
      analysis_status: input.analysis_status ?? 'pending',
      created_by: input.created_by,
      organization_id: orgId,
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

/** Déplace un document vers une autre collection (ou null = « Sans collection »). */
export async function moveDocumentToCollection(
  documentId: string,
  collectionId: string | null,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('documents')
    .update({ collection_id: collectionId })
    .eq('id', documentId)
    .is('deleted_at', null)
  if (error) throw error
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
  /** Référence libre (chapitre/article/page) — uniquement pour les liens
   *  obligation↔document (mig 151). Saisie humaine, jamais dérivée. */
  referenceLabel?: string | null,
): Promise<void> {
  const supabase = createAdminClient()
  const ref = referenceLabel?.trim() || null
  // upsert : si le lien existe déjà, on met à jour la référence (pas ignoreDuplicates
  // ici — la référence doit pouvoir être corrigée).
  const { error } = await supabase
    .from('document_links')
    .upsert(
      { document_id: documentId, target_type: targetType, target_id: targetId, reference_label: ref },
      { onConflict: 'document_id,target_type,target_id' },
    )
  if (error) throw error
}

export interface LinkedDocument {
  linkId: string
  documentId: string
  filename: string
  documentType: string
  referenceLabel: string | null
}

/** Documents liés à un (ou plusieurs) target(s) avec leur référence libre.
 *  Sert le bloc « Document lié » des obligations (et le surfaçage briefing). */
export async function listLinkedDocumentsForTargets(
  targetType: DocumentTargetType,
  targetIds: string[],
): Promise<Map<string, LinkedDocument[]>> {
  const out = new Map<string, LinkedDocument[]>()
  if (targetIds.length === 0) return out
  const supabase = createAdminClient()
  const { data: links } = await supabase
    .from('document_links')
    .select('id, document_id, target_id, reference_label')
    .eq('target_type', targetType)
    .in('target_id', targetIds)
  const rows = (links ?? []) as Array<{ id: string; document_id: string; target_id: string; reference_label: string | null }>
  if (rows.length === 0) return out
  const docIds = [...new Set(rows.map((r) => r.document_id))]
  const { data: docs } = await supabase
    .from('documents')
    .select('id, filename, document_type')
    .in('id', docIds)
    .is('deleted_at', null)
  const docById = new Map(((docs ?? []) as Array<{ id: string; filename: string; document_type: string }>).map((d) => [d.id, d]))
  for (const r of rows) {
    const d = docById.get(r.document_id)
    if (!d) continue
    const arr = out.get(r.target_id) ?? []
    arr.push({ linkId: r.id, documentId: r.document_id, filename: d.filename, documentType: d.document_type, referenceLabel: r.reference_label })
    out.set(r.target_id, arr)
  }
  return out
}

/** Retire un lien document↔target (par id de lien). */
export async function removeDocumentLink(linkId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('document_links').delete().eq('id', linkId)
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

// --- Rattachements résolus en libellés (« Contrat X · Client Y ») ----------
// Modèle : un document = 1 nœud, document_links polymorphe → N rattachements.
// Batch : 1 requête liens + 1 requête par type d'entité (jamais N×M).

export interface DocLinkLabel {
  type: DocumentTargetType
  label: string
}

const TARGET_LABEL_SOURCE: Partial<Record<DocumentTargetType, { table: string; nameCol: string }>> = {
  contract: { table: 'contracts', nameCol: 'name' },
  site: { table: 'sites', nameCol: 'name' },
  client: { table: 'clients', nameCol: 'name' },
  tender: { table: 'tenders', nameCol: 'title' },
  team: { table: 'teams', nameCol: 'name' },
}

export async function getDocumentLinkLabels(
  documentIds: string[],
): Promise<Map<string, DocLinkLabel[]>> {
  const out = new Map<string, DocLinkLabel[]>()
  if (documentIds.length === 0) return out
  const supabase = createAdminClient()

  const { data: links } = await supabase
    .from('document_links')
    .select('document_id, target_type, target_id')
    .in('document_id', documentIds)
  const rows = (links ?? []) as Array<{ document_id: string; target_type: DocumentTargetType; target_id: string }>
  if (rows.length === 0) return out

  // Collecte des target_id par type, puis résolution batch des noms.
  const idsByType = new Map<DocumentTargetType, Set<string>>()
  for (const r of rows) {
    if (!idsByType.has(r.target_type)) idsByType.set(r.target_type, new Set())
    idsByType.get(r.target_type)!.add(r.target_id)
  }
  const labelByKey = new Map<string, string>() // `${type}:${id}` -> label
  for (const [type, ids] of idsByType) {
    const src = TARGET_LABEL_SOURCE[type]
    if (!src) continue
    const { data } = await supabase
      .from(src.table)
      .select(`id, ${src.nameCol}`)
      .in('id', Array.from(ids))
    for (const d of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      labelByKey.set(`${type}:${d.id as string}`, (d[src.nameCol] as string) ?? '—')
    }
  }

  for (const r of rows) {
    const label = labelByKey.get(`${r.target_type}:${r.target_id}`)
    if (!label) continue // entité supprimée / introuvable : on n'affiche pas un UUID
    if (!out.has(r.document_id)) out.set(r.document_id, [])
    out.get(r.document_id)!.push({ type: r.target_type, label })
  }
  return out
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
