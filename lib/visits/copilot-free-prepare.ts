import 'server-only'

// Copilote Phase 3 — préparation de la conversation libre, lecture seule.
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
//
// P2-C (16/08, mandat Vincent) : ce module vivait dans `copilot-free-action.ts`
// (`'use server'`). Il en a été SORTI parce que `prepareCopilotAnswer` accepte
// désormais un second paramètre de confiance (`precomputed` : accès déjà décidé
// + lectures déjà en vol) — dans un fichier `'use server'`, chaque export est
// une action potentiellement invocable depuis un client, et un appelant
// malveillant aurait pu forger ce paramètre pour contourner `requireSiteAccess`.
// Ici, module serveur ordinaire : le paramètre ne peut venir que de code
// serveur (route vocale), jamais du réseau.

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import type { ResourceAccessContext } from '@/lib/auth/resource-access'
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
import { understandQuestion, mergeComprehension, type Comprehension, type ComprehensionMerge } from '@/lib/visits/copilot-comprehension'
import { resolveCanonicalSubjectReference } from '@/lib/db/canonical-subject-resolve'
import { resolveActorTarget, resolveActorCandidateById, type ActorCandidate } from '@/lib/db/actor-alias-resolve'
import { extractIdentityCorrection } from '@/lib/visits/copilot-identity-correction'
import { extractRelationClaim } from '@/lib/visits/copilot-relation-claim'
import { extractKnowledgeCorrection } from '@/lib/visits/copilot-knowledge-correction'
import { listRecentCurrentInformationEntries } from '@/lib/db/site-memory-entries'
import { buildCopilotProposal, buildScheduleProposal, buildObservationProposal, buildIdentityCorrectionProposal, buildFactProposal, buildRelationClaimProposal, buildWatchpointProposal, buildDeadlineProposal, buildReserveProposal, buildKnowledgeSupersessionProposal, buildKnowledgeArchiveProposal, type CopilotProposal } from '@/lib/visits/copilot-proposal'
import { parseScheduleFromQuestion, toNomeaTimestamp } from '@/lib/visits/copilot-schedule-parse'
import { detectIntent, readRemainsPlausible, hasWriteBlockingSemanticSignal, type IntentResult } from '@/lib/visits/copilot-intent-router'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCopilotInteraction } from '@/lib/db/copilot-telemetry'
import { scheduleDecomposeShadow } from '@/lib/visits/copilot-decompose-shadow'
import { decomposeUtterance, routeSegments, isP6MultiSegmentAdmissible } from '@/lib/visits/copilot-decompose'
import type { CopilotScope, CopilotSttRoute } from '@/lib/db/copilot-telemetry'
import { extractQuestionSubjectPhrase } from '@/lib/visits/copilot-classify'
import { getCanonicalSubjectLifeForSite, getCanonicalSubjectLabelsByIds } from '@/lib/db/canonical-subject-life'
import { buildSubjectDetailForCopilot } from '@/lib/visits/copilot-subject-context'
import { loadCboReducedBySubject } from '@/lib/knowledge/canonical-business-object-evolution'
import type { CboReducedEntry } from '@/lib/knowledge/canonical-business-object-evolution'
import type { FreeAnswer, FreeAnswerContext, HistoryMessage, RecentChangeContext } from '@/lib/visits/copilot-free-answer'
import { buildSiteActivityReadModel } from '@/lib/knowledge/site-activity-read-model'
import { buildVisitPlan } from '@/lib/visits/visit-plan-builder'
import { buildVisitBriefing } from '@/lib/knowledge/visit-briefing'
import { getSiteActorContext } from '@/lib/db/site-actor-responsibilities'
import { frDayMonthYearLocal } from '@/lib/time/local-date'
import { spokenFromShortAnswer } from '@/lib/voice/spoken-answer'
import type { CopilotItem, SiteCopilotDelta } from '@/lib/visits/copilot-context'
import type { SubjectDetailContext } from '@/lib/visits/copilot-subject-context'
import type { CopilotRef } from '@/app/(dashboard)/sites/[id]/copilot-action'

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
  /**
   * Texte brut du STT avant normalizeTranscript(), transmis uniquement pour
   * l'audit Copilote (brique 2, mandat Vincent 2026-08-17) — jamais utilisé
   * comme source de fait, jamais transmis au LLM.
   */
  rawTranscript: z.string().max(1000).nullable().optional(),
  transcriptionCorrections: z.array(z.object({ from: z.string(), to: z.string() })).max(20).optional(),
  transcriptionAbstentions: z.number().int().min(0).max(1000).nullable().optional(),
  /**
   * Décomposition serveur de la latence, sur demande explicite. Fermé par
   * défaut : la ligne `[copilot-diag]` porte la taille du contexte, le modèle
   * et les tokens — utile en recette, inutile et verbeux en production. Elle
   * n'influence RIEN : ni le modèle, ni le contexte, ni le prompt. Ouvrable
   * aussi par `COPILOT_DIAG=1` côté serveur, pour instrumenter un
   * environnement entier sans toucher au client.
   */
  diag: z.boolean().default(false),
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
      /**
       * Synthèse orale facultative. Absente = pas de lecture, jamais une
       * erreur. Le texte reste la restitution complète et canonique.
       */
      spokenText?: string | null
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
  | {
      /**
       * P6-B (mandat Vincent, 2026-08-19) : plusieurs unités métier indépendantes
       * détectées dans un même tour (ex. constat + consigne + vigilance), chacune
       * transformée en proposition indépendante. Tout-ou-rien à la construction —
       * voir `attemptP6MultiIntent` : jamais un sous-ensemble silencieux.
       */
      kind: 'proposals'
      proposals: Array<{
        text: string
        proposal: CopilotProposal
        interactionId: string | null
        segmentText: string
        segmentIndex: number
      }>
    }

// ── Préchargement d'un tour vocal (P2-C overlap) ─────────────────────────────
//
// Les trois lectures ci-dessous ne dépendent QUE de `siteId`/`userId`, connus
// dès la réception de l'audio — bien avant le transcript. La route vocale les
// lance donc en parallèle du STT (~5,5 s mesurés), et `prepareCopilotAnswer`
// les RÉUTILISE pour ce tour au lieu de les relancer.
//
// Pas de cache : ces promesses vivent dans la portée de LA requête qui les a
// créées, meurent avec elle, et ne sont jamais partagées entre utilisateurs ni
// entre tours. Une spéculation inutilisée (intention d'écriture) est jetée.
//
// Les échecs sont portés par un discriminant `ok` plutôt que par un rejet :
// une promesse lancée tôt puis rejetée sans handler ferait un unhandled
// rejection ; et la sémantique d'échec (`overviewLoadFailed` → jamais
// d'affirmation quantitative) doit rester décidée dans `prepareCopilotAnswer`.

export interface CopilotSitePrefetch {
  siteId: string
  userId: string | null
  /** Instant du VRAI départ des lectures — sert de `contextStartAt` à la trace. */
  startedAt: number
  overview: Promise<{ ok: true; value: Awaited<ReturnType<typeof getSiteOverview>> } | { ok: false }>
  briefing: Promise<{ ok: true; value: Awaited<ReturnType<typeof buildVisitBriefing>> } | { ok: false }>
  prepItems: Promise<Awaited<ReturnType<typeof listActivePreparationItems>>>
}

export function startCopilotSitePrefetch(siteId: string, userId: string | null): CopilotSitePrefetch {
  return {
    siteId,
    userId,
    startedAt: Date.now(),
    overview: getSiteOverview(siteId)
      .then((value) => ({ ok: true as const, value }))
      .catch(() => ({ ok: false as const })),
    briefing: buildVisitBriefing(siteId)
      .then((value) => ({ ok: true as const, value }))
      .catch(() => ({ ok: false as const })),
    prepItems: userId
      ? listActivePreparationItems(siteId, userId).catch(() => [])
      : Promise.resolve([]),
  }
}

/**
 * Ce que la route vocale a déjà fait AVANT le transcript, pour ce tour :
 * la décision d'accès (par `resolveResourceAccess`, LA primitive canonique —
 * jamais une seconde doctrine) et les lectures communes en vol.
 */
export interface CopilotPrecomputedTurn {
  access: ResourceAccessContext
  prefetch: CopilotSitePrefetch
}

// ── Préparation partagée ─────────────────────────────────────────────────────
//
// D1 (2026-08-16) : `askCopilotFreeAction` (Server Action) et le handler de
// route streamé appellent tous deux `prepareCopilotAnswer`. Elle porte tout
// ce qui ne dépend pas du transport — classification, résolution de sujet,
// chargement du contexte, moteurs déterministes — et s'arrête juste avant
// l'appel LLM. Les branches à réponse déterministe (clarification, proposition,
// verdict quantitatif…) sont déjà un `CopilotFreeResult` complet (`kind:
// 'result'`) : aucun transport n'a de LLM à appeler pour elles. Sinon
// (`kind: 'ready'`), l'appelant choisit son transport (`answerCopilotFreeQuestion`
// ou `answerCopilotFreeQuestionStream`) puis referme le pipeline via `finish`,
// identique quel que soit le transport — c'est ce qui interdit toute divergence
// de comportement entre les deux.

/**
 * Diagnostic d'un segment P6-B — un par segment produit par `decomposeUtterance`,
 * routé par le déterministe seul (jamais `understandQuestion`/`mergeComprehension`,
 * cf. Arbitrage 1 d'`attemptP6MultiIntent`). `interactionId` permet la corrélation
 * ultérieure avec `copilot_interactions.proposal_status` (mandat Vincent, 2026-08-19
 * — source de vérité unique pour shown/confirmed/cancelled, jamais dupliquée ici).
 */
export interface P6SegmentDiag {
  index: number
  text: string
  intent: string
  confidence: string
  signals: string[]
  admissible: boolean
  rejectionReason: string | null
  resultKind: string | null
  proposalKind: string | null
  interactionId: string | null
}

