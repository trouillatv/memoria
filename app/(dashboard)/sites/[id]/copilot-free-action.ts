'use server'

// Copilote Phase 3 — conversation libre, lecture seule.
// Invariant : AUCUNE écriture DB dans ce fichier.
//
// Flux :
//   1. Classifier l'intention (déterministe)
//   2. Résoudre les entités sujet nommées → resolved / ambiguous / not_found
//   3. Charger les read-models nécessaires (paresseux)
//   4. Appeler le LLM avec contexte fermé
//
// En cas d'ambiguïté sur un sujet → retourner 'clarification' (pas de LLM).
// En cas d'écriture → retourner 'write_not_supported' (3C seulement).

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { getSiteOverview, emptySiteOverview } from '@/lib/knowledge/site-overview'
import { listActivePreparationItems } from '@/lib/db/visit-preparation'
import {
  buildSiteCopilotContext,
  filterContextForIntent,
  resolveQuantitativeVerdict,
  isVisitPlanSignal,
  COPILOT_MAX_VISIT_PLAN,
} from '@/lib/visits/copilot-context'
import { classifyIntent } from '@/lib/visits/copilot-classify'
import { understandQuestion, mergeComprehension } from '@/lib/visits/copilot-comprehension'
import { resolveCanonicalSubjectReference } from '@/lib/db/canonical-subject-resolve'
import { buildCopilotProposal, buildScheduleProposal, type CopilotProposal } from '@/lib/visits/copilot-proposal'
import { parseScheduleFromQuestion, toNomeaTimestamp } from '@/lib/visits/copilot-schedule-parse'
import { detectIntent } from '@/lib/visits/copilot-intent-router'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCopilotInteraction } from '@/lib/db/copilot-telemetry'
import type { CopilotScope } from '@/lib/db/copilot-telemetry'
import { extractQuestionSubjectPhrase } from '@/lib/visits/copilot-classify'
import { getCanonicalSubjectLifeForSite } from '@/lib/db/canonical-subject-life'
import { buildSubjectDetailForCopilot } from '@/lib/visits/copilot-subject-context'
import { answerCopilotFreeQuestion } from '@/lib/visits/copilot-free-answer'
import type { FreeAnswerContext, RecentChangeContext } from '@/lib/visits/copilot-free-answer'
import { buildVisitPlan } from '@/lib/visits/visit-plan-builder'
import { buildVisitBriefing } from '@/lib/knowledge/visit-briefing'
import { getSiteActorContext } from '@/lib/db/site-actor-responsibilities'
import { frDayMonthYearLocal } from '@/lib/time/local-date'
import type { CopilotRef } from './copilot-action'

// ── Schémas ───────────────────────────────────────────────────────────────────

const HistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(2000),
})

const inputSchema = z.object({
  siteId: z.string().uuid(),
  question: z.string().min(1).max(500),
  /** Max 3 échanges = 6 messages. Sert uniquement au contexte conversationnel. */
  history: z.array(HistoryMessageSchema).max(6).default([]),
  /** IDs déjà résolus après une clarification utilisateur — court-circuite la résolution. */
  resolvedSubjectIds: z.array(z.string().uuid()).max(5).default([]),
  /** UUID stable de session locale — regroupe les échanges sans persister l'historique. */
  conversationId: z.string().uuid().optional(),
  /**
   * ID d'un sujet canonique sélectionné explicitement par l'utilisateur suite à une clarification.
   * Quand présent, court-circuite entièrement la résolution lexicale.
   */
  selectedCandidateId: z.string().uuid().optional(),
})

// ── Types de résultat ─────────────────────────────────────────────────────────

export type CopilotFreeCandidate = {
  id: string
  label: string
}

export type CopilotFreeResult =
  | {
      kind: 'answer'
      text: string
      references: CopilotRef[]
      source: 'llm' | 'fallback' | 'deterministic'
      interactionId: string | null
    }
  | {
      kind: 'clarification'
      /** Texte de présentation des candidats (déterministe, pas de LLM) */
      text: string
      candidates: CopilotFreeCandidate[]
      interactionId: string | null
    }
  | {
      kind: 'proposal'
      text: string
      proposal: CopilotProposal
      interactionId: string | null
    }
  | {
      kind: 'write_not_supported'
      text: string
    }

