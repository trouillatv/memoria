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
      // not_found → on continue sans ce sujet (le LLM dira qu'il ne trouve pas)
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
  const [overview, prepItemsRaw, ...subjectLives] = await Promise.all([
    getSiteOverview(siteId).catch(() => emptySiteOverview(siteId)),
    userId
      ? listActivePreparationItems(siteId, userId).catch(() => [])
      : Promise.resolve([]),
    ...[...subjectIdsToLoad].map((id) =>
      getCanonicalSubjectLifeForSite(siteId, id).catch(() => null),
    ),
  ])

  const prepItems = prepItemsRaw.map((p) => ({ label: p.label, stableKey: p.stableKey }))

  // Contexte de base Phase 2 (items + delta)
  const context = buildSiteCopilotContext(siteId, overview.identity.name, overview, prepItems)

  // Pour les questions globales, filtrer selon l'intent primaire
  // Pour les sujets détaillés, passer le contexte complet (pas de filtre intent)
  const intentForFilter = (
    classification.primary === 'subject_detail' ? 'attention' : classification.primary
  ) as Parameters<typeof filterContextForIntent>[1]

  const safeIntent = ['attention', 'changes', 'stale', 'next_visit'].includes(intentForFilter)
    ? intentForFilter
    : 'attention'

  const { items, delta, prepItems: filteredPrep } = filterContextForIntent(context, safeIntent)

  // Enrichissement sujets détaillés
  const subjectDetails = subjectLives
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .map(buildSubjectDetailForCopilot)

  // ── Appel LLM ────────────────────────────────────────────────────────────────
  const answer = await answerCopilotFreeQuestion(
    question,
    history,
    items,
    subjectDetails,
    delta,
    filteredPrep,
    overview.identity.name,
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