/** Diagnostic de la tentative d'orchestration P6-B pour ce tour (jamais dupliqué ailleurs). */
export interface P6PipelineDiag {
  p6Attempted: boolean
  p6Ambiguous: boolean
  p6SegmentsCount: number
  p6Segments: P6SegmentDiag[]
  /** 'single' = P6-B jamais tenté (intent déterministe global = READ). */
  p6Decision: 'single' | 'multi' | 'mono_fallback'
  p6FallbackReason: string | null
  p6ProposalCount: number
}

const P6_NOT_ATTEMPTED: P6PipelineDiag = {
  p6Attempted: false,
  p6Ambiguous: false,
  p6SegmentsCount: 0,
  p6Segments: [],
  p6Decision: 'single',
  p6FallbackReason: null,
  p6ProposalCount: 0,
}

/**
 * Diagnostic des sorties anticipées avant tout calcul d'intent (paramètres
 * invalides, accès refusé) — aucune décision de pipeline n'a encore eu lieu.
 */
const EARLY_EXIT_DIAG: PreparedCopilotAnswerDiag = {
  det: 'n/a', merged: 'n/a', family: 'n/a', applied: '—', q: '', comp: 'null',
  detIntent: 'n/a', detConfidence: 'n/a', detSignals: [],
  mergedIntent: null, mergedConfidence: null, mergedSignals: null,
  comprehensionMode: null, comprehensionConfidence: null, comprehensionIntent: null,
  appliedRules: [],
  ...P6_NOT_ATTEMPTED,
}

/**
 * Données de routage propagées au client via SSE `diag` — diagnostic P3-B,
 * enrichi par le mandat Vincent (2026-08-19) pour reconstruire la décision
 * d'orchestration d'un tour (déterministe / compréhension / P6-B) sans dupliquer
 * le statut des propositions, qui reste porté par `copilot_interactions`.
 */
export interface PreparedCopilotAnswerDiag {
  det: string
  merged: string
  family: string
  applied: string
  q: string
  /** Ce que la couche de compréhension LLM a extrait de `q` — label + entités reconnues. */
  comp: string
  detIntent: string
  detConfidence: string
  detSignals: string[]
  /** `null` quand la compréhension/fusion n'a pas tourné pour ce tour (P6-B multi). */
  mergedIntent: string | null
  mergedConfidence: string | null
  mergedSignals: string[] | null
  comprehensionMode: string | null
  comprehensionConfidence: string | null
  comprehensionIntent: string | null
  /** Version tableau de `applied` — `applied` (string jointe) reste inchangé pour les lecteurs existants. */
  appliedRules: string[]
  p6Attempted: boolean
  p6Ambiguous: boolean
  p6SegmentsCount: number
  p6Segments: P6SegmentDiag[]
  p6Decision: 'single' | 'multi' | 'mono_fallback'
  p6FallbackReason: string | null
  p6ProposalCount: number
}

/**
 * Construit le diagnostic enrichi à partir des mêmes données que `traceBase` —
 * un seul point de construction pour les trois sites de retour de
 * `prepareCopilotAnswer` (P6-B multi, écriture mono, lecture/LLM), afin qu'aucun
 * ne diverge du contrat ci-dessus.
 */
function buildPipelineDiag(args: {
  question: string
  deterministicIntent: IntentResult
  comprehension: Comprehension | null
  merged: ComprehensionMerge | null
  classification: ReturnType<typeof classifyIntent>
  p6: P6PipelineDiag
}): PreparedCopilotAnswerDiag {
  const { question, deterministicIntent, comprehension, merged, classification, p6 } = args
  return {
    det: `${deterministicIntent.intent}/${deterministicIntent.confidence}`,
    merged: merged ? merged.intentResult.intent : deterministicIntent.intent,
    family: classification.primary,
    applied: merged ? (merged.applied.join('+') || '—') : '—',
    q: question.slice(0, 120),
    comp: comprehension ? `${comprehension.label}[${comprehension.entities.join(',')}]` : 'null',
    detIntent: deterministicIntent.intent,
    detConfidence: deterministicIntent.confidence,
    detSignals: deterministicIntent.signals,
    mergedIntent: merged ? merged.intentResult.intent : null,
    mergedConfidence: merged ? merged.intentResult.confidence : null,
    mergedSignals: merged ? merged.intentResult.signals : null,
    comprehensionMode: comprehension?.mode ?? null,
    comprehensionConfidence: comprehension?.confidence ?? null,
    comprehensionIntent: comprehension?.intent ?? null,
    appliedRules: merged ? merged.applied : [],
    ...p6,
  }
}

export interface PreparedCopilotAnswerReady {
  kind: 'ready'
  question: string
  history: HistoryMessage[]
  items: CopilotItem[]
  subjectDetails: SubjectDetailContext[]
  delta: SiteCopilotDelta | null
  filteredPrep: { label: string; stableKey: string }[]
  siteName: string
  extra: FreeAnswerContext
  /** Routage retenu — propagé en SSE `diag` pour traçabilité terrain. */
  _diag: PreparedCopilotAnswerDiag
  /** Referme le pipeline (références, télémétrie, trace, diag) — commun aux deux transports. */
  finish: (answer: FreeAnswer, answerStartAt: number) => Promise<CopilotFreeResult>
}

export type PreparedCopilotAnswer =
  | { kind: 'result'; result: CopilotFreeResult; _diag: PreparedCopilotAnswerDiag }
  | PreparedCopilotAnswerReady

type ResolveWriteBranchParams = {
  question: string
  classification: ReturnType<typeof classifyIntent>
  intentResult: ReturnType<typeof detectIntent>
  selectedCandidateId: string | undefined
  resolvedSubjectIds: string[]
  siteId: string
  userId: string | null
  organizationId: string | null
  conversationId: string | undefined
  t0: number
  traceBase: Record<string, unknown>
  prefetchSource: CopilotSitePrefetch | null
}

