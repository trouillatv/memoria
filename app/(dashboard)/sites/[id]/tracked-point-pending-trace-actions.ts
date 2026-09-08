'use server'

// Geste "abandon" partagé par toutes les pending traces (TRACKABILITY_UNDETERMINED ET
// RESOLUTION_WITHOUT_KNOWN_PROBLEM) — dismissPendingTrace (tracked-point-pending-resolution.ts)
// est déjà générique à tous les kinds, cette action ne fait que l'exposer une seule fois plutôt
// que de la dupliquer dans chaque fichier d'actions par phase (6E.3B.2 "Non" / 6E.3B.3C "Laisser
// pour plus tard" appellent la même action, consommées par les cartes 6E.4A). Même squelette que
// les autres fichiers d'actions du domaine : validation zod,
// requireSiteWriteAccess(siteId, 'managerOrAdmin'), délégation immédiate au wrapper métier.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { dismissPendingTrace, type DismissPendingTraceResult } from '@/lib/db/tracked-point-pending-resolution'

const dismissActionSchema = z.object({
  siteId: z.string().uuid(),
  pendingTraceId: z.string().min(1),
})

export async function dismissPendingTraceAction(rawInput: unknown): Promise<DismissPendingTraceResult> {
  const parsed = dismissActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_PENDING_TRACE_ID' }
  const { siteId, pendingTraceId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await dismissPendingTrace({ siteId, pendingTraceId, actorUserId: access.userId })
  if (result.ok) {
    revalidatePath(`/sites/${siteId}/besoin-de-toi`)
    revalidatePath(`/sites/${siteId}`)
  }
  return result
}
