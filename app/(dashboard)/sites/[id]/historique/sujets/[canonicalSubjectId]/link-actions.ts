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

/** Compatible useActionState (React 19) — retourne null en cas de succès, string en cas d'erreur. */
export async function createCanonicalLinkAction(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  const siteId               = formData.get('siteId') as string
  const canonicalSubjectId   = formData.get('canonicalSubjectId') as string
  const toCanonicalSubjectId = formData.get('toCanonicalSubjectId') as string
  const linkType             = formData.get('linkType') as SubjectLinkType
  const justification        = ((formData.get('justification') as string | null) ?? '').trim() || null

  if (!toCanonicalSubjectId) return 'Aucun sujet cible sélectionné.'
  if (!linkType) return 'Type de relation manquant.'

  const user = await getCurrentUserWithProfile()
  if (!user) return 'Non authentifié.'

  const result = await createCanonicalSubjectLink({
    siteId,
    fromCanonicalSubjectId: canonicalSubjectId,
    toCanonicalSubjectId,
    linkType,
    justification,
    userId: user.id,
  })

  if (result === 'self_link') return 'Un sujet ne peut pas être lié à lui-même.'
  if (result === 'no_thread') return 'Impossible de créer la liaison : ce sujet n\'a pas encore de thread représentatif.'
  // 'already_exists' et 'created' → succès

  revalidatePath(`/sites/${siteId}/historique/sujets/${canonicalSubjectId}`)
  revalidatePath(`/sites/${siteId}/historique/sujets/${toCanonicalSubjectId}`)
  revalidatePath(`/sites/${siteId}/historique`)
  return null
}

export async function deleteCanonicalLinkAction(formData: FormData) {
  const linkId             = formData.get('linkId') as string
  const siteId             = formData.get('siteId') as string
  const canonicalSubjectId = formData.get('canonicalSubjectId') as string

  await deleteSubjectLink(linkId)
  revalidatePath(`/sites/${siteId}/historique/sujets/${canonicalSubjectId}`)
  revalidatePath(`/sites/${siteId}/historique`)
}

/** Crée un nouveau canonical_subject opérationnel (statut active, sans acteur).
 *  Retourne {id, label} ou {error} en cas d'échec. */
export async function createCanonicalSubjectForLink(
  siteId: string,
  label: string,
): Promise<{ id: string; label: string } | { error: string }> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const trimmed = label.trim()
  if (!trimmed) return { error: 'Label vide' }

  const { data, error } = await supabase
    .from('canonical_subject')
    .insert({ site_id: siteId, label: trimmed, status: 'active' })
    .select('id')
    .single()

  if (error || !data) return { error: error?.message ?? 'Erreur inconnue' }

  const csId = (data as { id: string }).id

  // Crée un thread synthétique (UUID libre) pour que le nouveau canonical soit immédiatement
  // relationnable via createCanonicalSubjectLink(), qui résout les threads depuis STI.
  const { error: stiError } = await supabase.from('subject_thread_identity').insert({
    subject_thread_id: crypto.randomUUID(),
    site_id: siteId,
    canonical_subject_id: csId,
    source: 'manual',
  })
  if (stiError) {
    // Rollback : on supprime le canonical si le STI échoue, pour éviter un fantôme non-relationnable.
    await supabase.from('canonical_subject').delete().eq('id', csId)
    return { error: `Erreur STI : ${stiError.message}` }
  }

  revalidatePath(`/sites/${siteId}/historique`)
  return { id: csId, label: trimmed }
}
