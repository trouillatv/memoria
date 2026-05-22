'use server'

// Phase 2 documents (spec 2026-05-19). Server Action upload UNIQUEMENT :
// stockage + métadonnées + lien optionnel + audit, puis analyse async
// fire-and-forget (analyzeDocument). Pas de visionneuse, pas d'injection
// agents, pas de bulk import (phases ultérieures). Zéro génération LLM.

import { z } from 'zod'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit/log'
import { getUserRoleById } from '@/lib/db/users'
import {
  createDocument,
  addDocumentLink,
  createDocumentCollection,
  updateDocumentAnalysisStatus,
  softDeleteDocument,
  getDocument,
} from '@/lib/db/documents'
import { analyzeDocument } from '@/lib/documents/analyze'

async function requireManagerOrAdmin(): Promise<string> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') throw new Error('Forbidden')
  return user.id
}

const MAX_PDF_BYTES = 20 * 1024 * 1024 // 20 MB

const DOCUMENT_TYPES = [
  'contrat', 'avenant', 'procedure', 'protocole', 'plan_acces', 'securite',
  'ao', 'memoire_technique', 'reference', 'litige', 'facture', 'preuve', 'autre',
] as const
const VISIBILITY = [
  'admin_only', 'manager', 'operations', 'field', 'client_portal',
] as const
const TARGET_TYPES = [
  'contract', 'site', 'tender', 'client', 'intervention', 'team', 'tenant',
] as const

const uploadSchema = z
  .object({
    // C : collection OBLIGATOIRE à l'upload.
    collection_id: z.string().uuid('Collection obligatoire'),
    // B : document_type OBLIGATOIRE.
    document_type: z.enum(DOCUMENT_TYPES),
    visibility_level: z.enum(VISIBILITY).optional(),
    tags: z.string().max(300).optional(), // CSV → string[]
    // Liens OPTIONNELS (A) : les deux ou aucun.
    target_type: z.enum(TARGET_TYPES).optional(),
    target_id: z.string().uuid().optional(),
    effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    expires_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // Tri d'ingestion (l'humain valide) : indexer (embedding) ou non, + couche.
    embed: z.enum(['true', 'false']).optional(),
    memory_tier: z.enum(['vivante', 'consultable', 'froide']).optional(),
  })
  .refine(
    (d) => (d.target_type ? !!d.target_id : !d.target_id),
    { message: 'target_type et target_id vont ensemble' },
  )

const collectionSchema = z.object({
  name: z.string().trim().min(2, 'Nom trop court').max(120),
  scope_type: z.string().max(40).optional(),
  scope_id: z.string().uuid().optional(),
})

