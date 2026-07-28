'use server'

// ── FIN DE VIE D'UNE ÉCHÉANCE VALIDÉE ────────────────────────────────────────
// Actions métier sur une échéance ACTIVE : la réaliser, la replanifier, ou
// l'annuler (avec motif). Distinct du rejet d'une PROPOSITION (avant validation).
// Garde tenant : on ne mute jamais une échéance hors de son organisation.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import {
  completeSiteDeadline, planSiteDeadline, cancelSiteDeadline, getSiteDeadlineOrgId,
} from '@/lib/db/site-deadlines'

type Result = { ok: true } | { ok: false; error: string }

/** Garde commune : rôle bureau/terrain + appartenance à l'organisation de l'échéance. */
async function guard(deadlineId: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe')) {
    return { ok: false, error: 'Accès refusé' }
  }
  const orgId = await getSiteDeadlineOrgId(deadlineId)
  if (!orgId) return { ok: false, error: 'Échéance introuvable' }
  const access = await requireOrganizationMembership(orgId)
  if (!access.ok) return { ok: false, error: access.error }
  return { ok: true, userId: user.id }
}

const idSchema = z.string().uuid()

export async function completeDeadlineAction(deadlineId: string): Promise<Result> {
  if (!idSchema.safeParse(deadlineId).success) return { ok: false, error: 'Requête invalide' }
  const g = await guard(deadlineId)
  if (!g.ok) return g
  try {
    const siteId = await completeSiteDeadline(deadlineId, g.userId)
    if (siteId) revalidatePath(`/sites/${siteId}`)
    return { ok: true }
  } catch { return { ok: false, error: 'Échec de l’enregistrement' } }
}

const rescheduleSchema = z.object({
  deadlineId: z.string().uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
})

export async function rescheduleDeadlineAction(input: z.input<typeof rescheduleSchema>): Promise<Result> {
  const parsed = rescheduleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Requête invalide' }
  const g = await guard(parsed.data.deadlineId)
  if (!g.ok) return g
  try {
    const siteId = await planSiteDeadline(parsed.data.deadlineId, parsed.data.dueDate)
    if (siteId) revalidatePath(`/sites/${siteId}`)
    return { ok: true }
  } catch { return { ok: false, error: 'Échec de la replanification' } }
}

const cancelSchema = z.object({
  deadlineId: z.string().uuid(),
  reason: z.enum(['abandoned', 'superseded', 'done_otherwise', 'bad_extraction', 'not_needed', 'other']),
  comment: z.string().trim().max(1000).optional(),
  replacementId: z.string().uuid().optional(),
})

export async function cancelDeadlineAction(input: z.input<typeof cancelSchema>): Promise<Result> {
  const parsed = cancelSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Requête invalide' }
  const { deadlineId, reason, comment, replacementId } = parsed.data
  // « Autre » ne veut rien dire sans un mot : on l'exige (Vincent).
  if (reason === 'other' && !comment?.trim()) return { ok: false, error: 'Précisez le motif dans le commentaire.' }
  const g = await guard(deadlineId)
  if (!g.ok) return g
  try {
    const siteId = await cancelSiteDeadline(deadlineId, { reason, comment, replacementId }, g.userId)
    if (siteId) revalidatePath(`/sites/${siteId}`)
    return { ok: true }
  } catch { return { ok: false, error: 'Échec de l’annulation' } }
}
