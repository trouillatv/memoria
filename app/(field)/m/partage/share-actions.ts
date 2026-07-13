'use server'

// « WhatsApp fournit les sources, MemorIA les range dans un objet métier
//   durable — visite ou réunion. » (Vincent, 2026-07-14)
//
// UNE mécanique, deux tables de rattachement :
//
//     partage → chantier → DESTINATION CHOISIE → objet (existant ou nouveau)
//                                              → tout le lot rejoint CET objet
//
// Trois règles qui ne se négocient pas :
//
//   1. **L'utilisateur choisit.** On a d'abord cru pouvoir deviner (« vocal →
//      réunion, photo → visite »). C'est faux : un vocal peut documenter une
//      visite, une photo peut illustrer une réunion. Deviner, c'est ranger la
//      mémoire au mauvais endroit — pire que poser une question.
//
//   2. **Additif.** Un nouveau partage vers le même objet AJOUTE ses éléments.
//      Il n'en recrée pas un, il n'écrase rien.
//
//   3. **Idempotent.** Le même fichier repartagé deux fois n'apparaît qu'une
//      fois : l'identité est calculée sur le CONTENU (`contentUuid`, mig 177),
//      pas sur le nom du fichier.
//
// Aucun second moteur : les photos passent par `ingestBatch` (le même que
// l'import ZIP), les sources de réunion par `addReportAttachment` (le même que
// l'audio capté dans l'app).

import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireFieldAgent } from '@/lib/auth/require'
import { requireOwned } from '@/lib/auth/ownership'
import { createAdminClient } from '@/lib/supabase/admin'
import { listStaged, readStaged, clearStaged } from '@/lib/share/staging'
import { isAudio, describeLot } from '@/lib/share/share-rules'
import { parseUpload } from '@/services/ingestion/adapters/upload'
import { ingestBatch } from '@/services/ingestion/ingest-batch'
import { createSiteReport, addReportSites, addReportAttachment } from '@/lib/db/site-reports'

const BUCKET = 'site-reports'

const schema = z.object({
  lotId: z.string().uuid(),
  siteId: z.string().uuid(),
  destination: z.object({
    type: z.enum(['visit', 'meeting']),
    /** L'objet à ENRICHIR. `null` → on en crée un. */
    id: z.string().uuid().nullable(),
    /** Titre, seulement à la création. Facultatif : la date et l'auteur, on les sait déjà. */
    title: z.string().trim().max(200).nullable().optional(),
  }),
})

export type ShareResult =
  | {
      ok: true
      destination: 'visit' | 'meeting'
      reportId: string
      /** Ce qui vient d'arriver. */
      added: number
      /** Ce qui était DÉJÀ là (même fichier repartagé) — on le dit, on ne le cache pas. */
      duplicates: number
    }
  | { error: string }

export async function attachSharedBatchAction(input: unknown): Promise<ShareResult> {
  const auth = await requireFieldAgent()
  if (!auth.ok || !auth.userId) return { error: 'Session expirée' }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: 'Choisissez une destination' }
  const { lotId, siteId, destination } = parsed.data

  const owned = await requireOwned(auth.role, 'sites', siteId)
  if (!owned.allowed) return { error: owned.error }

  // Le sas est scopé par utilisateur : on ne peut pas importer le lot d'un autre.
  const staged = await listStaged(auth.userId, lotId)
  if (staged.length === 0) return { error: 'Ces fichiers ne sont plus disponibles' }

  const files: Array<{
    bytes: Uint8Array
    filename: string
    mime: string
    lastModifiedMs: number | null
  }> = []
  for (const f of staged) {
    const bytes = await readStaged(f.path)
    if (bytes) files.push({ ...f, bytes })
  }
  if (files.length === 0) return { error: 'Ces fichiers ne sont plus disponibles' }

  const result =
    destination.type === 'visit'
      ? await intoVisit({ siteId, visitId: destination.id, files, userId: auth.userId })
      : await intoMeeting({
          siteId,
          meetingId: destination.id,
          title: destination.title ?? null,
          files,
          userId: auth.userId,
        })

  if ('error' in result) return result

  // Le sas a fait son travail. Ce qui compte vit maintenant dans la mémoire.
  await clearStaged(auth.userId, lotId).catch(() => {})

  revalidatePath('/m')
  revalidatePath(`/sites/${siteId}`)
  revalidatePath('/meetings')

  return result
}

/**
 * Le lot → une VISITE (nouvelle, ou celle qu'il a choisie).
 *
 * Le moteur d'ingestion fait tout : dédoublonnage par contenu, remise en ordre
 * chronologique, upload, capture. On lui passe simplement la visite cible quand
 * elle est désignée — il l'ENRICHIT au lieu d'en créer une.
 */
