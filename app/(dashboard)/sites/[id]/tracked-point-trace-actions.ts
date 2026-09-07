'use server'

// Phase 6E.2C — Build 4 : server actions TRACE_TO_POINT, préparées mais non consommées par
// aucun écran dans ce lot ("aucune nouvelle UI dans ce lot si on veut garder les phases
// propres" — Vincent). Même squelette que tracked-point-consolidation-actions.ts (Point↔Point) :
// validation zod, requireSiteWriteAccess(siteId, 'managerOrAdmin'), délégation immédiate au
// wrapper métier. Pas de revalidatePath ici faute de page réelle à invalider.

import { z } from 'zod'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import {
  acceptTraceIdentityCandidate,
  rejectTraceIdentityCandidate,
  type AcceptTraceIdentityCandidateResult,
  type RejectTraceIdentityCandidateResult,
} from '@/lib/db/tracked-point-trace-acceptance'

const candidateActionSchema = z.object({
  siteId: z.string().uuid(),
  candidateId: z.string().min(1),
})

export async function acceptTraceIdentityCandidateAction(rawInput: unknown): Promise<AcceptTraceIdentityCandidateResult> {
  const parsed = candidateActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_CANDIDATE_ID' }
  const { siteId, candidateId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  return acceptTraceIdentityCandidate({ siteId, candidateId })
}

export async function rejectTraceIdentityCandidateAction(rawInput: unknown): Promise<RejectTraceIdentityCandidateResult> {
  const parsed = candidateActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_CANDIDATE_ID' }
  const { siteId, candidateId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  return rejectTraceIdentityCandidate({ siteId, candidateId, actorUserId: access.userId })
}
