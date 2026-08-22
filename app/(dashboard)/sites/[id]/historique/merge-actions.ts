'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getAIProvider } from '@/services/ai/factory'
import { withAITracking } from '@/services/ai/tracking'
import type { LinkSnapshot } from '@/lib/db/canonical-subject-merge'

// ── Types exportés ────────────────────────────────────────────────────────────

export interface SubjectSimilarity {
  score: number
  recommendation: 'merge' | 'link' | 'none'
  reason: string
  suggested_label: string | null
}

/**
 * Fusionne deux canonical_subject. Détermine automatiquement le winner (celui avec
 * le plus de threads). Le loser reçoit status='merged' + merged_into. Un journal
 * canonical_subject_merge est créé pour permettre l'annulation.
 *
 * Gère canonical_subject_links :
 *   — self-links (loser ↔ winner) supprimés
 *   — duplicates (winner possède déjà la paire) supprimés, lien winner conservé
 *   — liens reroutés loser → winner
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

  // 3. Snapshot avant mutation : STI, occurrences, canonical_subject_links
  const [
    { data: stiRows },
    { data: occRows },
    { data: linksAsSource },
    { data: linksAsTarget },
  ] = await Promise.all([
    supabase.from('subject_thread_identity').select('subject_thread_id').eq('canonical_subject_id', loserId),
    supabase.from('canonical_subject_occurrence').select('id').eq('canonical_subject_id', loserId),
    supabase.from('canonical_subject_links')
      .select('id, source_subject_id, target_subject_id, relation_type, status')
      .eq('source_subject_id', loserId),
    supabase.from('canonical_subject_links')
      .select('id, source_subject_id, target_subject_id, relation_type, status')
      .eq('target_subject_id', loserId),
  ])

  const movedThreadIds = ((stiRows ?? []) as Array<{ subject_thread_id: string }>).map((r) => r.subject_thread_id)
  const movedOccurrenceIds = ((occRows ?? []) as Array<{ id: string }>).map((r) => r.id)
  const loserLinks: LinkSnapshot[] = [
    ...((linksAsSource ?? []) as LinkSnapshot[]),
    ...((linksAsTarget ?? []) as LinkSnapshot[]),
  ]

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

  // 6. Reroutage proposals
  {
    const { error: propsErr } = await supabase
      .from('site_knowledge_proposals')
      .update({ canonical_subject_id: winnerId })
      .eq('canonical_subject_id', loserId)
    if (propsErr) return { error: `Erreur reroutage proposals : ${propsErr.message}` }
  }

  // 7. canonical_subject_links
  const selfLinkIds: string[] = []
  const deletedDuplicateLinkIds: string[] = []
  const movedLinkIds: string[] = []

  if (loserLinks.length > 0) {
    // 7a. Self-links (loser ↔ winner) → DELETE avant reroutage
    const selfLinks = loserLinks.filter(
      (l) => l.source_subject_id === winnerId || l.target_subject_id === winnerId,
    )
    if (selfLinks.length > 0) {
      const ids = selfLinks.map((l) => l.id)
      selfLinkIds.push(...ids)
      const { error: selfErr } = await supabase
        .from('canonical_subject_links')
        .delete()
        .in('id', ids)
      if (selfErr) return { error: `Erreur suppression self-links : ${selfErr.message}` }
    }

    // 7b. Liens restants : duplicate check + reroutage
    const remaining = loserLinks.filter((l) => !selfLinkIds.includes(l.id))
    for (const link of remaining) {
      const otherSideId =
        link.source_subject_id === loserId ? link.target_subject_id : link.source_subject_id
      const pairLow = winnerId < otherSideId ? winnerId : otherSideId
      const pairHigh = winnerId > otherSideId ? winnerId : otherSideId

      const { data: existingWinnerLink } = await supabase
        .from('canonical_subject_links')
        .select('id')
        .eq('pair_low_id', pairLow)
        .eq('pair_high_id', pairHigh)
        .maybeSingle()

      if (existingWinnerLink) {
        // Duplicate : supprimer le lien du loser, conserver celui du winner
        deletedDuplicateLinkIds.push(link.id)
        await supabase.from('canonical_subject_links').delete().eq('id', link.id)
      } else {
        // Rerouter loser → winner
        const update =
          link.source_subject_id === loserId
            ? { source_subject_id: winnerId }
            : { target_subject_id: winnerId }
        const { error: rerouteErr } = await supabase
          .from('canonical_subject_links')
          .update(update)
          .eq('id', link.id)
        if (rerouteErr) return { error: `Erreur reroutage link ${link.id} : ${rerouteErr.message}` }
        movedLinkIds.push(link.id)
      }
    }
  }

  // 8. Marquer le loser
  const { error: loserErr } = await supabase
    .from('canonical_subject')
    .update({ status: 'merged', merged_into: winnerId })
    .eq('id', loserId)
  if (loserErr) return { error: `Erreur marquage loser : ${loserErr.message}` }

  // 9. Retirer le loser du topic
  await supabase.from('canonical_topic_subject').delete().eq('canonical_subject_id', loserId)

  // 10. Journal de fusion (snapshot complet pour rollback)
  const finalLabel = suggestedLabel.trim() || winner.label
  const snapshot = {
    moved_thread_ids: movedThreadIds,
    moved_occurrence_ids: movedOccurrenceIds,
    winner_label_before: winner.label,
    winner_aliases_before: winner.aliases ?? [],
    loser_label: loser.label,
    loser_aliases: loser.aliases ?? [],
    moved_link_ids: movedLinkIds,
    deleted_self_link_ids: selfLinkIds,
    deleted_duplicate_link_ids: deletedDuplicateLinkIds,
    links_snapshot_before: loserLinks,
  }

  const { error: journalErr } = await supabase.from('canonical_subject_merge').insert({
    winner_subject_id: winnerId,
    loser_subject_id: loserId,
    suggested_label: finalLabel !== winner.label ? finalLabel : null,
    resolution_source: 'manual',
    engine_version: null,
    snapshot,
  })
  if (journalErr) return { error: `Erreur journal : ${journalErr.message}` }

  // 11. Mettre à jour le winner (label + aliases fusionnés)
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

/** Déplace un sujet vers un topic (remplace l'appartenance courante). */
export async function moveSubjectToTopicAction(
  canonicalSubjectId: string,
  topicId: string,
  siteId: string,
): Promise<{ error?: string }> {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) return { error: 'Non authentifié' }

  const supabase = createAdminClient()
  const { error } = await supabase.from('canonical_topic_subject').upsert(
    { canonical_topic_id: topicId, canonical_subject_id: canonicalSubjectId, resolution_source: 'manual' },
    { onConflict: 'canonical_subject_id' },
  )
  if (error) return { error: error.message }

  revalidatePath(`/sites/${siteId}/historique`)
  return {}
}

