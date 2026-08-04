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
import { buildSiteCopilotContext, filterContextForIntent } from '@/lib/visits/copilot-context'
import { classifyIntent } from '@/lib/visits/copilot-classify'
import { resolveCanonicalSubjectReference } from '@/lib/db/canonical-subject-resolve'
import { getCanonicalSubjectLifeForSite } from '@/lib/db/canonical-subject-life'
import { buildSubjectDetailForCopilot } from '@/lib/visits/copilot-subject-context'
import { answerCopilotFreeQuestion } from '@/lib/visits/copilot-free-answer'
import type { FreeAnswerContext, RecentChangeContext, VisitPlanItemContext } from '@/lib/visits/copilot-free-answer'
import { getSiteActorContext } from '@/lib/db/site-actor-responsibilities'
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
      source: 'llm' | 'fallback'
    }
  | {
      kind: 'clarification'
      /** Texte de présentation des candidats (déterministe, pas de LLM) */
      text: string
      candidates: CopilotFreeCandidate[]
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
    return { kind: 'answer', text: 'Paramètres invalides.', references: [], source: 'fallback' }
  }
  const { siteId, question, history, resolvedSubjectIds } = parsed.data

  // Vérification d'accès — l'utilisateur doit avoir accès au chantier
  try {
    await requireSiteAccess(siteId)
  } catch {
    return { kind: 'answer', text: 'Accès non autorisé.', references: [], source: 'fallback' }
  }

  // Utilisateur courant (pour les prep items)
  let userId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  } catch { /* non bloquant */ }

  // ── Classification déterministe ───────────────────────────────────────────────
  const classification = classifyIntent(question)

  // Les écritures ne sont pas supportées en Phase 3 Lot 3A
  if (classification.isWriteRequest) {
    return {
      kind: 'write_not_supported',
      text: "Je peux analyser et répondre à vos questions sur ce chantier, mais la création d'actions ou d'éléments sera disponible dans une prochaine version. Pour l'instant, utilisez les écrans dédiés.",
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

  if (needsSubjectDetail && classification.entities.subjectLabels.length > 0) {
    // Résoudre chaque entité extraite — s'arrêter au premier ambiguous
    for (const label of classification.entities.subjectLabels) {
      // Pas besoin de résoudre si déjà dans resolvedSubjectIds (court-circuit utilisateur)
      const resolution = await resolveCanonicalSubjectReference(siteId, label)

      if (resolution.kind === 'resolved') {
        subjectIdsToLoad.add(resolution.candidate.id)
      } else if (resolution.kind === 'ambiguous') {
        // On retourne immédiatement la clarification — pas d'appel LLM
        clarificationCandidates.push(...resolution.candidates)
      }
      // not_found → sujet inconnu de la mémoire structurée
    }
  }

  // not_found déterministe : intent subject_detail avec entités extraites mais aucune résolue
  // → réponse directe sans LLM, sans références parasites
  const hasExtractedLabels = classification.entities.subjectLabels.length > 0
  const allLabelsUnresolved = hasExtractedLabels
    && subjectIdsToLoad.size === 0
    && clarificationCandidates.length === 0
  if (classification.primary === 'subject_detail' && allLabelsUnresolved) {
    const labels = classification.entities.subjectLabels.join(', ')
    return {
      kind: 'answer',
      text: `Je ne trouve aucun sujet correspondant à "${labels}" dans la mémoire structurée de ce chantier. Essayez avec le label exact ou un code technique (R4, G3, DN160…).`,
      references: [],
      source: 'fallback',
    }
  }

  if (clarificationCandidates.length > 0) {
    const labels = clarificationCandidates.map((c) => `• ${c.label}`).join('\n')
    return {
      kind: 'clarification',
      text: `Je trouve plusieurs sujets correspondant à votre question sur ce chantier. Lequel souhaitez-vous examiner ?\n\n${labels}`,
      candidates: clarificationCandidates,
    }
  }

  // ── Chargement des données ────────────────────────────────────────────────────
  const needsActor = classification.primary === 'actor' || classification.secondary.includes('actor')

  const [overview, prepItemsRaw, actorContext, ...subjectLives] = await Promise.all([
    getSiteOverview(siteId).catch(() => emptySiteOverview(siteId)),
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

  // Contexte de base Phase 2 (items + delta)
  const context = buildSiteCopilotContext(siteId, overview.identity.name, overview, prepItems)

  // Mapping intent primaire → filtre Phase 2
  const INTENT_FILTER_MAP: Record<string, 'attention' | 'changes' | 'stale' | 'next_visit'> = {
    timeline:      'changes',
    plan_visite:   'next_visit',
    action_status: 'attention',
    subject_detail:'attention',
    actor:         'attention',
    global:        'attention',
  }
  const safeIntent = INTENT_FILTER_MAP[classification.primary] ?? 'attention'
  const { items, delta, prepItems: filteredPrep } = filterContextForIntent(context, safeIntent)

  // Enrichissement sujets détaillés
  const subjectDetails = subjectLives
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .map(buildSubjectDetailForCopilot)

  // ── Contexte 3B — modules chargés à la demande ───────────────────────────────
  const extra: FreeAnswerContext = {}

  // Timeline : filtrer les changements récents à l'intervalle du delta
  // Ne remonter que les événements dont occurredAt est dans [fromDate, toDate].
  // Évite de présenter des signaux anciens comme des événements de l'intervalle.
  const needsTimeline = classification.primary === 'timeline' || classification.secondary.includes('timeline')
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

  // Actor : déjà chargé dans actorContext
  if (actorContext.length > 0) {
    extra.actorContext = actorContext
  }

  // Plan de visite : toujours définir visitPlanDetail pour intent plan_visite
  // (même vide → le LLM sait que le plan humain est vide et peut distinguer
  //  plan_utilisateur de recommandations_memoria)
  const needsPlan = safeIntent === 'next_visit'
  if (needsPlan) {
    extra.visitPlanDetail = overview.pvToVerify.map((v): VisitPlanItemContext => ({
      label: v.label,
      priority: 'normal',
      reason: null,
      signals: v.signals,
    }))
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

  return { kind: 'answer', text: answer.text, references, source: answer.source }
}
