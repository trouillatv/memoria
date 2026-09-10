'use server'

// Fermeture humaine de IDENTITY_UNRESOLVED après rejet de tous les candidats (mandat Vincent,
// migration 404 + lib/db/tracked-point-identity-resolution.ts). Deux server actions distinctes
// pour les deux sorties symétriques du fallback : associer à un autre Point EXISTANT, ou créer un
// nouveau Point. Même squelette que tracked-point-trace-actions.ts / tracked-point-resolution-actions.ts :
// validation zod, requireSiteWriteAccess(siteId, 'managerOrAdmin'), délégation immédiate au
// wrapper métier.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import {
  associateIdentityTraceToPoint,
  createPointFromIdentityTrace,
  type AssociateIdentityTraceResult,
  type CreatePointFromIdentityTraceResult,
} from '@/lib/db/tracked-point-identity-resolution'

const associateIdentityActionSchema = z.object({
  siteId: z.string().uuid(),
  pendingTraceId: z.string().min(1),
  targetPointId: z.string().min(1),
})

export async function associateIdentityTraceToPointAction(rawInput: unknown): Promise<AssociateIdentityTraceResult> {
  const parsed = associateIdentityActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' }
  const { siteId, pendingTraceId, targetPointId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await associateIdentityTraceToPoint({ siteId, pendingTraceId, targetPointId })
  if (result.ok) {
    revalidatePath(`/sites/${siteId}/besoin-de-toi`)
    revalidatePath(`/sites/${siteId}`)
    revalidatePath(`/m/site/${siteId}/besoin-de-toi`)
    revalidatePath(`/m/site/${siteId}`)
  }
  return result
}

const createPointFromIdentityActionSchema = z.object({
  siteId: z.string().uuid(),
  pendingTraceId: z.string().min(1),
})

export async function createPointFromIdentityTraceAction(rawInput: unknown): Promise<CreatePointFromIdentityTraceResult> {
  const parsed = createPointFromIdentityActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' }
  const { siteId, pendingTraceId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await createPointFromIdentityTrace({ siteId, pendingTraceId })
  if (result.ok) {
    revalidatePath(`/sites/${siteId}/besoin-de-toi`)
    revalidatePath(`/sites/${siteId}`)
    revalidatePath(`/m/site/${siteId}/besoin-de-toi`)
    revalidatePath(`/m/site/${siteId}`)
  }
  return result
}
