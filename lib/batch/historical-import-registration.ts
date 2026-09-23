// BATCH-2 — enregistrement des PDF locaux absents de `documents`.
//
// Le writer web (app/(dashboard)/sites/[id]/historical-pv-upload-actions.ts)
// dépend d'une session cookie-based (createClient() + requireOrganizationMembership
// sans currentUser explicite) : inutilisable tel quel depuis un CLI Node. Ce module
// réutilise en revanche ses primitives DB sans session (findHistoricalPvByHashForSite,
// addDocumentLink) et reproduit l'insert admin déjà utilisé par les scripts
// d'administration existants du dépôt (ex. scripts/_qualification-p0-phase-b.ts)
// pour la collection/l'upload/le document — même forme, même bucket, même convention
// de storage_path.
//
// Ne matérialise jamais de visite : crée uniquement la ligne `documents` + son lien
// au chantier. L'éligibilité au pipeline normal (extraction, etc.) est décidée
// ensuite par l'inventaire BATCH-1, pas ici.

import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createAdminClient } from '@/lib/supabase/admin'
import { findHistoricalPvByHashForSite, findHashClassificationConflict, addDocumentLink } from '@/lib/db/documents'
import { documentTypeLabel } from '@/lib/documents/labels'

const STORAGE_BUCKET = 'documents'
const UPLOAD_PATH_PREFIX = 'historical-pv'

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').slice(0, 200)
}

export interface RegisterMissingDocumentInput {
  filePath: string
  siteId: string
  createdBy: string
  /** N'est posé que si une date a déjà été démontrée non ambiguë par l'inventaire. */
  effectiveDate: string | null
}

export interface RegisterMissingDocumentResult {
  documentId: string
  status: 'created' | 'already_existed'
}

async function ensureSiteCollection(
  admin: ReturnType<typeof createAdminClient>,
  siteId: string,
  organizationId: string,
): Promise<string> {
  const { data: existing } = await admin
    .from('document_collections')
    .select('id')
    .eq('scope_type', 'site')
    .eq('scope_id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (existing) return (existing as { id: string }).id

  const { data, error } = await admin
    .from('document_collections')
    .insert({ name: 'Documents chantier', scope_type: 'site', scope_id: siteId, organization_id: organizationId })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/**
 * Enregistre un PDF local absent de `documents` pour ce chantier. Idempotent par
 * content_hash (via findHistoricalPvByHashForSite, même primitive que le writer web)
 * SI le document existant est déjà un PV historique du même chantier. Si ce contenu
 * exact existe déjà sous un autre document_type dans l'organisation (conflit de
 * classification), l'enregistrement est refusé plutôt que silencieusement fusionné
 * ou reclassifié (Vincent 2026-09-24, cas OCEF).
 */
export async function registerMissingHistoricalDocument(
  input: RegisterMissingDocumentInput,
): Promise<RegisterMissingDocumentResult> {
  const { filePath, siteId, createdBy, effectiveDate } = input
  const buffer = await readFile(filePath)
  const contentHash = createHash('sha256').update(buffer).digest('hex')

  const existing = await findHistoricalPvByHashForSite(contentHash, siteId)
  if (existing) return { documentId: existing.documentId, status: 'already_existed' }

  const admin = createAdminClient()
  const { data: siteRow, error: siteErr } = await admin
    .from('sites')
    .select('organization_id')
    .eq('id', siteId)
    .maybeSingle()
  if (siteErr) throw siteErr
  const organizationId = (siteRow as { organization_id: string } | null)?.organization_id
  if (!organizationId) throw new Error(`Site ${siteId} introuvable ou sans organisation`)

  const conflict = await findHashClassificationConflict(contentHash, organizationId, 'historical_visit_report')
  if (conflict) {
    throw new Error(
      `Ce fichier (${path.basename(filePath)}) existe déjà comme ${documentTypeLabel(conflict.document_type)} dans cette organisation. Import refusé — pas de reclassification silencieuse.`,
    )
  }

  const collectionId = await ensureSiteCollection(admin, siteId, organizationId)

  const fileName = path.basename(filePath)
  const storagePath = `${UPLOAD_PATH_PREFIX}/${siteId}/${randomUUID()}_${sanitizeFilename(fileName)}`
  const { error: uploadErr } = await admin.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, {
    contentType: 'application/pdf',
    upsert: false,
  })
  if (uploadErr) throw new Error(`Upload storage échoué : ${uploadErr.message}`)

  const { data: docRow, error: docErr } = await admin
    .from('documents')
    .insert({
      organization_id: organizationId,
      collection_id: collectionId,
      document_type: 'historical_visit_report',
      storage_path: storagePath,
      filename: fileName,
      visibility_level: 'manager',
      size_bytes: buffer.byteLength,
      content_hash: contentHash,
      effective_date: effectiveDate,
      memory_tier: 'froide',
      analysis_status: 'pending',
      created_by: createdBy,
    })
    .select('id')
    .single()
  if (docErr) throw docErr
  const documentId = (docRow as { id: string }).id

  await addDocumentLink(documentId, 'site', siteId)

  return { documentId, status: 'created' }
}
