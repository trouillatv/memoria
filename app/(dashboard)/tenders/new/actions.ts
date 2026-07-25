'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit/log'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import {
  createTender,
  createTenderDocument,
  getTender,
  listTenderDocuments,
  updateTenderStatus,
  countAnalysesToday,
  attachTenderToDossier,
} from '@/lib/db/tenders'
import { detectPieceKind } from '@/lib/tenders/pieces'
import { canAccessTenderForUpload } from '@/lib/tenders/upload-access'

async function requireManagerOrAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') throw new Error('Forbidden')
  return user.id
}

const MAX_PDF_BYTES = 20 * 1024 * 1024 // 20 MB
/** Un dossier d'AO tient en une dizaine de pièces ; au-delà, c'est une erreur de dépôt. */
const MAX_PIECES = 12

type UploadTenderRow = {
  id: string
  organization_id: string | null
  created_by: string
  deleted_at: string | null
}

async function getUploadTender(id: string, userId: string): Promise<UploadTenderRow | null> {
  const organizationIds = await getOrgIdsOfUser()
  const { data, error } = await createAdminClient()
    .from('tenders')
    .select('id, organization_id, created_by, deleted_at')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[tender-upload] tender lookup failed:', error.message)
    return null
  }
  const tender = data as UploadTenderRow | null
  if (!tender || !canAccessTenderForUpload(tender, userId, organizationIds)) return null
  return tender
}

async function listUploadDocuments(tenderId: string) {
  const { data, error } = await createAdminClient()
    .from('tender_documents')
    .select('id, size_bytes')
    .eq('tender_id', tenderId)
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  client_name: z.string().max(200).nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  // Affaire (dossier) pré-remplie quand on crée l'AO DEPUIS une affaire.
  dossier_id: z.string().uuid().nullable().optional(),
})
const tenderIdSchema = z.object({ id: z.string().uuid() })

type UploadTraceDetails = Record<string, string | number | boolean | null>

function traceFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
}

function isNextRedirectError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error
    && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT;')
}

