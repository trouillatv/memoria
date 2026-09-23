'use server'

// Phase 2 documents (spec 2026-05-19). Server Action upload UNIQUEMENT :
// stockage + métadonnées + lien optionnel + audit, puis analyse async
// fire-and-forget (analyzeDocument). Pas de visionneuse, pas d'injection
// agents, pas de bulk import (phases ultérieures). Zéro génération LLM.

import { z } from 'zod'
import { createHash } from 'node:crypto'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit/log'
import { getUserRoleById } from '@/lib/db/users'
import { resolveCreationOrgId } from '@/lib/auth/creation-org'
import { requireOrganizationMembership, ACCES_REFUSE } from '@/lib/auth/memberships'
import {
  createDocument,
  addDocumentLink,
  createDocumentCollection,
  updateDocumentAnalysisStatus,
  updateDocumentMetadata,
  softDeleteDocument,
  getDocument,
  moveDocumentToCollection,
  renameDocumentCollection,
  reorderDocumentCollections,
  deleteDocumentCollection,
  getCollectionOrganizationId,
  findDocumentByHashInOrg,
} from '@/lib/db/documents'
import { getSiteById } from '@/lib/db/sites'
import { analyzeDocument } from '@/lib/documents/analyze'

async function requireManagerOrAdmin(): Promise<string> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') throw new Error('Forbidden')
  return user.id
}

/**
 * Authentification SEULE — aucun rôle global vérifié ici. En multi-organisation,
 * le rôle global du profil ne veut plus rien dire (`lib/auth/memberships.ts`) :
 * l'autorisation d'écrire dépend uniquement du rôle DANS l'organisation ciblée,
 * décidé plus loin via `requireOrganizationMembership().context.role`. Un
 * chef_equipe globalement mais manager dans l'organisation ciblée doit pouvoir
 * écrire ; exiger ici un rôle global manager/admin en plus le lui interdirait
 * à tort (symétrique du bug déjà corrigé côté appartenance).
 */
async function requireAuthenticatedUserId(): Promise<string> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return user.id
}

const MAX_PDF_BYTES = 20 * 1024 * 1024 // 20 MB

const DOCUMENT_TYPES = [
  'contrat', 'avenant', 'procedure', 'protocole', 'plan_acces', 'securite',
  'ao', 'memoire_technique', 'reference', 'litige', 'facture', 'preuve', 'autre',
  'historical_visit_report',
  'cctp', 'ccap', 'ordre_service',
] as const
const VISIBILITY = [
  'admin_only', 'manager', 'operations', 'field', 'client_portal',
] as const
const TARGET_TYPES = [
  'contract', 'site', 'tender', 'client', 'intervention', 'team', 'tenant',
] as const

// Types "génériques" (catch-all, non-informatifs) vs "spécifiques" (classification
// délibérée). Cette distinction pilote l'enrichissement de métadonnées sur
// dédoublonnage (cf. resolveMetadataEnrichment) : un import plus précis peut
// remplacer un type générique, jamais un type spécifique déjà posé.
const GENERIC_DOCUMENT_TYPES: readonly string[] = ['preuve', 'autre']

function isGenericDocumentType(type: string | null | undefined): boolean {
  return !type || GENERIC_DOCUMENT_TYPES.includes(type)
}

/**
 * Dédoublonnage par content_hash (Vincent 2026-09-24) : le hash répond
 * « même fichier ? », le nouvel import répond « que sait-on maintenant de ce
 * fichier ? ». Décide s'il faut enrichir le document déjà connu, laisser ses
 * métadonnées telles quelles, ou signaler un conflit — jamais un écrasement
 * silencieux d'un type ou d'une date déjà spécifique.
 */