/** Crée un lien de dépendance entre deux canonical_subject depuis la matrice. */
export async function createLinkFromMatrixAction(
  fromCanonicalSubjectId: string,
  toCanonicalSubjectId: string,
  linkType: string,
  siteId: string,
  justification?: string | null,
): Promise<{ error?: string }> {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) return { error: 'Non authentifié' }

  const { createCanonicalSubjectLink } = await import('@/lib/db/subject-thread-links')
  const result = await createCanonicalSubjectLink({
    siteId,
    fromCanonicalSubjectId,
    toCanonicalSubjectId,
    linkType: linkType as import('@/lib/db/subject-thread-links').SubjectLinkType,
    justification: justification ?? null,
    userId: user.id,
  })

  if (result === 'self_link') return { error: 'Un sujet ne peut pas être lié à lui-même.' }
  if (result === 'no_thread') return { error: 'Thread manquant pour créer la liaison.' }

  revalidatePath(`/sites/${siteId}/historique`)
  revalidatePath(`/sites/${siteId}/historique/sujets/${fromCanonicalSubjectId}`)
  revalidatePath(`/sites/${siteId}/historique/sujets/${toCanonicalSubjectId}`)
  return {}
}

// ── Analyse Gemini de similarité ──────────────────────────────────────────────

const SIMILARITY_SYSTEM_PROMPT = `Tu es un expert en management de chantier BTP.
On te donne deux sujets canoniques extraits de procès-verbaux de chantier.
Chaque sujet comporte un libellé principal et des alias (formulations alternatives rencontrées dans les PV).

Ta mission : évaluer si ces deux sujets décrivent le même objet réel sur le chantier.

Critères de même sujet :
- Même problème physique ou opération, formulé différemment
- Même réserve ou observation, libellée avec des variations mineures
- Les alias confirment une continuité sémantique évidente

Ne pas considérer comme même sujet :
- Deux actions dans le même domaine mais portant sur des objets distincts
- Un sujet général et un sujet spécifique qui méritent d'exister séparément

Réponds UNIQUEMENT en JSON valide, aucun autre texte :
{
  "same_subject_score": 85,
  "recommendation": "merge",
  "reason": "Même réserve d'enrobage, libellés quasi identiques",
  "suggested_label": "Enrobage des conduites"
}

same_subject_score : entier 0-100
recommendation : "merge" si score >= 85 | "link" si 60-84 | "none" si < 60
reason : phrase courte ≤ 15 mots expliquant le verdict
suggested_label : libellé canonique proposé si fusion (null sinon)`

