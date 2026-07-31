'use server'

import { after } from 'next/server'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import {
  createPendingUpload,
  markUploadAsConfirmed,
  markUploadAsFailed,
  getUploadByStoragePath,
} from '@/lib/db/historical-pv-uploads'
import { createDocumentCollection, listDocumentCollections } from '@/lib/db/documents'

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 Mo (limite métier)
const STORAGE_BUCKET = 'documents'
const UPLOAD_PATH_PREFIX = 'historical-pv'

async function ensureSiteCollection(siteId: string): Promise<string> {
  const collections = await listDocumentCollections()
  const existing = collections.find((c) => c.scope_type === 'site' && c.scope_id === siteId)
  if (existing) return existing.id
  return createDocumentCollection({
    name: 'Documents chantier',
    scope_type: 'site',
    scope_id: siteId,
  })
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 200)
}

/**
 * Étape 1 — Demande d'URL signée pour upload direct Supabase Storage.
 */
export async function requestHistoricalPvUpload(input: {
  siteId: string
  fileName: string
  fileSize: number
  contentType: string
}): Promise<
  | { ok: true; uploadId: string; uploadUrl: string; storagePath: string; expiresAt: string }
  | { ok: false; error: string }
> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Non authentifié' }

    const role = await getUserRoleById(user.id)
    if (role !== 'admin' && role !== 'manager' && role !== 'chef_equipe') {
      return { ok: false, error: 'Permissions insuffisantes' }
    }

    // Validation
    if (input.contentType !== 'application/pdf') {
      return { ok: false, error: 'Seuls les fichiers PDF sont acceptés' }
    }
    if (input.fileSize > MAX_FILE_SIZE) {
      return { ok: false, error: `Fichier trop volumineux (max ${MAX_FILE_SIZE / 1024 / 1024} Mo)` }
    }
    if (input.fileSize === 0) {
      return { ok: false, error: 'Fichier vide' }
    }

    const sanitized = sanitizeFilename(input.fileName)
    const uuid = crypto.randomUUID()
    const storagePath = `${UPLOAD_PATH_PREFIX}/${input.siteId}/${uuid}_${sanitized}`

    // Créer l'enregistrement 'pending'
    const uploadId = await createPendingUpload({
      siteId: input.siteId,
      userId: user.id,
      storagePath,
      originalFilename: input.fileName,
      fileSize: input.fileSize,
    })

    // Générer l'URL signée (valide 15 minutes)
    const adminSupabase = createAdminClient()
    const { data: urlData, error: urlError } = await adminSupabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(storagePath)

    if (urlError || !urlData?.signedUrl) {
      await markUploadAsFailed(uploadId, 'Impossible de générer l\'URL signée')
      return { ok: false, error: 'Impossible de préparer l\'upload' }
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

    console.log('[requestHistoricalPvUpload]', {
      uploadId,
      siteId: input.siteId,
      fileSize: input.fileSize,
      storagePath,
    })

    return {
      ok: true,
      uploadId,
      uploadUrl: urlData.signedUrl,
      storagePath,
      expiresAt,
    }
  } catch (e) {
    console.error('[requestHistoricalPvUpload]', e)
    return { ok: false, error: 'Une erreur inattendue est survenue' }
  }
}

/**
 * Étape 2 — Confirmation de l'upload et création du document.
 * Idempotent : peut être appelé plusieurs fois avec le même uploadId sans recréer le document.
 */
export async function confirmHistoricalPvImport(input: {
  uploadId: string
  siteId: string
  storagePath: string
  effectiveDate?: string
}): Promise<
  | { ok: true; documentId: string; status: 'analysis_started' | 'already_confirmed' }
  | { ok: false; error: string; canRetry?: boolean }
> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Non authentifié' }

    const role = await getUserRoleById(user.id)
    if (role !== 'admin' && role !== 'manager' && role !== 'chef_equipe') {
      return { ok: false, error: 'Permissions insuffisantes' }
    }

    // Vérifier l'enregistrement d'upload
    const { getUploadById } = await import('@/lib/db/historical-pv-uploads')
    const upload = await getUploadById(input.uploadId)
    if (!upload) {
      return { ok: false, error: 'Upload introuvable', canRetry: false }
    }
    if (upload.siteId !== input.siteId) {
      return { ok: false, error: 'Site incorrect', canRetry: false }
    }
    if (upload.status === 'confirmed' && upload.documentId) {
      // Déjà confirmé → retour idempotent
      return { ok: true, documentId: upload.documentId, status: 'already_confirmed' }
    }
    if (upload.status === 'failed') {
      return { ok: false, error: upload.errorMessage ?? 'Upload échoué', canRetry: false }
    }

    // Vérifier que le fichier existe réellement dans Storage
    const adminSupabase = createAdminClient()
    const { data: fileList, error: listError } = await adminSupabase.storage
      .from(STORAGE_BUCKET)
      .list(input.storagePath.split('/').slice(0, -1).join('/'), {
        search: input.storagePath.split('/').pop(),
      })

    if (listError || !fileList || fileList.length === 0) {
      await markUploadAsFailed(input.uploadId, 'Fichier absent de Storage')
      return {
        ok: false,
        error: 'Le fichier n\'a pas été uploadé — réessayez l\'envoi',
        canRetry: true,
      }
    }

    const file = fileList[0]
    if (!file.metadata || file.metadata.size === 0) {
      await markUploadAsFailed(input.uploadId, 'Fichier vide dans Storage')
      return { ok: false, error: 'Le fichier uploadé est vide', canRetry: false }
    }

    // Créer le document
    const collectionId = await ensureSiteCollection(input.siteId)
    const { createDocument, addDocumentLink } = await import('@/lib/db/documents')
    const documentId = await createDocument({
      filename: upload.originalFilename,
      collection_id: collectionId,
      storage_path: input.storagePath,
      document_type: 'historical_visit_report',
      visibility_level: 'manager',
      size_bytes: file.metadata.size,
      effective_date: input.effectiveDate ?? null,
      memory_tier: 'froide',
      analysis_status: 'pending',
      created_by: user.id,
    })

    // Lier au chantier
    await addDocumentLink(documentId, 'site', input.siteId)

    // Marquer comme confirmé
    await markUploadAsConfirmed(input.uploadId, documentId, input.effectiveDate)

    // Lancer l'extraction en arrière-plan
    const secret = process.env.CRON_SECRET
    if (secret) {
      const h = await headers()
      const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
      const proto = h.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
      const extractionUrl = `${proto}://${host}/api/extraction/historical-pv`

      after(async () => {
        try {
          await fetch(extractionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-trigger': secret },
            body: JSON.stringify({ documentId, userId: user.id, siteId: input.siteId }),
          })
        } catch (e) {
          console.error('[confirmHistoricalPvImport] extraction trigger error:', e)
        }
      })
    }

    revalidatePath(`/sites/${input.siteId}`, 'page')

    console.log('[confirmHistoricalPvImport]', {
      uploadId: input.uploadId,
      documentId,
      siteId: input.siteId,
      fileSize: file.metadata.size,
    })

    return { ok: true, documentId, status: 'analysis_started' }
  } catch (e) {
    console.error('[confirmHistoricalPvImport]', e)
    try {
      await markUploadAsFailed(input.uploadId, String(e))
    } catch {}
    return { ok: false, error: 'Une erreur inattendue est survenue', canRetry: true }
  }
}

/**
 * Récupère le statut d'un upload (pour retry intelligent côté client).
 */
export async function getHistoricalPvUploadStatus(uploadId: string): Promise<
  | {
      ok: true
      status: 'pending' | 'uploaded' | 'confirmed' | 'failed'
      documentId?: string
      errorMessage?: string
    }
  | { ok: false; error: string }
> {
  try {
    const { getUploadById } = await import('@/lib/db/historical-pv-uploads')
    const upload = await getUploadById(uploadId)
    if (!upload) return { ok: false, error: 'Upload introuvable' }
    return {
      ok: true,
      status: upload.status,
      documentId: upload.documentId ?? undefined,
      errorMessage: upload.errorMessage ?? undefined,
    }
  } catch (e) {
    console.error('[getHistoricalPvUploadStatus]', e)
    return { ok: false, error: 'Erreur de récupération du statut' }
  }
}
