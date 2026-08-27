import 'server-only'

// P0-J.1 — Canonicalisation automatique des PV historiques
//
// Donne aux threads métier (action/decision/knowledge_fact/deadline/observation/
// reservation) d'un PV historique la même identité canonique que celle produite
// pour les visites terrain (canonical_subject + subject_thread_identity), en
// réutilisant le moteur de résolution/matching/clustering déjà en production
// (canonical-subject-source-reconcile.ts) plutôt qu'en dupliquant sa logique.
//
// Doctrine stricte (validée Vincent 2026-08-19) :
//   - ce module ne pose QUE l'identité (canonical_subject, subject_thread_identity).
//     Il n'écrit JAMAIS canonical_subject_occurrence : P0-B2
//     (ensureHistoricalPdfOccurrences, canal 'historical_pdf') reste seul
//     propriétaire des occurrences historiques.
//   - idempotent via subject_thread_identity.subject_thread_id : un thread déjà
//     identifié (upsert précédent, retry, double-clic) est ignoré, jamais
//     retraité ni réécrit.
//   - aucune génération de canonical_subject_similarity_suggestion.
//   - person/company sont hors périmètre : déjà canonicalisés par
//     extract-historical-pv.ts (étape 12c, tryActorAutoLink).
//
// Appelé depuis createHistoricalVisitAction(), après matérialisation du
// site_reports (source_ref_id nécessaire en aval par P0-B2) et avant
// ensureHistoricalPdfOccurrences() (les occurrences ont besoin de l'identité
// posée ici pour résoudre thread → canonical_subject_id).

import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCanonicalSubjectReference } from '@/lib/db/canonical-subject-resolve'
import {
  CAN_CREATE_SUBJECT_KINDS,
  CREATE_THRESHOLD,
  clusterOrphansWithGemini,
  matchExistingSubject,
  resolveMatchExistingDecision,
  isUniqueLabelViolation,
  findActiveSubjectByNormalizedLabel,
} from '@/lib/db/canonical-subject-source-reconcile'
import { selectBestText } from '@/lib/db/canonical-subject-historical-occurrence'
import { jaccardSimilarity } from '@/lib/documents/subject-reconciliation'
import { normalizeForMatching, P01_NORMALIZED_JACCARD_THRESHOLD } from '@/lib/subjects/normalize-for-matching'
import { analyzeSubjectPair } from '@/lib/subjects/similarity-analyze'
import type { SubjectInput } from '@/lib/subjects/similarity-analyze'
import {
  resolveSemanticFallback,
  buildSubjectSemanticContext,
  SEMANTIC_POOL_CAP,
  type SemanticCandidate,
} from '@/lib/db/canonical-subject-semantic-fallback'
import type { DocumentProposalFamily } from '@/types/db'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

// Mapping doctrine document_extraction_proposal.proposal_family → vocabulaire
// "kind" du moteur canonique (CAN_CREATE_SUBJECT_KINDS / ELIGIBLE_KINDS).
// person/company absents : hors périmètre (acteurs, déjà canonicalisés ailleurs).
export const FAMILY_TO_KIND: Partial<Record<DocumentProposalFamily, string>> = {
  action: 'action',
  decision: 'decision',
  knowledge_fact: 'knowledge',
  observation: 'vigilance',
  reservation: 'vigilance',
  deadline: 'deadline', // CAN_CREATE_SUBJECT_KINDS l'exclut : rattachement seul, jamais de création
}

interface ProposalRow {
  id: string
  proposal_family: DocumentProposalFamily
  label: string
  description: string | null
  subject_thread_id: string
}

interface ThreadGroup {
  threadId: string
  family: DocumentProposalFamily
  kind: string
  queryText: string
  description: string | null
  proposalCount: number
}

export interface HistoricalReconcileFamilyStat {
  family: DocumentProposalFamily
  threads: number
  alreadyIdentified: number // idempotence : thread déjà porteur d'une identité
  matchedExisting: number   // rattaché à un canonical_subject existant
  created: number           // rattaché à un canonical_subject nouvellement créé
  ambiguous: number         // plusieurs candidats, ne tranche jamais seul
  unresolved: number        // aucune identité posée dans ce passage
}

