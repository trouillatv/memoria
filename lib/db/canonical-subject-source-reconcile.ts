import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCanonicalSubjectReference } from '@/lib/db/canonical-subject-resolve'
import { reconcileProposalToCanonical, ELIGIBLE_KINDS } from '@/lib/db/canonical-subject-reconcile'
import { jaccardSimilarity } from '@/lib/documents/subject-reconciliation'

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
const CAN_CREATE_SUBJECT_KINDS = new Set(['action', 'vigilance', 'decision', 'knowledge'])

// Seuil pour le matching existant (deadline → CS) — plus élevé que la création
const MATCH_EXISTING_THRESHOLD = 0.85

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
    .select('id, kind, title, body, status, canonical_subject_id, canonical_resolution_status')
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
  }>

  const eligible = proposals.filter((p) => ELIGIBLE_KINDS.has(p.kind))
  if (eligible.length === 0) return result

  // ── Phase 1 : matching déterministe ──────────────────────────────────────
  const orphans: typeof eligible = []

  for (const proposal of eligible) {
    const resolution = await resolveCanonicalSubjectReference(source.siteId, proposal.title)

    if (resolution.kind === 'resolved') {
      await reconcileProposalToCanonical({
        proposalId: proposal.id,
        siteId: source.siteId,
        reportId: source.id,
        proposalKind: proposal.kind,
        proposalTitle: proposal.title,
        proposalBody: proposal.body,
        proposalCreatedAt: new Date().toISOString(),
        createdBy: source.authorId,
        validationStatus,
      })
      result.matched++

      if (proposal.kind === 'action') {
        await ensureActionThread(sb, proposal.id, source.siteId, resolution.candidate.id)
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

  const orphansForClustering = orphans.filter((p) => CAN_CREATE_SUBJECT_KINDS.has(p.kind))
  const orphansForMatchOnly = orphans.filter((p) => !CAN_CREATE_SUBJECT_KINDS.has(p.kind))

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

        if (csErr || !newCs) {
          console.error('[reconcile-source] erreur création CS:', csErr?.message)
          result.orphaned += groupProposals.length
          continue
        }

        const canonicalSubjectId = newCs.id
        result.created++
        result.clustered += groupProposals.length

        const sharedThreadId = crypto.randomUUID()
        await sb
          .from('subject_thread_identity')
          .insert({
            subject_thread_id: sharedThreadId,
            site_id: source.siteId,
            canonical_subject_id: canonicalSubjectId,
            source: 'auto',
          })

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
            await ensureActionThread(sb, proposal.id, source.siteId, canonicalSubjectId, sharedThreadId)
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
          await reconcileProposalToCanonical({
            proposalId: proposal.id,
            siteId: source.siteId,
            reportId: source.id,
            proposalKind: proposal.kind,
            proposalTitle: proposal.title,
            proposalBody: proposal.body,
            proposalCreatedAt: new Date().toISOString(),
            createdBy: source.authorId,
            validationStatus,
          })
          result.matched++
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
