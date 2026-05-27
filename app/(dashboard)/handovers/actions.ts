'use server'

// Sprint Équipes C (Vincent 2026-05-22) — Server actions des passages de témoin.
//
// Auth manager + admin. Chaque action est auditée via logAuditEvent.
//
// Doctrine V2 :
//   - Le snapshot payload est généré côté server au moment de la création.
//     Il ne mute plus ensuite (sauf manualNotes qui reste pur éditorial).
//   - Le brief documente LE SITE et la mémoire utile. Jamais la personne.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import {
  buildMemberChangePayload,
  buildTeamTakesSitePayload,
  createHandoverBrief,
  getHandoverBrief,
  updateHandoverManualNotes,
  shareHandoverBrief,
  acknowledgeHandoverBrief,
  archiveHandoverBrief,
  softDeleteHandoverBrief,
} from '@/lib/db/handover'
import { logAuditEvent } from '@/lib/audit/log'

// ----------------------------------------------------------------------------
// Auth
// ----------------------------------------------------------------------------

type AuthOk = { userId: string }
type AuthFail = { error: string }

async function requireManagerOrAdmin(): Promise<AuthOk | AuthFail> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Accès refusé' }
  return { userId: user.id }
}

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------

// Date d'effet OBLIGATOIRE (Vincent 2026-05-27) : un passage de témoin doit
// toujours dire à partir de quand il prend effet.
const isoDateRequired = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La date d'effet est obligatoire")

const createMemberChangeSchema = z.object({
  subjectUserId: z.string().uuid(),
  sourceTeamId: z.string().uuid().nullable().optional(),
  targetTeamId: z.string().uuid().nullable().optional(),
  effectiveDate: isoDateRequired,
})

const createTeamTakesSiteSchema = z.object({
  targetTeamId: z.string().uuid(),
  siteId: z.string().uuid(),
  effectiveDate: isoDateRequired,
})

const idSchema = z.object({ id: z.string().uuid() })

const updateNotesSchema = z.object({
  id: z.string().uuid(),
  notes: z.string().max(4000).nullable(),
})

const shareSchema = z.object({
  id: z.string().uuid(),
  daysValid: z.number().int().min(1).max(60).default(7),
})

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------

export interface CreateBriefResult {
  ok: boolean
  briefId?: string
  error?: string
}

export async function createMemberChangeBriefAction(input: {
  subjectUserId: string
  sourceTeamId?: string | null
  targetTeamId?: string | null
  effectiveDate?: string | null
}): Promise<CreateBriefResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = createMemberChangeSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  // Garde-fou doctrinal au niveau SERVEUR (pas seulement en UI) : on ne génère
  // pas son propre passage de témoin. (Audit board A3.)
  if (parsed.data.subjectUserId === auth.userId) {
    return { ok: false, error: 'Vous ne pouvez pas préparer votre propre passage de témoin.' }
  }

  try {
    const { payload, title } = await buildMemberChangePayload({
      subjectUserId: parsed.data.subjectUserId,
      sourceTeamId: parsed.data.sourceTeamId ?? null,
      targetTeamId: parsed.data.targetTeamId ?? null,
    })
    const brief = await createHandoverBrief({
      kind: 'member_change',
      subjectUserId: parsed.data.subjectUserId,
      sourceTeamId: parsed.data.sourceTeamId ?? null,
      targetTeamId: parsed.data.targetTeamId ?? null,
      payload,
      title,
      effectiveDate: parsed.data.effectiveDate ?? null,
      createdBy: auth.userId,
    })
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: brief.id,
      action: 'created',
      metadata: {
        kind: 'handover_brief',
        handover_kind: 'member_change',
        subject_user_id: parsed.data.subjectUserId,
        source_team_id: parsed.data.sourceTeamId ?? null,
        target_team_id: parsed.data.targetTeamId ?? null,
        sites_count: payload.sites.length,
      },
    })
    revalidatePath('/handovers')
    return { ok: true, briefId: brief.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur création brief'
    return { ok: false, error: msg }
  }
}

