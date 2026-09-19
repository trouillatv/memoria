'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { curateTrackedPointSubject } from '@/lib/db/tracked-point-subject-curation'

export type CuratePointSubjectActionResult =
  | { ok: true; code: 'moved' | 'no_op'; targetCanonicalSubjectId: string }
  | { ok: false; error: string }

const schema = z.object({
  siteId: z.string().uuid(),
  trackedPointId: z.string().uuid(),
  targetCanonicalSubjectId: z.string().uuid(),
  currentCanonicalSubjectId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(500).optional(),
})

function humanError(code: string): string {
  switch (code) {
    case 'point_not_found':
      return 'Point introuvable pour ce chantier.'
    case 'target_subject_not_found':
      return "Le sujet cible n'est pas disponible sur ce chantier."
    case 'no_active_thread_membership':
      return "Ce Point n'a pas de rattachement documentaire actif à déplacer."
    case 'invalid_thread_identity':
      return "Le rattachement source de ce Point n'est pas assez stable pour être déplacé automatiquement."
    default:
      return 'Changement de sujet impossible.'
  }
}

export async function curatePointSubjectAction(rawInput: unknown): Promise<CuratePointSubjectActionResult> {
  const parsed = schema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }

  const { siteId, trackedPointId, targetCanonicalSubjectId, currentCanonicalSubjectId, reason } = parsed.data
  if (currentCanonicalSubjectId && currentCanonicalSubjectId === targetCanonicalSubjectId) {
    return { ok: false, error: 'Choisis un sujet différent du sujet actuel.' }
  }

  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await curateTrackedPointSubject({
    siteId,
    trackedPointId,
    targetCanonicalSubjectId,
    userId: access.userId,
    reason: reason?.trim() || null,
  })

  if (!result.ok) return { ok: false, error: humanError(result.code) }
  const code = result.code === 'no_op' ? 'no_op' : 'moved'

  revalidatePath(`/sites/${siteId}/point/${trackedPointId}`)
  revalidatePath(`/sites/${siteId}/points`)
  revalidatePath(`/sites/${siteId}`)
  revalidatePath(`/sites/${siteId}/historique`)
  if (result.previousCanonicalSubjectId) {
    revalidatePath(`/sites/${siteId}/historique/sujets/${result.previousCanonicalSubjectId}`)
  }
  revalidatePath(`/sites/${siteId}/historique/sujets/${targetCanonicalSubjectId}`)

  return { ok: true, code, targetCanonicalSubjectId }
}
