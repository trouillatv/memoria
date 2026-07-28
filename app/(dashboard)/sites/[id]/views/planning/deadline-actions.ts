'use server'

// ── FIN DE VIE D'UNE ECHEANCE VALIDEE ───────────────────────────────────────
// Actions metier sur une echeance ACTIVE : la realiser, la replanifier, ou
// l'annuler (avec motif). Distinct du rejet d'une PROPOSITION (avant validation).
// Garde tenant : on ne mute jamais une echeance hors de son organisation.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import {
  completeSiteDeadline, planSiteDeadline, cancelSiteDeadline,
  reopenSiteDeadline, getSiteDeadlineOrgId,
} from '@/lib/db/site-deadlines'
import { createExtractionSuppression } from '@/lib/db/extraction-suppressions'
import { unmaskProposal, unmaskProposalAndDeleteRule } from '@/lib/db/knowledge-proposals'

type Result = { ok: true } | { ok: false; error: string }

/** Garde commune : role bureau/terrain + appartenance a l'organisation de l'echeance. */
async function guard(deadlineId: string): Promise<{ ok: true; userId: string; orgId: string } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe')) {
    return { ok: false, error: 'Acces refuse' }
  }
  const orgId = await getSiteDeadlineOrgId(deadlineId)
  if (!orgId) return { ok: false, error: 'Echeance introuvable' }
  const access = await requireOrganizationMembership(orgId)
  if (!access.ok) return { ok: false, error: access.error }
  return { ok: true, userId: user.id, orgId }
}

const idSchema = z.string().uuid()

export async function completeDeadlineAction(deadlineId: string): Promise<Result> {
  if (!idSchema.safeParse(deadlineId).success) return { ok: false, error: 'Requete invalide' }
  const g = await guard(deadlineId)
  if (!g.ok) return g
  try {
    const siteId = await completeSiteDeadline(deadlineId, g.userId)
    if (siteId) revalidatePath(`/sites/${siteId}`)
    return { ok: true }
  } catch { return { ok: false, error: 'Echec de l\'enregistrement' } }
}

/** Annule une realisation par erreur (undo toast) : remet l'echeance dans le planning actif. */
export async function reopenDeadlineAction(deadlineId: string): Promise<Result> {
  if (!idSchema.safeParse(deadlineId).success) return { ok: false, error: 'Requete invalide' }
  const g = await guard(deadlineId)
  if (!g.ok) return g
  try {
    const siteId = await reopenSiteDeadline(deadlineId)
    if (siteId) revalidatePath(`/sites/${siteId}`)
    return { ok: true }
  } catch { return { ok: false, error: 'Echec du retablissement' } }
}

const rescheduleSchema = z.object({
  deadlineId: z.string().uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
})

export async function rescheduleDeadlineAction(input: z.input<typeof rescheduleSchema>): Promise<Result> {
  const parsed = rescheduleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Requete invalide' }
  const g = await guard(parsed.data.deadlineId)
  if (!g.ok) return g
  try {
    const siteId = await planSiteDeadline(parsed.data.deadlineId, parsed.data.dueDate)
    if (siteId) revalidatePath(`/sites/${siteId}`)
    return { ok: true }
  } catch { return { ok: false, error: 'Echec de la replanification' } }
}

const cancelSchema = z.object({
  deadlineId: z.string().uuid(),
  reason: z.enum(['abandoned', 'superseded', 'done_otherwise', 'bad_extraction', 'not_needed', 'other']),
  comment: z.string().trim().max(1000).optional(),
  replacementId: z.string().uuid().optional(),
  suppressSimilar: z.boolean().optional(),
})

export async function cancelDeadlineAction(input: z.input<typeof cancelSchema>): Promise<Result> {
  const parsed = cancelSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Requete invalide' }
  const { deadlineId, reason, comment, replacementId, suppressSimilar } = parsed.data
  if (reason === 'other' && !comment?.trim()) return { ok: false, error: 'Precisez le motif dans le commentaire.' }
  const g = await guard(deadlineId)
  if (!g.ok) return g
  try {
    const { siteId, title } = await cancelSiteDeadline(deadlineId, { reason, comment, replacementId }, g.userId)
    if (siteId) revalidatePath(`/sites/${siteId}`)
    if (suppressSimilar && reason === 'bad_extraction' && siteId && title) {
      await createExtractionSuppression({
        siteId,
        organizationId: g.orgId,
        objectType: 'deadline',
        rawTitle: title,
        cancelReason: reason,
        createdBy: g.userId,
      }).catch(() => {})
    }
    return { ok: true }
  } catch { return { ok: false, error: 'Echec de l\'annulation' } }
}

const proposalIdSchema = z.string().uuid()

/** Remet une proposition masquee en attente de validation (bypass ponctuel — la regle reste active). */
export async function unmaskDeadlineProposalAction(proposalId: string): Promise<Result> {
  if (!proposalIdSchema.safeParse(proposalId).success) return { ok: false, error: 'Requete invalide' }
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe')) {
    return { ok: false, error: 'Acces refuse' }
  }
  try {
    await unmaskProposal(proposalId)
    return { ok: true }
  } catch { return { ok: false, error: 'Echec du demasquage' } }
}

/** Remet une proposition masquee en attente ET supprime la regle de suppression associee. */
export async function deleteSuppressionRuleAction(proposalId: string): Promise<Result> {
  if (!proposalIdSchema.safeParse(proposalId).success) return { ok: false, error: 'Requete invalide' }
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe')) {
    return { ok: false, error: 'Acces refuse' }
  }
  try {
    await unmaskProposalAndDeleteRule(proposalId)
    return { ok: true }
  } catch { return { ok: false, error: 'Echec de la suppression de la regle' } }
}
