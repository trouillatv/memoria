'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createSubjectLink, rejectSubjectLink, deleteSubjectLink } from '@/lib/db/subject-thread-links'
import type { SubjectLinkType } from '@/lib/db/subject-thread-links'

function requireManager(role: string | undefined): void {
  if (!role || !['admin', 'manager', 'chef_equipe'].includes(role)) {
    throw new Error('Autorisation insuffisante')
  }
}

export async function createLinkAction(formData: FormData) {
  const user = await getCurrentUserWithProfile()
  if (!user) throw new Error('Non authentifié')
  requireManager(user.role)

  const siteId         = formData.get('siteId') as string
  const fromThreadId   = formData.get('fromThreadId') as string
  const toThreadId     = formData.get('toThreadId') as string
  const linkType       = formData.get('linkType') as SubjectLinkType
  const justification  = (formData.get('justification') as string | null) || null

  if (!siteId || !fromThreadId || !toThreadId || !linkType) {
    throw new Error('Paramètres manquants')
  }
  if (fromThreadId === toThreadId) {
    throw new Error('Un sujet ne peut pas être lié à lui-même')
  }

  await createSubjectLink({ siteId, fromThreadId, toThreadId, linkType, justification, createdBy: user.id })
  revalidatePath(`/sites/${siteId}/historique/${fromThreadId}`)
  revalidatePath(`/sites/${siteId}/historique/${toThreadId}`)
}

export async function deleteLinkAction(formData: FormData) {
  const user = await getCurrentUserWithProfile()
  if (!user) throw new Error('Non authentifié')
  requireManager(user.role)

  const linkId = formData.get('linkId') as string
  const siteId = formData.get('siteId') as string
  const fromThreadId = formData.get('fromThreadId') as string

  await deleteSubjectLink(linkId)
  revalidatePath(`/sites/${siteId}/historique/${fromThreadId}`)
}

export async function rejectLinkAction(formData: FormData) {
  const user = await getCurrentUserWithProfile()
  if (!user) throw new Error('Non authentifié')
  requireManager(user.role)

  const linkId = formData.get('linkId') as string
  const siteId = formData.get('siteId') as string
  const fromThreadId = formData.get('fromThreadId') as string

  await rejectSubjectLink(linkId)
  revalidatePath(`/sites/${siteId}/historique/${fromThreadId}`)
}