// ── Action ────────────────────────────────────────────────────────────────────

export async function askCopilotFreeAction(
  rawInput: unknown,
): Promise<CopilotFreeResult> {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { kind: 'answer', text: 'Paramètres invalides.', references: [], source: 'fallback', interactionId: null }
  }
  const { siteId, question, history, resolvedSubjectIds, conversationId, selectedCandidateId } = parsed.data
  const t0 = Date.now()

  // Vérification d'accès — l'utilisateur doit avoir accès au chantier
  try {
    await requireSiteAccess(siteId)
  } catch {
    return { kind: 'answer', text: 'Accès non autorisé.', references: [], source: 'fallback', interactionId: null }
  }

  // Utilisateur courant (pour les prep items)
  let userId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  } catch { /* non bloquant */ }

  // ── Classification déterministe ───────────────────────────────────────────────
  const deterministicClassification = classifyIntent(question)
  const deterministicIntent = detectIntent(question)

  // ── Couche de compréhension (LLM léger, jamais de réponse ni d'écriture) ─────
  // Traduit une formulation orale imparfaite en structure. En cas de timeout,
  // d'erreur ou de JSON invalide → null, et le déterministe reprend la main
  // silencieusement (le Copilote doit rester fonctionnel sans LLM).
  const comprehension = await understandQuestion(question)
  const merged = mergeComprehension(
    question,
    deterministicClassification,
    deterministicIntent,
    comprehension,
  )
  const classification = merged.classification
  const intentResult = merged.intentResult

  // ── Trace de production (mandat Vincent, 15/08) ───────────────────────────
  // Aucune fonctionnalité : une ligne structurée pour répondre en un passage à
  // « où cette requête bifurque-t-elle ? ». La recette du 15/08 a montré qu'on
  // ne pouvait pas le dire : `copilot_interactions` ne porte ni l'intent
  // déterministe, ni l'intent après compréhension, ni le nombre de contrôles,
  // ni le build qui a servi — et une session navigateur reste épinglée au
  // déploiement sur lequel elle a été chargée, donc « c'est en production »
  // ne dit pas « c'est ce commit qui a répondu ».
  const traceBase = {
    dpl: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    q: question.slice(0, 80),
    det: `${deterministicIntent.intent}/${deterministicIntent.confidence}`,
    detSignals: deterministicIntent.signals.join('+') || '—',
    comp: comprehension ? `${comprehension.label}/${comprehension.confidence}` : 'null',
    merged: intentResult.intent,
    applied: merged.applied.join('+') || '—',
    primary: classification.primary,
  }
  console.log('[copilot-trace] routing', JSON.stringify(traceBase))

  // Scope dérivé de l'intention primaire (pour la télémétrie)
  const INTENT_SCOPE_MAP: Record<string, CopilotScope> = {
    subject_detail:   'canonical_subject',
    timeline:         'historical_pv',
    action_status:    'action',
    actor:            'actor',
    plan_visite:      'visit_plan',
    // La stagnation se mesure sur les sujets canoniques (moteur canonical-subject-life),
    // pas sur les actions : sans cette entrée le scope télémétrique retomberait sur
    // 'unknown' et la famille serait invisible dans l'Observatoire.
    stagnation:       'canonical_subject',
    global:           'site',
    proposal_request: 'site',
  }
  const baseScope: CopilotScope = INTENT_SCOPE_MAP[classification.primary] ?? 'unknown'

  // Écriture détectée — Copilote 3C : résoudre le sujet puis construire un brouillon.
  if (intentResult.intent !== 'READ') {
    // Sortie anticipée : aucune donnée du chantier n'est chargée au-delà de ce
    // point. C'est ici, et nulle part ailleurs, qu'une question de préparation
    // de visite peut devenir un formulaire.
    console.log('[copilot-trace] write', JSON.stringify({ ...traceBase, branch: intentResult.intent }))
    // ── Intention non supportée (réserve, échéance…) ou ambiguë → clarification ──
    if (intentResult.intent === 'UNKNOWN_WRITE') {
      const hasUnsupported = intentResult.signals.includes('unsupported_object')
      const clarText = hasUnsupported
        ? "Cette commande n'est pas encore disponible via le Copilote. Vous pouvez créer une action ou ajouter un point au plan de votre prochaine visite."
        : "Je n'ai pas bien compris votre intention. Souhaitez-vous créer une action, ajouter un point au plan de visite, ou planifier une visite / réunion ?"
      return { kind: 'answer', text: clarText, references: [], source: 'fallback', interactionId: null }
    }

    // ── Planification (SCHEDULE_VISIT / SCHEDULE_MEETING) ──────────────────
    if (intentResult.intent === 'SCHEDULE_VISIT' || intentResult.intent === 'SCHEDULE_MEETING') {
      const proposalKind = intentResult.intent === 'SCHEDULE_VISIT' ? 'schedule_visit' : 'schedule_meeting'
      const parsed = parseScheduleFromQuestion(question)
      const eventLabel = proposalKind === 'schedule_visit' ? 'visite' : 'réunion'

      if (!parsed) {
        // Pas de date trouvée → demander une précision (pas de brouillon).
        return {
          kind: 'answer',
          text: `Pour planifier une ${eventLabel}, précisez la date et l'heure.\nEx. : « Planifie une ${eventLabel} le 12 août à 9h »`,
          references: [],
          source: 'fallback',
          interactionId: null,
        }
      }

      // Avertissement doux : événement existant dans les ±2 h du créneau demandé.
      let conflictWarning: string | null = null
      if (parsed.time) {
        try {
          const admin = createAdminClient()
          const ts = new Date(toNomeaTimestamp(parsed.date, parsed.time)).getTime()
          const fromTs = new Date(ts - 2 * 3_600_000).toISOString()
          const toTs   = new Date(ts + 2 * 3_600_000).toISOString()
          const { data: conflicts } = await admin
            .from('site_scheduled_events')
            .select('title, type')
            .eq('site_id', siteId)
            .is('deleted_at', null)
            .in('status', ['planned', 'postponed'])
            .gte('planned_start', fromTs)
            .lte('planned_start', toTs)
          const TYPE_FR: Record<string, string> = { visit: 'visite', meeting: 'réunion' }
          const rows = (conflicts ?? []) as { title: string | null; type: string }[]
          if (rows.length > 0) {
            const first = rows[0]
            const label = first.title?.trim() || TYPE_FR[first.type] || first.type
            conflictWarning = `Un événement existe déjà dans ce créneau : « ${label} ».`
          }
        } catch { /* best-effort — ne bloque pas la proposition */ }
      }

      const proposal = buildScheduleProposal({
        kind: proposalKind,
        parsedDate: parsed.date,
        parsedTime: parsed.time,
        conflictWarning,
      })

      const iid = await logCopilotInteraction({
        siteId, userId, conversationId: conversationId ?? null,
        question, conversationMode: 'free',
        primaryIntent: 'proposal_request', secondaryIntents: [],
        scope: 'site',
        resolvedSubjectIds: [],
        answerText: null, answerMode: 'deterministic_fallback', answerStatus: 'answered',
        citedReferenceCount: 0, sourcesUsed: [],
        model: null, promptVersion: null, inputTokens: null, outputTokens: null,
        estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        proposalKind: proposal.kind,
        proposalId: proposal.proposalId,
        proposalStatus: 'shown',
      })

      return {
        kind: 'proposal',
        text: `Voici le brouillon pour planifier cette ${eventLabel}. Vérifiez et ajustez avant de valider.`,
        proposal,
        interactionId: iid,
      }
    }

    // ── Action / visit_item ─────────────────────────────────────────────────
    let canonicalSubjectId: string | null = null
    let canonicalSubjectLabel: string | null = null
    let resolvedWithConfidence = false

    if (classification.entities.subjectLabels.length > 0) {
      const resolution = await resolveCanonicalSubjectReference(siteId, classification.entities.subjectLabels[0])
      if (resolution.kind === 'resolved') {
        canonicalSubjectId = resolution.candidate.id
        canonicalSubjectLabel = resolution.candidate.label
        resolvedWithConfidence = true
      } else if (resolution.kind === 'ambiguous') {
        const labels = resolution.candidates.map((c) => `• ${c.label}`).join('\n')
        const iid = await logCopilotInteraction({
          siteId, userId, conversationId: conversationId ?? null,
          question, conversationMode: 'free',
          primaryIntent: 'proposal_request', secondaryIntents: [],
          scope: 'unknown', resolvedSubjectIds: [],
          answerText: null, answerMode: 'clarification', answerStatus: 'ambiguous',
          citedReferenceCount: 0, sourcesUsed: [],
          model: null, promptVersion: null, inputTokens: null, outputTokens: null,
          estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        })
        return {
          kind: 'clarification',
          text: `Plusieurs sujets correspondent. Lequel souhaitez-vous associer à cette proposition ?\n\n${labels}`,
          candidates: resolution.candidates,
          interactionId: iid,
        }
      }
    }

    const proposal = buildCopilotProposal({
      question,
      canonicalSubjectId,
      canonicalSubjectLabel,
      resolvedWithConfidence,
    })

    const proposalScope: CopilotScope = proposal.kind === 'visit_item' ? 'visit_plan' : 'action'
    const iid = await logCopilotInteraction({
      siteId, userId, conversationId: conversationId ?? null,
      question, conversationMode: 'free',
      primaryIntent: 'proposal_request', secondaryIntents: [],
      scope: proposalScope,
      resolvedSubjectIds: canonicalSubjectId ? [canonicalSubjectId] : [],
      answerText: null, answerMode: 'deterministic_fallback', answerStatus: 'answered',
      citedReferenceCount: 0, sourcesUsed: [],
      model: null, promptVersion: null, inputTokens: null, outputTokens: null,
      estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
      proposalKind: proposal.kind,
      proposalId: proposal.proposalId,
      proposalStatus: 'shown',
    })

    const kindLabel = proposal.kind === 'visit_item' ? 'point de visite' : 'action'
    console.log('[copilot-trace] answer', JSON.stringify({
      ...traceBase, ui: 'proposal', proposalKind: proposal.kind, controls: 0, source: 'fallback',
    }))
    return {
      kind: 'proposal',
      text: `Voici le brouillon de ${kindLabel} que je propose. Vérifiez et ajustez avant de valider.`,
      proposal,
      interactionId: iid,
    }
  }

  // ── Résolution des entités sujet ─────────────────────────────────────────────
  // On collecte tous les IDs à charger : ceux déjà résolus + ceux de la question courante
  const subjectIdsToLoad = new Set<string>(resolvedSubjectIds)
  const clarificationCandidates: CopilotFreeCandidate[] = []

  const needsSubjectDetail =
    classification.primary === 'subject_detail' ||
    classification.secondary.includes('subject_detail') ||
    classification.entities.subjectLabels.length > 0

  if (selectedCandidateId) {
    // Court-circuit : l'utilisateur a explicitement sélectionné un sujet après clarification.
    // Pas de résolution lexicale — on charge directement l'ID choisi.
    subjectIdsToLoad.add(selectedCandidateId)
  } else if (needsSubjectDetail && classification.entities.subjectLabels.length > 0) {
    // Résoudre chaque entité extraite (codes techniques ou guillemets)
    for (const label of classification.entities.subjectLabels) {
      const resolution = await resolveCanonicalSubjectReference(siteId, label)
      if (resolution.kind === 'resolved') {
        subjectIdsToLoad.add(resolution.candidate.id)
      } else if (resolution.kind === 'ambiguous') {
        clarificationCandidates.push(...resolution.candidates)
      }
      // not_found → sujet inconnu, on continue
    }
  } else if (needsSubjectDetail && classification.entities.subjectLabels.length === 0 && resolvedSubjectIds.length === 0) {
    // Fallback : intent sujet détecté (signal "où en est", "parle-moi"…) mais aucun code/guillemet extrait.
    // Tenter une résolution sur le syntagme nominal extrait de la question.
    const phrase = extractQuestionSubjectPhrase(question)
    if (phrase) {
      const resolution = await resolveCanonicalSubjectReference(siteId, phrase)
      if (resolution.kind === 'resolved') {
        subjectIdsToLoad.add(resolution.candidate.id)
      } else if (resolution.kind === 'ambiguous') {
        clarificationCandidates.push(...resolution.candidates)
      }
      // not_found → tombe dans le not_found déterministe ci-dessous
    }
  }

  // not_found déterministe : intent subject_detail, résolution tentée, rien trouvé
  // → réponse directe sans LLM, sans références parasites
  const hasExtractedLabels = classification.entities.subjectLabels.length > 0
  const extractedPhrase = !hasExtractedLabels ? extractQuestionSubjectPhrase(question) : null
  const attemptedResolution = hasExtractedLabels || extractedPhrase !== null
  const allLabelsUnresolved = attemptedResolution
    && subjectIdsToLoad.size === 0
    && clarificationCandidates.length === 0
    && !selectedCandidateId
  // Un indice de sujet issu de la compréhension LLM ("les toilettes" dans une phrase
  // orale) n'autorise PAS un "je ne trouve rien" péremptoire : l'utilisateur n'a pas
  // tapé un code technique, il a parlé. On poursuit vers la réponse générale.
  if (classification.primary === 'subject_detail' && allLabelsUnresolved && !merged.subjectHintsFromLlm) {
    const labels = hasExtractedLabels
      ? classification.entities.subjectLabels.join(', ')
      : (extractedPhrase ?? question.slice(0, 60))
    const notFoundText = `Je ne trouve aucun sujet correspondant à "${labels}" dans la mémoire structurée de ce chantier. Essayez avec le label exact ou un code technique (R4, G3, DN160…).`
    const iid = await logCopilotInteraction({
      siteId, userId, conversationId: conversationId ?? null,
      question, conversationMode: 'free',
      primaryIntent: classification.primary, secondaryIntents: classification.secondary,
      scope: 'canonical_subject', resolvedSubjectIds: [],
      answerText: notFoundText, answerMode: 'deterministic_fallback', answerStatus: 'not_found',
      citedReferenceCount: 0, sourcesUsed: [],
      model: null, promptVersion: null, inputTokens: null, outputTokens: null,
      estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
    })
    return {
      kind: 'answer',
      text: notFoundText,
      references: [],
      source: 'fallback',
      interactionId: iid,
    }
  }

  if (clarificationCandidates.length > 0) {
    const labels = clarificationCandidates.map((c) => `• ${c.label}`).join('\n')
    const clarText = `Je trouve plusieurs sujets correspondant à votre question sur ce chantier. Lequel souhaitez-vous examiner ?\n\n${labels}`
    const iid = await logCopilotInteraction({
      siteId, userId, conversationId: conversationId ?? null,
      question, conversationMode: 'free',
      primaryIntent: classification.primary, secondaryIntents: classification.secondary,
      scope: baseScope, resolvedSubjectIds: [],
      answerText: clarText, answerMode: 'clarification', answerStatus: 'ambiguous',
      citedReferenceCount: 0, sourcesUsed: [],
      model: null, promptVersion: null, inputTokens: null, outputTokens: null,
      estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
    })
    return {
      kind: 'clarification',
      text: clarText,
      candidates: clarificationCandidates,
      interactionId: iid,
    }
  }

  // ── Chargement des données ────────────────────────────────────────────────────
  const needsActor = classification.primary === 'actor' || classification.secondary.includes('actor')

  // Un échec de chargement produit un overview VIDE, indiscernable d'un chantier
  // réellement sans signal. On trace donc l'échec : il interdit toute affirmation
  // quantitative ("aucune action en retard") — cf. resolveQuantitativeVerdict.
  let overviewLoadFailed = false
  // Même règle pour le briefing : il porte les compteurs de stagnation et le
  // delta terrain. En échec, ses mesures valent `null` — jamais zéro.
  let briefingLoadFailed = false

  const [overview, briefing, prepItemsRaw, actorContext, ...subjectLives] = await Promise.all([
    getSiteOverview(siteId).catch(() => { overviewLoadFailed = true; return emptySiteOverview(siteId) }),
    // buildVisitBriefing est l'agrégateur déjà utilisé par « Préparer ma visite ».
    // Le Copilote consomme LA MÊME intelligence plutôt que de reconstruire un
    // agrégat parallèle : une seule source, une seule vérité (arbitrage Vincent).
    buildVisitBriefing(siteId).catch(() => {
      briefingLoadFailed = true
      return null
    }),
    userId
      ? listActivePreparationItems(siteId, userId).catch(() => [])
      : Promise.resolve([]),
    // Outil actor — chargement paresseux
    needsActor
      ? getSiteActorContext(siteId, classification.entities.actorLabels).catch(() => [])
      : Promise.resolve([]),
    ...[...subjectIdsToLoad].map((id) =>
      getCanonicalSubjectLifeForSite(siteId, id).catch(() => null),
    ),
  ])

  const prepItems = prepItemsRaw.map((p) => ({ label: p.label, stableKey: p.stableKey }))

  // Contexte de base Phase 2 (items + delta) + signaux du moteur canonique.
  // `allAttention` et NON `attention` : le ranking du briefing écarte les `low`,
  // arbitrage légitime pour l'UI de préparation de visite mais destructeur ici —
  // sur un chantier terrain dont tous les signaux sont `low` (PETRO ATTITI, 7
  // `subject_changed`), il supprimerait exactement le contexte attendu.
  const context = buildSiteCopilotContext(
    siteId,
    overview.identity.name,
    overview,
    prepItems,
    briefing?.allAttention ?? [],
  )

  // Mapping intent primaire → filtre Phase 2
  const INTENT_FILTER_MAP: Record<string, 'attention' | 'changes' | 'stale' | 'next_visit'> = {
    timeline:      'changes',
    plan_visite:   'next_visit',
    action_status: 'attention',
    subject_detail:'attention',
    actor:         'attention',
    stagnation:    'stale',
    global:        'attention',
  }
  const safeIntent = INTENT_FILTER_MAP[classification.primary] ?? 'attention'
  const { items, delta, prepItems: filteredPrep } = filterContextForIntent(context, safeIntent)

  // Réponse déterministe directe pour une question quantitative ("Quelles actions sont
  // en retard ?") : le moteur d'attention a déjà la réponse, inutile d'interroger le LLM
  // qui, face à un contexte vide, dit à tort "je n'ai pas d'informations" au lieu d'un
  // "zéro" confirmé (défaut Copilote V2, retour Guillaume).
  //
  // Les compteurs passés ici sont des MESURES, pas des comptages d'items filtrés :
  // un verdict quantitatif exige une mesure quantitative. Un moteur en échec
  // transmet `null`, ce qui produit "je ne sais pas" et jamais "aucun".
  const engineCount = (signals: string[]): number | null =>
    briefingLoadFailed || !briefing
      ? null
      : briefing.allAttention.filter((i) => signals.includes(i.signal)).length

  const quantitative = resolveQuantitativeVerdict({
    question,
    primaryIntent: classification.primary,
    overviewLoadFailed,
    measures: {
      actionsOverdue:   overviewLoadFailed ? null : overview.actions.summary.overdue,
      deadlinesOverdue: engineCount(['deadline_overdue']),
      reservesOpen:     engineCount(['reserve_open']),
      blocagesActive:   engineCount(['blocage_active']),
      subjectsStagnant: briefingLoadFailed || !briefing ? null : briefing.stagnation.stagnantCount,
    },
    stagnationClosest: briefing?.stagnation.closest
      ? { title: briefing.stagnation.closest.title, days: briefing.stagnation.closest.days }
      : null,
  })
  if (quantitative) {
    const iid = await logCopilotInteraction({
      siteId, userId, conversationId: conversationId ?? null,
      question, conversationMode: 'free',
      primaryIntent: classification.primary, secondaryIntents: classification.secondary,
      scope: baseScope, resolvedSubjectIds: [],
      answerText: quantitative.text, answerMode: 'deterministic_fallback',
      answerStatus: quantitative.kind === 'confirmed_zero' ? 'answered' : 'insufficient_data',
      citedReferenceCount: 0, sourcesUsed: quantitative.kind === 'confirmed_zero' ? ['site_overview'] : [],
      model: null, promptVersion: null, inputTokens: null, outputTokens: null,
      estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
    })
    return { kind: 'answer', text: quantitative.text, references: [], source: 'deterministic', interactionId: iid }
  }

  // Enrichissement sujets détaillés
  const subjectDetails = subjectLives
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .map(buildSubjectDetailForCopilot)

  // ── Contexte 3B — modules chargés à la demande ───────────────────────────────
  const extra: FreeAnswerContext = {}

  // Timeline : filtrer les changements récents à l'intervalle du delta
  // Ne remonter que les événements dont occurredAt est dans [fromDate, toDate].
  // Évite de présenter des signaux anciens comme des événements de l'intervalle.
  // "global" (résumé général type "où en est le chantier ?") en a aussi besoin :
  // une synthèse de situation sans les changements récents serait tronquée.
  const needsTimeline = classification.primary === 'timeline' || classification.secondary.includes('timeline')
    || classification.primary === 'global'
  if (needsTimeline) {
    const fromIso = delta?.fromDate ?? null
    const toIso   = delta?.toDate   ?? null
    const filtered = overview.recentChanges.filter((c) => {
      if (!fromIso || !toIso) return true
      return c.occurredAt >= fromIso && c.occurredAt <= toIso
    }).slice(0, 15)
    if (filtered.length > 0) {
      extra.recentChanges = filtered.map((c): RecentChangeContext => ({
        title: c.title,
        occurredAt: c.occurredAt,
        detail: c.detail,
      }))
    }
  }

  // ── Moteurs déterministes injectés selon la famille ──────────────────────────
  //
  // "Où en est le chantier ?" (global) est une question de SYNTHÈSE : elle a
  // besoin du delta terrain, des compteurs d'actions ET de l'état de stagnation,
  // pas seulement d'une liste de signaux. C'est ce manque qui rendait la réponse
  // creuse sur PETRO ATTITI alors que les faits existaient en base.
  const isGlobal     = classification.primary === 'global'
  const isTimeline   = classification.primary === 'timeline' || classification.secondary.includes('timeline')
  const isStagnation = classification.primary === 'stagnation'

  if (briefing?.delta && (isGlobal || isTimeline)) {
    extra.visitDelta = {
      // Formaté ICI, en zone Nouméa : l'ISO brut faisait dire « 10 août » au LLM
      // pour une visite du 11 août 10h43 locale (2026-08-10T23:43Z).
      depuis:           frDayMonthYearLocal(briefing.delta.since),
      sujetsChanges:    briefing.delta.subjectsChanged,
      actionsCreees:    briefing.delta.actionsCreated,
      actionsCloturees: briefing.delta.actionsClosed,
      reservesCreees:   briefing.delta.reservesCreated,
      reservesLevees:   briefing.delta.reservesLifted,
    }
  }

  if (isGlobal && !overviewLoadFailed) {
    const s = overview.actions.summary
    extra.actionsSummary = {
      actives:      s.active,
      planifiees:   s.planned,
      enRetard:     s.overdue,
      cetteSemaine: s.week,
      sansDate:     s.undated,
      terminees:    s.completed,
    }
  }

  if (briefing && !briefingLoadFailed && (isGlobal || isStagnation)) {
    extra.stagnation = {
      nbSujetsStagnants: briefing.stagnation.stagnantCount,
      plusProcheDuSeuil: briefing.stagnation.closest
        ? { titre: briefing.stagnation.closest.title, jours: briefing.stagnation.closest.days }
        : null,
    }
  }

  // Actor : déjà chargé dans actorContext
  if (actorContext.length > 0) {
    extra.actorContext = actorContext
  }

  // Plan de visite : toujours définir visitPlanDetail pour intent plan_visite
  // (même vide → le LLM sait que le plan humain est vide et peut distinguer
  //  plan_utilisateur de recommandations_memoria)
  //
  // Deux sources, dans cet ordre : le moteur canonique d'attention d'abord, puis
  // `pvToVerify`. Avant ce lot, seule la seconde alimentait le plan — un chantier
  // suivi en visites terrain sans PV analysé (PETRO ATTITI) recevait donc une
  // liste vide, et MemorIA demandait à l'utilisateur ce qu'il fallait vérifier
  // au lieu de le lui dire. On lit `allAttention` et non `attention` pour la même
  // raison qu'au-dessus (construction du contexte) : `rankBriefingAttention`
  // écarte les `low` et rendrait le plan vide sur ce chantier précis.
  //
  // La projection elle-même (hiérarchie de visite, quoi vérifier, dernier état
  // connu, changement depuis la dernière visite) vit dans `buildVisitPlan` :
  // un item d'attention n'est pas un contrôle terrain, et le LLM ne peut pas
  // inventer une hiérarchie métier qu'on ne lui fournit pas.
  const needsPlan = safeIntent === 'next_visit'
  if (needsPlan) {
    extra.visitPlanDetail = buildVisitPlan(
      (briefing?.allAttention ?? []).filter((i) => isVisitPlanSignal(i.signal)),
      overview.pvToVerify,
      COPILOT_MAX_VISIT_PLAN,
    )
  }

  // ── Appel LLM ────────────────────────────────────────────────────────────────
  const answer = await answerCopilotFreeQuestion(
    question,
    history,
    items,
    subjectDetails,
    delta,
    filteredPrep,
    overview.identity.name,
    extra,
  )

  // Résolution des références depuis la liste FERMÉE (items + sujets détaillés)
  const allItems = [
    ...items,
    ...subjectDetails.map((s) => ({ id: s.id, label: s.label, href: null as string | null })),
  ]
  const itemById = new Map(allItems.map((i) => [i.id, i]))
  const references: CopilotRef[] = answer.citedIds
    .map((id) => {
      const item = itemById.get(id)
      return item ? { id: item.id, label: item.label, href: (item as { href?: string | null }).href ?? null } : null
    })
    .filter((r): r is CopilotRef => r !== null)

  // Calcul des sources réellement chargées
  const sourcesUsed: string[] = ['site_overview']
  if (userId) sourcesUsed.push('visit_preparation')
  if (subjectDetails.length > 0) sourcesUsed.push('canonical_subject_life')
  if (needsActor && actorContext.length > 0) sourcesUsed.push('actors')
  if (needsTimeline) sourcesUsed.push('historical_pv')
  if (needsPlan) sourcesUsed.push('visit_plan')

  const latencyMs = Date.now() - t0
  const resolvedIds = [...subjectIdsToLoad]
  const answerStatus = answer.source === 'llm'
    ? 'answered'
    : (references.length === 0 ? 'insufficient_data' : 'answered')

  const iid = await logCopilotInteraction({
    siteId, userId, conversationId: conversationId ?? null,
    question, conversationMode: 'free',
    primaryIntent: classification.primary, secondaryIntents: classification.secondary,
    scope: baseScope, resolvedSubjectIds: resolvedIds,
    answerText: answer.text,
    answerMode: answer.source === 'llm' ? 'llm' : 'deterministic_fallback',
    answerStatus,
    citedReferenceCount: references.length,
    sourcesUsed,
    model: null, promptVersion: null, inputTokens: null, outputTokens: null,
    estimatedCostEur: null, latencyMs,
    usedFallback: answer.source === 'fallback',
  })

  console.log('[copilot-trace] answer', JSON.stringify({
    ...traceBase,
    ui: 'answer',
    safeIntent,
    controls: extra.visitPlanDetail?.length ?? 0,
    source: answer.source,
    refs: references.length,
    latencyMs,
  }))

  return { kind: 'answer', text: answer.text, references, source: answer.source, interactionId: iid }
}
