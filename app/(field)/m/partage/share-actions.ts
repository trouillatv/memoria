'use server'

// Le geste qui compte : « ces fichiers → ce chantier ».
//
// Rien n'est inventé ici. On relit les octets du sas et on les confie aux MÊMES
// chaînes que le reste du produit :
//
//   des PHOTOS  → `ingestBatch` (source 'os_share') → une VISITE, comme l'import
//                 ZIP et l'upload. Une seule chaîne, plusieurs portes.
//   des VOCAUX  → des SOURCES de RÉUNION (migs 141 + 193 : « la réunion est
//                 l'objet ; tout ce qui l'enrichit est une source »). Plusieurs
//                 vocaux peuvent donc nourrir UNE MÊME réunion — c'est
//                 exactement le modèle, pas une exception.

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireFieldAgent } from '@/lib/auth/require'
import { requireOwned } from '@/lib/auth/ownership'
import { createAdminClient } from '@/lib/supabase/admin'
import { listStaged, readStaged, clearStaged } from '@/lib/share/staging'
import { shareDestination, isAudio } from '@/lib/share/share-rules'
import { parseUpload, type UploadFile } from '@/services/ingestion/adapters/upload'
import { ingestBatch } from '@/services/ingestion/ingest-batch'
import { createSiteReport, addReportSites, addReportAttachment } from '@/lib/db/site-reports'

const BUCKET = 'site-reports'

const schema = z.object({
  lotId: z.string().uuid(),
  siteId: z.string().uuid(),
  /** Réunion existante à enrichir. Absent → on en crée une. */
  meetingId: z.string().uuid().nullable().optional(),
})

export type ShareResult =
  | { ok: true; destination: 'visit'; reportId: string; count: number }
  | { ok: true; destination: 'meeting'; reportId: string; count: number }
  | { error: string }

export async function confirmShareAction(input: unknown): Promise<ShareResult> {
  const auth = await requireFieldAgent()
  if (!auth.ok || !auth.userId) return { error: 'Session expirée' }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: 'Choisissez un chantier' }
  const { lotId, siteId, meetingId } = parsed.data

  const owned = await requireOwned(auth.role, 'sites', siteId)
  if (!owned.allowed) return { error: owned.error }

  // Le sas est scopé par utilisateur : on ne peut pas importer le lot d'un autre.
  const staged = await listStaged(auth.userId, lotId)
  if (staged.length === 0) return { error: 'Ces fichiers ne sont plus disponibles' }

  const files: Array<{ bytes: Uint8Array; filename: string; mime: string; lastModifiedMs: number | null }> = []
  for (const f of staged) {
    const bytes = await readStaged(f.path)
    if (bytes) files.push({ ...f, bytes })
  }
  if (files.length === 0) return { error: 'Ces fichiers ne sont plus disponibles' }

  const destination = shareDestination(files.map((f) => f.mime))

  const result =
    destination === 'meeting'
      ? await intoMeeting({ siteId, meetingId: meetingId ?? null, files, userId: auth.userId })
      : await intoVisit({ siteId, files, userId: auth.userId })

  if ('error' in result) return result

  // Le sas a fait son travail. Ce qui compte vit maintenant dans la mémoire.
  await clearStaged(auth.userId, lotId).catch(() => {})

  revalidatePath('/m')
  revalidatePath(`/sites/${siteId}`)
  revalidatePath('/meetings')

  return result
}

/** Des photos → une visite, par le moteur d'ingestion commun. */
async function intoVisit(params: {
  siteId: string
  files: UploadFile[]
  userId: string
}): Promise<ShareResult> {
  const out = await ingestBatch(parseUpload(params.files), {
    siteId: params.siteId,
    createdBy: params.userId,
    source: 'os_share',
  })
  const reportId = out.sessions[0]?.reportId
  if (!reportId) return { error: 'Rien n’a pu être importé' }
  revalidatePath(`/m/visite/${reportId}`)
  return { ok: true, destination: 'visit', reportId, count: out.created }
}

/**
 * Des vocaux → des SOURCES de réunion.
 *
 * Une réunion accepte zéro, une ou plusieurs sources audio. Partager trois
 * vocaux WhatsApp dans la même réunion n'est donc pas un cas tordu : c'est le
 * modèle qui fonctionne comme prévu. Chaque source garde son origine ('import')
 * et son nom d'origine — on ne prétend pas qu'elle a été captée dans l'app.
 */
