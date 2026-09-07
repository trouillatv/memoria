'use server'

// Phase 6E.1C — server actions générique pour la consolidation Point↔Point (déliverables 5/6).
//
// Aucun écran ne consomme encore ces actions (déliverable 7 : pas de livraison UI dans ce
// lot) — pas de revalidatePath ici faute de page réelle à invalider ; à ajouter au moment où
// une surface consomme lib/knowledge/tracked-point-consolidation-queue.ts.
//
// requireSiteWriteAccess(siteId, 'managerOrAdmin') : consolidation/rejet d'identité durable,
// même niveau de rôle que les autres opérations d'identité sensibles du domaine chantier —
// jamais 'operator', une fusion irréversible sur l'affichage ne doit pas être accessible à un
// chef d'équipe.

import { z } from 'zod'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import {
  consolidateTrackedPoints,
  rejectPointIdentityPair,
  type ConsolidateTrackedPointsResult,
  type RejectPointIdentityPairResult,
} from '@/lib/db/tracked-point-consolidation'

const pairActionSchema = z.object({
  siteId: z.string().uuid(),
  pairId: z.string().min(1),
})

export async function consolidateTrackedPointsAction(rawInput: unknown): Promise<ConsolidateTrackedPointsResult> {
  const parsed = pairActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_PAIR_ID' }
  const { siteId, pairId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  return consolidateTrackedPoints({ siteId, pairId })
}

export async function rejectPointIdentityPairAction(rawInput: unknown): Promise<RejectPointIdentityPairResult> {
  const parsed = pairActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_PAIR_ID' }
  const { siteId, pairId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  return rejectPointIdentityPair({ siteId, pairId, actorUserId: access.userId })
}
