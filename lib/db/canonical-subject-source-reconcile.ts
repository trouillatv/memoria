import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCanonicalSubjectReference, normalizeCanonicalLabel } from '@/lib/db/canonical-subject-resolve'
import { ELIGIBLE_KINDS } from '@/lib/db/canonical-subject-reconcile'
import { jaccardSimilarity } from '@/lib/documents/subject-reconciliation'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Types ───────────────────────────────────────────────────────────────────

export type SourceType = 'field_visit' | 'meeting' | 'historical_pv' | 'manual_object'

export interface SourceDescriptor {
  type: SourceType
  id: string        // report_id pour field_visit/meeting
  siteId: string
  authorId: string | null
  /**
   * Mode backfill (visites historiques déjà projetées).
   * - élargit le filtre de statut pour inclure 'fulfilled' et 'superseded'
   * - produit des occurrences 'confirmed' (visite close = vérité terrain)
   */
  backfill?: boolean
}

export interface ReconcileSourceResult {
  matched: number   // liées à un CS existant
  created: number   // nouveau CS créé
  clustered: number // propositions regroupées avant création
  ambiguous: number // plusieurs candidats, attend l'humain
  orphaned: number  // sous le seuil, reste not_found
}

// ─── Constantes ──────────────────────────────────────────────────────────────

// Seuil Jaccard pour union-find : deux propositions au-dessus rejoignent le même cluster
const CLUSTER_JOIN_THRESHOLD = 0.28

// Seuil de confiance minimum pour créer un nouveau CS automatiquement
const CREATE_THRESHOLD = 0.85

// Kinds pouvant créer un nouveau canonical_subject (deadline exclu)
export const CAN_CREATE_SUBJECT_KINDS = new Set(['action', 'vigilance', 'decision', 'knowledge'])

// Seuil pour le matching existant (deadline → CS) — plus élevé que la création
export const MATCH_EXISTING_THRESHOLD = 0.85

// ─── Schéma Gemini ───────────────────────────────────────────────────────────

const clusterGroupSchema = z.object({
  proposalIds: z.array(z.string()),
  suggestedLabel: z.string().max(120).catch(''),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .transform((v) => (v > 1 ? v / 100 : v))
    .catch(0),
  isDurableSubject: z.boolean().catch(false),
})

const clusterOutputSchema = z.object({
  groups: z.array(clusterGroupSchema),
})

type ClusterOutput = z.infer<typeof clusterOutputSchema>

// ─── Schéma Gemini — matching existant (deadline) ────────────────────────────

const existingMatchSchema = z.object({
  canonicalSubjectId: z.string().uuid().nullable(),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .transform((v) => (v > 1 ? v / 100 : v))
    .catch(0),
  reason: z.string().max(200).catch(''),
})

type ExistingMatchOutput = z.infer<typeof existingMatchSchema>

const SYSTEM_PROMPT_CLUSTERING = `Tu es un assistant de catégorisation de sujets de chantier BTP.
On t'envoie un ensemble de propositions issues d'une visite terrain qui n'ont pas trouvé de sujet canonique existant.
Ta tâche :
1. Regrouper les propositions qui désignent le MÊME sujet métier (même ouvrage, même zone, même objet).
2. Proposer un label court et stable pour chaque groupe (≤ 80 caractères).
3. Évaluer ta confiance globale pour chaque groupe (0.0 = incertain, 1.0 = certain).
4. Indiquer si le groupe constitue un sujet DURABLE (isDurableSubject=true) :
   - true : sujet structurant, à suivre dans le temps (ouvrage, réserve persistante, point sensible récurrent)
   - false : observation ponctuelle, action générique, fait passager
Règle stricte : ne regroupe pas deux propositions si elles décrivent des zones, phases ou objets différents.
Une proposition peut former un groupe de 1 si elle est suffisamment distinctive.
Réponds UNIQUEMENT avec le JSON demandé.`

function buildClusterPrompt(proposals: Array<{ id: string; title: string; body: string | null }>): string {
  const lines = proposals.map((p) => {
    const bodyStr = p.body ? ` — ${p.body.slice(0, 150)}` : ''
    // UUID complet obligatoire — orphanById est indexé par UUID complet
    return `- id:${p.id} : "${p.title}"${bodyStr}`
  })
  return [
    'Propositions terrain à regrouper :',
    ...lines,
    '',
    'Retourne un JSON avec la clé "groups" contenant des objets {proposalIds, suggestedLabel, confidence, isDurableSubject}.',
    "Chaque proposalId doit être l'identifiant COMPLET (UUID).",
  ].join('\n')
}

