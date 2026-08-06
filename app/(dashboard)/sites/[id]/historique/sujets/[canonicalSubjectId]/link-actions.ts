'use server'

import { revalidatePath } from 'next/cache'
import { confirmSubjectLink, rejectSubjectLink, deleteSubjectLink, createCanonicalSubjectLink } from '@/lib/db/subject-thread-links'
import type { SubjectLinkType } from '@/lib/db/subject-thread-links'
import { getCurrentUserWithProfile } from '@/lib/db/users'

export async function confirmSuggestedLink(formData: FormData) {
  const linkId            = formData.get('linkId') as string
  const siteId            = formData.get('siteId') as string
  const canonicalSubjectId = formData.get('canonicalSubjectId') as string

  const user = await getCurrentUserWithProfile()
  if (!user) throw new Error('Non authentifié')

  await confirmSubjectLink(linkId, user.id)
  revalidatePath(`/sites/${siteId}/historique/sujets/${canonicalSubjectId}`)
  revalidatePath(`/sites/${siteId}/historique`)
}

export async function rejectSuggestedLink(formData: FormData) {
  const linkId            = formData.get('linkId') as string
  const siteId            = formData.get('siteId') as string
  const canonicalSubjectId = formData.get('canonicalSubjectId') as string

  await rejectSubjectLink(linkId)
  revalidatePath(`/sites/${siteId}/historique/sujets/${canonicalSubjectId}`)
}

export async function createCanonicalLinkAction(formData: FormData) {
  const siteId               = formData.get('siteId') as string
  const canonicalSubjectId   = formData.get('canonicalSubjectId') as string
  const toCanonicalSubjectId = formData.get('toCanonicalSubjectId') as string
  const linkType             = formData.get('linkType') as SubjectLinkType
  const justification        = ((formData.get('justification') as string | null) ?? '').trim() || null

  if (!toCanonicalSubjectId || !linkType) return

  const user = await getCurrentUserWithProfile()
  if (!user) throw new Error('Non authentifié')

  await createCanonicalSubjectLink({
    siteId,
    fromCanonicalSubjectId: canonicalSubjectId,
    toCanonicalSubjectId,
    linkType,
    justification,
    userId: user.id,
  })

  revalidatePath(`/sites/${siteId}/historique/sujets/${canonicalSubjectId}`)
  revalidatePath(`/sites/${siteId}/historique/sujets/${toCanonicalSubjectId}`)
  revalidatePath(`/sites/${siteId}/historique`)
}

export async function deleteCanonicalLinkAction(formData: FormData) {
  const linkId             = formData.get('linkId') as string
  const siteId             = formData.get('siteId') as string
  const canonicalSubjectId = formData.get('canonicalSubjectId') as string

  await deleteSubjectLink(linkId)
  revalidatePath(`/sites/${siteId}/historique/sujets/${canonicalSubjectId}`)
  revalidatePath(`/sites/${siteId}/historique`)
}
