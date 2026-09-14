'use server'

// Lot Entreprise citée → Responsable (mandat Vincent 2026-09-14, cas Clim Exp'Air) — server
// actions pour le geste humain explicite « Définir comme responsable » sur une entreprise déjà
// citée dans le titre ou les preuves d'un Point (cf. PointDetailCitedCompany), et son retrait
// symétrique. Même niveau d'accès que la modification Responsable/Entreprise d'une Action
// (updateActionAssignmentAction, app/(dashboard)/actions/actions.ts) : managerOrAdmin, car
// cette écriture crée une responsabilité structurée, pas une simple lecture.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import {
  designateResponsibleCompany,
  revokeResponsibleCompany,
  type DesignateResponsibleCompanyResult,
  type RevokeResponsibleCompanyResult,
} from '@/lib/db/tracked-point-responsible-companies'

function revalidatePointPaths(siteId: string, pointId: string) {
  revalidatePath(`/sites/${siteId}/point/${pointId}`)
  revalidatePath(`/sites/${siteId}`)
  revalidatePath(`/m/site/${siteId}/point/${pointId}`)
  revalidatePath(`/m/site/${siteId}`)
}

const designateSchema = z.object({
  siteId: z.string().uuid(),
  pointId: z.string().min(1),
  companyId: z.string().uuid(),
})

export async function designateResponsibleCompanyAction(
  rawInput: unknown,
): Promise<DesignateResponsibleCompanyResult> {
  const parsed = designateSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' }
  const { siteId, pointId, companyId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await designateResponsibleCompany({
    siteId,
    trackedPointId: pointId,
    companyId,
    designatedBy: access.userId,
  })
  if (result.ok) revalidatePointPaths(siteId, pointId)
  return result
}

const revokeSchema = z.object({
  siteId: z.string().uuid(),
  pointId: z.string().min(1),
  designationId: z.string().uuid(),
})

export async function revokeResponsibleCompanyAction(
  rawInput: unknown,
): Promise<RevokeResponsibleCompanyResult> {
  const parsed = revokeSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' }
  const { siteId, pointId, designationId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await revokeResponsibleCompany({ siteId, designationId, revokedBy: access.userId })
  if (result.ok) revalidatePointPaths(siteId, pointId)
  return result
}