const SYSTEM_PROMPT_MATCH_EXISTING = `Tu es un assistant de catégorisation de sujets de chantier BTP.
On t'envoie un événement ou une échéance terrain et la liste des sujets canoniques connus du chantier.
Ta tâche : déterminer si cet événement constitue une manifestation, une évolution ou une échéance d'un sujet canonique existant.
Règle absolue : ne crée jamais un nouveau sujet. Retourne uniquement l'identifiant d'un sujet existant, ou null.
Si le lien n'est pas clairement établi, retourne null avec une confidence basse.
Réponds UNIQUEMENT avec le JSON demandé.`

function buildMatchExistingPrompt(
  proposal: { title: string; body: string | null; kind: string },
  existingCs: Array<{ id: string; label: string }>,
): string {
  const csLines = existingCs.map((cs) => `- id:${cs.id} : "${cs.label}"`).join('\n')
  const bodyStr = proposal.body ? `\nDétail : ${proposal.body.slice(0, 300)}` : ''
  return [
    `Événement terrain (${proposal.kind}) :`,
    `"${proposal.title}"${bodyStr}`,
    '',
    'Sujets canoniques existants du chantier :',
    csLines,
    '',
    "Cet événement est-il une manifestation, une évolution ou une échéance d'un de ces sujets ?",
    "Retourne l'UUID exact du sujet si le lien est établi avec confiance ≥ 0.85, sinon retourne null.",
    'Format JSON : {"canonicalSubjectId": "uuid-ou-null", "confidence": 0.0-1.0, "reason": "explication courte"}',
  ].join('\n')
}

// ─── Décision Phase 2b (pure, testable) ─────────────────────────────────────

/**
 * Décide si un résultat Gemini existing-only doit déclencher un rattachement.
 * Pure : aucun effet de bord, exportée pour les tests.
 *
 * Règles :
 * - match null → orphan
 * - canonicalSubjectId null → orphan
 * - confidence < threshold → orphan
 * - UUID non présent dans existingCs → orphan (intégrité locale)
 * - sinon → attach
 */
export function resolveMatchExistingDecision(
  match: { canonicalSubjectId: string | null; confidence: number } | null,
  existingCs: ReadonlyArray<{ id: string }>,
  threshold: number = MATCH_EXISTING_THRESHOLD,
): 'attach' | 'orphan' {
  if (!match || !match.canonicalSubjectId || match.confidence < threshold) return 'orphan'
  if (!existingCs.some((cs) => cs.id === match.canonicalSubjectId)) return 'orphan'
  return 'attach'
}

// ─── Verrou de réconciliation (P0-2) ─────────────────────────────────────────

/** TTL du verrou soft : au-delà, un run réputé bloqué libère sa place. */
export const RECONCILE_LOCK_TTL_MS = 5 * 60 * 1000

/**
 * Décide si un run de réconciliation peut démarrer, à partir de l'état du
 * rapport. Pure et exportée : c'est la règle qui empêche deux runs concurrents
 * de matérialiser deux fois les mêmes sujets (cause de l'incident du 14/08).
 *
 * - déjà réconcilié            → 'done'      (idempotence)
 * - verrou récent (< TTL)      → 'concurrent'(un autre run travaille)
 * - verrou expiré ou absent    → 'acquire'   (on tente le CAS SQL)
 *
 * 'acquire' n'est qu'une autorisation de TENTER : le CAS SQL
 * (WHERE canonical_reconcile_started_at IS NULL) reste l'arbitre final.
 */
export function decideReconcileLock(
  state: { canonical_reconciled_at?: string | null; canonical_reconcile_started_at?: string | null } | null,
  nowMs: number,
  ttlMs: number = RECONCILE_LOCK_TTL_MS,
): 'done' | 'concurrent' | 'acquire' {
  if (state?.canonical_reconciled_at) return 'done'
  const startedAt = state?.canonical_reconcile_started_at
  if (startedAt && nowMs - Date.parse(startedAt) < ttlMs) return 'concurrent'
  return 'acquire'
}

// ─── Reprise sur conflit d'unicité (P0-3, mig 323) ───────────────────────────