/**
 * Appelle Gemini pour évaluer la similarité entre deux canonical_subject.
 * Aucune écriture en base — lecture seule + appel LLM.
 */
export async function analyzeSubjectSimilarityAction(
  subjectAId: string,
  subjectBId: string,
): Promise<{ error?: string } & Partial<SubjectSimilarity>> {
  const user = await getCurrentUserWithProfile().catch(() => null)
  const supabase = createAdminClient()

  const [{ data: sA }, { data: sB }] = await Promise.all([
    supabase.from('canonical_subject').select('label, aliases').eq('id', subjectAId).maybeSingle(),
    supabase.from('canonical_subject').select('label, aliases').eq('id', subjectBId).maybeSingle(),
  ])
  if (!sA || !sB) return { error: 'Sujet introuvable' }

  const provider = getAIProvider()
  const userMsg = JSON.stringify({
    sujet_A: { label: (sA as { label: string; aliases: string[] }).label, aliases: (sA as { label: string; aliases: string[] }).aliases ?? [] },
    sujet_B: { label: (sB as { label: string; aliases: string[] }).label, aliases: (sB as { label: string; aliases: string[] }).aliases ?? [] },
  }, null, 2)

  try {
    const output = await withAITracking('subject_similarity', user?.id ?? null, async () => {
      const r = await provider.complete({
        systemPrompt: SIMILARITY_SYSTEM_PROMPT,
        userMessage: userMsg,
        modelTier: 'light',
        maxOutputTokens: 256,
      })
      return { result: r, tokens: r.tokens, model: r.model, provider: provider.name, durationMs: r.durationMs }
    })

    const rawText = output.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(rawText) as {
      same_subject_score?: number
      recommendation?: string
      reason?: string
      suggested_label?: string | null
    }

    const score = Math.max(0, Math.min(100, Number(parsed.same_subject_score ?? 0)))
    const rec = (['merge', 'link', 'none'] as const).includes(parsed.recommendation as 'merge' | 'link' | 'none')
      ? (parsed.recommendation as 'merge' | 'link' | 'none')
      : score >= 85 ? 'merge' : score >= 60 ? 'link' : 'none'

    return { score, recommendation: rec, reason: parsed.reason ?? '', suggested_label: parsed.suggested_label ?? null }
  } catch (e) {
    const msg = `provider=${provider.name} — ${(e as Error).message}`
    console.error('[subject-similarity] error', msg)
    return { error: msg }
  }
}