async function intoVisit(params: {
  siteId: string
  visitId: string | null
  files: Array<{ bytes: Uint8Array; filename: string; mime: string; lastModifiedMs: number | null }>
  userId: string
}): Promise<ShareResult> {
  // Visite désignée : on vérifie qu'elle est bien de CE chantier.
  if (params.visitId) {
    const db = createAdminClient()
    const { data } = await db
      .from('site_reports')
      .select('site_id, origin, deleted_at')
      .eq('id', params.visitId)
      .maybeSingle()
    const r = data as { site_id: string | null; origin: string | null; deleted_at: string | null } | null
    if (!r || r.deleted_at || r.site_id !== params.siteId || r.origin === null) {
      return { error: 'Visite introuvable' }
    }
  }

  const out = await ingestBatch(parseUpload(params.files), {
    siteId: params.siteId,
    createdBy: params.userId,
    source: 'os_share',
    reportId: params.visitId,
  })

  const reportId = params.visitId ?? out.sessions[0]?.reportId
  if (!reportId) {
    // Tout était déjà là : ce n'est pas une erreur, c'est une bonne nouvelle.
    if (out.skippedDuplicates > 0) return { error: 'Ces éléments sont déjà dans la mémoire' }
    return { error: 'Rien n’a pu être importé' }
  }

  revalidatePath(`/m/visite/${reportId}`)
  return {
    ok: true,
    destination: 'visit',
    reportId,
    added: out.created,
    duplicates: out.skippedDuplicates,
  }
}

/**
 * Le lot → une RÉUNION (migs 141 + 193 : « la réunion est l'objet ; tout ce qui
 * l'enrichit est une source »).
 *
 * Chaque vocal devient une SOURCE, avec sa provenance ('os_share', mig 201) et
 * son nom d'origine. La première source reste l'audio principal ; les suivantes
 * S'AJOUTENT — elles ne remplacent rien.
 */
async function intoMeeting(params: {
  siteId: string
  meetingId: string | null
  title: string | null
  files: Array<{ bytes: Uint8Array; filename: string; mime: string; lastModifiedMs: number | null }>
  userId: string
}): Promise<ShareResult> {
  const db = createAdminClient()

  const { data: site } = await db
    .from('sites')
    .select('tenant_id')
    .eq('id', params.siteId)
    .maybeSingle()
  const tenantId = (site as { tenant_id: string } | null)?.tenant_id
  if (!tenantId) return { error: 'Chantier introuvable' }

  let reportId = params.meetingId
  if (reportId) {
    // On ne greffe pas une source sur la réunion d'un autre chantier.
    const { data } = await db
      .from('site_reports')
      .select('site_id, origin, deleted_at')
      .eq('id', reportId)
      .maybeSingle()
    const r = data as { site_id: string | null; origin: string | null; deleted_at: string | null } | null
    if (!r || r.deleted_at || r.site_id !== params.siteId || r.origin !== null) {
      return { error: 'Réunion introuvable' }
    }
  } else {
    reportId = await createSiteReport({
      type: 'site',
      site_id: params.siteId,
      title: params.title || null,
      tenant_id: tenantId,
      created_by: params.userId,
      transcript_status: 'pending',
    })
    await addReportSites(reportId, [params.siteId])
  }

  // Ce qui est DÉJÀ rattaché à cette réunion — pour ne rien ajouter deux fois.
  const { data: existingRows } = await db
    .from('site_report_attachments')
    .select('client_uuid')
    .eq('report_id', reportId)
  const already = new Set(
    ((existingRows ?? []) as Array<{ client_uuid: string | null }>)
      .map((r) => r.client_uuid)
      .filter((v): v is string => !!v),
  )

  let added = 0
  let duplicates = 0
  let firstAudioPath: string | null = null
  let firstAudioMime: string | null = null

  for (const f of params.files) {
    // L'identité vit dans le CONTENU, pas dans le nom : le même vocal repartagé
    // demain ne créera pas un doublon.
    const clientUuid = contentUuid(f.bytes)
    if (already.has(clientUuid)) {
      duplicates += 1
      continue
    }

    const ext = (f.filename.split('.').pop() ?? 'bin').slice(0, 8).toLowerCase()
    const storagePath = `${tenantId}/${reportId}/${randomUUID()}.${ext}`

    const { error } = await db.storage
      .from(BUCKET)
      .upload(storagePath, f.bytes, { contentType: f.mime, upsert: false })
    if (error) continue

    const audio = isAudio(f.mime)
    await addReportAttachment({
      report_id: reportId,
      kind: audio
        ? 'audio'
        : f.mime.startsWith('image/')
          ? 'photo'
          : f.mime.startsWith('video/')
            ? 'video'
            : 'file',
      storage_path: storagePath,
      filename: f.filename,
      mime_type: f.mime,
      size_bytes: f.bytes.byteLength,
      client_uuid: clientUuid,
      added_by: params.userId,
      source_origin: 'os_share',
      ...(audio
        ? {
            label: f.filename,
            type_source: 'audio_meeting' as const,
            // La transcription reprendra la main : elle traite tout ce qui est
            // en attente, quelle que soit la porte d'entrée.
            transcript_status: 'pending' as const,
            recorded_started_at: f.lastModifiedMs
              ? new Date(f.lastModifiedMs).toISOString()
              : null,
          }
        : {}),
    })

    if (audio && !firstAudioPath) {
      firstAudioPath = storagePath
      firstAudioMime = f.mime
    }
    already.add(clientUuid)
    added += 1
  }

  if (added === 0) {
    if (duplicates > 0) return { error: 'Ces éléments sont déjà dans cette réunion' }
    return { error: 'Rien n’a pu être importé' }
  }

  // Rétro-compat mono-source : la PREMIÈRE source reste l'audio principal ; les
  // suivantes ne l'écrasent JAMAIS.
  const { data: current } = await db
    .from('site_reports')
    .select('audio_path')
    .eq('id', reportId)
    .maybeSingle()

  const patch: Record<string, unknown> = {}
  if (firstAudioPath) {
    patch.transcript_status = 'pending'
    if (!(current as { audio_path: string | null } | null)?.audio_path) {
      patch.audio_path = firstAudioPath
      patch.audio_mime = firstAudioMime
    }
  }
  if (Object.keys(patch).length > 0) {
    await db.from('site_reports').update(patch).eq('id', reportId)
  }

  revalidatePath(`/meetings/${reportId}`)
  return { ok: true, destination: 'meeting', reportId, added, duplicates }
}

