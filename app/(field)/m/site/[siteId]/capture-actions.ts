'use server'

// Captures de visite (mig 165) — server actions du PANIER terrain.
// Les 4 gestes + position déposent une capture brute (status='captured').
// Friction zéro : une pression, retour immédiat. L'IA se tait sur le terrain.
// Le vocal ne bloque jamais : déposé en 'pending', il est ENRICHI en arrière-plan
// par la route worker /api/visit-captures/process (le client la DÉCLENCHE, ne
// transcrit jamais lui-même ; cf. mig 166 + [[visite-trois-temps]]).
//
// Auth terrain (requireFieldAgent).

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireFieldAgent } from '@/lib/field/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { mimeToExt } from '@/lib/ai/transcribe'
import { getSiteReport, addReportAttachment } from '@/lib/db/site-reports'
import { addCapturedKnowledge } from '@/lib/db/captured-knowledge'
import {
  addVisitCapture,
  listVisitCaptures,
  removeCaptureWhileCollecting,
  setCaptureStarred,
  type VisitCaptureRow,
} from '@/lib/db/visit-captures'

const BUCKET = 'site-reports'
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

// ── Note ─────────────────────────────────────────────────────────────────────

// Position PONCTUELLE d'une OBSERVATION (opt-in, jamais de trace continue ; cf.
// [[ouverture-contextuelle-gps]]). On localise ce qui est vu, pas la personne.
const coords = {
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
}

const noteSchema = z.object({
  report_id: z.string().uuid(),
  site_id: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
  ...coords,
})

export async function addNoteCaptureAction(
  input: z.input<typeof noteSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = noteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    const id = await addVisitCapture({
      reportId: parsed.data.report_id,
      siteId: parsed.data.site_id,
      kind: 'note',
      body: parsed.data.body,
      lat: parsed.data.lat ?? null,
      lng: parsed.data.lng ?? null,
      createdBy: auth.userId,
    })
    return { ok: true, id }
  } catch {
    return { ok: false, error: 'Échec de la capture' }
  }
}

// ── Vérifier un point suivi ──────────────────────────────────────────────────

const verifSchema = z.object({
  report_id: z.string().uuid(),
  site_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  body: z.string().trim().max(2000).optional(),
})

export async function addVerificationCaptureAction(
  input: z.input<typeof verifSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = verifSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    const id = await addVisitCapture({
      reportId: parsed.data.report_id,
      siteId: parsed.data.site_id,
      kind: 'verification',
      subjectId: parsed.data.subject_id,
      body: parsed.data.body ?? null,
      createdBy: auth.userId,
    })
    return { ok: true, id }
  } catch {
    return { ok: false, error: 'Échec de la capture' }
  }
}

// ── Photo (la pièce est déjà uploadée via uploadReportAttachmentAction) ──────

const photoSchema = z.object({
  report_id: z.string().uuid(),
  site_id: z.string().uuid(),
  attachment_id: z.string().uuid(),
  ...coords,
})

export async function addPhotoCaptureAction(
  input: z.input<typeof photoSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = photoSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    const id = await addVisitCapture({
      reportId: parsed.data.report_id,
      siteId: parsed.data.site_id,
      kind: 'photo',
      attachmentId: parsed.data.attachment_id,
      lat: parsed.data.lat ?? null,
      lng: parsed.data.lng ?? null,
      createdBy: auth.userId,
    })
    return { ok: true, id }
  } catch {
    return { ok: false, error: 'Échec de la capture' }
  }
}

// ── Vidéo (la pièce est déjà uploadée via uploadReportAttachmentAction) ──────

const videoSchema = z.object({
  report_id: z.string().uuid(),
  site_id: z.string().uuid(),
  attachment_id: z.string().uuid(),
  ...coords,
})

export async function addVideoCaptureAction(
  input: z.input<typeof videoSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = videoSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    const id = await addVisitCapture({
      reportId: parsed.data.report_id,
      siteId: parsed.data.site_id,
      kind: 'video',
      attachmentId: parsed.data.attachment_id,
      lat: parsed.data.lat ?? null,
      lng: parsed.data.lng ?? null,
      createdBy: auth.userId,
    })
    return { ok: true, id }
  } catch {
    return { ok: false, error: 'Échec de la capture' }
  }
}

// ── Position (one-shot, opt-in) ──────────────────────────────────────────────

const positionSchema = z.object({
  report_id: z.string().uuid(),
  site_id: z.string().uuid(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
})

export async function addPositionCaptureAction(
  input: z.input<typeof positionSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = positionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    const id = await addVisitCapture({
      reportId: parsed.data.report_id,
      siteId: parsed.data.site_id,
      kind: 'position',
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      createdBy: auth.userId,
    })
    return { ok: true, id }
  } catch {
    return { ok: false, error: 'Échec de la capture' }
  }
}

// ── Vocal (upload audio + capture pending ; transcription en async plus tard) ─