export async function createDocumentCollectionAction(
  formData: FormData,
): Promise<{ ok: boolean; collectionId?: string; error?: string }> {
  let userId: string
  try {
    userId = await requireManagerOrAdmin()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Forbidden' }
  }
  void userId
  const parsed = collectionSchema.safeParse({
    name: formData.get('name'),
    scope_type: formData.get('scope_type') || undefined,
    scope_id: formData.get('scope_id') || undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }
  try {
    const collectionId = await createDocumentCollection({
      name: parsed.data.name,
      scope_type: parsed.data.scope_type ?? null,
      scope_id: parsed.data.scope_id ?? null,
    })
    return { ok: true, collectionId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Création échouée' }
  }
}

export interface UploadDocumentResult {
  ok: boolean
  documentId?: string
  error?: string
}

export async function uploadDocumentAction(
  formData: FormData,
): Promise<UploadDocumentResult> {
  let userId: string
  try {
    userId = await requireManagerOrAdmin()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Forbidden' }
  }

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'Fichier manquant' }
  if (file.type !== 'application/pdf') return { ok: false, error: 'Format PDF requis' }
  if (file.size > MAX_PDF_BYTES) return { ok: false, error: 'Fichier > 20 MB' }

  const parsed = uploadSchema.safeParse({
    collection_id: formData.get('collection_id'),
    document_type: formData.get('document_type'),
    visibility_level: formData.get('visibility_level') || undefined,
    tags: formData.get('tags') || undefined,
    target_type: formData.get('target_type') || undefined,
    target_id: formData.get('target_id') || undefined,
    effective_date: formData.get('effective_date') || undefined,
    expires_date: formData.get('expires_date') || undefined,
    embed: formData.get('embed') || undefined,
    memory_tier: formData.get('memory_tier') || undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }
  const input = parsed.data

  // Embedding SÉLECTIF (doctrine ingestion mémorielle) : on n'indexe que si
  // l'humain l'a validé. Défaut = indexer (rétro-compat) sauf 'false' explicite.
  // Un document non indexé est rangé en couche 'froide', statut 'ready' (pipeline
  // terminé sans chunks) — pas de coût d'embedding, pas de pollution du retrieval.
  //
  // GARDE-FOU SERVEUR : un litige n'est JAMAIS indexé automatiquement, quoi que
  // poste le client ([[litige-no-automatic-reading]]).
  const embed = input.document_type !== 'litige' && input.embed !== 'false'
  const memoryTier: 'vivante' | 'consultable' | 'froide' | null = embed
    ? (input.memory_tier ?? null)
    : 'froide'

  // Upload fichier (bucket privé `documents`, service-role bypass RLS).
  const supabase = createAdminClient()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  const storagePath = `${globalThis.crypto.randomUUID()}/${Date.now()}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false })
  if (uploadErr) {
    return { ok: false, error: `Upload échoué : ${uploadErr.message}` }
  }

  let documentId: string
  try {
    documentId = await createDocument({
      collection_id: input.collection_id,
      document_type: input.document_type,
      storage_path: storagePath,
      filename: file.name,
      visibility_level: input.visibility_level,
      tags: input.tags
        ? input.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20)
        : undefined,
      size_bytes: file.size,
      effective_date: input.effective_date ?? null,
      expires_date: input.expires_date ?? null,
      memory_tier: memoryTier,
      analysis_status: embed ? 'pending' : 'ready',
      created_by: userId,
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Création échouée' }
  }

  if (input.target_type && input.target_id) {
    await addDocumentLink(documentId, input.target_type, input.target_id)
  }

  await logAuditEvent({
    userId,
    entityType: 'document',
    entityId: documentId,
    action: 'created',
    metadata: {
      filename: file.name,
      document_type: input.document_type,
      collection_id: input.collection_id,
      memory_tier: memoryTier,
      indexed: embed,
      ...(input.target_type ? { target_type: input.target_type } : {}),
    },
  })

  // Embedding SÉLECTIF : on ne lance l'analyse (extraction + chunking +
  // embedding) QUE si l'humain a validé l'indexation. Sinon le document est
  // stocké en archive froide, sans coût IA ni pollution du retrieval.
  if (embed) {
    after(() => analyzeDocument(documentId))
  }

  return { ok: true, documentId }
}

// ===========================================================================
// Relancer l'analyse — manager+ only
// ===========================================================================
//
// Reset analysis_status à 'pending' + fire-and-forget analyzeDocument.
// À la fin du pipeline ('ready'), B1 et B2 ré-firent automatiquement
// via les hooks existants dans analyze.ts.
//
// Idempotent : si déjà en cours (pending/extracting/ocr/chunking), refuse
// avec un message clair plutôt que de relancer en double.

const relaunchSchema = z.object({ document_id: z.string().uuid() })

export async function relaunchDocumentAnalysisAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  let userId: string
  try {
    userId = await requireManagerOrAdmin()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Forbidden' }
  }

  const parsed = relaunchSchema.safeParse({ document_id: formData.get('document_id') })
  if (!parsed.success) return { ok: false, error: 'document_id invalide' }

  const doc = await getDocument(parsed.data.document_id)
  if (!doc || doc.deleted_at) return { ok: false, error: 'Document introuvable' }

  // Idempotence : refuse si analyse en cours (sinon double pipeline).
  const inFlight = ['pending', 'extracting', 'ocr', 'chunking']
  if (inFlight.includes(doc.analysis_status)) {
    return { ok: false, error: 'Analyse déjà en cours' }
  }

  try {
    await updateDocumentAnalysisStatus(parsed.data.document_id, 'pending')
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Reset status échoué' }
  }

  await logAuditEvent({
    userId,
    entityType: 'document',
    entityId: parsed.data.document_id,
    action: 'analysis_relaunched',
    metadata: {
      previous_status: doc.analysis_status,
      filename: doc.filename,
    },
  })

  // Fire-and-forget — B1+B2 firent automatiquement via les hooks de
  // analyzeDocument à la fin du pipeline.
  after(() => analyzeDocument(parsed.data.document_id))

  revalidatePath(`/documents/${parsed.data.document_id}`)
  return { ok: true }
}

// ===========================================================================
// Soft delete document — manager+ only
// ===========================================================================
//
// Doctrine : on conserve la trace historique (deleted_at), on nettoie les
// dérivés IA qui pourraient ressurgir (cf. softDeleteDocument dans
// lib/db/documents.ts) :
//  - knowledge_chunks → DELETE hard (anti-fuite recall)
//  - site_reading_candidates → status='stale' (préserve historique)
//  - storage : fichier CONSERVÉ (restauration possible, audit préservé)

const deleteSchema = z.object({ document_id: z.string().uuid() })

export async function deleteDocumentAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  let userId: string
  try {
    userId = await requireManagerOrAdmin()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Forbidden' }
  }

  const parsed = deleteSchema.safeParse({ document_id: formData.get('document_id') })
  if (!parsed.success) return { ok: false, error: 'document_id invalide' }

  const doc = await getDocument(parsed.data.document_id)
  if (!doc || doc.deleted_at) return { ok: false, error: 'Document introuvable' }

  try {
    await softDeleteDocument(parsed.data.document_id)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Suppression échouée' }
  }

  await logAuditEvent({
    userId,
    entityType: 'document',
    entityId: parsed.data.document_id,
    action: 'soft_deleted',
    metadata: {
      filename: doc.filename,
      document_type: doc.document_type,
      previous_status: doc.analysis_status,
    },
  })

  revalidatePath('/documents')
  return { ok: true }
}
