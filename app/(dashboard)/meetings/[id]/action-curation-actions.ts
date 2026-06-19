'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getProposal, curateProposal, markProposalCreated, getSiteReport } from '@/lib/db/site-reports'
import { createSiteAction, updateSiteAction } from '@/lib/db/site-actions'

async function requireManagerOrAdmin() {
  const user = await getCurrentUserWithProfile()
  if (!user) throw new Error('Not authenticated')
  if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Forbidden')
  return user
}

const dueDateStatus = z.enum(['explicit', 'estimated']).nullable()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()

const acceptSchema = z.object({
  title: z.string().min(1).max(200),
  assigned_to: z.string().max(120).nullable(),
  corps_etat: z.string().max(60).nullable(),
  due_date: isoDate,
  due_date_status: dueDateStatus,
})

/** Accepte une proposition de type action → crée une site_action (curation desktop). */
export async function acceptActionProposalAction(
  reportId: string,
  proposalId: string,
  input: z.infer<typeof acceptSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireManagerOrAdmin()
  const parsed = acceptSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }

  const proposal = await getProposal(proposalId)
  if (!proposal) return { ok: false, error: 'Proposition introuvable' }
  const report = await getSiteReport(reportId)
  const siteId = proposal.site_id ?? report?.site_id ?? null
  if (!siteId) return { ok: false, error: 'Aucun site associé à cette action.' }

  // Cohérence : une échéance ne peut avoir de statut que si une date existe.
  const due = parsed.data.due_date
  const status = due ? parsed.data.due_date_status : null

  try {
    const actionId = await createSiteAction({
      site_id: siteId,
      report_id: reportId,
      title: parsed.data.title,
      corps_etat: parsed.data.corps_etat,
      assigned_to: parsed.data.assigned_to,
      due_date: due,
      due_date_status: status,
      created_by: user.id,
      created_from: 'desktop_report',
    })
    await markProposalCreated(proposalId, 'site_action', actionId)
    await curateProposal(proposalId, { status: 'accepted' })
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

/** Ignore une proposition (rejetée, ne devient pas une action officielle). */
export async function ignoreActionProposalAction(
  reportId: string,
  proposalId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireManagerOrAdmin()
  try {
    await curateProposal(proposalId, { status: 'rejected' })
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  assigned_to: z.string().max(120).nullable().optional(),
  due_date: isoDate.optional(),
  due_date_status: dueDateStatus.optional(),
})

/** Édite une action déjà créée (titre / responsable / échéance / badge). */
export async function updateActionAction(
  reportId: string,
  actionId: string,
  input: z.infer<typeof updateSchema>,
): Promise<{ ok: boolean; error?: string }> {
  await requireManagerOrAdmin()
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  try {
    await updateSiteAction(actionId, parsed.data)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}