export async function addVocalCaptureAction(
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const reportId = formData.get('report_id')
  const siteId = formData.get('site_id')
  if (typeof reportId !== 'string' || !z.string().uuid().safeParse(reportId).success) {
    return { ok: false, error: 'Visite invalide' }
  }
  if (typeof siteId !== 'string' || !z.string().uuid().safeParse(siteId).success) {
    return { ok: false, error: 'Site invalide' }
  }
  const audio = formData.get('audio')
  if (!(audio instanceof File) || audio.size === 0) return { ok: false, error: 'Audio manquant' }
  if (audio.size > MAX_AUDIO_BYTES) return { ok: false, error: 'Mémo trop long' }

  const report = await getSiteReport(reportId)
  if (!report) return { ok: false, error: 'Visite introuvable' }

  const mime = (typeof formData.get('audio_mime') === 'string' && formData.get('audio_mime')) || audio.type || 'audio/webm'
  const ext = mimeToExt(mime as string)
  const supabase = createAdminClient()
  const attId = crypto.randomUUID()
  const storagePath = `${report.tenant_id}/${report.id}/${attId}.${ext}`

  try {
    const bytes = new Uint8Array(await audio.arrayBuffer())
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: mime as string, upsert: false })
    if (upErr) return { ok: false, error: 'Upload du mémo échoué' }

    const attachmentId = await addReportAttachment({
      report_id: report.id,
      kind: 'audio',
      storage_path: storagePath,
      filename: `memo.${ext}`,
      mime_type: mime as string,
      size_bytes: audio.size,
    })
    // Capture brute : déposée en 'pending'. L'enrichissement (transcription) est
    // fait par la route worker, que le client DÉCLENCHE juste après. La vérité de
    // l'avancement est en base ; si le déclenchement échoue, le cron rattrape.
    // Position ponctuelle optionnelle (opt-in), best-effort : jamais bloquante.
    const latRaw = formData.get('lat'); const lngRaw = formData.get('lng')
    const geo = z.object(coords).safeParse({
      lat: typeof latRaw === 'string' && latRaw ? latRaw : undefined,
      lng: typeof lngRaw === 'string' && lngRaw ? lngRaw : undefined,
    })
    const id = await addVisitCapture({
      reportId: report.id,
      siteId,
      kind: 'vocal',
      attachmentId,
      transcriptStatus: 'pending',
      lat: geo.success ? geo.data.lat ?? null : null,
      lng: geo.success ? geo.data.lng ?? null : null,
      createdBy: auth.userId,
    })
    return { ok: true, id }
  } catch {
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {})
    return { ok: false, error: 'Échec de la capture vocale' }
  }
}

// ── Retirer une capture (faux geste, pendant la collecte) ────────────────────

// ── Question ouverte / « à vérifier au retour » (❓) ──────────────────────────
// La 2ᵉ primitive terrain (avec ⭐) : « je ne sais pas encore ». Réutilise
// captured_knowledge (kind='question', active→resolved) — pas un outil de tâches
// (ni assignation, ni échéance, ni priorité). Sur une capture ou libre.

const questionSchema = z.object({
  report_id: z.string().uuid(),
  site_id: z.string().uuid(),
  body: z.string().trim().min(1).max(500),
  capture_id: z.string().uuid().optional(),
})

export async function addQuestionCaptureAction(
  input: z.input<typeof questionSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = questionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    await addCapturedKnowledge({
      siteId: parsed.data.site_id,
      sourceType: 'visit',
      sourceId: parsed.data.report_id,
      kind: 'question',
      title: parsed.data.body,
      sourceCaptureIds: parsed.data.capture_id ? [parsed.data.capture_id] : [],
      createdBy: auth.userId,
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec' }
  }
}

// ── Marquer pour le mémoire technique (⭐, optionnel) ─────────────────────────

const starSchema = z.object({ capture_id: z.string().uuid(), starred: z.boolean() })

export async function setCaptureStarAction(
  input: z.input<typeof starSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = starSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    await setCaptureStarred(parsed.data.capture_id, parsed.data.starred)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec' }
  }
}

const removeSchema = z.object({ capture_id: z.string().uuid() })

export async function removeCaptureAction(
  input: z.input<typeof removeSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = removeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    await removeCaptureWhileCollecting(parsed.data.capture_id)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec' }
  }
}

// ── Rafraîchir la timeline du panier ─────────────────────────────────────────

export async function listVisitCapturesAction(reportId: string): Promise<VisitCaptureRow[]> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return []
  if (!z.string().uuid().safeParse(reportId).success) return []
  try {
    return await listVisitCaptures(reportId)
  } catch {
    return []
  }
}

// Re-export pour la revalidation depuis le composant après « Terminer ».
export async function revalidateSiteMobile(siteId: string): Promise<void> {
  revalidatePath(`/m/site/${siteId}`)
}