/**
 * L'identité d'un fichier = son CONTENU.
 *
 * Même règle que le moteur d'ingestion (`contentUuid`, mig 177) : WhatsApp
 * renomme, recompresse les noms, duplique — mais les octets, eux, ne mentent
 * pas. C'est ce qui rend le repartage inoffensif.
 */
function contentUuid(bytes: Uint8Array): string {
  const h = createHash('sha256').update(bytes).digest('hex')
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join('-')
}

// ── Ce qu'on peut enrichir ───────────────────────────────────────────────────

export interface ShareTargetOption {
  id: string
  title: string
  /** ISO — pour dire « Aujourd'hui », « Hier », « 12 juillet ». */
  at: string
  /** Combien d'éléments cet objet porte déjà : c'est ce qui le rend reconnaissable. */
  items: number
}

/** Les visites récentes du chantier — celles qu'on peut encore enrichir. */
export async function listRecentVisitsAction(siteId: string): Promise<ShareTargetOption[]> {
  const auth = await requireFieldAgent()
  if (!auth.ok) return []
  if (!z.string().uuid().safeParse(siteId).success) return []
  const owned = await requireOwned(auth.role, 'sites', siteId)
  if (!owned.allowed) return []

  const db = createAdminClient()
  const { data } = await db
    .from('site_reports')
    .select('id, title, motive, started_at, created_at')
    .eq('site_id', siteId)
    .not('origin', 'is', null) // une VISITE (une réunion a origin null)
    .is('deleted_at', null)
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(6)

  const rows = (data ?? []) as Array<{
    id: string
    title: string | null
    motive: string | null
    started_at: string | null
    created_at: string
  }>
  if (rows.length === 0) return []

  const { data: caps } = await db
    .from('visit_capture')
    .select('report_id')
    .in('report_id', rows.map((r) => r.id))
    .neq('status', 'discarded')

  const counts = new Map<string, number>()
  for (const c of (caps ?? []) as Array<{ report_id: string }>) {
    counts.set(c.report_id, (counts.get(c.report_id) ?? 0) + 1)
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title?.trim() || r.motive?.trim() || 'Visite',
    at: r.started_at ?? r.created_at,
    items: counts.get(r.id) ?? 0,
  }))
}