async function intoMeeting(params: {
  siteId: string
  meetingId: string | null
  files: Array<{ bytes: Uint8Array; filename: string; mime: string; lastModifiedMs: number | null }>
  userId: string
}): Promise<ShareResult> {
  const db = createAdminClient()

  const { data: site } = await db
    .from('sites')
    .select('tenant_id, name')
    .eq('id', params.siteId)
    .maybeSingle()
  const tenantId = (site as { tenant_id: string } | null)?.tenant_id
  if (!tenantId) return { error: 'Chantier introuvable' }

  // Enrichir une réunion existante, ou en ouvrir une.
  let reportId = params.meetingId
  if (reportId) {
    // On ne greffe pas une source sur la réunion d'un autre chantier.
    const { data: existing } = await db
      .from('site_reports')
      .select('id, site_id, origin, deleted_at')
      .eq('id', reportId)
      .maybeSingle()
    const r = existing as { site_id: string | null; origin: string | null; deleted_at: string | null } | null
    if (!r || r.deleted_at || r.site_id !== params.siteId || r.origin !== null) {
      return { error: 'Réunion introuvable' }
    }
  } else {
    reportId = await createSiteReport({
      type: 'site',
      site_id: params.siteId,
      title: null,
      tenant_id: tenantId,
      created_by: params.userId,
      transcript_status: 'pending',
    })
    await addReportSites(reportId, [params.siteId])
  }

  let count = 0
  let firstAudioPath: string | null = null
  let firstAudioMime: string | null = null

  for (const f of params.files) {
    const ext = (f.filename.split('.').pop() ?? 'bin').slice(0, 8).toLowerCase()
    const storagePath = `${tenantId}/${reportId}/${randomUUID()}.${ext}`

    const { error } = await db.storage
      .from(BUCKET)
      .upload(storagePath, f.bytes, { contentType: f.mime, upsert: false })
    if (error) continue

    const audio = isAudio(f.mime)
    await addReportAttachment({
      report_id: reportId,
      kind: audio ? 'audio' : f.mime === 'application/pdf' ? 'file' : 'photo',
      storage_path: storagePath,
      filename: f.filename,
      mime_type: f.mime,
      size_bytes: f.bytes.byteLength,
      added_by: params.userId,
      ...(audio
        ? {
            // Chaque vocal est une SOURCE à part entière, avec sa provenance.
            label: f.filename,
            type_source: 'audio_meeting' as const,
            transcript_status: 'pending' as const,
            source_origin: 'import' as const,
            recorded_started_at: f.lastModifiedMs ? new Date(f.lastModifiedMs).toISOString() : null,
          }
        : {}),
    })

    if (audio && !firstAudioPath) {
      firstAudioPath = storagePath
      firstAudioMime = f.mime
    }
    count += 1
  }

  if (count === 0) return { error: 'Rien n’a pu être importé' }

  // Rétro-compat mono-source : la PREMIÈRE source reste l'« audio principal » de
  // la réunion ; les suivantes ne l'écrasent JAMAIS (elles s'ajoutent).
  const { data: current } = await db
    .from('site_reports')
    .select('audio_path')
    .eq('id', reportId)
    .maybeSingle()

  const patch: Record<string, unknown> = { transcript_status: 'pending' }
  if (!(current as { audio_path: string | null } | null)?.audio_path && firstAudioPath) {
    patch.audio_path = firstAudioPath
    patch.audio_mime = firstAudioMime
  }
  await db.from('site_reports').update(patch).eq('id', reportId)

  revalidatePath(`/meetings/${reportId}`)
  return { ok: true, destination: 'meeting', reportId, count }
}

/** Les réunions récentes du chantier — celles qu'on peut encore enrichir. */
export async function listRecentMeetingsAction(
  siteId: string,
): Promise<Array<{ id: string; title: string; createdAt: string; sources: number }>> {
  const auth = await requireFieldAgent()
  if (!auth.ok) return []
  if (!z.string().uuid().safeParse(siteId).success) return []
  const owned = await requireOwned(auth.role, 'sites', siteId)
  if (!owned.allowed) return []

  const db = createAdminClient()
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const { data } = await db
    .from('site_reports')
    .select('id, title, created_at')
    .eq('site_id', siteId)
    .is('origin', null) // une réunion (une visite a un origin)
    .is('deleted_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(6)

  const reports = (data ?? []) as Array<{ id: string; title: string | null; created_at: string }>
  if (reports.length === 0) return []

  // Combien de sources chacune porte déjà — c'est ce qui la rend reconnaissable.
  const { data: atts } = await db
    .from('site_report_attachments')
    .select('report_id')
    .in('report_id', reports.map((r) => r.id))
    .eq('kind', 'audio')

  const sources = new Map<string, number>()
  for (const a of (atts ?? []) as Array<{ report_id: string }>) {
    sources.set(a.report_id, (sources.get(a.report_id) ?? 0) + 1)
  }

  return reports.map((r) => ({
    id: r.id,
    title: r.title?.trim() || 'Réunion',
    createdAt: r.created_at,
    sources: sources.get(r.id) ?? 0,
  }))
}

/** « Finalement, non. » Le sas se vide, rien n'a jamais existé. */
export async function discardShareAction(lotId: string): Promise<void> {
  const auth = await requireFieldAgent()
  if (!auth.ok || !auth.userId) return
  if (!z.string().uuid().safeParse(lotId).success) return
  await clearStaged(auth.userId, lotId).catch(() => {})
}
