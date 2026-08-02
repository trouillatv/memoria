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
  fileHashSha256?: string
}): Promise<
  | { ok: true; uploadId: string; uploadUrl: string; storagePath: string; expiresAt: string }
  | { ok: false; error: string }
> {
  let step = 'initialization'
  try {
    console.log('[requestHistoricalPvUpload] START', { siteId: input.siteId, fileSize: input.fileSize })

    step = 'authentication'
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      console.error('[requestHistoricalPvUpload] FAIL: no user', { step })
      return { ok: false, error: 'Non authentifié' }
    }
    console.log('[requestHistoricalPvUpload] authenticated', { userId: user.id })

    step = 'role_check'
    const role = await getUserRoleById(user.id)
    console.log('[requestHistoricalPvUpload] role fetched', { role })
    if (role !== 'admin' && role !== 'manager' && role !== 'chef_equipe') {
      console.error('[requestHistoricalPvUpload] FAIL: insufficient role', { step, role })
      return { ok: false, error: 'Permissions insuffisantes' }
    }

    // Validation
    step = 'validation'
    if (input.contentType !== 'application/pdf') {
      console.error('[requestHistoricalPvUpload] FAIL: invalid content type', { step, contentType: input.contentType })
      return { ok: false, error: 'Seuls les fichiers PDF sont acceptés' }
    }
    if (input.fileSize > MAX_FILE_SIZE) {
      console.error('[requestHistoricalPvUpload] FAIL: file too large', { step, fileSize: input.fileSize, maxSize: MAX_FILE_SIZE })
      return { ok: false, error: `Fichier trop volumineux (max ${MAX_FILE_SIZE / 1024 / 1024} Mo)` }
    }
    if (input.fileSize === 0) {
      console.error('[requestHistoricalPvUpload] FAIL: empty file', { step })
      return { ok: false, error: 'Fichier vide' }
    }
    console.log('[requestHistoricalPvUpload] validation passed')

    step = 'generate_storage_path'
    const sanitized = sanitizeFilename(input.fileName)
    const uuid = crypto.randomUUID()
    const storagePath = `${UPLOAD_PATH_PREFIX}/${input.siteId}/${uuid}_${sanitized}`
    console.log('[requestHistoricalPvUpload] storage path generated', { storagePath })

    // Créer l'enregistrement 'pending'
    step = 'create_pending_upload'
    const uploadId = await createPendingUpload({
      siteId: input.siteId,
      userId: user.id,
      storagePath,
      originalFilename: input.fileName,
      fileSize: input.fileSize,
      fileHashSha256: input.fileHashSha256,
    })
    console.log('[requestHistoricalPvUpload] pending upload created', { uploadId })

    // Générer l'URL signée (valide 15 minutes)
    step = 'create_signed_upload_url'
    const adminSupabase = createAdminClient()
    const { data: urlData, error: urlError } = await adminSupabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(storagePath)

    if (urlError || !urlData?.signedUrl) {
      console.error('[requestHistoricalPvUpload] FAIL: signed URL error', { step, error: urlError })
      await markUploadAsFailed(uploadId, 'Impossible de générer l\'URL signée')
      return { ok: false, error: 'Impossible de préparer l\'upload' }
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

    console.log('[requestHistoricalPvUpload] SUCCESS', {
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
    console.error('[requestHistoricalPvUpload] EXCEPTION', {
      step,
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
    })
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
  | { ok: true; documentId: string; status: 'analysis_started'; dateWarning?: { count: number } }
  | { ok: true; documentId: string; status: 'already_confirmed' }
  | { ok: true; documentId: string; status: 'duplicate_content'; existingFilename: string; existingCreatedAt: string }
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

    // Validation serveur : taille réelle
    if (file.metadata.size > MAX_FILE_SIZE) {
      await markUploadAsFailed(input.uploadId, `Fichier > ${MAX_FILE_SIZE / 1024 / 1024} Mo`)
      return { ok: false, error: 'Fichier trop volumineux (validation serveur)', canRetry: false }
    }

    // Validation serveur : MIME type
    const mimeType = file.metadata.mimetype ?? ''
    if (mimeType !== 'application/pdf') {
      await markUploadAsFailed(input.uploadId, `MIME invalide: ${mimeType}`)
      return { ok: false, error: 'Le fichier n\'est pas un PDF valide', canRetry: false }
    }

    // Validation serveur : signature PDF (%PDF-)
    const { data: fileData, error: downloadError } = await adminSupabase.storage
      .from(STORAGE_BUCKET)
      .download(input.storagePath)

    if (downloadError) {
      console.error('[confirmHistoricalPvImport] download error', downloadError)
      await markUploadAsFailed(input.uploadId, `Download error: ${downloadError.message}`)
      return { ok: false, error: 'Erreur de validation du fichier', canRetry: true }
    }

    const buffer = Buffer.from(await fileData.arrayBuffer())
    const signature = buffer.slice(0, 5).toString('ascii')
    if (signature !== '%PDF-') {
      await markUploadAsFailed(input.uploadId, `Signature invalide: ${signature}`)
      return { ok: false, error: 'Le fichier n\'est pas un PDF valide (signature manquante)', canRetry: false }
    }

    // Hash SHA256 : toujours calculé côté serveur, vérifié si fourni par le client
    const nodeCrypto = await import('crypto')
    const actualHash = nodeCrypto.createHash('sha256').update(buffer).digest('hex')
    if (upload.fileHashSha256 && actualHash !== upload.fileHashSha256) {
      await markUploadAsFailed(input.uploadId, 'Hash SHA256 ne correspond pas')
      return { ok: false, error: 'Le fichier a été modifié pendant l\'upload', canRetry: false }
    }

    // Niveau 1 — Doublon de contenu (même PDF, même ou autre nom)
    const { createDocument, addDocumentLink, findHistoricalPvByHashForSite, countHistoricalPvsByDateForSite } = await import('@/lib/db/documents')
    const existingByHash = await findHistoricalPvByHashForSite(actualHash, input.siteId)
    if (existingByHash) {
      return {
        ok: true,
        documentId: existingByHash.documentId,
        status: 'duplicate_content',
        existingFilename: existingByHash.filename,
        existingCreatedAt: existingByHash.createdAt,
      }
    }

    // Niveau 2 — Doublon métier (même date, contenu différent) — avertissement non bloquant
    let dateWarning: { count: number } | undefined
    if (input.effectiveDate) {
      const sameDate = await countHistoricalPvsByDateForSite(input.effectiveDate, input.siteId)
      if (sameDate > 0) dateWarning = { count: sameDate }
    }

    // Créer le document (avec hash pour future dédup)
    const collectionId = await ensureSiteCollection(input.siteId)
    const documentId = await createDocument({
      filename: upload.originalFilename,
      collection_id: collectionId,
      storage_path: input.storagePath,
      document_type: 'historical_visit_report',
      visibility_level: 'manager',
      size_bytes: file.metadata.size,
      effective_date: input.effectiveDate ?? null,
      content_hash: actualHash,
      memory_tier: 'froide',
      analysis_status: 'pending',
      created_by: user.id,
    })

    await addDocumentLink(documentId, 'site', input.siteId)

    // Marquer comme confirmé (atomique : retourne true si transition réussie, false si déjà confirmé)
    const transitionSucceeded = await markUploadAsConfirmed(input.uploadId, documentId, input.effectiveDate)

    // Lancer l'extraction en arrière-plan (uniquement si cette requête a gagné la course)
    const secret = process.env.CRON_SECRET
    if (secret && transitionSucceeded) {
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

    return { ok: true, documentId, status: 'analysis_started', ...(dateWarning ? { dateWarning } : {}) }
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