/** Les réunions récentes du chantier. */
export async function listRecentMeetingsAction(siteId: string): Promise<ShareTargetOption[]> {
  const auth = await requireFieldAgent()
  if (!auth.ok) return []
  if (!z.string().uuid().safeParse(siteId).success) return []
  const owned = await requireOwned(auth.role, 'sites', siteId)
  if (!owned.allowed) return []

  const db = createAdminClient()
  const { data } = await db
    .from('site_reports')
    .select('id, title, created_at')
    .eq('site_id', siteId)
    .is('origin', null) // une RÉUNION
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(6)

  const rows = (data ?? []) as Array<{ id: string; title: string | null; created_at: string }>
  if (rows.length === 0) return []

  const { data: atts } = await db
    .from('site_report_attachments')
    .select('report_id')
    .in('report_id', rows.map((r) => r.id))

  const counts = new Map<string, number>()
  for (const a of (atts ?? []) as Array<{ report_id: string }>) {
    counts.set(a.report_id, (counts.get(a.report_id) ?? 0) + 1)
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title?.trim() || 'Réunion',
    at: r.created_at,
    items: counts.get(r.id) ?? 0,
  }))
}

/**
 * LÀ OÙ LE DERNIER PARTAGE EST ALLÉ.
 *
 * WhatsApp n'autorise **qu'un partage à la fois** dès qu'on sélectionne
 * plusieurs messages : « Partager » disparaît, il ne reste que « Transférer »
 * (qui garde tout chez WhatsApp). Ce n'est pas contournable — c'est leur menu.
 *
 * Conséquence : cinq photos = cinq partages. Reposer trois questions à chaque
 * fois serait insupportable. On propose donc, en un seul geste, de continuer
 * là où on vient d'aller : « Ajouter à la visite du 14 juillet ».
 *
 * La fenêtre est courte (6 h) : au-delà, ce n'est plus « la suite du même
 * geste », c'est un nouveau contexte — et on repose la question.
 */
export interface LastShareTarget {
  reportId: string
  siteId: string
  siteName: string
  title: string
  type: 'visit' | 'meeting'
}

const CONTINUATION_WINDOW_MS = 6 * 60 * 60 * 1000

export async function lastShareTargetAction(): Promise<LastShareTarget | null> {
  const auth = await requireFieldAgent()
  if (!auth.ok || !auth.userId) return null

  const db = createAdminClient()
  const since = new Date(Date.now() - CONTINUATION_WINDOW_MS).toISOString()

  // La dernière pièce arrivée PAR LE PARTAGE, de cet utilisateur.
  const { data: att } = await db
    .from('site_report_attachments')
    .select('report_id, created_at')
    .eq('added_by', auth.userId)
    .eq('source_origin', 'os_share')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const reportId = (att as { report_id: string } | null)?.report_id
  if (!reportId) return null

  const { data: rep } = await db
    .from('site_reports')
    .select('id, site_id, title, motive, origin, started_at, created_at, deleted_at')
    .eq('id', reportId)
    .maybeSingle()

  const r = rep as {
    site_id: string | null
    title: string | null
    motive: string | null
    origin: string | null
    started_at: string | null
    created_at: string
    deleted_at: string | null
  } | null
  if (!r || r.deleted_at || !r.site_id) return null

  // L'objet a-t-il encore un sens pour cet utilisateur ? (tenant, droits)
  const owned = await requireOwned(auth.role, 'sites', r.site_id)
  if (!owned.allowed) return null

  const { data: site } = await db.from('sites').select('name').eq('id', r.site_id).maybeSingle()

  const isVisit = r.origin !== null
  const when = new Date(r.started_at ?? r.created_at).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
  })
  const base = r.title?.trim() || r.motive?.trim() || (isVisit ? 'Visite' : 'Réunion')

  return {
    reportId,
    siteId: r.site_id,
    siteName: (site as { name: string } | null)?.name ?? 'Chantier',
    title: `${base} — ${when}`,
    type: isVisit ? 'visit' : 'meeting',
  }
}

/** Ce que contient le lot en attente — pour l'annoncer avant tout choix. */
export async function describeLotAction(lotId: string): Promise<ReturnType<typeof describeLot> | null> {
  const auth = await requireFieldAgent()
  if (!auth.ok || !auth.userId) return null
  if (!z.string().uuid().safeParse(lotId).success) return null
  const staged = await listStaged(auth.userId, lotId)
  return describeLot(staged.map((f) => f.mime))
}

/** « Finalement, non. » Le sas se vide, rien n'a jamais existé. */
export async function discardShareAction(lotId: string): Promise<void> {
  const auth = await requireFieldAgent()
  if (!auth.ok || !auth.userId) return
  if (!z.string().uuid().safeParse(lotId).success) return
  await clearStaged(auth.userId, lotId).catch(() => {})
}