function resolveMetadataEnrichment(
  existing: { document_type?: string | null; effective_date?: string | null },
  incoming: { document_type: string; effective_date?: string },
): { typeToApply?: string; dateToApply?: string; conflict: boolean } {
  let typeToApply: string | undefined
  let dateToApply: string | undefined
  let conflict = false

  const existingType = existing.document_type
  if (existingType && existingType !== incoming.document_type) {
    if (isGenericDocumentType(existingType) && !isGenericDocumentType(incoming.document_type)) {
      typeToApply = incoming.document_type
    } else if (!isGenericDocumentType(existingType) && !isGenericDocumentType(incoming.document_type)) {
      conflict = true
    }
    // Existant spécifique, nouveau générique : on ignore silencieusement —
    // jamais de dégradation d'une classification déjà posée.
  }

  if (incoming.effective_date) {
    const existingDate = existing.effective_date
    if (!existingDate) {
      dateToApply = incoming.effective_date
    } else if (existingDate !== incoming.effective_date) {
      conflict = true
    }
  }

  return { typeToApply, dateToApply, conflict }
}

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
    userId = await requireAuthenticatedUserId()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Forbidden' }
  }
  const parsed = collectionSchema.safeParse({
    name: formData.get('name'),
    scope_type: formData.get('scope_type') || undefined,
    scope_id: formData.get('scope_id') || undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }
  const rawOrgId = formData.get('organization_id') as string | null
  const orgResolution = await resolveCreationOrgId(rawOrgId)
  if (!orgResolution.ok) return { ok: false, error: orgResolution.error }
  // resolveCreationOrgId ne fait que CHOISIR l'organisation (0/1/many) ; elle
  // ne vérifie ni l'appartenance ni le rôle. Seul le rôle DANS cette
  // organisation fait autorité (jamais un rôle global) : cf.
  // requireAuthenticatedUserId ci-dessus.
  const membership = await requireOrganizationMembership(orgResolution.organizationId, { id: userId })
  if (!membership.ok) {
    return { ok: false, error: membership.error }
  }
  if (membership.context.role !== 'manager' && membership.context.role !== 'admin') {
    return { ok: false, error: ACCES_REFUSE }
  }
  try {
    const collectionId = await createDocumentCollection({
      name: parsed.data.name,
      scope_type: parsed.data.scope_type ?? null,
      scope_id: parsed.data.scope_id ?? null,
      organization_id: orgResolution.organizationId,
    })
    return { ok: true, collectionId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Création échouée' }
  }
}

// collection_id : un uuid, ou '' / 'none' = « Sans collection » (orphelin).
const moveSchema = z.object({
  document_id: z.string().uuid(),
  collection_id: z.union([z.string().uuid(), z.literal(''), z.literal('none')]),
})

/** Déplace un document vers une autre collection (ou « sans collection »). Manager/admin. */
export async function moveDocumentAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  let userId: string
  try {
    userId = await requireManagerOrAdmin()
  } catch {
    return { ok: false, error: 'Accès refusé.' }
  }
  const parsed = moveSchema.safeParse({
    document_id: formData.get('document_id'),
    collection_id: formData.get('collection_id'),
  })
  if (!parsed.success) return { ok: false, error: 'Champs invalides.' }
  const target = parsed.data.collection_id === '' || parsed.data.collection_id === 'none'
    ? null
    : parsed.data.collection_id
  try {
    await moveDocumentToCollection(parsed.data.document_id, target)
    await logAuditEvent({
      userId,
      entityType: 'document',
      entityId: parsed.data.document_id,
      action: 'updated',
      metadata: { kind: 'document_moved_collection', collection_id: target },
    })
    revalidatePath('/documents')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Déplacement échoué.' }
  }
}

const renameSchema = z.object({ collection_id: z.string().uuid(), name: z.string().min(2).max(120) })

/** Renomme une collection. Manager/admin. */
export async function renameCollectionAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  let userId: string
  try { userId = await requireManagerOrAdmin() } catch { return { ok: false, error: 'Accès refusé.' } }
  const parsed = renameSchema.safeParse({
    collection_id: formData.get('collection_id'),
    name: (formData.get('name') as string | null)?.trim(),
  })
  if (!parsed.success) return { ok: false, error: 'Nom invalide (2-120 caractères).' }
  try {
    await renameDocumentCollection(parsed.data.collection_id, parsed.data.name)
    revalidatePath('/documents')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec.' }
  }
}

/** Réordonne les collections (liste d'ids ordonnée). Manager/admin. */
export async function reorderCollectionsAction(
  orderedIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  try { await requireManagerOrAdmin() } catch { return { ok: false, error: 'Accès refusé.' } }
  if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== 'string')) {
    return { ok: false, error: 'Liste invalide.' }
  }
  try {
    await reorderDocumentCollections(orderedIds)
    revalidatePath('/documents')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec.' }
  }
}

const deleteCollectionSchema = z.object({
  collection_id: z.string().uuid(),
  mode: z.enum(['cascade', 'orphan']),
})

/** Supprime une collection. mode=cascade (supprime les docs) | orphan (docs → sans collection). Manager/admin. */
export async function deleteCollectionAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  let userId: string
  try { userId = await requireManagerOrAdmin() } catch { return { ok: false, error: 'Accès refusé.' } }
  const parsed = deleteCollectionSchema.safeParse({
    collection_id: formData.get('collection_id'),
    mode: formData.get('mode'),
  })
  if (!parsed.success) return { ok: false, error: 'Champs invalides.' }
  try {
    await deleteDocumentCollection(parsed.data.collection_id, parsed.data.mode)
    await logAuditEvent({
      userId,
      entityType: 'document',
      entityId: parsed.data.collection_id,
      action: 'soft_deleted',
      metadata: { kind: 'collection_deleted', mode: parsed.data.mode },
    })
    revalidatePath('/documents')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec.' }
  }
}