/** Seuil d'héritage Phase 0 : une reformulation d'un même rapport rejoué.
 *  Volontairement plus strict que JACCARD_THRESHOLD (0.35) : hériter un ID est
 *  une décision d'identité, pas une suggestion de proximité. */
export const INHERIT_THRESHOLD = 0.50

/** 23505 = unique_violation PostgreSQL. Seule erreur pour laquelle une création
 *  perdante peut se rattacher au gagnant plutôt qu'orpheliner ses faits. */
export function isUniqueLabelViolation(err: { code?: string | null } | null): boolean {
  return err?.code === '23505'
}

/**
 * Retrouve le sujet ACTIF portant le même label normalisé sur ce site.
 * Utilisé pour se rattacher au gagnant d'une course de création.
 * Compare avec normalizeCanonicalLabel() — strictement la même normalisation
 * que canonical_normalize_label() en SQL (mig 323).
 */
export async function findActiveSubjectByNormalizedLabel(
  sb: SupabaseClient,
  siteId: string,
  label: string,
): Promise<string | null> {
  const { data } = await sb
    .from('canonical_subject')
    .select('id, label')
    .eq('site_id', siteId)
    .eq('status', 'active')

  const target = normalizeCanonicalLabel(label)
  const hit = ((data ?? []) as Array<{ id: string; label: string }>)
    .find((cs) => normalizeCanonicalLabel(cs.label) === target)
  return hit?.id ?? null
}

/**
 * Apparie les propositions supersédées porteuses d'un canonical_subject_id avec
 * les propositions éligibles du rejeu (Phase 0, P0-5). Pure et exportée pour les
 * tests : c'est la règle qui empêche un rejeu de créer un monde parallèle.
 *
 * Une proposition éligible ne peut hériter que d'une seule supersédée (premier
 * arrivé au meilleur score), et seulement au-dessus de INHERIT_THRESHOLD.
 */
export function matchInheritedProposals(
  superseded: ReadonlyArray<{ id: string; title: string; canonical_subject_id: string }>,
  eligible: ReadonlyArray<{ id: string; title: string }>,
  threshold: number = INHERIT_THRESHOLD,
): Array<{ staleId: string; eligibleId: string; canonicalSubjectId: string; score: number }> {
  const taken = new Set<string>()
  const pairs: Array<{ staleId: string; eligibleId: string; canonicalSubjectId: string; score: number }> = []

  for (const stale of superseded) {
    let bestScore = threshold
    let best: { id: string; title: string } | null = null
    for (const p of eligible) {
      if (taken.has(p.id)) continue
      const score = jaccardSimilarity(stale.title, p.title)
      if (score > bestScore) { bestScore = score; best = p }
    }
    if (!best) continue
    taken.add(best.id)
    pairs.push({
      staleId: stale.id,
      eligibleId: best.id,
      canonicalSubjectId: stale.canonical_subject_id,
      score: bestScore,
    })
  }
  return pairs
}

// ─── Jaccard Union-Find (pur, testable) ──────────────────────────────────────

interface JaccardCluster {
  representativeIdx: number
  memberIdxs: number[]
}

/**
 * Regroupe des labels par similarité Jaccard via Union-Find.
 * Pur, sans effet de bord, exporté pour les tests unitaires.
 */
export function clusterByJaccard(
  labels: string[],
  threshold: number = CLUSTER_JOIN_THRESHOLD,
): JaccardCluster[] {
  const n = labels.length
  const parent = Array.from({ length: n }, (_, i) => i)

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }

  function union(a: number, b: number): void {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (jaccardSimilarity(labels[i], labels[j]) >= threshold) {
        union(i, j)
      }
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(i)
  }

  return Array.from(groups.entries()).map(([representative, memberIdxs]) => ({
    representativeIdx: representative,
    memberIdxs,
  }))
}

// ─── Réconciliation principale ────────────────────────────────────────────────

/**
 * Réconcilie les propositions d'une source (visite, réunion) avec les canonical_subjects.
 *
 * Phase 1 : matching déterministe des propositions non liées (resolveCanonicalSubjectReference).
 * Phase 2 : clustering Jaccard + Gemini sur les orphelins.
 * Phase 3 : création de canonical_subject uniquement si isDurableSubject && confidence >= 0.85.
 *
 * Pour les propositions d'action : après liaison CS, assure subject_thread_id + STI.
 *
 * Limite de lot : cette fonction ne garantit PAS la réconciliation négative (CS obsolète).
 * Si un objet matérialisé existant doit être détaché, c'est un lot séparé.
 *
 * Fire-and-forget depuis debrief-analysis.ts — ne doit jamais bloquer la projection.
 */