/** Crée uniquement l'enveloppe du dossier : aucun fichier ne transite ici. */
export async function createTenderDraftAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return { error: 'Aucune organisation active' }

  const organizationId = orgIds.length === 1
    ? orgIds[0]
    : (formData.get('organization_id') as string | null)
  if (!organizationId || !orgIds.includes(organizationId)) return { error: 'Sélectionnez une organisation' }

  const parsed = createSchema.safeParse({
    title: formData.get('title'),
    client_name: formData.get('client_name') || null,
    deadline: formData.get('deadline') || null,
    dossier_id: formData.get('dossier_id') || null,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const todayCount = await countAnalysesToday()
  const limit = parseInt(process.env.MAX_AO_ANALYSES_PER_DAY ?? '20', 10)
  if (todayCount >= limit) return { error: `Quota journalier atteint (${todayCount}/${limit}).` }

  const tenderId = await createTender({
    title: parsed.data.title,
    client_name: parsed.data.client_name,
    deadline: parsed.data.deadline,
    created_by: userId,
    organization_id: organizationId,
  })
  if (parsed.data.dossier_id) await attachTenderToDossier(tenderId, parsed.data.dossier_id).catch(() => {})
  return { ok: true as const, tenderId }
}

/** Envoie exactement une pièce : la requête reste sous la limite Vercel. */
export async function uploadTenderPieceAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const parsed = tenderIdSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Dossier invalide' }
  const tender = await getUploadTender(parsed.data.id, userId)
  if (!tender) return { error: 'Dossier introuvable' }

  const files = formData.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length !== 1) return { error: 'Une seule pièce doit être envoyée par requête' }
  const file = files[0]
  if (file.type !== 'application/pdf') return { error: `Format PDF requis : ${file.name}` }
  if (file.size > MAX_PDF_BYTES) return { error: `Pièce trop lourde (> 20 Mo) : ${file.name}` }
  const existing = await listUploadDocuments(parsed.data.id)
  if (existing.length >= MAX_PIECES) return { error: `Le dossier dépasserait ${MAX_PIECES} pièces.` }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  const storagePath = `${parsed.data.id}/${Date.now()}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const supabase = createAdminClient()
  const { error: uploadErr } = await supabase.storage
    .from('tender-documents')
    .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false })
  if (uploadErr) return { error: `Dépôt échoué (${file.name}) : ${uploadErr.message}` }

  await createTenderDocument({
    tender_id: parsed.data.id,
    storage_path: storagePath,
    filename: file.name,
    size_bytes: file.size,
    organization_id: tender.organization_id,
    page_count: 0,
    extracted_text: null,
    kind: detectPieceKind(file.name),
  })
  return { ok: true as const }
}

/** Finalise une série d'uploads et ne lance l'analyse qu'une seule fois. */
export async function finalizeTenderUploadAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const parsed = tenderIdSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Dossier invalide' }
  const tender = await getUploadTender(parsed.data.id, userId)
  if (!tender) return { error: 'Dossier introuvable' }
  const pieces = await listUploadDocuments(parsed.data.id)
  if (pieces.length === 0) return { error: 'Aucune pièce n’a été enregistrée' }

  await updateTenderStatus(parsed.data.id, 'extracting')
  await logAuditEvent({
    userId,
    entityType: 'tender',
    entityId: parsed.data.id,
    action: 'created',
    metadata: { pieces: pieces.length, size_bytes: pieces.reduce((sum, piece) => sum + (piece.size_bytes ?? 0), 0) },
  })
  revalidatePath('/tenders')
  return { ok: true as const, tenderId: parsed.data.id }
}

function logUploadTrace(traceId: string, step: string, state: 'start' | 'ok' | 'failed' | 'return', details: UploadTraceDetails = {}) {
  console.info(JSON.stringify({ scope: 'tender-upload', trace_id: traceId, step, state, ...details }))
}

async function tracedUploadStep<T>(traceId: string, step: string, operation: () => Promise<T>, details: UploadTraceDetails = {}): Promise<T> {
  logUploadTrace(traceId, step, 'start', details)
  const startedAt = Date.now()
  try {
    const result = await operation()
    logUploadTrace(traceId, step, 'ok', { ...details, duration_ms: Date.now() - startedAt })
    return result
  } catch (error) {
    logUploadTrace(traceId, step, 'failed', {
      ...details,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      error_name: error instanceof Error ? error.name : null,
    })
    throw error
  }
}

async function createTenderActionImpl(formData: FormData, traceId: string) {
  const userId = await tracedUploadStep(traceId, 'authentication', requireManagerOrAdmin)

  const orgIds = await tracedUploadStep(traceId, 'organization_lookup', getOrgIdsOfUser)
  logUploadTrace(traceId, 'organization_state', 'ok', { organization_count: orgIds.length })
  if (orgIds.length === 0) {
    logUploadTrace(traceId, 'organization_validation', 'return', { reason: 'no_active_organization' })
    return { error: 'Aucune organisation active' }
  }
  let organizationId: string
  if (orgIds.length === 1) {
    organizationId = orgIds[0]
  } else {
    const rawOrgId = formData.get('organization_id') as string | null
    if (!rawOrgId || !orgIds.includes(rawOrgId)) {
      logUploadTrace(traceId, 'organization_validation', 'return', { reason: 'invalid_organization' })
      return { error: 'Sélectionnez une organisation' }
    }
    organizationId = rawOrgId
  }

  // Un AO n'est pas un document : c'est un dossier de pièces (RC, CCAP, CCTP,
  // DPGF, BPU, plans). On accepte donc N fichiers — un seul reste valide.
  const files = formData.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
  logUploadTrace(traceId, 'file_validation', 'start', { file_count: files.length })
  if (files.length === 0) {
    logUploadTrace(traceId, 'file_validation', 'return', { reason: 'no_files' })
    return { error: 'Aucune pièce jointe' }
  }
  if (files.length > MAX_PIECES) {
    logUploadTrace(traceId, 'file_validation', 'return', { reason: 'too_many_files', file_count: files.length })
    return { error: `Trop de pièces (${files.length}, maximum ${MAX_PIECES})` }
  }
  for (const f of files) {
    if (f.type !== 'application/pdf') {
      logUploadTrace(traceId, 'file_validation', 'return', { reason: 'invalid_mime_type', filename: f.name })
      return { error: `Format PDF requis : ${f.name}` }
    }
    if (f.size > MAX_PDF_BYTES) {
      logUploadTrace(traceId, 'file_validation', 'return', { reason: 'file_too_large', filename: f.name, size_bytes: f.size })
      return { error: `Pièce trop lourde (> 20 Mo) : ${f.name}` }
    }
  }
  logUploadTrace(traceId, 'file_validation', 'ok', { file_count: files.length, total_size_bytes: files.reduce((sum, f) => sum + f.size, 0) })

  const parsed = createSchema.safeParse({
    title: formData.get('title'),
    client_name: formData.get('client_name') || null,
    deadline: formData.get('deadline') || null,
    dossier_id: formData.get('dossier_id') || null,
  })
  if (!parsed.success) {
    logUploadTrace(traceId, 'metadata_validation', 'return', { error: parsed.error.issues[0].message })
    return { error: parsed.error.issues[0].message }
  }
  logUploadTrace(traceId, 'metadata_validation', 'ok')

  // Quota check
  const todayCount = await tracedUploadStep(traceId, 'quota_lookup', countAnalysesToday)
  const limit = parseInt(process.env.MAX_AO_ANALYSES_PER_DAY ?? '20', 10)
  if (todayCount >= limit) {
    logUploadTrace(traceId, 'quota_validation', 'return', { reason: 'quota_reached', today_count: todayCount, limit })
    return { error: `Quota journalier atteint (${todayCount}/${limit}). Réessayer demain ou augmenter MAX_AO_ANALYSES_PER_DAY.` }
  }

  // 1. Create tender row (status=draft)
  const tenderId = await tracedUploadStep(traceId, 'insert_tender', () => createTender({
      title: parsed.data.title,
      client_name: parsed.data.client_name,
      deadline: parsed.data.deadline,
      created_by: userId,
      organization_id: organizationId,
    }))
  logUploadTrace(traceId, 'tender_created', 'ok', { tender_id: tenderId })

  // Rattachement auto à l'affaire si l'AO est créé depuis une affaire (best-effort).
  if (parsed.data.dossier_id) {
    await attachTenderToDossier(tenderId, parsed.data.dossier_id).catch(() => {})
  }

  // 2-3. Déposer CHAQUE pièce et créer sa ligne. Le PDF est stocké ; le TEXTE
  //      n'est PAS extrait ici — l'extraction synchrone (pdf-parse) bloquait le
  //      formulaire à l'infini. Elle a lieu dans la route /analyze, pièce par pièce.
  //
  //      La nature de la pièce est DÉDUITE du nom de fichier (déterministe, zéro
  //      IA). Elle peut être nulle : « pièce non qualifiée » est une réponse
  //      honnête, l'utilisateur corrigera.
  const supabase = await tracedUploadStep(traceId, 'admin_client', async () => createAdminClient(), { organization_count: orgIds.length })
  for (const [index, file] of files.entries()) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
    const storagePath = `${tenderId}/${Date.now()}-${safeName}`
    const buffer = await tracedUploadStep(traceId, `read_file_${index + 1}`, async () => Buffer.from(await file.arrayBuffer()), {
      file_index: index + 1,
      filename: traceFilename(file.name),
    })

    const { error: uploadErr } = await tracedUploadStep(traceId, `storage_upload_${index + 1}`, () => supabase.storage
      .from('tender-documents')
      .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false }), {
        file_index: index + 1,
        filename: traceFilename(file.name),
        size_bytes: file.size,
      })
    if (uploadErr) {
      logUploadTrace(traceId, `storage_upload_${index + 1}`, 'failed', { error: uploadErr.message, filename: traceFilename(file.name) })
      await updateTenderStatus(tenderId, 'failed', uploadErr.message)
      return { error: `Dépôt échoué (${file.name}) : ${uploadErr.message}` }
    }

    await tracedUploadStep(traceId, `insert_document_${index + 1}`, () => createTenderDocument({
      tender_id: tenderId,
      storage_path: storagePath,
      filename: file.name,
      size_bytes: file.size,
      page_count: 0,
      extracted_text: null,
      kind: detectPieceKind(file.name),
    }), { file_index: index + 1, filename: traceFilename(file.name) })
  }
  logUploadTrace(traceId, 'all_files_processed', 'ok', { tender_id: tenderId, file_count: files.length })

  // 4. Statut 'extracting' → le loader de la page AO déclenche POST /analyze, qui
  //    fait extraction + analyse dans une vraie requête HTTP (fiable sur Vercel).
  await tracedUploadStep(traceId, 'set_extracting_status', () => updateTenderStatus(tenderId, 'extracting'), { tender_id: tenderId })

  await tracedUploadStep(traceId, 'audit_log', () => logAuditEvent({
    userId, entityType: 'tender', entityId: tenderId,
    action: 'created',
    metadata: {
      title: parsed.data.title,
      pieces: files.length,
      size_bytes: files.reduce((sum, f) => sum + f.size, 0),
    },
  }), { tender_id: tenderId })
  revalidatePath('/tenders')
  logUploadTrace(traceId, 'redirect', 'ok', { tender_id: tenderId })

  // Le formulaire rend la main IMMÉDIATEMENT (plus aucune extraction synchrone).
  redirect(`/tenders/${tenderId}`)
}

export async function createTenderAction(formData: FormData) {
  const traceId = crypto.randomUUID()
  const startedAt = Date.now()
  logUploadTrace(traceId, 'action_called', 'start')

  try {
    const result = await createTenderActionImpl(formData, traceId)
    logUploadTrace(traceId, 'action_finished', 'return', {
      outcome: result && 'error' in result ? 'expected_error' : 'returned',
      duration_ms: Date.now() - startedAt,
    })
    return result
  } catch (error) {
    if (isNextRedirectError(error)) {
      logUploadTrace(traceId, 'action_finished', 'ok', {
        outcome: 'created',
        duration_ms: Date.now() - startedAt,
      })
      throw error
    }

    const message = error instanceof Error ? error.message : String(error)
    logUploadTrace(traceId, 'action_finished', 'failed', {
      outcome: 'technical_error',
      duration_ms: Date.now() - startedAt,
      error: message,
      error_name: error instanceof Error ? error.name : null,
    })
    throw new Error(`Échec technique du dépôt (référence ${traceId})`)
  }
}
