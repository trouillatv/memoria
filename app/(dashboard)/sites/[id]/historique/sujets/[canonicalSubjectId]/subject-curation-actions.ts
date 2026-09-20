'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { mergeCanonicalSubjectsManual, renameCanonicalSubjectManual } from '@/lib/db/tracked-point-subject-curation'

export type SubjectCurationActionResult =
  | { ok: true; code: 'renamed' | 'merged' | 'no_op'; targetCanonicalSubjectId?: string }
  | { ok: false; error: string }

const renameSchema = z.object({
  siteId: z.string().uuid(),
  canonicalSubjectId: z.string().uuid(),
  newLabel: z.string().trim().min(1).max(180),
  reason: z.string().trim().max(500).optional(),
})

const mergeSchema = z.object({
  siteId: z.string().uuid(),
  sourceCanonicalSubjectId: z.string().uuid(),
  targetCanonicalSubjectId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
})

function humanError(code: string): string {
  switch (code) {
    case 'label_required':
      return 'Nom du sujet requis.'
    case 'duplicate_subject':
      return 'Un autre sujet porte deja ce nom.'
    case 'subject_not_found':
    case 'source_subject_not_found':
    case 'target_subject_not_found':
      return "Sujet introuvable ou indisponible sur ce chantier."
    case 'same_subject':
      return 'Choisis deux sujets differents.'
    default:
      return 'Curation du sujet impossible.'
  }
}

export async function renameCanonicalSubjectAction(rawInput: unknown): Promise<SubjectCurationActionResult> {
  const parsed = renameSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Parametres invalides.' }

  const access = await requireSiteWriteAccess(parsed.data.siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await renameCanonicalSubjectManual({
    siteId: parsed.data.siteId,
    canonicalSubjectId: parsed.data.canonicalSubjectId,
    newLabel: parsed.data.newLabel,
    userId: access.userId,
    reason: parsed.data.reason?.trim() || null,
  })

  if (!result.ok) return { ok: false, error: humanError(result.code) }

  revalidatePath(`/sites/${parsed.data.siteId}/historique`)
  revalidatePath(`/sites/${parsed.data.siteId}/historique/sujets/${parsed.data.canonicalSubjectId}`)
  revalidatePath(`/sites/${parsed.data.siteId}/points`)
  revalidatePath(`/sites/${parsed.data.siteId}`)

  return { ok: true, code: result.code }
}

export async function mergeCanonicalSubjectsAction(rawInput: unknown): Promise<SubjectCurationActionResult> {
  const parsed = mergeSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Parametres invalides.' }
  if (parsed.data.sourceCanonicalSubjectId === parsed.data.targetCanonicalSubjectId) {
    return { ok: false, error: 'Choisis deux sujets differents.' }
  }

  const access = await requireSiteWriteAccess(parsed.data.siteId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: access.error }

  const result = await mergeCanonicalSubjectsManual({
    siteId: parsed.data.siteId,
    sourceCanonicalSubjectId: parsed.data.sourceCanonicalSubjectId,
    targetCanonicalSubjectId: parsed.data.targetCanonicalSubjectId,
    userId: access.userId,
    reason: parsed.data.reason?.trim() || null,
  })

  if (!result.ok) return { ok: false, error: humanError(result.code) }

  revalidatePath(`/sites/${parsed.data.siteId}/historique`)
  revalidatePath(`/sites/${parsed.data.siteId}/historique/sujets/${parsed.data.sourceCanonicalSubjectId}`)
  revalidatePath(`/sites/${parsed.data.siteId}/historique/sujets/${parsed.data.targetCanonicalSubjectId}`)
  revalidatePath(`/sites/${parsed.data.siteId}/points`)
  revalidatePath(`/sites/${parsed.data.siteId}`)

  return { ok: true, code: result.code, targetCanonicalSubjectId: parsed.data.targetCanonicalSubjectId }
}