export interface HistoricalReconcileResult {
  runId: string
  siteId: string
  totalThreads: number
  byFamily: HistoricalReconcileFamilyStat[]
  /** canonical_subject touchés (rattachés ou créés) lors de ce passage — seed du scope P1-A. */
  touchedCanonicalSubjectIds: string[]
}

function emptyStat(family: DocumentProposalFamily): HistoricalReconcileFamilyStat {
  return { family, threads: 0, alreadyIdentified: 0, matchedExisting: 0, created: 0, ambiguous: 0, unresolved: 0 }
}

/**
 * Donne une identité canonique aux threads métier d'un PV historique.
 * Idempotent, additif, jamais destructeur : un thread non résolu reste
 * simplement sans identité jusqu'au prochain passage.
 */
export async function reconcileHistoricalPvCanonicalSubjects(params: {
  runId: string
  siteId: string
}): Promise<HistoricalReconcileResult> {
  const { runId, siteId } = params
  const sb = createAdminClient()

  const stats = new Map<DocumentProposalFamily, HistoricalReconcileFamilyStat>()
  const statFor = (f: DocumentProposalFamily): HistoricalReconcileFamilyStat => {
    if (!stats.has(f)) stats.set(f, emptyStat(f))
    return stats.get(f)!
  }
  const touchedCanonicalSubjectIds = new Set<string>()
  const finish = (totalThreads: number): HistoricalReconcileResult => ({
    runId, siteId, totalThreads, byFamily: [...stats.values()],
    touchedCanonicalSubjectIds: [...touchedCanonicalSubjectIds],
  })

  // 1. Propositions métier éligibles du run (threads déjà posés par
  //    reconcileSubjectThreads() — étape 12 de extractHistoricalPv()).
  const { data: rawProposals, error: propErr } = await sb
    .from('document_extraction_proposal')
    .select('id, proposal_family, label, description, subject_thread_id')
    .eq('extraction_run_id', runId)
    .in('proposal_family', Object.keys(FAMILY_TO_KIND))
    .not('subject_thread_id', 'is', null)

  if (propErr) {
    console.error('[historical-reconcile] proposals fetch failed:', propErr.message)
    return finish(0)
  }

  const proposals = (rawProposals ?? []) as ProposalRow[]
  if (proposals.length === 0) return finish(0)

  // 2. Regrouper par thread — un thread ne mélange jamais deux familles
  //    (reconcileSubjectThreads apparie proposal_family === newProp.proposal_family).
  const byThread = new Map<string, ProposalRow[]>()
  for (const p of proposals) {
    const arr = byThread.get(p.subject_thread_id) ?? []
    arr.push(p)
    byThread.set(p.subject_thread_id, arr)
  }

  const threadGroups: ThreadGroup[] = []
  for (const [threadId, rows] of byThread) {
    const family = rows[0].proposal_family
    const kind = FAMILY_TO_KIND[family]
    if (!kind) continue
    const bestLabel = selectBestText(rows.map((r) => r.label)) ?? rows[0].label
    const bestDescription = selectBestText(rows.map((r) => r.description ?? '').filter(Boolean))
    threadGroups.push({
      threadId,
      family,
      kind,
      queryText: bestLabel,
      description: bestDescription,
      proposalCount: rows.length,
    })
    statFor(family).threads++
  }

  if (threadGroups.length === 0) return finish(0)

  // 3. Idempotence : threads déjà porteurs d'une identité (retry, double-clic).
  const threadIds = threadGroups.map((g) => g.threadId)
  const { data: rawSti, error: stiErr } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id')
    .eq('site_id', siteId)
    .in('subject_thread_id', threadIds)

  if (stiErr) {
    console.error('[historical-reconcile] STI fetch failed:', stiErr.message)
    return finish(threadGroups.length)
  }

  const alreadyIdentified = new Set((rawSti ?? []).map((r) => r.subject_thread_id as string))
  for (const g of threadGroups) {
    if (alreadyIdentified.has(g.threadId)) statFor(g.family).alreadyIdentified++
  }
  const pending = threadGroups.filter((g) => !alreadyIdentified.has(g.threadId))
  if (pending.length === 0) return finish(threadGroups.length)

  // 4. Phase 1 — matching déterministe (même moteur, même seuils que field_visit/meeting).
  const stillPending: ThreadGroup[] = []
  for (const g of pending) {
    // P1-C1a : tous les threads traités ici sont métier (FAMILY_TO_KIND exclut
    // person/company) → on retire les sujets acteurs du pool de résolution pour
    // qu'un fait citant son acteur ne soit jamais canonicalisé SUR l'acteur.
    const resolution = await resolveCanonicalSubjectReference(siteId, g.queryText, {
      excludeActorSubjects: true,
    })
    if (resolution.kind === 'resolved') {
      await attachThread(sb, g.threadId, siteId, resolution.candidate.id)
      touchedCanonicalSubjectIds.add(resolution.candidate.id)
      statFor(g.family).matchedExisting++
    } else if (resolution.kind === 'ambiguous') {
      // Jamais tranché automatiquement — cohérent avec la doctrine du moteur live.
      statFor(g.family).ambiguous++
    } else {
      stillPending.push(g)
    }
  }
  if (stillPending.length === 0) return finish(threadGroups.length)

  // 5. Phase 1.5 — matching LLM liste fermée, tous kinds (ne crée jamais).
  //    P1-C1a : le pool candidat exclut les sujets acteurs — le LLM ne peut plus
  //    proposer de rattacher un fait métier à un acteur (ex. « Récupération huiles »
  //    → « Velayoudon »). S'applique aussi à la Phase 1.6 (même pool existingCs).
  const { data: rawCs } = await sb
    .from('canonical_subject')
    .select('id, label')
    .eq('site_id', siteId)
    .eq('status', 'active')
    .neq('kind', 'actor')
  const existingCs = (rawCs ?? []) as Array<{ id: string; label: string }>

  const afterLlmMatch: ThreadGroup[] = []
  if (existingCs.length > 0) {
    for (const g of stillPending) {
      const match = await matchExistingSubject(
        { id: g.threadId, title: g.queryText, body: g.description, kind: g.kind },
        existingCs,
      )
      const decision = resolveMatchExistingDecision(match, existingCs)
      if (decision === 'attach') {
        await attachThread(sb, g.threadId, siteId, match!.canonicalSubjectId!)
        touchedCanonicalSubjectIds.add(match!.canonicalSubjectId!)
        statFor(g.family).matchedExisting++
      } else {
        afterLlmMatch.push(g)
      }
    }
  } else {
    afterLlmMatch.push(...stillPending)
  }
  if (afterLlmMatch.length === 0) return finish(threadGroups.length)

  // 5.6. Phase 1.6 — P0-1 : génération de candidats normalisés + P0-2 : décision sémantique.
  // normalizeForMatching() retire les préfixes d'état / suffixes d'outcome pour que
  // « Prévision : X » et « X = Fait » génèrent le même candidat que « X ».
  // analyzeSubjectPair() (Gemini P0-2) décide : seul 'same_subject' entraîne un rattachement.
  // Jamais de mutation automatique sur RELATED/DISTINCT/UNCERTAIN → renvoi en Phase 2.
  const afterP01: ThreadGroup[] = []
  for (const g of afterLlmMatch) {
    const normalizedQuery = normalizeForMatching(g.queryText, g.family)
    const p01Candidates = existingCs
      .map((cs) => ({ cs, score: jaccardSimilarity(normalizedQuery, normalizeForMatching(cs.label)) }))
      .filter((c) => c.score >= P01_NORMALIZED_JACCARD_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    if (p01Candidates.length === 0) {
      afterP01.push(g)
      continue
    }

    let matched = false
    for (const { cs } of p01Candidates) {
      try {
        const subjectA: SubjectInput = { id: g.threadId, label: g.queryText, aliases: [] }
        const subjectB: SubjectInput = { id: cs.id, label: cs.label, aliases: [] }
        const result = await analyzeSubjectPair(subjectA, subjectB, null)
        if (result.verdict === 'same_subject') {
          await attachThread(sb, g.threadId, siteId, cs.id)
          touchedCanonicalSubjectIds.add(cs.id)
          statFor(g.family).matchedExisting++
          matched = true
          break
        }
      } catch (err) {
        console.error('[historical-reconcile] P0-2 analyzeSubjectPair error:', String(err).slice(0, 200))
      }
    }
    if (!matched) afterP01.push(g)
  }
  if (afterP01.length === 0) return finish(threadGroups.length)

  // 5.7. Phase sémantique — DERNIER RECOURS, pool borné (P1-C2). Réutilise analyzeSubjectPair
  //      (juge existant) avec le contexte d'occurrence des candidats. Ne s'exécute que pour les
  //      kinds créateurs et ne rattache que sur un same_subject unique et fiable ; ambiguïté ou
  //      objet distinct → rien (le sujet sera créé en Phase 2). Aucun embedding.
  const afterSemantic: ThreadGroup[] = []
  const semanticCreators = afterP01.filter((g) => CAN_CREATE_SUBJECT_KINDS.has(g.kind))
  if (semanticCreators.length > 0 && existingCs.length > 0 && existingCs.length <= SEMANTIC_POOL_CAP) {
    const candCtx = await loadCandidateContexts(sb, siteId, existingCs.map((c) => c.id))
    for (const g of afterP01) {
      if (!CAN_CREATE_SUBJECT_KINDS.has(g.kind)) { afterSemantic.push(g); continue }
      const source: SemanticCandidate = {
        id: g.threadId,
        label: g.queryText,
        occurrenceContext: buildSubjectSemanticContext([g.queryText], [g.description]),
      }
      const candidates: SemanticCandidate[] = existingCs.map((cs) => ({
        id: cs.id,
        label: cs.label,
        aliases: candCtx.get(cs.id)?.aliases ?? [],
        occurrenceContext: candCtx.get(cs.id)?.context ?? null,
      }))
      try {
        const res = await resolveSemanticFallback(source, candidates)
        if (res.matchId) {
          await attachThread(sb, g.threadId, siteId, res.matchId)
          touchedCanonicalSubjectIds.add(res.matchId)
          statFor(g.family).matchedExisting++
        } else {
          afterSemantic.push(g)
        }
      } catch (err) {
        console.error('[historical-reconcile] semantic fallback error:', String(err).slice(0, 200))
        afterSemantic.push(g)
      }
    }
  } else {
    afterSemantic.push(...afterP01)
  }
  if (afterSemantic.length === 0) return finish(threadGroups.length)

  // 6. Séparer selon la capacité de création — deadline ne crée jamais (doctrine identique
  //    à CAN_CREATE_SUBJECT_KINDS côté field_visit/meeting).
  const forClustering = afterSemantic.filter((g) => CAN_CREATE_SUBJECT_KINDS.has(g.kind))
  const matchOnly = afterSemantic.filter((g) => !CAN_CREATE_SUBJECT_KINDS.has(g.kind))
  for (const g of matchOnly) statFor(g.family).unresolved++
  if (forClustering.length === 0) return finish(threadGroups.length)

  // 7. Phase 2 — clustering + création des CS éligibles (Gemini, même moteur).
  const geminiGroups = await clusterOrphansWithGemini(
    forClustering.map((g) => ({ id: g.threadId, title: g.queryText, body: g.description })),
  )

  if (!geminiGroups) {
    for (const g of forClustering) statFor(g.family).unresolved++
    return finish(threadGroups.length)
  }

  const groupByThreadId = new Map(forClustering.map((g) => [g.threadId, g]))
  const covered = new Set(geminiGroups.flatMap((gr) => gr.proposalIds))
  for (const [threadId, g] of groupByThreadId) {
    if (!covered.has(threadId)) statFor(g.family).unresolved++
  }

  for (const group of geminiGroups) {
    if (!group.isDurableSubject || group.confidence < CREATE_THRESHOLD || !group.suggestedLabel) {
      for (const threadId of group.proposalIds) {
        const g = groupByThreadId.get(threadId)
        if (g) statFor(g.family).unresolved++
      }
      continue
    }

    const memberThreads = group.proposalIds
      .map((id) => groupByThreadId.get(id))
      .filter((g): g is ThreadGroup => g != null)
    if (memberThreads.length === 0) continue

    const { data: newCs, error: csErr } = await sb
      .from('canonical_subject')
      .insert({ site_id: siteId, label: group.suggestedLabel, status: 'active', creation_source: 'historical_pv', kind: 'business_subject' })
      .select('id')
      .single()

    let canonicalSubjectId: string
    if (csErr || !newCs) {
      // Même reprise que reconcileSourceToCanonicalSubjects (P0-3, mig 323) :
      // une création perdante d'une course se rattache au gagnant.
      const recovered = isUniqueLabelViolation(csErr)
        ? await findActiveSubjectByNormalizedLabel(sb, siteId, group.suggestedLabel)
        : null
      if (!recovered) {
        console.error('[historical-reconcile] erreur création CS:', csErr?.code, csErr?.message)
        for (const g of memberThreads) statFor(g.family).unresolved++
        continue
      }
      canonicalSubjectId = recovered
      for (const g of memberThreads) statFor(g.family).matchedExisting++
    } else {
      canonicalSubjectId = newCs.id
      for (const g of memberThreads) statFor(g.family).created++
    }

    for (const g of memberThreads) {
      await attachThread(sb, g.threadId, siteId, canonicalSubjectId)
    }
    touchedCanonicalSubjectIds.add(canonicalSubjectId)
  }

  return finish(threadGroups.length)
}

/**
 * Charge le contexte métier compact (aliases + labels/notes d'occurrences) de chaque candidat,
 * pour nourrir le juge sémantique. Borné par l'appelant (existingCs ≤ SEMANTIC_POOL_CAP).
 */
async function loadCandidateContexts(
  sb: SupabaseAdmin,
  siteId: string,
  csIds: string[],
): Promise<Map<string, { aliases: string[]; context: string }>> {
  const out = new Map<string, { aliases: string[]; context: string }>()
  if (csIds.length === 0) return out
  const { data: subs } = await sb.from('canonical_subject').select('id, aliases').in('id', csIds)
  const { data: occs } = await sb
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, label, note')
    .eq('site_id', siteId)
    .in('canonical_subject_id', csIds)
  const byCs = new Map<string, { labels: string[]; notes: string[] }>()
  for (const o of occs ?? []) {
    const k = o.canonical_subject_id as string
    const e = byCs.get(k) ?? { labels: [], notes: [] }
    if (o.label) e.labels.push(o.label as string)
    if (o.note) e.notes.push(o.note as string)
    byCs.set(k, e)
  }
  for (const s of subs ?? []) {
    const id = s.id as string
    const e = byCs.get(id) ?? { labels: [], notes: [] }
    out.set(id, {
      aliases: (s.aliases as string[] | null) ?? [],
      context: buildSubjectSemanticContext(e.labels, e.notes),
    })
  }
  return out
}

/**
 * Pose l'identité canonique d'un thread. Idempotent : ignoreDuplicates sur
 * subject_thread_id — n'écrase jamais une identité déjà posée par un autre
 * passage (live ou historique).
 */
async function attachThread(
  sb: SupabaseAdmin,
  threadId: string,
  siteId: string,
  canonicalSubjectId: string,
): Promise<void> {
  await sb.from('subject_thread_identity').upsert(
    { subject_thread_id: threadId, site_id: siteId, canonical_subject_id: canonicalSubjectId, source: 'auto' },
    { onConflict: 'subject_thread_id', ignoreDuplicates: true },
  )
}
