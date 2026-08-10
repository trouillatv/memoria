'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'

/**
 * Fusionne deux canonical_subject. Détermine automatiquement le winner (celui avec
 * le plus de threads). Le loser reçoit status='merged' + merged_into. Un journal
 * canonical_subject_merge est créé pour permettre l'annulation.
 *
 * Retourne { winnerId } en cas de succès, { error } en cas d'échec.
 */
export async function mergeCanonicalSubjectsAction(
  subjectAId: string,
  subjectBId: string,
  suggestedLabel: string,
  siteId: string,
): Promise<{ error?: string; winnerId?: string }> {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) return { error: 'Non authentifié' }

  const supabase = createAdminClient()

  // 1. Thread counts pour décider winner/loser
  const [{ count: countA }, { count: countB }] = await Promise.all([
    supabase.from('subject_thread_identity').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', subjectAId),
    supabase.from('subject_thread_identity').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', subjectBId),
  ])

  const winnerId = (countA ?? 0) >= (countB ?? 0) ? subjectAId : subjectBId
  const loserId = winnerId === subjectAId ? subjectBId : subjectAId

  // 2. Données courantes pour le snapshot
  const [{ data: winnerData }, { data: loserData }] = await Promise.all([
    supabase.from('canonical_subject').select('label, aliases, status').eq('id', winnerId).maybeSingle(),
    supabase.from('canonical_subject').select('label, aliases, status').eq('id', loserId).maybeSingle(),
  ])

  if (!winnerData || !loserData) return { error: 'Sujet introuvable' }

  const winner = winnerData as { label: string; aliases: string[]; status: string }
  const loser = loserData as { label: string; aliases: string[]; status: string }

  if (loser.status === 'merged') return { error: 'Ce sujet est déjà fusionné' }
  if (winner.status === 'merged') return { error: 'Le sujet cible est déjà fusionné' }

  // 3. IDs des entités à déplacer pour le snapshot
  const [{ data: stiRows }, { data: occRows }] = await Promise.all([
    supabase.from('subject_thread_identity').select('subject_thread_id').eq('canonical_subject_id', loserId),
    supabase.from('canonical_subject_occurrence').select('id').eq('canonical_subject_id', loserId),
  ])
  const movedThreadIds = ((stiRows ?? []) as Array<{ subject_thread_id: string }>).map((r) => r.subject_thread_id)
  const movedOccurrenceIds = ((occRows ?? []) as Array<{ id: string }>).map((r) => r.id)

  // 4. Reroutage STI
  if (movedThreadIds.length > 0) {
    const { error: stiErr } = await supabase
      .from('subject_thread_identity')
      .update({ canonical_subject_id: winnerId })
      .eq('canonical_subject_id', loserId)
    if (stiErr) return { error: `Erreur reroutage threads : ${stiErr.message}` }
  }

  // 5. Reroutage occurrences
  if (movedOccurrenceIds.length > 0) {
    const { error: occErr } = await supabase
      .from('canonical_subject_occurrence')
      .update({ canonical_subject_id: winnerId })
      .eq('canonical_subject_id', loserId)
    if (occErr) return { error: `Erreur reroutage occurrences : ${occErr.message}` }
  }

  // 6. Marquer le loser
  const { error: loserErr } = await supabase
    .from('canonical_subject')
    .update({ status: 'merged', merged_into: winnerId })
    .eq('id', loserId)
  if (loserErr) return { error: `Erreur marquage loser : ${loserErr.message}` }

  // 7. Retirer le loser du topic
  await supabase.from('canonical_topic_subject').delete().eq('canonical_subject_id', loserId)

  // 8. Journal de fusion
  const finalLabel = suggestedLabel.trim() || winner.label
  const snapshot = {
    moved_thread_ids: movedThreadIds,
    moved_occurrence_ids: movedOccurrenceIds,
    winner_label_before: winner.label,
    winner_aliases_before: winner.aliases ?? [],
    loser_label: loser.label,
    loser_aliases: loser.aliases ?? [],
  }

  const { error: journalErr } = await supabase.from('canonical_subject_merge').insert({
    winner_subject_id: winnerId,
    loser_subject_id: loserId,
    suggested_label: finalLabel !== winner.label ? finalLabel : null,
    resolution_source: 'manual',
    snapshot,
  })
  if (journalErr) return { error: `Erreur journal : ${journalErr.message}` }

  // 9. Mettre à jour le winner (label + aliases fusionnés)
  const combinedAliases = Array.from(new Set([
    ...(winner.aliases ?? []),
    loser.label,
    ...(loser.aliases ?? []),
    ...(finalLabel !== winner.label ? [winner.label] : []),
  ])).filter((a) => a !== finalLabel)

  const { error: winnerErr } = await supabase
    .from('canonical_subject')
    .update({ label: finalLabel, aliases: combinedAliases })
    .eq('id', winnerId)
  if (winnerErr) return { error: `Erreur mise à jour winner : ${winnerErr.message}` }

  revalidatePath(`/sites/${siteId}/historique`)
  revalidatePath(`/sites/${siteId}/historique/sujets/${winnerId}`)
  revalidatePath(`/sites/${siteId}/historique/sujets/${loserId}`)

  return { winnerId }
}
