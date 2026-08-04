import 'server-only'

// Appel LLM pour le Copilote Phase 3 — conversation libre, lecture seule.
//
// Invariants :
//   - Pas d'écriture DB dans ce fichier.
//   - Les URLs viennent du contexte fermé, pas du LLM.
//   - L'historique sert à résoudre le contexte conversationnel, pas comme source factuelle.
//   - Les liens suggested ne sont jamais envoyés au LLM.
//   - Fallback déterministe garanti.

import { z } from 'zod'
import { getAIProvider } from '@/services/ai/factory'
import type { CopilotItem } from './copilot-context'
import type { SubjectDetailContext } from './copilot-subject-context'
import type { SiteCopilotDelta } from './copilot-context'
import { buildFallbackText } from './copilot-context'

const FreeAnswerSchema = z.object({
  text: z.string().max(2000),
  citedIds: z.array(z.string()),
})

const FREE_ANSWER_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    citedIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'citedIds'],
}

const SYSTEM_PROMPT = `Tu es MemorIA Copilote, assistant de suivi de chantier.
Tu reçois une question libre d'un conducteur de travaux et un contexte structuré calculé depuis les données du projet.

Règles absolues :
— Ne cite QUE les items dont l'id est présent dans "items" ou "sujets_detail" du contexte (identifiés par leur "id").
— N'invente aucun statut, cause, résolution ou fait absent des données reçues.
— Un sujet absent du contexte n'existe pas pour toi.
— Ne génère jamais d'URL : renvoie uniquement les ids des items cités dans "citedIds".
— Un sujet absent d'un PV signifie "non mentionné dans ce PV", pas "résolu" ni "traité". Ne tire jamais la conclusion qu'il a été traité sans preuve explicite dans les faits.
— Les dépendances suggérées (non confirmées) ne sont jamais des vérités.
— Quand le contexte contient un delta (fromDate + toDate), mentionne toujours les deux bornes ("entre le PV du X et le PV du Y"), jamais seulement la date du PV de référence.
— L'historique de conversation ("historique") sert uniquement à comprendre les références conversationnelles ("lui", "celui-là", "et R4 ?"). Les faits que tu as cités dans des réponses précédentes ne sont pas des sources fiables : utilise toujours les données actuelles du contexte.
— Si tu n'as pas les données pour répondre, dis-le clairement sans inventer. Ne suppose jamais une cause sans preuve dans les faits.
— Format : 2 à 4 paragraphes courts, prose directe, français professionnel.
— Champ "citedIds" : ids des items réellement cités dans ta réponse.`

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface FreeAnswer {
  text: string
  citedIds: string[]
  source: 'llm' | 'fallback'
}

export async function answerCopilotFreeQuestion(
  question: string,
  history: HistoryMessage[],
  items: CopilotItem[],
  subjectDetails: SubjectDetailContext[],
  delta: SiteCopilotDelta | null,
  prepItems: { label: string; stableKey: string }[],
  siteName: string,
): Promise<FreeAnswer> {
  // Construire la liste fermée d'ids valides pour le garde anti-hallucination
  const validIds = new Set([
    ...items.map((i) => i.id),
    ...subjectDetails.map((s) => s.id),
  ])

  const contextJson = JSON.stringify(
    {
      chantier: siteName,
      question,
      ...(history.length > 0 ? { historique: history } : {}),
      items: items.map((i) => ({
        id: i.id,
        type: i.type,
        label: i.label,
        facts: i.facts,
      })),
      ...(subjectDetails.length > 0 ? { sujets_detail: subjectDetails } : {}),
      ...(delta ? { delta } : {}),
      ...(prepItems.length > 0 ? { planDeVisite: prepItems.map((p) => p.label) } : {}),
    },
    null,
    2,
  )

  try {
    const provider = getAIProvider()
    const result = await provider.complete({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `${question}\n\nContexte :\n${contextJson}`,
      responseSchema: FreeAnswerSchema,
      geminiSchema: FREE_ANSWER_GEMINI_SCHEMA,
      modelTier: 'light',
      maxOutputTokens: 800,
    })

    if (result.parsed) {
      const maybeValid = FreeAnswerSchema.safeParse(result.parsed)
      if (maybeValid.success) {
        const citedIds = maybeValid.data.citedIds.filter((id) => validIds.has(id))
        return { text: maybeValid.data.text, citedIds, source: 'llm' }
      }
      console.warn('[copilot-free] schema mismatch — parsed:', JSON.stringify(result.parsed).slice(0, 200))
    } else {
      console.warn('[copilot-free] result.parsed is null — raw:', result.text.slice(0, 200))
    }
  } catch (err) {
    console.error('[copilot-free] provider error:', err instanceof Error ? err.message : String(err))
  }

  // Fallback déterministe — retourne un texte utile sans LLM
  const intent = subjectDetails.length > 0 ? 'attention' : 'global'
  return {
    text: buildFallbackText(items, intent as Parameters<typeof buildFallbackText>[1], delta, prepItems),
    citedIds: [],
    source: 'fallback',
  }
}