// Extrait de `prepareCopilotAnswer` (mandat P6-B, Vincent 2026-08-19) : porte
// TOUTE la branche d'écriture mono-intent, verbatim, pour être réutilisable à
// la fois par le pipeline mono (appel unique ci-dessous) et par l'orchestration
// multi-segment P6-B (un appel par segment admissible). Aucune ligne de logique
// métier n'a été modifiée pendant l'extraction — seul le paramétrage a changé.
async function resolveWriteBranch(params: ResolveWriteBranchParams): Promise<{ kind: 'result'; result: CopilotFreeResult }> {
  const {
    question, classification, intentResult, selectedCandidateId, resolvedSubjectIds,
    siteId, userId, organizationId, conversationId, t0, traceBase, prefetchSource,
  } = params

  if (intentResult.intent !== 'READ') {
    // Sortie anticipée : aucune donnée du chantier n'est chargée au-delà de ce
    // point. C'est ici, et nulle part ailleurs, qu'une question de préparation
    // de visite peut devenir un formulaire.
    // `speculationDiscarded` rend le coût de la spéculation comptable en
    // production : c'est le seul chemin où des lectures sont lancées puis
    // jamais consommées (y compris celles de la route vocale).
    console.log('[copilot-trace] write', JSON.stringify({
      ...traceBase, branch: intentResult.intent, speculationDiscarded: prefetchSource !== null,
    }))

    // ── Verrou sémantique commun (Vincent 2026-08-19, suite trou de sûreté P6-B) ──
    // Jusqu'ici hasWriteBlockingSemanticSignal n'était vérifié que dans la
    // branche FACT (ci-dessous, désormais retirée car redondante) et dans
    // isP6MultiSegmentAdmissible (P6-B, par segment). Un repli mono après
    // échec du décomposeur (`ambiguous_decomposition`) agrège plusieurs actes
    // de langage dans un seul IntentResult — le nom de l'intent final
    // (CREATE_ACTION, CREATE_WATCHPOINT…) ne dit alors plus si le TEXTE
    // envoyé ici est sûr. « Je ne considère pas que R4 est réglé. Crée une
    // action pour vérifier la grille demain. » sort du routeur en
    // CREATE_ACTION/strong tout en portant negated_assertion_claim : sans ce
    // verrou, la branche catch-all (plus bas) construisait une proposition
    // sur la phrase entière, négation comprise. Le signal ne dit pas
    // « cette phrase contient une négation », il dit « l'unité de texte
    // actuellement évaluée ne doit pas être réinterprétée comme une
    // commande » — donc le verrou porte sur l'entrée de resolveWriteBranch,
    // avant toute branche métier, quel que soit intentResult.intent.
    if (hasWriteBlockingSemanticSignal(intentResult.signals)) {
      const text = "J'ai compris votre remarque, mais je n'ai rien enregistré : une partie de cette formulation rejette une affirmation plutôt que de la confirmer."
      return {
        kind: 'result',
        result: { kind: 'answer', text, references: [], source: 'fallback', interactionId: null, spokenText: spokenFromShortAnswer(text) },
      }
    }

    // ── Intention non supportée (réserve, échéance…) ou ambiguë → clarification ──
    if (intentResult.intent === 'UNKNOWN_WRITE') {
      const hasUnsupported = intentResult.signals.includes('unsupported_object')
      const clarText = hasUnsupported
        ? "Cette commande n'est pas encore disponible via le Copilote. Vous pouvez créer une action ou ajouter un point au plan de votre prochaine visite."
        : "Je n'ai pas bien compris votre intention. Souhaitez-vous créer une action, ajouter un point au plan de visite, ou planifier une visite / réunion ?"
      return { kind: 'result', result: { kind: 'answer', text: clarText, references: [], source: 'fallback', interactionId: null, spokenText: spokenFromShortAnswer(clarText) } }
    }

    // ── Planification (SCHEDULE_VISIT / SCHEDULE_MEETING) ──────────────────
    if (intentResult.intent === 'SCHEDULE_VISIT' || intentResult.intent === 'SCHEDULE_MEETING') {
      const proposalKind = intentResult.intent === 'SCHEDULE_VISIT' ? 'schedule_visit' : 'schedule_meeting'
      const parsed = parseScheduleFromQuestion(question)
      const eventLabel = proposalKind === 'schedule_visit' ? 'visite' : 'réunion'

      if (!parsed) {
        // Pas de date trouvée → demander une précision (pas de brouillon).
        return {
          kind: 'result',
          result: {
            kind: 'answer',
            text: `Pour planifier une ${eventLabel}, précisez la date et l'heure.\nEx. : « Planifie une ${eventLabel} le 12 août à 9h »`,
            references: [],
            source: 'fallback',
            interactionId: null,
          },
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
        kind: 'result',
        result: {
          kind: 'proposal',
          text: `Voici le brouillon pour planifier cette ${eventLabel}. Vérifiez et ajustez avant de valider.`,
          proposal,
          interactionId: iid,
        },
      }
    }

    // ── OBSERVATION ──────────────────────────────────────────────────────────
    // Constat terrain daté implicitement à aujourd'hui. Contrairement à action/
    // visit_item, canonical_subject_occurrence.canonical_subject_id est NOT NULL
    // en base (mig 291) : un constat sans sujet résolu avec certitude ne peut
    // pas devenir un brouillon confirmable, il faut le dire plutôt que produire
    // une proposition qui échouera à la confirmation.
    if (intentResult.intent === 'OBSERVATION') {
      let obsSubjectId: string | null = null
      let obsSubjectLabel: string | null = null
      let obsResolvedWithConfidence = false

      if (selectedCandidateId) {
        // Correction locale du tour (P4-B.1) : l'utilisateur vient de trancher
        // une clarification déjà posée — pas de nouvelle résolution lexicale,
        // sinon on retomberait sur la même ambiguïté (ex. « cadenas »).
        obsSubjectId = selectedCandidateId
        obsResolvedWithConfidence = true
        const labels = await getCanonicalSubjectLabelsByIds([selectedCandidateId])
        obsSubjectLabel = labels[selectedCandidateId] ?? null
      } else if (classification.entities.subjectLabels.length > 0) {
        const resolution = await resolveCanonicalSubjectReference(siteId, classification.entities.subjectLabels[0])
        if (resolution.kind === 'resolved') {
          obsSubjectId = resolution.candidate.id
          obsSubjectLabel = resolution.candidate.label
          obsResolvedWithConfidence = true
        } else if (resolution.kind === 'ambiguous') {
          const labels = resolution.candidates.map((c) => `• ${c.label}`).join('\n')
          const iid = await logCopilotInteraction({
            siteId, userId, conversationId: conversationId ?? null,
            question, conversationMode: 'free',
            primaryIntent: 'proposal_request', secondaryIntents: [],
            scope: 'canonical_subject', resolvedSubjectIds: [],
            answerText: null, answerMode: 'clarification', answerStatus: 'ambiguous',
            citedReferenceCount: 0, sourcesUsed: [],
            model: null, promptVersion: null, inputTokens: null, outputTokens: null,
            estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
          })
          return {
            kind: 'result',
            result: {
              kind: 'clarification',
              text: `Plusieurs sujets correspondent à ce constat. Lequel souhaitez-vous associer ?\n\n${labels}`,
              candidates: resolution.candidates,
              interactionId: iid,
            },
          }
        }
      }

      // Aucun sujet résolu avec certitude → pas de brouillon (contrainte NOT NULL
      // en base), on l'explique plutôt que de proposer une confirmation vouée à échouer.
      if (!obsSubjectId) {
        const iid = await logCopilotInteraction({
          siteId, userId, conversationId: conversationId ?? null,
          question, conversationMode: 'free',
          primaryIntent: 'proposal_request', secondaryIntents: [],
          scope: 'canonical_subject', resolvedSubjectIds: [],
          answerText: null, answerMode: 'clarification', answerStatus: 'not_found',
          citedReferenceCount: 0, sourcesUsed: [],
          model: null, promptVersion: null, inputTokens: null, outputTokens: null,
          estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        })
        const clarText = "Je n'ai pas identifié avec certitude le sujet concerné par ce constat. Précisez de quel élément du chantier il s'agit."
        return { kind: 'result', result: { kind: 'answer', text: clarText, references: [], source: 'fallback', interactionId: iid, spokenText: spokenFromShortAnswer(clarText) } }
      }

      const proposal = buildObservationProposal({
        question,
        canonicalSubjectId: obsSubjectId,
        canonicalSubjectLabel: obsSubjectLabel,
        resolvedWithConfidence: obsResolvedWithConfidence,
        actorLabel: classification.entities.actorLabels[0] ?? null,
      })

      const iid = await logCopilotInteraction({
        siteId, userId, conversationId: conversationId ?? null,
        question, conversationMode: 'free',
        primaryIntent: 'proposal_request', secondaryIntents: [],
        scope: 'canonical_subject',
        resolvedSubjectIds: [obsSubjectId],
        answerText: null, answerMode: 'deterministic_fallback', answerStatus: 'answered',
        citedReferenceCount: 0, sourcesUsed: [],
        model: null, promptVersion: null, inputTokens: null, outputTokens: null,
        estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        proposalKind: proposal.kind,
        proposalId: proposal.proposalId,
        proposalStatus: 'shown',
      })

      return {
        kind: 'result',
        result: {
          kind: 'proposal',
          text: `Voici le constat que je propose d'enregistrer. Vérifiez et ajustez avant de valider.`,
          proposal,
          interactionId: iid,
        },
      }
    }

    // ── FACT ─────────────────────────────────────────────────────────────────
    // Information déclarative à retenir (P4-C). Contrairement à OBSERVATION,
    // canonical_subject_id n'est PAS exigé en V1 (cadrage Vincent) : la
    // résolution de sujet est tentée à titre d'enrichissement, jamais bloquante
    // — une ambiguïté ou une absence de résolution laisse simplement le
    // brouillon sans sujet associé plutôt que de redemander une clarification.
    //
    // La garde negated_assertion_claim/negated_write_verb (ex-P4-C, ex-ligne
    // dédiée ici) est désormais le verrou commun en tête de fonction — cette
    // branche n'est atteinte que lorsque intentResult.signals ne porte aucun
    // signal bloquant.
    if (intentResult.intent === 'FACT') {
      let factSubjectId: string | null = null
      let factSubjectLabel: string | null = null

      if (selectedCandidateId) {
        factSubjectId = selectedCandidateId
        const labels = await getCanonicalSubjectLabelsByIds([selectedCandidateId])
        factSubjectLabel = labels[selectedCandidateId] ?? null
      } else if (classification.entities.subjectLabels.length > 0) {
        const resolution = await resolveCanonicalSubjectReference(siteId, classification.entities.subjectLabels[0])
        if (resolution.kind === 'resolved') {
          factSubjectId = resolution.candidate.id
          factSubjectLabel = resolution.candidate.label
        }
        // ambiguous / not_found → pas de sujet, jamais de clarification bloquante ici.
      }

      const proposal = buildFactProposal({
        question,
        canonicalSubjectId: factSubjectId,
        canonicalSubjectLabel: factSubjectLabel,
      })

      const factScope: CopilotScope = factSubjectId ? 'canonical_subject' : 'site'
      const iid = await logCopilotInteraction({
        siteId, userId, conversationId: conversationId ?? null,
        question, conversationMode: 'free',
        primaryIntent: 'proposal_request', secondaryIntents: [],
        scope: factScope,
        resolvedSubjectIds: factSubjectId ? [factSubjectId] : [],
        answerText: null, answerMode: 'deterministic_fallback', answerStatus: 'answered',
        citedReferenceCount: 0, sourcesUsed: [],
        model: null, promptVersion: null, inputTokens: null, outputTokens: null,
        estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        proposalKind: proposal.kind,
        proposalId: proposal.proposalId,
        proposalStatus: 'shown',
      })

      return {
        kind: 'result',
        result: {
          kind: 'proposal',
          text: `Voici l'information que je propose de retenir. Choisissez sa nature et validez.`,
          proposal,
          interactionId: iid,
        },
      }
    }

    // ── CORRECTION_KNOWLEDGE ─────────────────────────────────────────────────
    // Correction/obsolescence explicite d'une information mémorisée (P5-F2b,
    // mandat Vincent 2026-08-17). Le routeur n'a détecté qu'un booléen sur
    // texte normalisé ; l'extraction (texte original) distingue ici le mode
    // (supersession vs archivage). Les candidats proposés sont les 5
    // `current_information` actives les plus récentes, SANS présélection —
    // l'utilisateur choisit sur la carte, jamais le LLM/routeur. `body: null`
    // en sortie de extraction : la fiche reprend la phrase entière comme titre
    // éditable, l'humain corrige avant de valider (même doctrine que FACT).
    if (intentResult.intent === 'CORRECTION_KNOWLEDGE') {
      const extraction = extractKnowledgeCorrection(question)
      if (!extraction) {
        const clarText = "Je n'ai pas compris cette correction. Reformulez, par exemple : « Correction, Jérôme passe lundi » ou « Cette information n'est plus valable. »"
        return { kind: 'result', result: { kind: 'answer', text: clarText, references: [], source: 'fallback', interactionId: null, spokenText: spokenFromShortAnswer(clarText) } }
      }

      const candidateEntries = await listRecentCurrentInformationEntries(siteId)
      const knowledgeCandidates = candidateEntries.map((c) => ({
        id: c.id,
        title: c.title,
        body: c.body,
        confirmedAt: c.confirmedAt,
      }))

      const proposal = extraction.mode === 'supersede'
        ? buildKnowledgeSupersessionProposal({ newTitle: extraction.newTitle, candidates: knowledgeCandidates })
        : buildKnowledgeArchiveProposal({ candidates: knowledgeCandidates })

      const iid = await logCopilotInteraction({
        siteId, userId, conversationId: conversationId ?? null,
        question, conversationMode: 'free',
        primaryIntent: 'proposal_request', secondaryIntents: [],
        scope: 'site', resolvedSubjectIds: [],
        answerText: null, answerMode: 'deterministic_fallback', answerStatus: 'answered',
        citedReferenceCount: 0, sourcesUsed: [],
        model: null, promptVersion: null, inputTokens: null, outputTokens: null,
        estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        proposalKind: proposal.kind,
        proposalId: proposal.proposalId,
        proposalStatus: 'shown',
      })

      return {
        kind: 'result',
        result: {
          kind: 'proposal',
          text: extraction.mode === 'supersede'
            ? "Voici la nouvelle information. Choisissez quelle information actuelle elle remplace, ou indiquez qu'aucune ne correspond."
            : 'Choisissez quelle information actuelle marquer comme obsolète.',
          proposal,
          interactionId: iid,
        },
      }
    }

    // ── CREATE_WATCHPOINT ────────────────────────────────────────────────────
    // Vigilance durable sans échéance ni ancrage sur la prochaine visite
    // (P4-E1). Même doctrine que FACT : la résolution de sujet canonique est
    // tentée à titre d'enrichissement d'affichage, jamais bloquante — une
    // ambiguïté ou une absence de résolution laisse le brouillon sans sujet
    // associé plutôt que de redemander une clarification. Le statut naît et
    // reste 'active' : la fermeture est un geste humain hors périmètre ici.
    if (intentResult.intent === 'CREATE_WATCHPOINT') {
      let watchpointSubjectId: string | null = null
      let watchpointSubjectLabel: string | null = null

      if (selectedCandidateId) {
        watchpointSubjectId = selectedCandidateId
        const labels = await getCanonicalSubjectLabelsByIds([selectedCandidateId])
        watchpointSubjectLabel = labels[selectedCandidateId] ?? null
      } else if (classification.entities.subjectLabels.length > 0) {
        const resolution = await resolveCanonicalSubjectReference(siteId, classification.entities.subjectLabels[0])
        if (resolution.kind === 'resolved') {
          watchpointSubjectId = resolution.candidate.id
          watchpointSubjectLabel = resolution.candidate.label
        }
        // ambiguous / not_found → pas de sujet, jamais de clarification bloquante ici.
      }

      const proposal = buildWatchpointProposal({
        question,
        canonicalSubjectId: watchpointSubjectId,
        canonicalSubjectLabel: watchpointSubjectLabel,
      })

      const watchpointScope: CopilotScope = watchpointSubjectId ? 'canonical_subject' : 'site'
      const iid = await logCopilotInteraction({
        siteId, userId, conversationId: conversationId ?? null,
        question, conversationMode: 'free',
        primaryIntent: 'proposal_request', secondaryIntents: [],
        scope: watchpointScope,
        resolvedSubjectIds: watchpointSubjectId ? [watchpointSubjectId] : [],
        answerText: null, answerMode: 'deterministic_fallback', answerStatus: 'answered',
        citedReferenceCount: 0, sourcesUsed: [],
        model: null, promptVersion: null, inputTokens: null, outputTokens: null,
        estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        proposalKind: proposal.kind,
        proposalId: proposal.proposalId,
        proposalStatus: 'shown',
      })

      return {
        kind: 'result',
        result: {
          kind: 'proposal',
          text: `Voici le point de vigilance que je propose d'enregistrer. Validez pour le retenir.`,
          proposal,
          interactionId: iid,
        },
      }
    }

    // ── CREATE_DEADLINE ──────────────────────────────────────────────────────
    // Obligation sur un état + contrainte temporelle explicite (P4-E2). Même
    // doctrine que FACT/WATCHPOINT : la résolution de sujet canonique est un
    // enrichissement d'affichage tenté à titre indicatif, jamais bloquant.
    // Aucun `subject_id` n'est écrit — `createSiteDeadline` n'expose pas ce
    // paramètre (audit p4-e2-audit-deadline).
    if (intentResult.intent === 'CREATE_DEADLINE') {
      let deadlineSubjectId: string | null = null
      let deadlineSubjectLabel: string | null = null

      if (selectedCandidateId) {
        deadlineSubjectId = selectedCandidateId
        const labels = await getCanonicalSubjectLabelsByIds([selectedCandidateId])
        deadlineSubjectLabel = labels[selectedCandidateId] ?? null
      } else if (classification.entities.subjectLabels.length > 0) {
        const resolution = await resolveCanonicalSubjectReference(siteId, classification.entities.subjectLabels[0])
        if (resolution.kind === 'resolved') {
          deadlineSubjectId = resolution.candidate.id
          deadlineSubjectLabel = resolution.candidate.label
        }
        // ambiguous / not_found → pas de sujet, jamais de clarification bloquante ici.
      }

      const proposal = buildDeadlineProposal({
        question,
        canonicalSubjectId: deadlineSubjectId,
        canonicalSubjectLabel: deadlineSubjectLabel,
      })

      const deadlineScope: CopilotScope = deadlineSubjectId ? 'canonical_subject' : 'site'
      const iid = await logCopilotInteraction({
        siteId, userId, conversationId: conversationId ?? null,
        question, conversationMode: 'free',
        primaryIntent: 'proposal_request', secondaryIntents: [],
        scope: deadlineScope,
        resolvedSubjectIds: deadlineSubjectId ? [deadlineSubjectId] : [],
        answerText: null, answerMode: 'deterministic_fallback', answerStatus: 'answered',
        citedReferenceCount: 0, sourcesUsed: [],
        model: null, promptVersion: null, inputTokens: null, outputTokens: null,
        estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        proposalKind: proposal.kind,
        proposalId: proposal.proposalId,
        proposalStatus: 'shown',
      })

      return {
        kind: 'result',
        result: {
          kind: 'proposal',
          text: `Voici l'échéance que je propose d'enregistrer. Validez pour la retenir.`,
          proposal,
          interactionId: iid,
        },
      }
    }

    // ── CREATE_RESERVE ───────────────────────────────────────────────────────
    // Intention explicite de créer une réserve (P4-E3). Même doctrine que
    // WATCHPOINT/DEADLINE : la résolution de sujet canonique est un
    // enrichissement d'affichage tenté à titre indicatif, jamais bloquant.
    // Aucune gravité inventée, aucune due_date, aucun responsable personne.
    if (intentResult.intent === 'CREATE_RESERVE') {
      let reserveSubjectId: string | null = null
      let reserveSubjectLabel: string | null = null

      if (selectedCandidateId) {
        reserveSubjectId = selectedCandidateId
        const labels = await getCanonicalSubjectLabelsByIds([selectedCandidateId])
        reserveSubjectLabel = labels[selectedCandidateId] ?? null
      } else if (classification.entities.subjectLabels.length > 0) {
        const resolution = await resolveCanonicalSubjectReference(siteId, classification.entities.subjectLabels[0])
        if (resolution.kind === 'resolved') {
          reserveSubjectId = resolution.candidate.id
          reserveSubjectLabel = resolution.candidate.label
        }
        // ambiguous / not_found → pas de sujet, jamais de clarification bloquante ici.
      }

      const proposal = buildReserveProposal({
        question,
        canonicalSubjectId: reserveSubjectId,
        canonicalSubjectLabel: reserveSubjectLabel,
      })

      const reserveScope: CopilotScope = reserveSubjectId ? 'canonical_subject' : 'site'
      const iid = await logCopilotInteraction({
        siteId, userId, conversationId: conversationId ?? null,
        question, conversationMode: 'free',
        primaryIntent: 'proposal_request', secondaryIntents: [],
        scope: reserveScope,
        resolvedSubjectIds: reserveSubjectId ? [reserveSubjectId] : [],
        answerText: null, answerMode: 'deterministic_fallback', answerStatus: 'answered',
        citedReferenceCount: 0, sourcesUsed: [],
        model: null, promptVersion: null, inputTokens: null, outputTokens: null,
        estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        proposalKind: proposal.kind,
        proposalId: proposal.proposalId,
        proposalStatus: 'shown',
      })

      return {
        kind: 'result',
        result: {
          kind: 'proposal',
          text: `Voici la réserve que je propose d'enregistrer. Validez pour la retenir.`,
          proposal,
          interactionId: iid,
        },
      }
    }

    // ── CORRECTION_IDENTITY ──────────────────────────────────────────────────
    // « Quand je dis X, je parle de Y » — enseigner qu'une mention désigne un
    // acteur existant (company OU company_contact), P4-B.2. La cible n'est
    // JAMAIS créée ici : seule une résolution vers une identité déjà en base
    // produit un brouillon ; sinon on l'explique plutôt que d'halluciner un
    // acteur. `organizationId` vient de `requireSiteAccess`/l'accès précalculé,
    // jamais d'une valeur transmise par le client.
    if (intentResult.intent === 'CORRECTION_IDENTITY') {
      const extraction = extractIdentityCorrection(question)
      if (!extraction) {
        const clarText = "Je n'ai pas compris cette correction d'identité. Reformulez, par exemple : « Quand je dis Clim Expert, je parle de Clim Expair »."
        return { kind: 'result', result: { kind: 'answer', text: clarText, references: [], source: 'fallback', interactionId: null, spokenText: spokenFromShortAnswer(clarText) } }
      }
      if (!organizationId) {
        return { kind: 'result', result: { kind: 'answer', text: 'Accès non autorisé.', references: [], source: 'fallback', interactionId: null } }
      }

      let target: ActorCandidate | null = null

      if (selectedCandidateId) {
        // Correction locale du tour (même court-circuit que OBSERVATION) : l'utilisateur
        // vient de trancher une ambiguïté déjà posée sur CETTE question.
        target = await resolveActorCandidateById(organizationId, selectedCandidateId)
      } else {
        const resolution = await resolveActorTarget(organizationId, extraction.target, extraction.targetOrg)
        if (resolution.kind === 'resolved') {
          target = resolution.candidate
        } else if (resolution.kind === 'ambiguous') {
          const labels = resolution.candidates.map((c) => `• ${c.label}`).join('\n')
          const iid = await logCopilotInteraction({
            siteId, userId, conversationId: conversationId ?? null,
            question, conversationMode: 'free',
            primaryIntent: 'proposal_request', secondaryIntents: [],
            scope: 'actor', resolvedSubjectIds: [],
            answerText: null, answerMode: 'clarification', answerStatus: 'ambiguous',
            citedReferenceCount: 0, sourcesUsed: [],
            model: null, promptVersion: null, inputTokens: null, outputTokens: null,
            estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
          })
          return {
            kind: 'result',
            result: {
              kind: 'clarification',
              text: `Plusieurs acteurs correspondent à « ${extraction.target} ». Lequel souhaitez-vous désigner ?\n\n${labels}`,
              candidates: resolution.candidates.map((c) => ({ id: c.id, label: c.label })),
              interactionId: iid,
            },
          }
        }
      }

      if (!target) {
        const iid = await logCopilotInteraction({
          siteId, userId, conversationId: conversationId ?? null,
          question, conversationMode: 'free',
          primaryIntent: 'proposal_request', secondaryIntents: [],
          scope: 'actor', resolvedSubjectIds: [],
          answerText: null, answerMode: 'clarification', answerStatus: 'not_found',
          citedReferenceCount: 0, sourcesUsed: [],
          model: null, promptVersion: null, inputTokens: null, outputTokens: null,
          estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        })
        const clarText = `Je ne trouve aucun acteur correspondant à « ${extraction.target} » sur ce chantier.`
        return { kind: 'result', result: { kind: 'answer', text: clarText, references: [], source: 'fallback', interactionId: iid, spokenText: spokenFromShortAnswer(clarText) } }
      }

      const proposal = buildIdentityCorrectionProposal({
        alias: extraction.alias,
        targetKind: target.kind,
        targetId: target.id,
        targetLabel: target.label,
        proposedNature: extraction.proposedNature,
      })

      const iid = await logCopilotInteraction({
        siteId, userId, conversationId: conversationId ?? null,
        question, conversationMode: 'free',
        primaryIntent: 'proposal_request', secondaryIntents: [],
        scope: 'actor',
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
        kind: 'result',
        result: {
          kind: 'proposal',
          text: 'Voici la correspondance que je propose de retenir. Vérifiez et ajustez avant de valider.',
          proposal,
          interactionId: iid,
        },
      }
    }

    // ── RELATION_CLAIM ───────────────────────────────────────────────────────
    // « Le SSI dépend de la mise sous tension » (P4-D1, mandat Vincent
    // 2026-08-17). Réutilise STRICTEMENT canonical_subject_links (mig 316),
    // écrit directement en status='confirmed' (l'utilisateur affirme ET valide
    // lui-même la relation — pas une suggestion statistique du moteur P0-B1).
    //
    // Deux sujets à résoudre AVEC CERTITUDE (source ET cible), alors que le
    // protocole existant (selectedCandidateId singulier + resolvedSubjectIds
    // accumulé côté client, cf. OBSERVATION/CORRECTION_IDENTITY ci-dessus) n'a
    // qu'un seul emplacement de résolution par tour. Réutilisé SANS extension
    // (CLAUDE.md §5, aucun nouveau champ de protocole) : à chaque tour, un
    // syntagme ambigu est considéré tranché si l'un de ses candidats a déjà été
    // choisi lors d'un tour précédent (présent dans resolvedSubjectIds ou
    // selectedCandidateId) ; sinon on pose la clarification pour CE seul
    // syntagme et on s'arrête — jamais les deux clarifications à la fois. La
    // source est toujours résolue avant la cible, donc la clarification en
    // cours ne peut porter que sur le syntagme réellement en attente.
    if (intentResult.intent === 'RELATION_CLAIM') {
      const extraction = extractRelationClaim(question)
      if (!extraction) {
        const clarText = "Je n'ai pas compris cette relation. Reformulez, par exemple : « Le SSI dépend de la mise sous tension »."
        return { kind: 'result', result: { kind: 'answer', text: clarText, references: [], source: 'fallback', interactionId: null, spokenText: spokenFromShortAnswer(clarText) } }
      }

      const priorIds = new Set<string>(resolvedSubjectIds)
      if (selectedCandidateId) priorIds.add(selectedCandidateId)

      type SlotResolution =
        | { kind: 'resolved'; id: string; label: string }
        | { kind: 'ambiguous'; candidates: { id: string; label: string }[] }
        | { kind: 'not_found' }

      const resolveSlot = async (text: string): Promise<SlotResolution> => {
        const resolution = await resolveCanonicalSubjectReference(siteId, text)
        if (resolution.kind === 'resolved') {
          return { kind: 'resolved', id: resolution.candidate.id, label: resolution.candidate.label }
        }
        if (resolution.kind === 'ambiguous') {
          const already = resolution.candidates.find((c) => priorIds.has(c.id))
          if (already) return { kind: 'resolved', id: already.id, label: already.label }
          return { kind: 'ambiguous', candidates: resolution.candidates }
        }
        return { kind: 'not_found' }
      }

      const sourceResolution = await resolveSlot(extraction.sourceText)
      if (sourceResolution.kind === 'ambiguous') {
        const labels = sourceResolution.candidates.map((c) => `• ${c.label}`).join('\n')
        const iid = await logCopilotInteraction({
          siteId, userId, conversationId: conversationId ?? null,
          question, conversationMode: 'free',
          primaryIntent: 'proposal_request', secondaryIntents: [],
          scope: 'canonical_subject', resolvedSubjectIds: [],
          answerText: null, answerMode: 'clarification', answerStatus: 'ambiguous',
          citedReferenceCount: 0, sourcesUsed: [],
          model: null, promptVersion: null, inputTokens: null, outputTokens: null,
          estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        })
        return {
          kind: 'result',
          result: {
            kind: 'clarification',
            text: `Plusieurs sujets correspondent à « ${extraction.sourceText} ». Lequel souhaitez-vous désigner ?\n\n${labels}`,
            candidates: sourceResolution.candidates,
            interactionId: iid,
          },
        }
      }
      if (sourceResolution.kind === 'not_found') {
        const iid = await logCopilotInteraction({
          siteId, userId, conversationId: conversationId ?? null,
          question, conversationMode: 'free',
          primaryIntent: 'proposal_request', secondaryIntents: [],
          scope: 'canonical_subject', resolvedSubjectIds: [],
          answerText: null, answerMode: 'clarification', answerStatus: 'not_found',
          citedReferenceCount: 0, sourcesUsed: [],
          model: null, promptVersion: null, inputTokens: null, outputTokens: null,
          estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        })
        const clarText = `Je ne trouve aucun sujet correspondant à « ${extraction.sourceText} » sur ce chantier.`
        return { kind: 'result', result: { kind: 'answer', text: clarText, references: [], source: 'fallback', interactionId: iid, spokenText: spokenFromShortAnswer(clarText) } }
      }

      priorIds.add(sourceResolution.id)

      const targetResolution = await resolveSlot(extraction.targetText)
      if (targetResolution.kind === 'ambiguous') {
        const labels = targetResolution.candidates.map((c) => `• ${c.label}`).join('\n')
        const iid = await logCopilotInteraction({
          siteId, userId, conversationId: conversationId ?? null,
          question, conversationMode: 'free',
          primaryIntent: 'proposal_request', secondaryIntents: [],
          scope: 'canonical_subject', resolvedSubjectIds: [sourceResolution.id],
          answerText: null, answerMode: 'clarification', answerStatus: 'ambiguous',
          citedReferenceCount: 0, sourcesUsed: [],
          model: null, promptVersion: null, inputTokens: null, outputTokens: null,
          estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        })
        return {
          kind: 'result',
          result: {
            kind: 'clarification',
            text: `Plusieurs sujets correspondent à « ${extraction.targetText} ». Lequel souhaitez-vous désigner ?\n\n${labels}`,
            candidates: targetResolution.candidates,
            interactionId: iid,
          },
        }
      }
      if (targetResolution.kind === 'not_found') {
        const iid = await logCopilotInteraction({
          siteId, userId, conversationId: conversationId ?? null,
          question, conversationMode: 'free',
          primaryIntent: 'proposal_request', secondaryIntents: [],
          scope: 'canonical_subject', resolvedSubjectIds: [sourceResolution.id],
          answerText: null, answerMode: 'clarification', answerStatus: 'not_found',
          citedReferenceCount: 0, sourcesUsed: [],
          model: null, promptVersion: null, inputTokens: null, outputTokens: null,
          estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        })
        const clarText = `Je ne trouve aucun sujet correspondant à « ${extraction.targetText} » sur ce chantier.`
        return { kind: 'result', result: { kind: 'answer', text: clarText, references: [], source: 'fallback', interactionId: iid, spokenText: spokenFromShortAnswer(clarText) } }
      }

      if (sourceResolution.id === targetResolution.id) {
        const clarText = 'La source et la cible de cette relation semblent désigner le même sujet. Reformulez pour préciser les deux éléments concernés.'
        return { kind: 'result', result: { kind: 'answer', text: clarText, references: [], source: 'fallback', interactionId: null, spokenText: spokenFromShortAnswer(clarText) } }
      }

      const proposal = buildRelationClaimProposal({
        question,
        relationType: extraction.relationType,
        sourceSubjectId: sourceResolution.id,
        sourceSubjectLabel: sourceResolution.label,
        targetSubjectId: targetResolution.id,
        targetSubjectLabel: targetResolution.label,
      })

      const iid = await logCopilotInteraction({
        siteId, userId, conversationId: conversationId ?? null,
        question, conversationMode: 'free',
        primaryIntent: 'proposal_request', secondaryIntents: [],
        scope: 'canonical_subject',
        resolvedSubjectIds: [sourceResolution.id, targetResolution.id],
        answerText: null, answerMode: 'deterministic_fallback', answerStatus: 'answered',
        citedReferenceCount: 0, sourcesUsed: [],
        model: null, promptVersion: null, inputTokens: null, outputTokens: null,
        estimatedCostEur: null, latencyMs: Date.now() - t0, usedFallback: true,
        proposalKind: proposal.kind,
        proposalId: proposal.proposalId,
        proposalStatus: 'shown',
      })

      return {
        kind: 'result',
        result: {
          kind: 'proposal',
          text: `Voici la relation que je propose d'enregistrer. Vérifiez et ajustez avant de valider.`,
          proposal,
          interactionId: iid,
        },
      }
    }

    // ── Action / visit_item ─────────────────────────────────────────────────
    let canonicalSubjectId: string | null = null
    let canonicalSubjectLabel: string | null = null
    let resolvedWithConfidence = false

    if (selectedCandidateId) {
      // Correction locale du tour (P4-B.1) — même court-circuit que OBSERVATION.
      canonicalSubjectId = selectedCandidateId
      resolvedWithConfidence = true
      const labels = await getCanonicalSubjectLabelsByIds([selectedCandidateId])
      canonicalSubjectLabel = labels[selectedCandidateId] ?? null
    } else if (classification.entities.subjectLabels.length > 0) {
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
          kind: 'result',
          result: {
            kind: 'clarification',
            text: `Plusieurs sujets correspondent. Lequel souhaitez-vous associer à cette proposition ?\n\n${labels}`,
            candidates: resolution.candidates,
            interactionId: iid,
          },
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
      kind: 'result',
      result: {
        kind: 'proposal',
        text: `Voici le brouillon de ${kindLabel} que je propose. Vérifiez et ajustez avant de valider.`,
        proposal,
        interactionId: iid,
      },
    }
  }

  throw new Error("resolveWriteBranch: aucune branche n'a produit de resultat")
}

type AttemptP6MultiIntentParams = {
  question: string
  siteId: string
  userId: string | null
  organizationId: string | null
  conversationId: string | undefined
  t0: number
}

type AttemptP6MultiIntentResult = {
  outcome: { kind: 'result'; result: CopilotFreeResult } | null
  /** Toujours peuplé, succès ou repli — jamais un simple `null` (mandat télémétrie, 2026-08-19). */
  diag: P6PipelineDiag
}

/**
 * P6-B (mandat Vincent, 2026-08-19) — tentative d'orchestration multi-intent.
 *
 * Appelée UNE SEULE fois, depuis un unique site d'appel dans
 * `prepareCopilotAnswer`, avant la couche de compréhension. Ne rappelle
 * jamais `decomposeUtterance` ni elle-même : c'est une fonction en ligne
 * droite qui retourne soit un succès complet, soit `outcome: null` — jamais de
 * récursion, jamais de second appel au décomposeur pour cette requête.
 *
 * Arbitrage 1 : chaque segment n'est routé QUE par le déterministe
 * (`classifyIntent` + `detectIntent`, via `routeSegments`) — jamais par
 * `understandQuestion`/`mergeComprehension`, qui restent réservés au
 * pipeline mono.
 *
 * Arbitrage 2 (tout ou rien) : le moindre segment non admissible
 * (`isP6MultiSegmentAdmissible`) ou dont `resolveWriteBranch` ne produit pas
 * directement `kind: 'proposal'` (clarification, réponse, écriture non
 * supportée…) fait retourner `outcome: null` immédiatement — aucune
 * proposition partielle n'est jamais construite ni retournée. Le `diag`
 * accompagnant ce repli porte toujours la raison exacte, par segment.
 */
async function attemptP6MultiIntent(
  params: AttemptP6MultiIntentParams,
): Promise<AttemptP6MultiIntentResult> {
  const { question, siteId, userId, organizationId, conversationId, t0 } = params

  const decomposition = await decomposeUtterance(question)
  const routed = routeSegments(question, decomposition)
  const segmentDiags: P6SegmentDiag[] = routed.map((seg, i) => ({
    index: i,
    text: seg.text,
    intent: seg.intent.intent,
    confidence: seg.intent.confidence,
    signals: seg.intent.signals,
    admissible: isP6MultiSegmentAdmissible(seg.intent),
    rejectionReason: null,
    resultKind: null,
    proposalKind: null,
    interactionId: null,
  }))

  if (decomposition.ambiguous || decomposition.segments.length < 2) {
    return {
      outcome: null,
      diag: {
        p6Attempted: true,
        p6Ambiguous: decomposition.ambiguous,
        p6SegmentsCount: routed.length,
        p6Segments: segmentDiags,
        p6Decision: 'mono_fallback',
        p6FallbackReason: decomposition.ambiguous ? 'ambiguous_decomposition' : 'single_segment',
        p6ProposalCount: 0,
      },
    }
  }

  const firstNonAdmissible = segmentDiags.findIndex((s) => !s.admissible)
  if (firstNonAdmissible !== -1) {
    segmentDiags[firstNonAdmissible].rejectionReason = 'not_admissible'
    return {
      outcome: null,
      diag: {
        p6Attempted: true,
        p6Ambiguous: false,
        p6SegmentsCount: routed.length,
        p6Segments: segmentDiags,
        p6Decision: 'mono_fallback',
        p6FallbackReason: 'segment_not_admissible',
        p6ProposalCount: 0,
      },
    }
  }

  const proposals: Array<{
    text: string
    proposal: CopilotProposal
    interactionId: string | null
    segmentText: string
    segmentIndex: number
  }> = []

  for (let i = 0; i < routed.length; i++) {
    const seg = routed[i]
    const segClassification = classifyIntent(seg.text)
    const segTraceBase = {
      dpl: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      q: seg.text.slice(0, 80),
      det: `${seg.intent.intent}/${seg.intent.confidence}`,
      detSignals: seg.intent.signals.join('+') || '—',
      merged: seg.intent.intent,
      primary: segClassification.primary,
      p6bSegmentIndex: i,
      p6bSegmentCount: routed.length,
    }
    const outcome = await resolveWriteBranch({
      question: seg.text,
      classification: segClassification,
      intentResult: seg.intent,
      selectedCandidateId: undefined,
      resolvedSubjectIds: [],
      siteId,
      userId,
      organizationId,
      conversationId,
      t0,
      traceBase: segTraceBase,
      prefetchSource: null,
    })
    segmentDiags[i].resultKind = outcome.result.kind
    if (outcome.result.kind !== 'proposal') {
      segmentDiags[i].rejectionReason = 'resolution_not_proposal'
      return {
        outcome: null,
        diag: {
          p6Attempted: true,
          p6Ambiguous: false,
          p6SegmentsCount: routed.length,
          p6Segments: segmentDiags,
          p6Decision: 'mono_fallback',
          p6FallbackReason: 'segment_resolution_not_proposal',
          p6ProposalCount: 0,
        },
      }
    }
    segmentDiags[i].proposalKind = outcome.result.proposal.kind
    segmentDiags[i].interactionId = outcome.result.interactionId
    proposals.push({
      text: outcome.result.text,
      proposal: outcome.result.proposal,
      interactionId: outcome.result.interactionId,
      segmentText: seg.text,
      segmentIndex: i,
    })
  }

  console.log('[copilot-trace] p6b-multi', JSON.stringify({
    q: question.slice(0, 80),
    segments: routed.length,
    intents: routed.map((s) => `${s.intent.intent}/${s.intent.confidence}`),
  }))

  return {
    outcome: { kind: 'result', result: { kind: 'proposals', proposals } },
    diag: {
      p6Attempted: true,
      p6Ambiguous: false,
      p6SegmentsCount: routed.length,
      p6Segments: segmentDiags,
      p6Decision: 'multi',
      p6FallbackReason: null,
      p6ProposalCount: proposals.length,
    },
  }
}

export async function prepareCopilotAnswer(
  rawInput: unknown,
  precomputed?: CopilotPrecomputedTurn,
): Promise<PreparedCopilotAnswer> {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { kind: 'result', result: { kind: 'answer', text: 'Paramètres invalides.', references: [], source: 'fallback', interactionId: null }, _diag: EARLY_EXIT_DIAG }
  }
  const { siteId, question, history, resolvedSubjectIds, conversationId, selectedCandidateId, diag, rawTranscript, transcriptionCorrections, transcriptionAbstentions } = parsed.data
  const t0 = Date.now()
  const diagEnabled = diag || process.env.COPILOT_DIAG === '1'
  // Audit Copilote (brique 2) : route STT réellement empruntée pour ce tour.
  // `precomputed` n'est jamais fourni ailleurs que par la route vocale
  // audio→serveur (P2-C) ; sinon, `rawTranscript` distingue un tour vocal
  // Live (P3-B) d'une question tapée.
  const sttRoute: CopilotSttRoute = precomputed ? 'server_stt' : (rawTranscript ? 'client_live' : 'typed')

  // Le précalcul n'est accepté QUE s'il porte exactement ce chantier — un
  // décalage (bug d'appelant) le fait ignorer entièrement, et les gardes
  // normales reprennent. Jeter une spéculation ne coûte rien ; lui faire
  // confiance à tort coûterait le cloisonnement.
  const injected = precomputed
    && precomputed.access.resourceId === siteId
    && precomputed.prefetch.siteId === siteId
    ? precomputed
    : null

  // Vérification d'accès — l'utilisateur doit avoir accès au chantier.
  // Si la route vocale l'a déjà décidé via `resolveResourceAccess` (même
  // primitive que `requireSiteAccess`), on ne paie pas une seconde fois.
  // `organizationId` est retenu pour CORRECTION_IDENTITY (P4-B.2) : la
  // résolution d'acteur doit être bornée à l'organisation de l'utilisateur,
  // jamais à un organization_id fourni côté client.
  let organizationId: string | null = null
  if (!injected) {
    try {
      const access = await requireSiteAccess(siteId)
      organizationId = access.organizationId
    } catch {
      return { kind: 'result', result: { kind: 'answer', text: 'Accès non autorisé.', references: [], source: 'fallback', interactionId: null }, _diag: EARLY_EXIT_DIAG }
    }
  } else {
    organizationId = injected.access.organizationId
  }

  // Utilisateur courant (pour les prep items)
  let userId: string | null = null
  if (injected) {
    userId = injected.access.userId
  } else {
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      userId = user?.id ?? null
    } catch { /* non bloquant */ }
  }

  // ── P6-A2 : shadow mode decompose-v2 (mandat Vincent 2026-08-17) ────────────
  // Planifié ICI, avant toute branche : couvre uniformément les intents
  // d'écriture (retour anticipé plus bas) et de lecture (via `finish`), sans
  // dépendre de l'ID d'interaction réel (généré plus tard, par branche —
  // certaines n'en génèrent aucun). `after()` garantit qu'il ne retarde
  // jamais la réponse ; le rapprochement se fait par conversation_id.
  scheduleDecomposeShadow({ siteId, userId, organizationId, conversationId: conversationId ?? null, question })

  // ── Classification déterministe ───────────────────────────────────────────────
  const deterministicClassification = classifyIntent(question)
  const deterministicIntent = detectIntent(question)

  // ── P6-B : tentative d'orchestration multi-intent (mandat Vincent, 2026-08-19) ──
  // Positionnée ICI, avant `understandQuestion`/`mergeComprehension` (Arbitrage 1
  // interdit tout appel de compréhension par segment — routage 100% déterministe).
  //
  // Pré-filtre de latence : `deterministicIntent` porte déjà l'intent de la
  // phrase ENTIÈRE, et les signaux d'écriture balaient le texte en entier — un
  // texte classé READ au global ne peut donc contenir aucun segment d'écriture.
  // On évite ainsi l'appel LLM bloquant de `decomposeUtterance` (jusqu'à 2,5 s)
  // sur la majorité du trafic (lectures simples), sans jamais manquer un cas
  // multi-écriture réel. Coût zéro : `deterministicIntent` est déjà calculé.
  //
  // `decomposeUtterance` n'est appelé qu'UNE SEULE fois par requête, dans
  // `attemptP6MultiIntent` — jamais rappelé, jamais récursif (voir sa
  // documentation). Un échec à n'importe quelle étape retourne `null` et cette
  // branche ne modifie RIEN à l'état ci-dessous : le pipeline mono reprend sur
  // la phrase originale, exactement comme si P6-B n'avait pas été tenté.
  let p6Diag: P6PipelineDiag = P6_NOT_ATTEMPTED
  if (deterministicIntent.intent !== 'READ') {
    const { outcome, diag } = await attemptP6MultiIntent({ question, siteId, userId, organizationId, conversationId, t0 })
    p6Diag = diag
    if (outcome) {
      return {
        kind: 'result',
        result: outcome.result,
        _diag: buildPipelineDiag({
          question,
          deterministicIntent,
          comprehension: null,
          merged: null,
          classification: deterministicClassification,
          p6: p6Diag,
        }),
      }
    }
  }

  // ── Instrumentation de latence ────────────────────────────────────────────
  // Mandat Vincent (15/08) : « ne fais pas d'autre optimisation de latence à
  // l'aveugle ». Le badge `?voicedebug=1` mesure « texte → réponse » d'un seul
  // bloc ; ces marques disent ce qu'il y a DEDANS. Aucune décision produit n'en
  // dépend — c'est une trace, pas un moteur.
  const marks: Record<string, number> = {}
  function timed<T>(key: string, run: () => Promise<T>): Promise<T> {
    const t = Date.now()
    return run().then((v) => { marks[key] = Date.now() - t; return v })
  }

  // ── Chargement anticipé du contexte chantier ──────────────────────────────
  // La compréhension (appel LLM) et les read-models du chantier (DB) ne
  // dépendent pas l'un de l'autre : les enchaîner coûtait leur somme pour rien.
  // On lance donc ici les trois chargements INDÉPENDANTS de la classification ;
  // les deux qui en dépendent réellement (contexte acteur, vies de sujets)
  // restent après, inchangés. Mêmes fonctions, mêmes arguments, mêmes gardes
  // d'échec : seul l'instant du `await` change.
  //
  // Garde-fou : on anticipe dès qu'une LECTURE reste plausible — pas seulement
  // quand elle est certaine (`readRemainsPlausible`). Le cas mesuré en
  // production le 16/08 était exactement le contraire : « Quels sont les points
  // de la réunion de demain à évoquer ? » sortait du routeur en
  // SCHEDULE_MEETING/ambiguous, donc sans anticipation ; la compréhension la
  // requalifiait ensuite en lecture (`read_downgrade`), et le contexte ne
  // démarrait qu'après elle — 1729 ms d'attente au lieu de ~150.
  //
  // Une écriture `strong` (verbe de planification explicite, objet « action »)
  // ne redescend jamais en lecture : elle ne déclenche aucun chargement.
  // Une spéculation fausse coûte trois lectures jamais consommées — la branche
  // d'écriture sort avant de les lire — et RIEN d'autre : pas de cache, pas
  // d'état partagé, pas de contexte réutilisé d'un tour à l'autre.
  //
  // Un échec de chargement produit un overview VIDE, indiscernable d'un chantier
  // réellement sans signal. On trace donc l'échec : il interdit toute affirmation
  // quantitative ("aucune action en retard") — cf. resolveQuantitativeVerdict.
  let overviewLoadFailed = false
  // Même règle pour le briefing : il porte les compteurs de stagnation et le
  // delta terrain. En échec, ses mesures valent `null` — jamais zéro.
  let briefingLoadFailed = false

  const unwrapOverview = (r: Awaited<CopilotSitePrefetch['overview']>) => {
    if (!r.ok) { overviewLoadFailed = true; return emptySiteOverview(siteId) }
    return r.value
  }
  const unwrapBriefing = (r: Awaited<CopilotSitePrefetch['briefing']>) => {
    if (!r.ok) { briefingLoadFailed = true; return null }
    return r.value
  }

  const loadOverview = () => timed('overviewMs', () =>
    getSiteOverview(siteId).catch(() => { overviewLoadFailed = true; return emptySiteOverview(siteId) }))
  // buildVisitBriefing est l'agrégateur déjà utilisé par « Préparer ma visite ».
  // Le Copilote consomme LA MÊME intelligence plutôt que de reconstruire un
  // agrégat parallèle : une seule source, une seule vérité (arbitrage Vincent).
  const loadBriefing = () => timed('briefingMs', () =>
    buildVisitBriefing(siteId).catch(() => { briefingLoadFailed = true; return null }))
  const loadPrepItems = () => userId
    ? listActivePreparationItems(siteId, userId).catch(() => [])
    : Promise.resolve([])

  // Origine des temps du chargement métier : l'instant où la PREMIÈRE requête
  // part réellement, et non celui où on l'attend. La distinction est tout
  // l'objet de la mesure : en lecture les requêtes partent avant la
  // compréhension, et `contextWaitMs` seul ferait croire à une DB rapide alors
  // qu'elle a simplement eu le temps de finir pendant l'appel LLM léger.
  let contextStartAt = Date.now()
  const speculative = readRemainsPlausible(deterministicIntent)
  // P2-C : si la route vocale a déjà lancé les lectures pendant le STT, on les
  // réutilise — elles sont en vol depuis bien avant l'entrée dans cette
  // fonction. Sinon, elles démarrent ici, comme avant. Pour un tour injecté,
  // `overviewMs`/`briefingMs` mesurent l'attente RÉSIDUELLE (souvent ~0 si le
  // STT a tout masqué), et `contextStartAt` remonte au vrai départ.
  const prefetchSource: CopilotSitePrefetch | null =
    injected?.prefetch ?? (speculative ? startCopilotSitePrefetch(siteId, userId) : null)
  if (injected) contextStartAt = injected.prefetch.startedAt
  const prefetched = prefetchSource && speculative
    ? {
        overview: timed('overviewMs', () => prefetchSource.overview.then(unwrapOverview)),
        briefing: timed('briefingMs', () => prefetchSource.briefing.then(unwrapBriefing)),
        prepItems: prefetchSource.prepItems,
      }
    : null

  // ── Couche de compréhension (LLM léger, jamais de réponse ni d'écriture) ─────
  // Traduit une formulation orale imparfaite en structure. En cas de timeout,
  // d'erreur ou de JSON invalide → null, et le déterministe reprend la main
  // silencieusement (le Copilote doit rester fonctionnel sans LLM).
  const comprehension = await timed('comprehensionMs', () => understandQuestion(question))
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
    const outcome = await resolveWriteBranch({
      question, classification, intentResult, selectedCandidateId, resolvedSubjectIds,
      siteId, userId, organizationId, conversationId, t0, traceBase, prefetchSource,
    })
    return {
      kind: 'result',
      result: outcome.result,
      _diag: buildPipelineDiag({
        question,
        deterministicIntent,
        comprehension,
        merged,
        classification,
        p6: p6Diag,
      }),
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
      kind: 'result',
      result: {
        kind: 'answer',
        text: notFoundText,
        references: [],
        source: 'fallback',
        interactionId: iid,
        spokenText: spokenFromShortAnswer(notFoundText),
      },
      _diag: buildPipelineDiag({ question, deterministicIntent, comprehension, merged, classification, p6: p6Diag }),
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
      kind: 'result',
      result: {
        kind: 'clarification',
        text: clarText,
        candidates: clarificationCandidates,
        interactionId: iid,
      },
      _diag: buildPipelineDiag({ question, deterministicIntent, comprehension, merged, classification, p6: p6Diag }),
    }
  }

  // ── Chargement des données ────────────────────────────────────────────────────
  const needsActor = classification.primary === 'actor' || classification.secondary.includes('actor')

  // Les trois premiers sont déjà en vol depuis avant la compréhension quand
  // l'intention déterministe était une lecture — voire depuis le début du STT
  // pour un tour vocal ; sinon ils démarrent ici. Les deux suivants ne peuvent
  // pas être anticipés : ils dépendent des entités extraites par la
  // classification.
  if (!prefetched) contextStartAt = Date.now()
  const [overview, briefing, prepItemsRaw, actorContext, ...subjectLives] = await timed('contextWaitMs', () => Promise.all([
    prefetched?.overview ?? loadOverview(),
    prefetched?.briefing ?? loadBriefing(),
    prefetched?.prepItems ?? loadPrepItems(),
    // Outil actor — chargement paresseux
    needsActor
      ? getSiteActorContext(siteId, classification.entities.actorLabels).catch(() => [])
      : Promise.resolve([]),
    ...[...subjectIdsToLoad].map((id) =>
      getCanonicalSubjectLifeForSite(siteId, id).catch(() => null),
    ),
  ]))
  const contextReadyAt = Date.now()

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
      subjectsOpen:     briefingLoadFailed || !briefing ? null : briefing.subjectsOpen.length,
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
    // Verdict quantitatif : une phrase, déjà exacte — le meilleur cas oral qui soit.
    const qSpoken = spokenFromShortAnswer(quantitative.text)
    if (diagEnabled) {
      // Chemin sans LLM : le rapporter est indispensable, sinon la moyenne de
      // latence mélangerait deux régimes très différents et masquerait le fait
      // qu'une partie des questions ne coûte déjà plus rien en génération.
      console.log('[copilot-diag]', JSON.stringify({
        q: question.slice(0, 60), path: 'deterministic',
        request_received: 0,
        context_start: contextStartAt - t0,
        context_ready: contextReadyAt - t0,
        llm_start: null, llm_end: null, parse_end: null,
        response_returned: Date.now() - t0,
        contextMs: contextReadyAt - contextStartAt,
        llmMs: null, parseMs: null, model: null, tokensIn: null, tokensOut: null,
        contextChars: 0,
        textLength: quantitative.text.length,
        spokenLength: qSpoken?.length ?? 0,
        prefetch: prefetched !== null,
        ...marks,
      }))
    }
    return {
      kind: 'result',
      result: { kind: 'answer', text: quantitative.text, references: [], source: 'deterministic', interactionId: iid, spokenText: qSpoken },
      _diag: buildPipelineDiag({ question, deterministicIntent, comprehension, merged, classification, p6: p6Diag }),
    }
  }

  // Enrichissement sujets détaillés
  // P1-4C2E2 — vérité CBO autoritative (C2A) par sujet : le LLM l'explique, ne la recalcule pas.
  // Best-effort : en cas d'échec de la couche CBO, businessObjects reste vide (dégradation gracieuse).
  let cboBySubject = new Map<string, CboReducedEntry[]>()
  try { cboBySubject = await loadCboReducedBySubject(siteId) } catch { cboBySubject = new Map() }
  const subjectDetails = subjectLives
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .map((life) => buildSubjectDetailForCopilot(life, cboBySubject.get(life.canonicalSubjectId) ?? []))

  // ── Contexte 3B — modules chargés à la demande ───────────────────────────────
  const extra: FreeAnswerContext = {}
  // Garantie architecturale (Vincent 2026-08-18) : cette fonction n'atteint ce
  // point que sur la branche READ (retour anticipé ligne ~445 pour tout autre
  // intent) — mutationStatus vaut donc toujours 'none' ici, jamais déduit côté
  // prompt. neutralizedWrite signale au moteur de réponse qu'une négation a
  // désarmé une intention d'écriture (NEGATION_SCOPE), pour qu'il ne prétende
  // jamais avoir exécuté ce que le routeur a justement neutralisé.
  extra.mutationStatus = 'none'
  extra.neutralizedWrite = intentResult.signals.includes('negated_write_verb')

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

  // D10 — activités parallèles réelles : « qu'est-ce qui est en cours ? »
  // Chargé pour les questions de synthèse / timeline. Read-model déterministe
  // (débriefs terrain + objets ouverts) : le LLM énonce, ne recalcule pas, et
  // ne fabrique jamais une phase unique. Signalement « à reconfirmer » seulement.
  if (isGlobal || isTimeline) {
    const activity = await buildSiteActivityReadModel(siteId, {
      sinceLastVenueAt: briefing?.delta?.since ?? null,
    }).catch(() => null)
    if (activity && (
      activity.interventionStarted !== null
      || activity.activitiesInProgress.length > 0
      || activity.toReconfirm.length > 0
    )) {
      extra.activites = {
        interventionCommencee: activity.interventionStarted,
        jourIntervention: activity.dayIndex,
        enCours: activity.activitiesInProgress.map((a) => ({
          activite: a.label, depuis: a.proofDate, etat: a.status,
        })),
        demarreesRecemment: activity.activitiesStartedRecently.map((a) => ({
          activite: a.label, depuis: a.proofDate,
        })),
        aReconfirmer: activity.toReconfirm.map((o) => ({
          titre: o.title, ouvertDepuisJours: o.ageDays,
        })),
      }
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

  // ── Prêt pour l'appel LLM ──────────────────────────────────────────────────
  // Le transport (streamé ou non) et l'instant `answerStartAt` restent au choix
  // de l'appelant ; `finish` referme le pipeline à l'identique pour les deux.
  const siteName = overview.identity.name
  const finish = async (answer: FreeAnswer, answerStartAt: number): Promise<CopilotFreeResult> => {
    marks.answerMs = Date.now() - answerStartAt

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

    const d = answer.diagnostics
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
      model: d?.model ?? null, promptVersion: null,
      inputTokens: d?.tokensIn ?? null, outputTokens: d?.tokensOut ?? null,
      estimatedCostEur: null, latencyMs,
      usedFallback: answer.source === 'fallback',
      transcriptionRaw: rawTranscript ?? null,
      transcriptionCorrections: transcriptionCorrections ?? null,
      transcriptionAbstentions: transcriptionAbstentions ?? null,
      sttRoute,
      routingDiag: {
        det: traceBase.det,
        merged: intentResult.intent,
        family: classification.primary,
        applied: traceBase.applied,
        contextChars: d?.contextChars ?? null,
        finishReason: d?.finishReason ?? null,
      },
    })

    console.log('[copilot-trace] answer', JSON.stringify({
      ...traceBase,
      ui: 'answer',
      safeIntent,
      controls: extra.visitPlanDetail?.length ?? 0,
      source: answer.source,
      refs: references.length,
      latencyMs,
      // Décomposition serveur : `prefetch` dit si la compréhension et la DB ont
      // réellement tourné en parallèle, `contextWaitMs` ce qu'il restait à
      // attendre après elle. Sans ces deux nombres côte à côte, on ne peut pas
      // distinguer « la DB est lente » de « la DB a été attendue trop tard ».
      prefetch: prefetched !== null,
      // P2-C : `true` quand les lectures venaient de la route vocale (parties
      // pendant le STT) — c'est la preuve de recouvrement demandée au mandat.
      voiceOverlap: injected !== null,
      ...marks,
    }))

    // ── Décomposition serveur, fermée par défaut ──────────────────────────────
    // Sept jalons exprimés en ms DEPUIS la réception de la requête, pas en durées
    // isolées : c'est la seule forme qui montre les recouvrements. Les trois
    // derniers sont reconstruits depuis les mesures du fournisseur — le temps de
    // construction du prompt est ce qui reste entre l'entrée dans la fonction de
    // réponse et le départ réel vers Gemini.
    if (diagEnabled) {
      const answerEntry = answerStartAt - t0
      const promptMs = d ? Math.max(0, (marks.answerMs ?? 0) - d.llmMs - d.parseMs) : 0
      const llmStart = answerEntry + promptMs
      const llmEnd = llmStart + (d?.llmMs ?? 0)
      console.log('[copilot-diag]', JSON.stringify({
        q: question.slice(0, 60), path: answer.source,
        request_received: 0,
        context_start: contextStartAt - t0,
        context_ready: contextReadyAt - t0,
        llm_start: llmStart,
        llm_end: llmEnd,
        parse_end: llmEnd + (d?.parseMs ?? 0),
        response_returned: latencyMs,
        contextMs: contextReadyAt - contextStartAt,
        promptMs,
        llmMs: d?.llmMs ?? null,
        parseMs: d?.parseMs ?? null,
        model: d?.model ?? null,
        tokensIn: d?.tokensIn ?? null,
        tokensOut: d?.tokensOut ?? null,
        finishReason: d?.finishReason ?? null,
        contextChars: d?.contextChars ?? null,
        textLength: answer.text.length,
        spokenLength: answer.spokenText?.length ?? 0,
        prefetch: prefetched !== null,
        ...marks,
      }))
    }

    return { kind: 'answer', text: answer.text, references, source: answer.source, interactionId: iid, spokenText: answer.spokenText }
  }

  return {
    kind: 'ready',
    question,
    history,
    items,
    subjectDetails,
    delta,
    filteredPrep,
    siteName,
    extra,
    _diag: buildPipelineDiag({
      question,
      deterministicIntent,
      comprehension,
      merged,
      classification,
      p6: p6Diag,
    }),
    finish,
  }
}