export async function createTeamTakesSiteBriefAction(input: {
  targetTeamId: string
  siteId: string
  effectiveDate?: string | null
}): Promise<CreateBriefResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = createTeamTakesSiteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  try {
    const { payload, title } = await buildTeamTakesSitePayload({
      targetTeamId: parsed.data.targetTeamId,
      siteId: parsed.data.siteId,
    })
    const brief = await createHandoverBrief({
      kind: 'team_takes_site',
      targetTeamId: parsed.data.targetTeamId,
      siteId: parsed.data.siteId,
      payload,
      title,
      effectiveDate: parsed.data.effectiveDate ?? null,
      createdBy: auth.userId,
    })
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: brief.id,
      action: 'created',
      metadata: {
        kind: 'handover_brief',
        handover_kind: 'team_takes_site',
        target_team_id: parsed.data.targetTeamId,
        site_id: parsed.data.siteId,
      },
    })
    revalidatePath('/handovers')
    return { ok: true, briefId: brief.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur création brief'
    return { ok: false, error: msg }
  }
}

export interface MutateResult {
  ok: boolean
  error?: string
}

export async function updateBriefNotesAction(input: {
  id: string
  notes: string | null
}): Promise<MutateResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }
  const parsed = updateNotesSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }
  try {
    await updateHandoverManualNotes(parsed.data.id, parsed.data.notes)
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: parsed.data.id,
      action: 'updated',
      metadata: { kind: 'handover_brief_notes' },
    })
    revalidatePath(`/handovers/${parsed.data.id}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export interface ShareBriefResult extends MutateResult {
  token?: string
  url?: string
}

export async function shareBriefAction(input: {
  id: string
  daysValid?: number
}): Promise<ShareBriefResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }
  const parsed = shareSchema.safeParse({ id: input.id, daysValid: input.daysValid ?? 7 })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }
  try {
    const expiresAt = new Date(Date.now() + parsed.data.daysValid * 24 * 60 * 60 * 1000)
    const { token } = await shareHandoverBrief(parsed.data.id, expiresAt)
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: parsed.data.id,
      action: 'updated',
      metadata: {
        kind: 'handover_brief_shared',
        days_valid: parsed.data.daysValid,
      },
    })
    revalidatePath(`/handovers/${parsed.data.id}`)
    revalidatePath('/handovers')
    return { ok: true, token, url: `/h/${token}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function acknowledgeBriefAction(input: {
  id: string
}): Promise<MutateResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }
  try {
    await acknowledgeHandoverBrief(parsed.data.id, auth.userId)
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: parsed.data.id,
      action: 'updated',
      metadata: { kind: 'handover_brief_acknowledged' },
    })
    revalidatePath(`/handovers/${parsed.data.id}`)
    revalidatePath('/handovers')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function archiveBriefAction(input: { id: string }): Promise<MutateResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }
  try {
    const existing = await getHandoverBrief(parsed.data.id)
    if (!existing) return { ok: false, error: 'Brief introuvable' }
    await archiveHandoverBrief(parsed.data.id)
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: parsed.data.id,
      action: 'soft_deleted',
      metadata: { kind: 'handover_brief_archived' },
    })
    revalidatePath('/handovers')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function deleteBriefAction(input: { id: string }): Promise<MutateResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }
  try {
    const existing = await getHandoverBrief(parsed.data.id)
    if (!existing) return { ok: false, error: 'Brief introuvable' }
    await softDeleteHandoverBrief(parsed.data.id)
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: parsed.data.id,
      action: 'soft_deleted',
      metadata: { kind: 'handover_brief_deleted' },
    })
    revalidatePath('/handovers')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// ----------------------------------------------------------------------------
// Form actions wrappers (utilisables depuis <form action={...}>)
// ----------------------------------------------------------------------------

export async function createMemberChangeBriefFormAction(formData: FormData): Promise<void> {
  const result = await createMemberChangeBriefAction({
    subjectUserId: String(formData.get('subjectUserId') ?? ''),
    sourceTeamId: (formData.get('sourceTeamId') as string) || null,
    targetTeamId: (formData.get('targetTeamId') as string) || null,
    effectiveDate: (formData.get('effectiveDate') as string) || null,
  })
  if (result.ok && result.briefId) {
    redirect(`/handovers/${result.briefId}`)
  }
  // Si erreur, on laisse la page de création la gérer (revalidatePath
  // déclenchera un reload). Pour le pilote, c'est suffisant.
}

export async function createTeamTakesSiteBriefFormAction(formData: FormData): Promise<void> {
  const result = await createTeamTakesSiteBriefAction({
    targetTeamId: String(formData.get('targetTeamId') ?? ''),
    siteId: String(formData.get('siteId') ?? ''),
    effectiveDate: (formData.get('effectiveDate') as string) || null,
  })
  if (result.ok && result.briefId) {
    redirect(`/handovers/${result.briefId}`)
  }
}
