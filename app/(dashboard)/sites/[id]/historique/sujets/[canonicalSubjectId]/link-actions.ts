'use server'

import { revalidatePath } from 'next/cache'
import { confirmSubjectLink, rejectSubjectLink } from '@/lib/db/subject-thread-links'
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
