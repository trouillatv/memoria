'use server'

// Phase 6E.3C — server action pour la sélection humaine de portée de preuve ("Quelle
// information constitue réellement la preuve ?"), consommée par la carte 6E.4A
// (/sites/[id]/besoin-de-toi). Même squelette que les autres fichiers d'actions du domaine :
// validation zod, requireSiteWriteAccess(siteId, 'managerOrAdmin'), délégation immédiate au
// wrapper métier.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import {
  resolvePendingEvidenceScope,
  type ResolvePendingEvidenceScopeResult,
} from '@/lib/db/tracked-point-pending-evidence-scope'

const resolveEvidenceScopeActionSchema = z.object({
  siteId: z.string().uuid(),
  pendingTraceId: z.string().min(1),
  proposalIds: z.array(z.string().min(1)).min(1),
})

export async function resolvePendingEvidenceScopeAction(
  rawInput: unknown,
): Promise<ResolvePendingEvidenceScopeResult> {
  const parsed = resolveEvidenceScopeActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' }
  const { siteId, pendingTraceId, proposalIds } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await resolvePendingEvidenceScope({ siteId, pendingTraceId, proposalIds })
  if (result.ok) {
    revalidatePath(`/sites/${siteId}/besoin-de-toi`)
    revalidatePath(`/sites/${siteId}`)
  }
  return result
}
