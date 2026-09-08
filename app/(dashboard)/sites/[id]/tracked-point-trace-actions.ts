'use server'

// Phase 6E.2C — Build 4 : server actions TRACE_TO_POINT, consommées par la carte "Cette
// information concerne-t-elle ce suivi ?" (6E.4A, /sites/[id]/besoin-de-toi). Même squelette que
// tracked-point-consolidation-actions.ts (Point↔Point) : validation zod,
// requireSiteWriteAccess(siteId, 'managerOrAdmin'), délégation immédiate au wrapper métier.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
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

  const result = await acceptTraceIdentityCandidate({ siteId, candidateId })
  if (result.ok) {
    revalidatePath(`/sites/${siteId}/besoin-de-toi`)
    revalidatePath(`/sites/${siteId}`)
    revalidatePath(`/m/site/${siteId}/besoin-de-toi`)
    revalidatePath(`/m/site/${siteId}`)
  }
  return result
}

export async function rejectTraceIdentityCandidateAction(rawInput: unknown): Promise<RejectTraceIdentityCandidateResult> {
  const parsed = candidateActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_CANDIDATE_ID' }
  const { siteId, candidateId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await rejectTraceIdentityCandidate({ siteId, candidateId, actorUserId: access.userId })
  if (result.ok) {
    revalidatePath(`/sites/${siteId}/besoin-de-toi`)
    revalidatePath(`/sites/${siteId}`)
    revalidatePath(`/m/site/${siteId}/besoin-de-toi`)
    revalidatePath(`/m/site/${siteId}`)
  }
  return result
}