export interface UploadDocumentResult {
  ok: boolean
  documentId?: string
  error?: string
  /** Le doc existait déjà (même content_hash) → nœud réutilisé, lien ajouté. */
  duplicate?: boolean
  /** Type et/ou date d'effet enrichis sur le document existant lors de ce dédoublonnage. */
  enriched?: boolean
  /** Le nouvel import contredit un type ou une date déjà spécifique sur le document existant : aucun écrasement, signal explicite. */
  metadataConflict?: boolean
}

export async function uploadDocumentAction(
  formData: FormData,
): Promise<UploadDocumentResult> {
  let userId: string
  try {
    userId = await requireAuthenticatedUserId()
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

  // Doctrine M3 : l'organisation du document futur est TOUJOURS celle de sa
  // collection (jamais de la session). On la résout ici, une fois, pour la
  // garde cross-org (chantier) et le dédoublonnage scoping ci-dessous.
  const collectionOrgId = await getCollectionOrganizationId(input.collection_id)
  if (!collectionOrgId) {
    return { ok: false, error: 'Collection introuvable ou sans organisation' }
  }

  // GARDE SERVEUR — appartenance ET rôle AVANT tout traitement lourd (hash,
  // Storage) : un utilisateur authentifié mais non membre de l'organisation
  // de la collection, ou membre sans le rôle manager/admin DANS cette
  // organisation (jamais son rôle global), ne doit jamais faire écrire un
  // fichier dans Storage, même si createDocument() refuse ensuite. Sans ce
  // contrôle ici, un appel forgé laisserait un PDF orphelin dans le bucket
  // avant le refus tardif.
  const membership = await requireOrganizationMembership(collectionOrgId, { id: userId })
  if (!membership.ok) {
    return { ok: false, error: membership.error }
  }
  // Le rôle qui compte est celui DANS cette organisation, jamais le rôle
  // global du profil (requireManagerOrAdmin) : un manager AGP peut n'être que
  // chef d'équipe côté CAPSE, et ne doit alors pas pouvoir y écrire.
  if (membership.context.role !== 'manager' && membership.context.role !== 'admin') {
    return { ok: false, error: ACCES_REFUSE }
  }

  // GARDE SERVEUR (jamais confiance au client) : une cible chantier doit
  // appartenir à la MÊME organisation que la collection choisie. Un couple
  // forgé (collection d'une organisation + chantier d'une autre) est refusé
  // avant toute écriture — aucun document, aucun lien créé.
  if (input.target_type === 'site' && input.target_id) {
    const site = await getSiteById(input.target_id)
    if (!site?.organization_id || site.organization_id !== collectionOrgId) {
      return { ok: false, error: 'Organisation de la collection et du chantier incompatibles' }
    }
  }

  // Embedding SÉLECTIF (doctrine ingestion mémorielle) : on n'indexe que si
  // l'humain l'a validé. Défaut = indexer (rétro-compat) sauf 'false' explicite.
  // Un document non indexé est rangé en couche 'froide', statut 'ready' (pipeline
  // terminé sans chunks) — pas de coût d'embedding, pas de pollution du retrieval.
  //
  // GARDE-FOU SERVEUR : un litige ou un PV historique n'est JAMAIS indexé
  // automatiquement, quoi que poste le client. L'extraction sur PV historique
  // est réservée au Sprint 4B (validation explicite lot par lot).
  const NEVER_AUTO_EXTRACT: string[] = ['litige', 'historical_visit_report']
  const embed = !NEVER_AUTO_EXTRACT.includes(input.document_type) && input.embed !== 'false'
  const memoryTier: 'vivante' | 'consultable' | 'froide' | null = embed
    ? (input.memory_tier ?? null)
    : 'froide'

  // Upload fichier (bucket privé `documents`, service-role bypass RLS).
  const supabase = createAdminClient()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  const storagePath = `${globalThis.crypto.randomUUID()}/${Date.now()}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const contentHash = createHash('sha256').update(buffer).digest('hex')

  // DÉDUP : ce contenu est-il déjà importé DANS CETTE ORGANISATION ? Le
  // document est un NŒUD unique ; document_links est polymorphe → un doc peut
  // être rattaché à un contrat ET un client en même temps. Sur doublon : on
  // RÉUTILISE le nœud et on ajoute le nouveau lien (pas de re-upload, pas de
  // doc dupliqué). On prévient (duplicate). Le dédoublonnage ne franchit
  // jamais une frontière d'organisation (même PDF importé par CAPSE et par
  // AGP = deux nœuds documentaires distincts).
  const hashLookup = await findDocumentByHashInOrg(contentHash, collectionOrgId)
  if (hashLookup.status === 'conflict') {
    // Anomalie exposée, jamais résolue en silence (pas de "prend la plus
    // récente") : plusieurs documents actifs partagent déjà ce contenu dans
    // cette organisation — cas réel constaté sur OCEF (P0-1B, Vincent 2026-09-24).
    console.error('[uploadDocumentAction] DUPLICATE_INVARIANT_BROKEN', {
      contentHash,
      organizationId: collectionOrgId,
      ids: hashLookup.ids,
    })
    return {
      ok: false,
      error:
        'Plusieurs documents existants partagent déjà ce contenu dans cette organisation (anomalie). Import bloqué — signalez ce cas avant de réessayer.',
    }
  }
  if (hashLookup.status === 'found') {
    const existingDoc = hashLookup
    if (input.target_type && input.target_id) {
      try {
        await addDocumentLink(existingDoc.id, input.target_type, input.target_id)
      } catch (e) {
        console.error('[uploadDocumentAction] dedup addDocumentLink failed:', e)
      }
    }

    // ENRICHISSEMENT DE MÉTADONNÉES (Vincent 2026-09-24) : la déduplication
    // ne doit pas empêcher l'enrichissement documentaire. Un import explicite
    // (ex. document contractuel) sur un document connu sous un type générique
    // ou sans date d'effet complète le nœud existant au lieu de laisser sa
    // classification périmée. Jamais d'écrasement silencieux d'un type ou
    // d'une date déjà spécifique — cf. resolveMetadataEnrichment.
    const { typeToApply, dateToApply, conflict } = resolveMetadataEnrichment(
      { document_type: existingDoc.document_type, effective_date: existingDoc.effective_date },
      { document_type: input.document_type, effective_date: input.effective_date },
    )
    if (typeToApply || dateToApply) {
      try {
        await updateDocumentMetadata(existingDoc.id, {
          ...(typeToApply ? { document_type: typeToApply } : {}),
          ...(dateToApply ? { effective_date: dateToApply } : {}),
        })
        await logAuditEvent({
          userId,
          entityType: 'document',
          entityId: existingDoc.id,
          action: 'updated',
          metadata: {
            kind: 'metadata_enriched',
            ...(typeToApply
              ? { document_type_from: existingDoc.document_type, document_type_to: typeToApply }
              : {}),
            ...(dateToApply
              ? { effective_date_from: existingDoc.effective_date, effective_date_to: dateToApply }
              : {}),
          },
        })
      } catch (e) {
        console.error('[uploadDocumentAction] dedup metadata enrichment failed:', e)
      }
    }

    return {
      ok: true,
      documentId: existingDoc.id,
      duplicate: true,
      ...(typeToApply || dateToApply ? { enriched: true } : {}),
      ...(conflict ? { metadataConflict: true } : {}),
    }
  }

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
      content_hash: contentHash,
      created_by: userId,
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Création échouée' }
  }

  // Le document est créé : un échec de lien ou d'audit ne doit PAS faire
  // échouer l'import (sinon throw non-catché → message masqué « Server
  // Components render error » côté client). Best-effort, on logge et on continue.
  if (input.target_type && input.target_id) {
    try {
      await addDocumentLink(documentId, input.target_type, input.target_id)
    } catch (e) {
      console.error('[uploadDocumentAction] addDocumentLink failed:', e)
    }
  }

  try {
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
  } catch (e) {
    console.error('[uploadDocumentAction] audit failed:', e)
  }

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

// ===========================================================================
// Rattacher un document à une entité (+ rattacher) — manager+ only
// ===========================================================================
//
// Modèle : document unique + document_links polymorphe. addDocumentLink est
// idempotent (upsert onConflict) → ré-rattacher au même cible = no-op.

const addLinkSchema = z.object({
  document_id: z.string().uuid(),
  target_type: z.enum(['contract', 'site', 'client', 'tender', 'team']),
  target_id: z.string().uuid(),
})

export async function addDocumentLinkAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  let userId: string
  try {
    userId = await requireManagerOrAdmin()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Forbidden' }
  }

  const parsed = addLinkSchema.safeParse({
    document_id: formData.get('document_id'),
    target_type: formData.get('target_type'),
    target_id: formData.get('target_id'),
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }

  const doc = await getDocument(parsed.data.document_id)
  if (!doc || doc.deleted_at) return { ok: false, error: 'Document introuvable' }

  try {
    await addDocumentLink(parsed.data.document_id, parsed.data.target_type, parsed.data.target_id)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Rattachement échoué' }
  }

  await logAuditEvent({
    userId,
    entityType: 'document',
    entityId: parsed.data.document_id,
    action: 'linked',
    metadata: { target_type: parsed.data.target_type, target_id: parsed.data.target_id },
  }).catch(() => {})

  revalidatePath(`/documents/${parsed.data.document_id}`)
  return { ok: true }
}
