'use server'

// Phase 6E.3B.2 — server action pour la confirmation de suivi ("Faut-il suivre cette
// situation ?"), consommée par la carte 6E.4A (/sites/[id]/besoin-de-toi). Même squelette que
// les autres fichiers d'actions du domaine : validation zod,
// requireSiteWriteAccess(siteId, 'managerOrAdmin'), délégation immédiate au wrapper métier. Le
// geste "Non" réutilise dismissPendingTraceAction (tracked-point-pending-trace-actions.ts),
// générique à tous les kinds de pending trace — aucune action dismiss dupliquée ici.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import {
  confirmPendingTrackability,
  type ConfirmPendingTrackabilityResult,
} from '@/lib/db/tracked-point-pending-trackability'

const confirmTrackabilityActionSchema = z.object({
  siteId: z.string().uuid(),
  pendingTraceId: z.string().min(1),
})

export async function confirmPendingTrackabilityAction(
  rawInput: unknown,
): Promise<ConfirmPendingTrackabilityResult> {
  const parsed = confirmTrackabilityActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_PENDING_TRACE_ID' }
  const { siteId, pendingTraceId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await confirmPendingTrackability({ siteId, pendingTraceId })
  if (result.ok) {
    revalidatePath(`/sites/${siteId}/besoin-de-toi`)
    revalidatePath(`/sites/${siteId}`)
    revalidatePath(`/m/site/${siteId}/besoin-de-toi`)
    revalidatePath(`/m/site/${siteId}`)
  }
  return result
}
