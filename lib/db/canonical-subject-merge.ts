// Fusion atomique de canonical_subject.
// Toute la logique de validation + reroutage (occurrences, threads, proposals,
// canonical_subject_links) est dans la fonction SQL merge_canonical_subjects()
// (migration 311, complétée par 344). Ce module est un wrapper TypeScript.
//
// Deux fonctions exposées :
//   mergeCanonicalSubjects()         — fusion seule, journal écrit par l'appelant
//   mergeWithJournal()               — fusion + journal complet en une seule opération
//                                      (chemin P1-5B et scripts automatiques)

import { createAdminClient } from '@/lib/supabase/admin'

export interface MergeResult {
  source: string
  target: string
  sourceLabel: string
  targetLabel: string
  occurrencesMoved: number
  threadsMoved: number
  proposalsMoved: number
  canonicalBusinessObjectsMoved: number
  linksMoved: number
  selfLinksDeleted: number
  duplicateLinksDeleted: number
}

export interface MergeJournalOptions {
  winnerId: string
  loserId: string
  siteId: string
  mergeResult: MergeResult
  winnerLabelBefore: string
  winnerAliasesBefore: string[]
  loserLabel: string
  loserAliases: string[]
  suggestedLabel: string | null
  engineVersion: string
  p01Jaccard: number | null
  p02Confidence: number | null
  movedThreadIds: string[]
  movedOccurrenceIds: string[]
  linksSnapshotBefore: LinkSnapshot[]
  movedLinkIds: string[]
  deletedSelfLinkIds: string[]
  deletedDuplicateLinkIds: string[]
}

export interface LinkSnapshot {
  id: string
  source_subject_id: string
  target_subject_id: string
  relation_type: string
  status: string
}

export async function mergeCanonicalSubjects(
  sourceId: string,
  targetId: string,
): Promise<{ ok: true; result: MergeResult } | { ok: false; error: string }> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .rpc('merge_canonical_subjects', {
      p_source_id: sourceId,
      p_target_id: targetId,
    })

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, result: data as MergeResult }
}

export async function writeJournal(opts: MergeJournalOptions): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminClient()

  const snapshot = {
    moved_thread_ids: opts.movedThreadIds,
    moved_occurrence_ids: opts.movedOccurrenceIds,
    winner_label_before: opts.winnerLabelBefore,
    winner_aliases_before: opts.winnerAliasesBefore,
    loser_label: opts.loserLabel,
    loser_aliases: opts.loserAliases,
    moved_link_ids: opts.movedLinkIds,
    deleted_self_link_ids: opts.deletedSelfLinkIds,
    deleted_duplicate_link_ids: opts.deletedDuplicateLinkIds,
    links_snapshot_before: opts.linksSnapshotBefore,
  }

  const { error } = await supabase.from('canonical_subject_merge').insert({
    winner_subject_id: opts.winnerId,
    loser_subject_id: opts.loserId,
    suggested_label: opts.suggestedLabel,
    resolution_source: 'automatic',
    engine_version: opts.engineVersion,
    p01_jaccard: opts.p01Jaccard != null ? Math.round(opts.p01Jaccard * 1000) / 1000 : null,
    p02_confidence: opts.p02Confidence,
    snapshot,
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function mergeWithJournal(opts: {
  sourceId: string
  targetId: string
  siteId: string
  engineVersion: string
  p01Jaccard: number | null
  p02Confidence: number | null
  suggestedLabel?: string | null
}): Promise<{ ok: true; result: MergeResult } | { ok: false; error: string }> {
  const supabase = createAdminClient()

  // 1. Snapshot avant mutation : données winner/loser + links loser
  const [{ data: sourceData }, { data: targetData }] = await Promise.all([
    supabase.from('canonical_subject').select('label, aliases').eq('id', opts.sourceId).maybeSingle(),
    supabase.from('canonical_subject').select('label, aliases').eq('id', opts.targetId).maybeSingle(),
  ])
  if (!sourceData || !targetData) return { ok: false, error: 'Sujet introuvable' }

  const [{ data: stiRows }, { data: occRows }] = await Promise.all([
    supabase.from('subject_thread_identity').select('subject_thread_id').eq('canonical_subject_id', opts.sourceId),
    supabase.from('canonical_subject_occurrence').select('id').eq('canonical_subject_id', opts.sourceId),
  ])

  const [{ data: linksAsSource }, { data: linksAsTarget }] = await Promise.all([
    supabase.from('canonical_subject_links')
      .select('id, source_subject_id, target_subject_id, relation_type, status')
      .eq('source_subject_id', opts.sourceId),
    supabase.from('canonical_subject_links')
      .select('id, source_subject_id, target_subject_id, relation_type, status')
      .eq('target_subject_id', opts.sourceId),
  ])

  const loserLinks: LinkSnapshot[] = [
    ...((linksAsSource ?? []) as LinkSnapshot[]),
    ...((linksAsTarget ?? []) as LinkSnapshot[]),
  ]

  const selfLinkIds = loserLinks
    .filter((l) => l.source_subject_id === opts.targetId || l.target_subject_id === opts.targetId)
    .map((l) => l.id)

  // 2. Fusion atomique SQL (gère links, occurrences, threads, proposals)
  const mergeRes = await mergeCanonicalSubjects(opts.sourceId, opts.targetId)
  if (!mergeRes.ok) return mergeRes

  // 3. Dériver les IDs de links déplacés/supprimés depuis le snapshot + compteurs SQL
  const survivingLinks = loserLinks.filter((l) => !selfLinkIds.includes(l.id))
  const deletedDuplicateCount = mergeRes.result.duplicateLinksDeleted
  const movedCount = mergeRes.result.linksMoved

  // Approximation conservative : on trie les surviving links par position pour inférer
  // quels IDs ont été dupliqués vs déplacés (ordre stable, même logique que SQL DELETE).
  // Pour un rollback précis, privilégier le snapshot complet links_snapshot_before.
  const movedLinkIds: string[] = survivingLinks.slice(0, movedCount).map((l) => l.id)
  const deletedDuplicateLinkIds: string[] = survivingLinks.slice(movedCount, movedCount + deletedDuplicateCount).map((l) => l.id)

  // 4. Écrire le journal structuré
  const source = sourceData as { label: string; aliases: string[] }
  const target = targetData as { label: string; aliases: string[] }

  const journalRes = await writeJournal({
    winnerId: opts.targetId,
    loserId: opts.sourceId,
    siteId: opts.siteId,
    mergeResult: mergeRes.result,
    winnerLabelBefore: target.label,
    winnerAliasesBefore: target.aliases ?? [],
    loserLabel: source.label,
    loserAliases: source.aliases ?? [],
    suggestedLabel: opts.suggestedLabel ?? null,
    engineVersion: opts.engineVersion,
    p01Jaccard: opts.p01Jaccard,
    p02Confidence: opts.p02Confidence,
    movedThreadIds: ((stiRows ?? []) as Array<{ subject_thread_id: string }>).map((r) => r.subject_thread_id),
    movedOccurrenceIds: ((occRows ?? []) as Array<{ id: string }>).map((r) => r.id),
    linksSnapshotBefore: loserLinks,
    movedLinkIds,
    deletedSelfLinkIds: selfLinkIds,
    deletedDuplicateLinkIds,
  })

  if (!journalRes.ok) {
    // La fusion SQL est déjà commise — signaler l'échec du journal sans bloquer
    console.error('[mergeWithJournal] journal write failed after successful merge:', journalRes.error)
    return { ok: false, error: `Fusion réussie mais journal non écrit : ${journalRes.error}` }
  }

  return mergeRes
}
