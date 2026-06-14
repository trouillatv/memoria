'use server'

// Comptes-rendus multimodaux de chantier — server actions.
// Flux : brouillon → (upload pièces) → transcription → analyse IA →
// curation → création des éléments validés. Partagé mobile + desktop.
//
// Doctrine : l'IA ne crée jamais sans validation humaine ; l'artefact brut
// (audio + pièces) n'est jamais perdu, même si la transcription ou l'IA échoue ;
// le texte saisi est persisté AVANT tout upload.

import { z } from 'zod'
import { createHash } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldAgent } from '@/lib/field/auth'
import { mimeToExt, transcribeAudio, transcriptionProvider } from '@/lib/ai/transcribe'
import { logAIUsageDirect } from '@/services/ai/tracking'
import { runSiteReportAnalysisAgent } from '@/services/ai/site-report-analysis'
import {
  createSiteReport,
  addReportAttachment,
  getSiteReport,
  listAttachments,
  listProposals,
  setTranscript,
  setReportStatus,
  setReportText,
  setReportAnalysis,
  bulkInsertProposals,
  curateProposal,
  markProposalCreated,
} from '@/lib/db/site-reports'
import {
  createSiteAction,
  markSiteActionPlanned,
  markSiteActionDone,
  listSiteActionsBySite,
} from '@/lib/db/site-actions'
import { createMission } from '@/lib/db/missions'
import { createIntervention, createAnomaly } from '@/lib/db/interventions'
import { createSiteNote } from '@/lib/db/sites'
import {
  findOrCreateSpontaneousIntervention,
  NoActiveTeamError,
} from '@/lib/db/spontaneous-intervention'
import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'
import type {
  AnomalyCategory,
  DbSiteReportProposal,
  MissionCadence,
  SiteReportProposalType,
} from '@/types/db'

const BUCKET = 'site-reports'
const MAX_AUDIO_BYTES = 25 * 1024 * 1024 // 25 MB — couvre l'import d'un audio de réunion (~25 min)
const MAX_FILE_BYTES = 20 * 1024 * 1024 // 20 MB (PDF, image, plan…)

/** Tronque proprement à 140 (limite stricte de createSiteNote). */
function clip140(s: string): string {
  const t = s.trim()
  return t.length <= 140 ? t : t.slice(0, 137).trimEnd() + '…'
}

async function resolveSiteContext(siteId: string): Promise<{ tenant_id: string } | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('sites')
    .select('id, tenant_id')
    .eq('id', siteId)
    .maybeSingle()
  const row = data as { id: string; tenant_id: string } | null
  if (!row?.tenant_id) return null
  return { tenant_id: row.tenant_id }
}

// ── 1. Création du brouillon (+ audio optionnel) ────────────────────────────

const draftSchema = z.object({
  site_id: z.string().uuid(),
  text_input: z.string().max(5000).optional(),
  audio_mime: z.string().max(80).optional(),
  audio_duration_seconds: z.coerce.number().int().min(0).max(600).optional(),
})

export async function createReportDraftAction(formData: FormData): Promise<
  { ok: true; reportId: string; hasAudio: boolean } | { ok: false; error: string }
> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = draftSchema.safeParse({
    site_id: formData.get('site_id'),
    text_input: formData.get('text_input') ?? undefined,
    audio_mime: formData.get('audio_mime') ?? undefined,
    audio_duration_seconds: formData.get('audio_duration_seconds') ?? undefined,
  })
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const ctx = await resolveSiteContext(parsed.data.site_id)
  if (!ctx) return { ok: false, error: 'Site introuvable' }

  // Le texte saisi est persisté D'ABORD — jamais perdu si l'upload échoue.
  const reportId = await createSiteReport({
    site_id: parsed.data.site_id,
    tenant_id: ctx.tenant_id,
    created_by: auth.userId,
    text_input: parsed.data.text_input ?? null,
  })

  // Audio optionnel
  const audioFile = formData.get('audio')
  let hasAudio = false
  if (audioFile instanceof File && audioFile.size > 0) {
    if (audioFile.size > MAX_AUDIO_BYTES) {
      // L'audio échoue mais le brouillon (texte) est déjà sauvé.
      return { ok: true, reportId, hasAudio: false }
    }
    const mime = parsed.data.audio_mime || audioFile.type || 'audio/webm'
    const ext = mimeToExt(mime)
    const attId = crypto.randomUUID()
    const storagePath = `${ctx.tenant_id}/${parsed.data.site_id}/${reportId}/${attId}.${ext}`
    const supabase = createAdminClient()
    const bytes = new Uint8Array(await audioFile.arrayBuffer())
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: mime, upsert: false })
    if (!upErr) {
      await addReportAttachment({
        report_id: reportId,
        kind: 'audio',
        storage_path: storagePath,
        filename: `note.${ext}`,
        mime_type: mime,
        size_bytes: audioFile.size,
      })
      await supabase
        .from('site_reports')
        .update({
          audio_path: storagePath,
          audio_mime: mime,
          audio_duration_seconds: parsed.data.audio_duration_seconds ?? null,
          transcript_status: 'pending',
        })
        .eq('id', reportId)
      hasAudio = true
    }
  }

  return { ok: true, reportId, hasAudio }
}

// ── 2. Upload d'une pièce jointe (photo ou fichier) ─────────────────────────

const attachmentSchema = z.object({
  report_id: z.string().uuid(),
  kind: z.enum(['photo', 'file']),
  client_uuid: z.string().uuid().optional(),
})

export async function uploadReportAttachmentAction(formData: FormData): Promise<
  { ok: true; attachmentId: string; idempotent: boolean } | { ok: false; error: string }
> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = attachmentSchema.safeParse({
    report_id: formData.get('report_id'),
    kind: formData.get('kind'),
    client_uuid: formData.get('client_uuid') ?? undefined,
  })
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Fichier manquant' }
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: 'Fichier trop lourd (max 20 Mo)' }
  const isImage = file.type.startsWith('image/')
  const isPdf = file.type === 'application/pdf'
  if (!isImage && !isPdf) return { ok: false, error: 'Format non supporté (image ou PDF)' }

  const supabase = createAdminClient()
  const report = await getSiteReport(parsed.data.report_id)
  if (!report) return { ok: false, error: 'Compte-rendu introuvable' }

  // Idempotence offline-first : si client_uuid déjà ingéré, no-op.
  if (parsed.data.client_uuid) {
    const { data: existing } = await supabase
      .from('site_report_attachments')
      .select('id')
      .eq('client_uuid', parsed.data.client_uuid)
      .maybeSingle()
    if (existing) {
      return { ok: true, attachmentId: (existing as { id: string }).id, idempotent: true }
    }
  }

  const rawExt = (file.name.split('.').pop() ?? (isPdf ? 'pdf' : 'jpg')).toLowerCase().slice(0, 5)
  const safeExt = /^[a-z0-9]+$/.test(rawExt) ? rawExt : isPdf ? 'pdf' : 'jpg'
  const attId = crypto.randomUUID()
  const storagePath = `${report.tenant_id}/${report.site_id}/${report.id}/${attId}.${safeExt}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const sha256 = createHash('sha256').update(buffer).digest('hex')

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false })
  if (upErr) return { ok: false, error: `Upload échoué : ${upErr.message}` }

  try {
    const attachmentId = await addReportAttachment({
      report_id: report.id,
      kind: parsed.data.kind,
      storage_path: storagePath,
      filename: file.name.slice(0, 200),
      mime_type: file.type,
      size_bytes: buffer.length,
      sha256,
      client_uuid: parsed.data.client_uuid ?? null,
    })
    return { ok: true, attachmentId, idempotent: false }
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === '23505' && parsed.data.client_uuid) {
      await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {})
      const { data: existing } = await supabase
        .from('site_report_attachments')
        .select('id')
        .eq('client_uuid', parsed.data.client_uuid)
        .single()
      return { ok: true, attachmentId: (existing as { id: string })?.id ?? '', idempotent: true }
    }
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {})
    return { ok: false, error: 'Enregistrement de la pièce échoué' }
  }
}

// ── 3. Transcription de l'audio ─────────────────────────────────────────────

export async function transcribeReportAction(
  reportId: string,
): Promise<{ ok: true; transcript: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  if (!z.string().uuid().safeParse(reportId).success) {
    return { ok: false, error: 'Identifiant invalide' }
  }
  const report = await getSiteReport(reportId)
  if (!report) return { ok: false, error: 'Compte-rendu introuvable' }
  if (!report.audio_path) return { ok: false, error: 'Pas d\'audio à transcrire' }

  const supabase = createAdminClient()
  const { data: blob, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(report.audio_path)
  if (dlErr || !blob) return { ok: false, error: 'Audio introuvable' }

  const mime = report.audio_mime || 'audio/webm'
  const ext = mimeToExt(mime)
  const startedAt = Date.now()
  try {
    const buffer = await blob.arrayBuffer()
    const transcript = await transcribeAudio(buffer, mime, ext)
    await setTranscript(reportId, { raw: transcript, status: 'done' })
    await setReportStatus(reportId, 'ready')
    // Coût (tokens non disponibles via REST audio) — tracé quand même.
    const prov = transcriptionProvider()
    if (prov) {
      await logAIUsageDirect({
        feature: 'site_report_transcription',
        userId: auth.userId,
        provider: prov,
        model: prov === 'gemini' ? 'gemini-2.5-flash' : 'whisper-1',
        inputTokens: null,
        outputTokens: null,
        durationMs: Date.now() - startedAt,
        status: 'success',
        errorMsg: null,
      })
    }
    return { ok: true, transcript }
  } catch (e) {
    // Échec transcription : l'audio reste, l'humain saisira le texte à la main.
    await setTranscript(reportId, { status: 'failed' })
    await setReportStatus(reportId, 'ready')
    return { ok: false, error: e instanceof Error ? e.message : 'Transcription échouée' }
  }
}

// ── 4. Analyse IA → propositions (décisions) ────────────────────────────────

const analyzeSchema = z.object({
  report_id: z.string().uuid(),
  transcript_corrected: z.string().max(12000).optional(),
  text_input: z.string().max(5000).optional(),
})

export async function listSiteMissionsForReportAction(
  siteId: string,
): Promise<Array<{ id: string; name: string }>> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return []
  if (!z.string().uuid().safeParse(siteId).success) return []
  const { listMissionsBySite } = await import('@/lib/db/missions')
  const missions = await listMissionsBySite(siteId)
  return missions.map((m) => ({ id: m.id, name: m.name }))
}

/** Contexte de curation : missions, n° de réunion, actions ouvertes, dates des
 *  comptes-rendus (pour l'âge déterministe « vu sur N comptes-rendus »). */
export async function getReportCurationContextAction(siteId: string): Promise<{
  missions: Array<{ id: string; name: string }>
  meetingNumber: number
  openActions: import('@/types/db').DbSiteAction[]
  reportDates: string[]
}> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { missions: [], meetingNumber: 1, openActions: [], reportDates: [] }
  if (!z.string().uuid().safeParse(siteId).success) {
    return { missions: [], meetingNumber: 1, openActions: [], reportDates: [] }
  }
  const { listMissionsBySite } = await import('@/lib/db/missions')
  const { listReportsBySite } = await import('@/lib/db/site-reports')
  const { listSiteActionsBySite } = await import('@/lib/db/site-actions')
  const [missions, reports, openActions] = await Promise.all([
    listMissionsBySite(siteId),
    listReportsBySite(siteId),
    listSiteActionsBySite(siteId, { status: 'open' }),
  ])
  return {
    missions: missions.map((m) => ({ id: m.id, name: m.name })),
    meetingNumber: Math.max(1, reports.length),
    openActions,
    reportDates: reports.map((r) => r.created_at),
  }
}

export async function analyzeReportAction(formData: FormData): Promise<
  | {
      ok: true
      count: number
      proposals: DbSiteReportProposal[]
      participants: import('@/types/db').SiteReportParticipant[]
      risks: import('@/types/db').SiteReportRisk[]
      priorUpdates: import('@/services/ai/site-report-analysis').PriorActionUpdate[]
    }
  | { ok: false; error: string }
> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = analyzeSchema.safeParse({
    report_id: formData.get('report_id'),
    transcript_corrected: formData.get('transcript_corrected') ?? undefined,
    text_input: formData.get('text_input') ?? undefined,
  })
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const report = await getSiteReport(parsed.data.report_id)
  if (!report) return { ok: false, error: 'Compte-rendu introuvable' }

  // Sauver les corrections humaines AVANT l'analyse.
  await setReportText(parsed.data.report_id, {
    transcript_corrected: parsed.data.transcript_corrected ?? report.transcript_corrected ?? report.transcript_raw,
    text_input: parsed.data.text_input ?? report.text_input,
  })
  await setReportStatus(parsed.data.report_id, 'analyzing')

  const transcript =
    parsed.data.transcript_corrected ?? report.transcript_corrected ?? report.transcript_raw ?? ''
  const textInput = parsed.data.text_input ?? report.text_input ?? null
  const attachments = await listAttachments(parsed.data.report_id)
  const attachmentNames = attachments
    .filter((a) => a.kind !== 'audio' && a.filename)
    .map((a) => a.filename as string)

  if (!transcript.trim() && !(textInput ?? '').trim()) {
    await setReportStatus(parsed.data.report_id, 'ready')
    return { ok: false, error: 'Rien à analyser (transcription et notes vides)' }
  }

  // Comparaison réunion : injecter les actions ouvertes antérieures.
  const priorOpen = await listSiteActionsBySite(report.site_id, { status: 'open' })
  const priorOpenActions = priorOpen.map((a) => ({
    id: a.id,
    title: a.title,
    corps_etat: a.corps_etat,
  }))

  try {
    const { proposals, participants, risks, priorUpdates } = await runSiteReportAnalysisAgent({
      transcript,
      textInput,
      attachmentNames,
      priorOpenActions,
      userId: auth.userId,
    })
    const inserted = await bulkInsertProposals({
      report_id: parsed.data.report_id,
      proposals: proposals.map((p) => ({
        type: p.type,
        payload: p.payload,
        short_label: p.short_label,
        rationale: p.rationale,
        category: p.category,
        corps_etat: p.corps_etat,
        assigned_to: p.assigned_to,
        ai_confidence: p.ai_confidence,
      })),
    })
    // Persister la reconstruction (présents + risques) sur le compte-rendu.
    await setReportAnalysis(parsed.data.report_id, { participants, risks })
    await setReportStatus(parsed.data.report_id, 'proposed')
    return { ok: true, count: inserted.length, proposals: inserted, participants, risks, priorUpdates }
  } catch (e) {
    // Échec IA : l'artefact + les pièces restent visibles dans le journal.
    await setReportStatus(
      parsed.data.report_id,
      'failed',
      e instanceof Error ? e.message : 'Analyse échouée',
    )
    return { ok: false, error: 'L\'analyse a échoué. Le compte-rendu et ses pièces sont conservés.' }
  }
}

// ── 5. Curation d'une proposition (accept / édite / rejette) ────────────────

const curateSchema = z.object({
  proposal_id: z.string().uuid(),
  short_label: z.string().max(140).optional(),
  corps_etat: z.string().max(60).nullable().optional(),
  assigned_to: z.string().max(120).nullable().optional(),
  status: z.enum(['accepted', 'rejected']).optional(),
  // Édition légère du payload (action_outcome, mission_choice, scheduled_for…)
  payload_patch: z.string().optional(), // JSON stringifié, fusionné côté serveur
})

export async function curateProposalAction(formData: FormData): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = curateSchema.safeParse({
    proposal_id: formData.get('proposal_id'),
    short_label: formData.get('short_label') ?? undefined,
    corps_etat: formData.get('corps_etat') ?? undefined,
    assigned_to: formData.get('assigned_to') ?? undefined,
    status: formData.get('status') ?? undefined,
    payload_patch: formData.get('payload_patch') ?? undefined,
  })
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  let payload: Record<string, unknown> | undefined
  if (parsed.data.payload_patch) {
    try {
      const supabase = createAdminClient()
      const { data: current } = await supabase
        .from('site_report_proposals')
        .select('payload')
        .eq('id', parsed.data.proposal_id)
        .maybeSingle()
      const base = (current as { payload?: Record<string, unknown> } | null)?.payload ?? {}
      payload = { ...base, ...(JSON.parse(parsed.data.payload_patch) as Record<string, unknown>) }
    } catch {
      payload = undefined
    }
  }

  await curateProposal(parsed.data.proposal_id, {
    short_label: parsed.data.short_label,
    corps_etat: parsed.data.corps_etat,
    assigned_to: parsed.data.assigned_to,
    status: parsed.data.status,
    payload,
  })
  return { ok: true }
}

// ── 6. Création des éléments validés (matérialiseur) ────────────────────────

const CADENCES: MissionCadence[] = ['daily', 'weekly', 'biweekly', 'monthly', 'on_demand']
function asCadence(v: unknown): MissionCadence {
  return CADENCES.includes(v as MissionCadence) ? (v as MissionCadence) : 'on_demand'
}

/** Résout la mission d'une intervention proposée : existante choisie, ou créée. */
async function resolveMission(
  p: DbSiteReportProposal,
  siteId: string,
  userId: string,
): Promise<string> {
  const mc = (p.payload?.mission_choice ?? null) as
    | { mode?: string; mission_id?: string; new_mission_name?: string; cadence?: string }
    | null
  if (mc?.mode === 'existing' && mc.mission_id) return mc.mission_id
  const name = (mc?.new_mission_name || p.short_label).slice(0, 120)
  return createMission({
    site_id: siteId,
    name,
    cadence: asCadence(mc?.cadence),
    created_by: userId,
  })
}

export async function createValidatedProposalsAction(reportId: string): Promise<
  | { ok: true; created: number; skipped: number; hasTomorrowIntervention: boolean }
  | { ok: false; error: string }
> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  if (!z.string().uuid().safeParse(reportId).success) {
    return { ok: false, error: 'Identifiant invalide' }
  }

  const report = await getSiteReport(reportId)
  if (!report) return { ok: false, error: 'Compte-rendu introuvable' }
  const siteId = report.site_id

  const proposals = (await listProposals(reportId)).filter((p) => p.status === 'accepted')
  const tomorrow = addDaysLocal(todayLocalIso(), 1)
  let created = 0
  let skipped = 0
  let hasTomorrowIntervention = false

  for (const p of proposals) {
    try {
      const scheduledFor =
        typeof p.payload?.suggested_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.payload.suggested_date)
          ? (p.payload.suggested_date as string)
          : (typeof p.payload?.scheduled_for === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.payload.scheduled_for)
              ? (p.payload.scheduled_for as string)
              : null)

      switch (p.type) {
        case 'note': {
          const note = await createSiteNote({ siteId, body: clip140(p.short_label), kind: 'a_savoir' })
          await markProposalCreated(p.id, 'site_note', note.id)
          break
        }
        case 'vigilance': {
          const note = await createSiteNote({ siteId, body: clip140(p.short_label), kind: 'a_savoir' })
          await markProposalCreated(p.id, 'site_note', note.id)
          break
        }
        case 'client_memory': {
          const note = await createSiteNote({
            siteId,
            body: clip140(`Client : ${p.short_label}`),
            kind: 'a_savoir',
          })
          await markProposalCreated(p.id, 'site_note', note.id)
          break
        }
        case 'proof_request': {
          const note = await createSiteNote({
            siteId,
            body: clip140(`Preuve demandée : ${p.short_label}`),
            kind: 'note',
          })
          await markProposalCreated(p.id, 'site_note', note.id)
          break
        }
        case 'anomaly': {
          try {
            const { intervention } = await findOrCreateSpontaneousIntervention(auth.userId, siteId)
            const anomalyId = await createAnomaly({
              intervention_id: intervention.id,
              category: (p.category as AnomalyCategory) ?? 'autre',
              description: p.short_label,
              reported_by: auth.userId,
            })
            await markProposalCreated(p.id, 'anomaly', anomalyId)
          } catch (err) {
            if (err instanceof NoActiveTeamError) {
              // Pas d'équipe active → on n'écrase rien, on conserve comme action.
              const actionId = await createSiteAction({
                site_id: siteId,
                report_id: reportId,
                title: p.short_label,
                corps_etat: p.corps_etat,
                assigned_to: p.assigned_to,
                created_by: auth.userId,
              })
              await markProposalCreated(p.id, 'site_action', actionId)
            } else {
              throw err
            }
          }
          break
        }
        case 'mission': {
          const missionId = await createMission({
            site_id: siteId,
            name: p.short_label.slice(0, 120),
            cadence: asCadence(p.payload?.cadence),
            created_by: auth.userId,
          })
          await markProposalCreated(p.id, 'mission', missionId)
          break
        }
        case 'intervention': {
          const missionId = await resolveMission(p, siteId, auth.userId)
          const when = scheduledFor ?? todayLocalIso()
          const interventionId = await createIntervention({
            mission_id: missionId,
            scheduled_for: when,
            slot: 'morning',
            created_by: auth.userId,
          })
          await markProposalCreated(p.id, 'intervention', interventionId)
          if (when === tomorrow) hasTomorrowIntervention = true
          break
        }
        case 'action': {
          const outcome = (p.payload?.action_outcome as string) ?? 'keep'
          const actionId = await createSiteAction({
            site_id: siteId,
            report_id: reportId,
            title: p.short_label,
            corps_etat: p.corps_etat,
            assigned_to: p.assigned_to,
            due_date: scheduledFor,
            created_by: auth.userId,
          })
          if (outcome === 'intervention') {
            const missionId = await resolveMission(p, siteId, auth.userId)
            const when = scheduledFor ?? todayLocalIso()
            const interventionId = await createIntervention({
              mission_id: missionId,
              scheduled_for: when,
              slot: 'morning',
              created_by: auth.userId,
            })
            await markSiteActionPlanned(actionId, 'intervention', interventionId)
            if (when === tomorrow) hasTomorrowIntervention = true
          } else if (outcome === 'mission') {
            const missionId = await createMission({
              site_id: siteId,
              name: p.short_label.slice(0, 120),
              cadence: asCadence(p.payload?.cadence),
              created_by: auth.userId,
            })
            await markSiteActionPlanned(actionId, 'mission', missionId)
          }
          await markProposalCreated(p.id, 'site_action', actionId)
          break
        }
        default:
          skipped++
          continue
      }
      created++
    } catch {
      skipped++
    }
  }

  await setReportStatus(reportId, 'curated')
  revalidatePath(`/sites/${siteId}`)
  revalidatePath(`/m/site/${siteId}`)

  return { ok: true, created, skipped, hasTomorrowIntervention }
}

// ── 7. Comparaison réunion : clore une action ouverte antérieure ────────────

export async function markPriorActionDoneAction(
  actionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  if (!z.string().uuid().safeParse(actionId).success) return { ok: false, error: 'Identifiant invalide' }
  await markSiteActionDone(actionId)
  return { ok: true }
}

// ── 8. Risque détecté → point de vigilance (note « à savoir ») ──────────────

const vigilanceSchema = z.object({
  site_id: z.string().uuid(),
  label: z.string().trim().min(3).max(140),
})

export async function createVigilanceFromRiskAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = vigilanceSchema.safeParse({
    site_id: formData.get('site_id'),
    label: formData.get('label'),
  })
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  await createSiteNote({ siteId: parsed.data.site_id, body: clip140(parsed.data.label), kind: 'a_savoir' })
  revalidatePath(`/sites/${parsed.data.site_id}`)
  return { ok: true }
}