export async function reconcileSourceToCanonicalSubjects(
  source: SourceDescriptor,
): Promise<ReconcileSourceResult> {
  const result: ReconcileSourceResult = { matched: 0, created: 0, clustered: 0, ambiguous: 0, orphaned: 0 }

  const sb = createAdminClient()
  const validationStatus = source.backfill ? 'confirmed' : 'observed'

  // ── Récupérer les propositions éligibles non encore liées ─────────────────
  // En mode live : uniquement 'proposed' (projection en cours).
  // En mode backfill : aussi 'fulfilled' et 'superseded' (visites closes,
  // proposals déjà matérialisées mais jamais rattachées à un canonical_subject).
  let query = sb
    .from('site_knowledge_proposals')
    .select('id, kind, title, body, status, canonical_subject_id, canonical_resolution_status, entity_ids')
    .eq('report_id', source.id)
    .eq('site_id', source.siteId)
    .is('canonical_subject_id', null)

  if (!source.backfill) {
    query = query.eq('status', 'proposed')
  } else {
    query = query.in('status', ['proposed', 'fulfilled', 'superseded'])
  }

  const { data: rawProposals, error } = await query

  if (error) {
    console.error('[reconcile-source] erreur récupération proposals:', error.message)
    return result
  }

  const proposals = (rawProposals ?? []) as Array<{
    id: string
    kind: string
    title: string
    body: string | null
    status: string
    canonical_subject_id: string | null
    canonical_resolution_status: string | null
    entity_ids: string[]
  }>

  const eligible = proposals.filter((p) => ELIGIBLE_KINDS.has(p.kind))
  if (eligible.length === 0) return result

  // Métadonnées du report : sourceKind + effectiveDate communs à Phase 1 et Phase 2b.
  const VISIT_ORIGINS_SET = new Set(['planned', 'spontaneous', 'qr', 'gps', 'import'])
  const { data: reportMeta } = await sb
    .from('site_reports')
    .select('origin, started_at, created_at')
    .eq('id', source.id)
    .maybeSingle()
  type ReportMeta = { origin?: string | null; started_at?: string | null; created_at?: string } | null
  const rm = reportMeta as ReportMeta
  const occSourceKind: 'field_visit' | 'meeting' =
    rm?.origin && VISIT_ORIGINS_SET.has(rm.origin) ? 'field_visit' : 'meeting'
  const occEffectiveDate = (rm?.started_at ?? rm?.created_at ?? new Date().toISOString()).slice(0, 10)

  // ── Phase 0 : héritage depuis les propositions supersédées du même rapport ──
  // P0-5 : lors d'un rejeu (v3→v4), les propositions de v4 ne repartent pas de
  // zéro. Si une proposition v3 a été supersédée (dedupe_key disparu de v4) mais
  // portait déjà un canonical_subject_id, et qu'une proposition v4 lui ressemble
  // (Jaccard ≥ 0.50 sur le titre), on hérite directement l'ID sans passer par le
  // LLM. Cela évite de créer un CS jumeau pour le même concept reformulé.
  // superseded_by est également chaîné sur l'ancienne proposition.
  const inheritedIds = new Set<string>()

  const { data: supersededWithCs } = await sb
    .from('site_knowledge_proposals')
    .select('id, title, canonical_subject_id')
    .eq('report_id', source.id)
    .eq('site_id', source.siteId)
    .eq('status', 'superseded')
    .not('canonical_subject_id', 'is', null)

  if ((supersededWithCs ?? []).length > 0) {
    const eligibleById = new Map(eligible.map((p) => [p.id, p]))
    const pairs = matchInheritedProposals(
      (supersededWithCs as Array<{ id: string; title: string; canonical_subject_id: string }>),
      eligible.map((p) => ({ id: p.id, title: p.title })),
    )

    for (const pair of pairs) {
      const bestEligible = eligibleById.get(pair.eligibleId)
      if (!bestEligible) continue
      const csId = pair.canonicalSubjectId
      const stale = { id: pair.staleId }

      await sb.from('canonical_subject_occurrence').upsert({
        canonical_subject_id: csId,
        site_id: source.siteId,
        source_kind: occSourceKind,
        source_ref_id: source.id,
        source_proposal_id: bestEligible.id,
        visit_status: occSourceKind === 'field_visit' ? 'field_checked' : 'mentioned',
        label: bestEligible.title,
        note: bestEligible.body,
        evidence_count: 0,
        effective_date: occEffectiveDate,
        created_by: source.authorId,
        validation_status: validationStatus,
        entity_ids: bestEligible.entity_ids ?? [],
      }, { onConflict: 'source_kind,source_proposal_id', ignoreDuplicates: true })

      const { error: iErr } = await sb.from('site_knowledge_proposals')
        .update({ canonical_subject_id: csId, canonical_resolution_status: 'resolved' })
        .eq('id', bestEligible.id)

      if (!iErr) {
        // Chaîner la supersession : l'ancienne proposition pointe vers la nouvelle
        await sb.from('site_knowledge_proposals')
          .update({ superseded_by: bestEligible.id })
          .eq('id', stale.id as string)
          .is('superseded_by', null)

        inheritedIds.add(bestEligible.id)
        result.matched++
      }
    }
  }

  const eligibleAfterInherit = eligible.filter((p) => !inheritedIds.has(p.id))

  // ── Phase 1 : matching déterministe ──────────────────────────────────────
  // Écriture directe avec sb (client admin racine de l'invocation) pour éviter :
  //   - le double appel à resolveCanonicalSubjectReference (outer vs inner divergent)
  //   - les échecs silencieux des createAdminClient() imbriqués dans reconcileProposalToCanonical
  // matched++ conditionné au succès réel de la mise à jour DB.
  const orphans: typeof eligible = []

  for (const proposal of eligibleAfterInherit) {
    const resolution = await resolveCanonicalSubjectReference(source.siteId, proposal.title)

    if (resolution.kind === 'resolved') {
      const canonicalSubjectId = resolution.candidate.id

      await sb
        .from('canonical_subject_occurrence')
        .upsert(
          {
            canonical_subject_id: canonicalSubjectId,
            site_id: source.siteId,
            source_kind: occSourceKind,
            source_ref_id: source.id,
            source_proposal_id: proposal.id,
            visit_status: occSourceKind === 'field_visit' ? 'field_checked' : 'mentioned',
            label: proposal.title,
            note: proposal.body,
            evidence_count: 0,
            effective_date: occEffectiveDate,
            created_by: source.authorId,
            validation_status: validationStatus,
            entity_ids: proposal.entity_ids ?? [],
          },
          { onConflict: 'source_kind,source_proposal_id', ignoreDuplicates: true },
        )

      if (validationStatus === 'confirmed') {
        await sb
          .from('canonical_subject_occurrence')
          .update({ validation_status: 'confirmed' })
          .eq('source_kind', occSourceKind)
          .eq('source_proposal_id', proposal.id)
          .eq('validation_status', 'observed')
      }

      const { error: propErr } = await sb
        .from('site_knowledge_proposals')
        .update({ canonical_subject_id: canonicalSubjectId, canonical_resolution_status: 'resolved' })
        .eq('id', proposal.id)

      if (propErr) {
        console.error('[reconcile-source] Phase 1 proposal update failed:', proposal.id, propErr.code, propErr.message)
      } else {
        result.matched++
      }

      if (proposal.kind === 'action') {
        await ensureActionThread(sb, proposal.id, source.siteId, canonicalSubjectId)
      }
    } else if (resolution.kind === 'ambiguous') {
      result.ambiguous++
    } else {
      orphans.push(proposal)
    }
  }

  // ── Séparer les orphelins selon leur capacité ────────────────────────────
  // deadline ∈ CAN_MATCH_EXISTING (ELIGIBLE_KINDS), deadline ∉ CAN_CREATE_SUBJECT_KINDS
  if (orphans.length === 0) return result

  // ── Phase 1.5 : matching LLM liste fermée — TOUS les orphelins (P0-4) ────
  // Avant clustering et création, le LLM vérifie si un orphelin correspond à
  // un CS existant. Liste fermée : retourne un UUID existant ou null, jamais
  // un nouveau sujet. Empêche la création de doublons sémantiques que les passes
  // déterministes ont manqués (reformulations, scores Jaccard < seuil).
  // Ne baisse PAS le seuil Jaccard : cette passe est complémentaire, pas un
  // remplacement du réglage du seuil.
  const { data: rawCsAll } = await sb
    .from('canonical_subject')
    .select('id, label')
    .eq('site_id', source.siteId)
    .eq('status', 'active')

  const existingCsForMatch = (rawCsAll ?? []) as Array<{ id: string; label: string }>
  const afterLlmMatch: typeof orphans = []

  if (existingCsForMatch.length > 0) {
    for (const proposal of orphans) {
      const match = await matchExistingSubject(proposal, existingCsForMatch)
      const decision = resolveMatchExistingDecision(match, existingCsForMatch)
      if (decision === 'attach') {
        const csId = match!.canonicalSubjectId!

        await sb.from('canonical_subject_occurrence').upsert({
          canonical_subject_id: csId,
          site_id: source.siteId,
          source_kind: occSourceKind,
          source_ref_id: source.id,
          source_proposal_id: proposal.id,
          visit_status: occSourceKind === 'field_visit' ? 'field_checked' : 'mentioned',
          label: proposal.title,
          note: proposal.body,
          evidence_count: 0,
          effective_date: occEffectiveDate,
          created_by: source.authorId,
          validation_status: validationStatus,
          entity_ids: proposal.entity_ids ?? [],
        }, { onConflict: 'source_kind,source_proposal_id', ignoreDuplicates: true })

        if (validationStatus === 'confirmed') {
          await sb.from('canonical_subject_occurrence')
            .update({ validation_status: 'confirmed' })
            .eq('source_kind', occSourceKind)
            .eq('source_proposal_id', proposal.id)
            .eq('validation_status', 'observed')
        }

        const { error: mErr } = await sb.from('site_knowledge_proposals')
          .update({ canonical_subject_id: csId, canonical_resolution_status: 'resolved' })
          .eq('id', proposal.id)

        if (!mErr) {
          result.matched++
          if (proposal.kind === 'action') {
            await ensureActionThread(sb, proposal.id, source.siteId, csId)
          }
          continue
        }
      }
      afterLlmMatch.push(proposal)
    }
  } else {
    afterLlmMatch.push(...orphans)
  }

  if (afterLlmMatch.length === 0) return result

  const orphansForClustering = afterLlmMatch.filter((p) => CAN_CREATE_SUBJECT_KINDS.has(p.kind))
  const orphansForMatchOnly = afterLlmMatch.filter((p) => !CAN_CREATE_SUBJECT_KINDS.has(p.kind))

  // ── Phase 2a : clustering + création des orphelins éligibles ─────────────
  if (orphansForClustering.length > 0) {
    // Appel Gemini sur les orphelins éligibles à la création
    let geminiGroups: ClusterOutput['groups'] | null = null

    try {
      const { getAIProvider } = await import('@/services/ai/factory')
      const provider = getAIProvider()
      const output = await provider.complete({
        systemPrompt: SYSTEM_PROMPT_CLUSTERING,
        userMessage: buildClusterPrompt(orphansForClustering.map((p) => ({ id: p.id, title: p.title, body: p.body }))),
        responseSchema: clusterOutputSchema,
        modelTier: 'light',
        maxOutputTokens: 1200,
      })
      if (output.parsed) {
        const validated = clusterOutputSchema.safeParse(output.parsed)
        if (validated.success) geminiGroups = validated.data.groups
      }
    } catch (err) {
      console.error('[reconcile-source] erreur Gemini clustering:', String(err).slice(0, 200))
    }

    // ── Phase 3 : créer les CS éligibles ───────────────────────────────────
    if (geminiGroups) {
      const orphanById = new Map(orphansForClustering.map((p) => [p.id, p]))

      const coveredByGemini = new Set(geminiGroups.flatMap((g) => g.proposalIds))
      for (const [id] of orphanById) {
        if (!coveredByGemini.has(id)) result.orphaned++
      }

      for (const group of geminiGroups) {
        if (!group.isDurableSubject) {
          result.orphaned += group.proposalIds.length
          continue
        }
        if (group.confidence < CREATE_THRESHOLD) {
          result.orphaned += group.proposalIds.length
          continue
        }
        if (!group.suggestedLabel) {
          result.orphaned += group.proposalIds.length
          continue
        }

        const groupProposals = group.proposalIds
          .map((id) => orphanById.get(id))
          .filter((p): p is NonNullable<typeof p> => p != null)

        if (groupProposals.length === 0) continue

        const { data: newCs, error: csErr } = await sb
          .from('canonical_subject')
          .insert({
            site_id: source.siteId,
            label: group.suggestedLabel,
            status: 'active',
            creation_source: source.type === 'field_visit' ? 'auto_visit'
              : source.type === 'meeting' ? 'auto_meeting'
              : source.type === 'historical_pv' ? 'historical_pv'
              : 'manual',
          })
          .select('id')
          .single()

        // P0-3 : l'index unique (mig 323) fait échouer la création perdante d'une
        // course. On ne doit PAS orpheliner ses propositions — le gagnant porte
        // déjà le bon sujet : on s'y rattache. Sans cette reprise, l'index
        // remplacerait le bug « deux jumeaux actifs » par « faits détachés du
        // graphe », ce qui est plus silencieux donc pire.
        let canonicalSubjectId: string
        let createdNow = false

        if (csErr || !newCs) {
          const recovered = isUniqueLabelViolation(csErr)
            ? await findActiveSubjectByNormalizedLabel(sb, source.siteId, group.suggestedLabel)
            : null

          if (!recovered) {
            console.error('[reconcile-source] erreur création CS:', csErr?.code, csErr?.message)
            result.orphaned += groupProposals.length
            continue
          }
          canonicalSubjectId = recovered
          result.matched += groupProposals.length
        } else {
          canonicalSubjectId = newCs.id
          createdNow = true
          result.created++
          result.clustered += groupProposals.length
        }

        // Identité de thread créée uniquement pour un sujet réellement neuf :
        // un sujet récupéré après conflit porte déjà la sienne.
        const sharedThreadId = crypto.randomUUID()
        if (createdNow) {
          await sb
            .from('subject_thread_identity')
            .insert({
              subject_thread_id: sharedThreadId,
              site_id: source.siteId,
              canonical_subject_id: canonicalSubjectId,
              source: 'auto',
            })
        }

        for (const proposal of groupProposals) {
          await sb
            .from('canonical_subject_occurrence')
            .upsert(
              {
                canonical_subject_id: canonicalSubjectId,
                site_id: source.siteId,
                source_kind: source.type === 'field_visit' ? 'field_visit' : 'meeting',
                source_ref_id: source.id,
                source_proposal_id: proposal.id,
                visit_status: source.type === 'field_visit' ? 'field_checked' : 'mentioned',
                label: proposal.title,
                note: proposal.body,
                evidence_count: 0,
                effective_date: new Date().toISOString().slice(0, 10),
                created_by: source.authorId,
                validation_status: validationStatus,
                entity_ids: proposal.entity_ids ?? [],
              },
              { onConflict: 'source_kind,source_proposal_id', ignoreDuplicates: true },
            )

          await sb
            .from('site_knowledge_proposals')
            .update({
              canonical_subject_id: canonicalSubjectId,
              canonical_resolution_status: 'resolved',
            })
            .eq('id', proposal.id)

          if (proposal.kind === 'action') {
            // Ne jamais propager sharedThreadId si l'identité n'a pas été insérée :
            // cela recréerait les STI orphelines nettoyées en P0-8.
            await ensureActionThread(
              sb, proposal.id, source.siteId, canonicalSubjectId,
              createdNow ? sharedThreadId : undefined,
            )
          }
        }
      }
    } else {
      // Pas de réponse Gemini : fallback Jaccard pur, pas de création (confiance inconnue)
      result.orphaned += orphansForClustering.length
    }
  }

  // ── Phase 2b : matching existant pour les deadlines orphelines ────────────
  // Le prompt Gemini ne demande jamais "quel sujet créer" — uniquement
  // "ce fait appartient-il à un sujet connu du chantier ?"
  if (orphansForMatchOnly.length > 0) {
    const { data: rawCs } = await sb
      .from('canonical_subject')
      .select('id, label')
      .eq('site_id', source.siteId)
      .eq('status', 'active')

    const existingCs = (rawCs ?? []) as Array<{ id: string; label: string }>

    if (existingCs.length === 0) {
      result.orphaned += orphansForMatchOnly.length
    } else {
      for (const proposal of orphansForMatchOnly) {
        const match = await matchExistingSubject(proposal, existingCs)
        if (match && match.confidence >= MATCH_EXISTING_THRESHOLD && match.canonicalSubjectId) {
          const csExists = existingCs.some((cs) => cs.id === match.canonicalSubjectId)
          if (!csExists) {
            result.orphaned++
            continue
          }
          const canonicalSubjectId = match.canonicalSubjectId

          await sb
            .from('canonical_subject_occurrence')
            .upsert(
              {
                canonical_subject_id: canonicalSubjectId,
                site_id: source.siteId,
                source_kind: occSourceKind,
                source_ref_id: source.id,
                source_proposal_id: proposal.id,
                visit_status: occSourceKind === 'field_visit' ? 'field_checked' : 'mentioned',
                label: proposal.title,
                note: proposal.body,
                evidence_count: 0,
                effective_date: occEffectiveDate,
                created_by: source.authorId,
                validation_status: validationStatus,
                entity_ids: proposal.entity_ids ?? [],
              },
              { onConflict: 'source_kind,source_proposal_id', ignoreDuplicates: true },
            )

          if (validationStatus === 'confirmed') {
            await sb
              .from('canonical_subject_occurrence')
              .update({ validation_status: 'confirmed' })
              .eq('source_kind', occSourceKind)
              .eq('source_proposal_id', proposal.id)
              .eq('validation_status', 'observed')
          }

          const { error: propErr } = await sb
            .from('site_knowledge_proposals')
            .update({ canonical_subject_id: canonicalSubjectId, canonical_resolution_status: 'resolved' })
            .eq('id', proposal.id)

          if (propErr) {
            console.error('[reconcile-source] Phase 2b proposal update failed:', proposal.id, propErr.code, propErr.message)
            result.orphaned++
          } else {
            result.matched++
          }
        } else {
          result.orphaned++
        }
      }
    }
  }

  return result
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/**
 * Phase 2b — Gemini existing-only : une deadline peut rejoindre un CS existant,
 * jamais en créer un. Retourne null si Gemini échoue ou si la confiance est trop basse.
 */
async function matchExistingSubject(
  proposal: { id: string; title: string; body: string | null; kind: string },
  existingCs: Array<{ id: string; label: string }>,
): Promise<ExistingMatchOutput | null> {
  try {
    const { getAIProvider } = await import('@/services/ai/factory')
    const provider = getAIProvider()
    const output = await provider.complete({
      systemPrompt: SYSTEM_PROMPT_MATCH_EXISTING,
      userMessage: buildMatchExistingPrompt(proposal, existingCs),
      responseSchema: existingMatchSchema,
      modelTier: 'light',
      maxOutputTokens: 300,
    })
    if (output.parsed) {
      const validated = existingMatchSchema.safeParse(output.parsed)
      if (validated.success) return validated.data
    }
    return null
  } catch (err) {
    console.error('[reconcile-source] erreur Gemini match-existing:', String(err).slice(0, 200))
    return null
  }
}

/**
 * Assure que l'action est liée à un subject_thread_id et que STI pointe vers le CS.
 * Idempotent : si l'action a déjà un thread, on s'assure juste que STI existe.
 */
async function ensureActionThread(
  sb: SupabaseAdmin,
  proposalId: string,
  siteId: string,
  canonicalSubjectId: string,
  preferredThreadId?: string,
): Promise<void> {
  // Trouver l'action liée à cette proposition
  const { data: propRow } = await sb
    .from('site_knowledge_proposals')
    .select('promoted_object_id, promoted_object_type')
    .eq('id', proposalId)
    .maybeSingle()

  type PropRow = { promoted_object_id?: string | null; promoted_object_type?: string | null } | null
  const pr = propRow as PropRow
  if (!pr?.promoted_object_id || pr.promoted_object_type !== 'site_action') return

  const actionId = pr.promoted_object_id

  // Lire subject_thread_id existant
  const { data: actionRow } = await sb
    .from('site_actions')
    .select('subject_thread_id')
    .eq('id', actionId)
    .maybeSingle()

  type ActionRow = { subject_thread_id?: string | null } | null
  const ar = actionRow as ActionRow
  let threadId = ar?.subject_thread_id ?? null

  if (!threadId) {
    threadId = preferredThreadId ?? crypto.randomUUID()
    await sb
      .from('site_actions')
      .update({ subject_thread_id: threadId })
      .eq('id', actionId)
  }

  // Créer STI si absent
  await sb
    .from('subject_thread_identity')
    .upsert(
      {
        subject_thread_id: threadId,
        site_id: siteId,
        canonical_subject_id: canonicalSubjectId,
        source: 'auto',
      },
      { onConflict: 'subject_thread_id', ignoreDuplicates: true },
    )
}
