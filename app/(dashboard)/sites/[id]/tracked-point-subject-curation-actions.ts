'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { curateTrackedPointSubject, createSubjectFromTrackedPoint } from '@/lib/db/tracked-point-subject-curation'

export type CuratePointSubjectActionResult =
  | {
    ok: true
    code: 'moved' | 'detached' | 'created_subject' | 'no_op'
    targetCanonicalSubjectId: string | null
    createdCanonicalSubjectId?: string
  }
  | { ok: false; error: string }

const schema = z.object({
  siteId: z.string().uuid(),
  trackedPointId: z.string().uuid(),
  targetCanonicalSubjectId: z.string().uuid(),
  currentCanonicalSubjectId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(500).optional(),
})

const createSubjectSchema = z.object({
  siteId: z.string().uuid(),
  trackedPointId: z.string().uuid(),
  label: z.string().trim().min(1).max(180),
  reason: z.string().trim().max(500).optional(),
})

const detachSchema = z.object({
  siteId: z.string().uuid(),
  trackedPointId: z.string().uuid(),
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
      return "Ce Point n'a pas de rattachement documentaire actif a deplacer."
    case 'invalid_thread_identity':
      return "Le rattachement source de ce Point n'est pas assez stable pour etre deplace automatiquement."
    case 'label_required':
      return 'Nom du sujet requis.'
    case 'duplicate_subject':
      return 'Un sujet portant ce nom existe deja sur ce chantier.'
    default:
      return 'Changement de sujet impossible.'
  }
}

function revalidatePointCuration(siteId: string, trackedPointId: string, subjectIds: Array<string | null | undefined>) {
  revalidatePath(`/sites/${siteId}/point/${trackedPointId}`)
  revalidatePath(`/sites/${siteId}/points`)
  revalidatePath(`/sites/${siteId}`)
  revalidatePath(`/sites/${siteId}/historique`)
  for (const subjectId of subjectIds) {
    if (subjectId) revalidatePath(`/sites/${siteId}/historique/sujets/${subjectId}`)
  }
}

export async function curatePointSubjectAction(rawInput: unknown): Promise<CuratePointSubjectActionResult> {
  const parsed = schema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Parametres invalides.' }

  const { siteId, trackedPointId, targetCanonicalSubjectId, currentCanonicalSubjectId, reason } = parsed.data
  if (currentCanonicalSubjectId && currentCanonicalSubjectId === targetCanonicalSubjectId) {
    return { ok: false, error: 'Choisis un sujet different du sujet actuel.' }
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

  revalidatePointCuration(siteId, trackedPointId, [result.previousCanonicalSubjectId, targetCanonicalSubjectId])

  return { ok: true, code, targetCanonicalSubjectId }
}

export async function createPointSubjectAction(rawInput: unknown): Promise<CuratePointSubjectActionResult> {
  const parsed = createSubjectSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Parametres invalides.' }

  const access = await requireSiteWriteAccess(parsed.data.siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await createSubjectFromTrackedPoint({
    siteId: parsed.data.siteId,
    trackedPointId: parsed.data.trackedPointId,
    label: parsed.data.label,
    userId: access.userId,
    reason: parsed.data.reason?.trim() || null,
  })

  if (!result.ok) return { ok: false, error: humanError(result.code) }
  const target = result.createdCanonicalSubjectId ?? result.targetCanonicalSubjectId ?? null

  revalidatePointCuration(parsed.data.siteId, parsed.data.trackedPointId, [result.previousCanonicalSubjectId, target])

  return {
    ok: true,
    code: result.code === 'no_op' ? 'no_op' : 'created_subject',
    targetCanonicalSubjectId: target,
    createdCanonicalSubjectId: result.createdCanonicalSubjectId,
  }
}

export async function detachPointSubjectAction(rawInput: unknown): Promise<CuratePointSubjectActionResult> {
  const parsed = detachSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Parametres invalides.' }

  const access = await requireSiteWriteAccess(parsed.data.siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await curateTrackedPointSubject({
    siteId: parsed.data.siteId,
    trackedPointId: parsed.data.trackedPointId,
    targetCanonicalSubjectId: null,
    userId: access.userId,
    reason: parsed.data.reason?.trim() || null,
  })

  if (!result.ok) return { ok: false, error: humanError(result.code) }

  revalidatePointCuration(parsed.data.siteId, parsed.data.trackedPointId, [
    result.previousCanonicalSubjectId,
    parsed.data.currentCanonicalSubjectId,
  ])

  return { ok: true, code: result.code === 'no_op' ? 'no_op' : 'detached', targetCanonicalSubjectId: null }
}
