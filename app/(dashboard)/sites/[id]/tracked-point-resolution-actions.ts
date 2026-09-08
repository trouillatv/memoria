'use server'

// Phase 6E.3B.3C — server action pour l'association d'une résolution orpheline à un Point
// ("Quel suivi cette preuve vient-elle résoudre ?"), consommée par la carte 6E.4A
// (/sites/[id]/besoin-de-toi). Même squelette que les autres fichiers d'actions du domaine :
// validation zod, requireSiteWriteAccess(siteId, 'managerOrAdmin'), délégation immédiate au
// wrapper métier. candidateId reste optionnel (mode HUMAN_SELECTED_TARGET vs.
// KNOWN_CANDIDATE_TARGET, cf. tracked-point-pending-resolution.ts) — cette action ne le rend pas
// obligatoire. Le geste "Laisser pour plus tard" réutilise dismissPendingTraceAction
// (tracked-point-pending-trace-actions.ts), générique à tous les kinds de pending trace.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import {
  associatePendingResolutionToPoint,
  type AssociatePendingResolutionResult,
} from '@/lib/db/tracked-point-pending-resolution'

const associateResolutionActionSchema = z.object({
  siteId: z.string().uuid(),
  pendingTraceId: z.string().min(1),
  targetPointId: z.string().min(1),
  candidateId: z.string().min(1).nullish(),
})

export async function associatePendingResolutionToPointAction(
  rawInput: unknown,
): Promise<AssociatePendingResolutionResult> {
  const parsed = associateResolutionActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' }
  const { siteId, pendingTraceId, targetPointId, candidateId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await associatePendingResolutionToPoint({ siteId, pendingTraceId, targetPointId, candidateId })
  if (result.ok) {
    revalidatePath(`/sites/${siteId}/besoin-de-toi`)
    revalidatePath(`/sites/${siteId}`)
  }
  return result
}
