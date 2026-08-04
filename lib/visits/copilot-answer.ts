import 'server-only'

// Appel LLM pour le Copilote Phase 2 — lecture seule, sourcé.
// Contrat : le LLM reçoit un JSON déterministe et renvoie texte + ids cités.
// Les URLs ne sont JAMAIS générées par le LLM : elles viennent du contexte fermé.
// Fallback déterministe garanti si le provider échoue.

import { z } from 'zod'
import { getAIProvider } from '@/services/ai/factory'
import type { CopilotIntent, CopilotItem, SiteCopilotDelta } from './copilot-context'
import { buildFallbackText } from './copilot-context'

// Schéma de réponse structurée — le LLM renvoie UNIQUEMENT texte + ids fermés.
const AnswerSchema = z.object({
  text: z.string().max(1500),
  citedIds: z.array(z.string()),
})

// Schéma JSON natif passé à Gemini pour forcer la structure de sortie.
// Évite les variations de nommage (cited_ids vs citedIds) qui causent un fallback silencieux.
const ANSWER_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    citedIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'citedIds'],
}

const SYSTEM_PROMPT = `Tu es MemorIA Copilote, assistant de suivi de chantier.
Tu reçois un contexte JSON structuré, calculé de façon déterministe depuis les données du projet.

Règles absolues :
— Ne cite QUE les items présents dans le champ "items" du contexte (identifiés par leur "id").
— N'invente aucun statut, aucune cause, aucune résolution absente des faits.
— Un sujet absent du contexte n'existe pas pour toi.
— Ne génère jamais d'URL : renvoie uniquement les ids des items cités dans "citedIds".
— Un sujet absent d'un PV signifie "non mentionné dans ce PV", pas "résolu" ni "traité". Ne tire jamais la conclusion qu'il a été traité sans preuve explicite dans les faits.
— Les dépendances suggérées (non confirmées) ne sont jamais des vérités.
— Quand le contexte contient un delta (fromDate + toDate), mentionne toujours les deux bornes ("entre le PV du X et le PV du Y"), jamais seulement la date du PV de référence.
— Format : 2 à 4 paragraphes courts, prose directe, français professionnel.
— Champ "citedIds" : liste les ids des items réellement cités dans ta réponse.`

const INTENT_PROMPTS: Record<CopilotIntent, string> = {
  attention:
    "Quels sujets ou problèmes méritent l'attention du conducteur de travaux maintenant ? Explique brièvement pourquoi chaque sujet est prioritaire, en t'appuyant uniquement sur les faits du contexte.",
  changes:
    "Qu'est-ce qui a changé récemment sur ce chantier ? Appuie-toi sur le delta inter-PV et les changements récents présents dans le contexte.",
  stale:
    "Quels sujets traînent sans évolution sur ce chantier ? Identifie ce qui bloque ou stagne, uniquement à partir des données du contexte.",
  next_visit:
    "Que doit vérifier le conducteur à sa prochaine visite ? Prends en compte le plan de visite actif s'il existe, puis les sujets prioritaires à vérifier.",
}

export interface CopilotAnswer {
  text: string
  citedIds: string[]  // ids validés contre la liste fermée du contexte
  source: 'llm' | 'fallback'
}

export async function answerCopilotQuestion(
  items: CopilotItem[],
  intent: CopilotIntent,
  delta: SiteCopilotDelta | null,
  prepItems: { label: string; stableKey: string }[],
  siteName: string,
): Promise<CopilotAnswer> {
  const contextJson = JSON.stringify(
    {
      chantier: siteName,
      intent,
      items: items.map((i) => ({
        id: i.id,
        type: i.type,
        label: i.label,
        facts: i.facts,
      })),
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
      userMessage: `${INTENT_PROMPTS[intent]}\n\nContexte :\n${contextJson}`,
      responseSchema: AnswerSchema,
      geminiSchema: ANSWER_GEMINI_SCHEMA,
      modelTier: 'light',
      maxOutputTokens: 600,
    })

    if (result.parsed) {
      const maybeValid = AnswerSchema.safeParse(result.parsed)
      if (maybeValid.success) {
        // Validation des ids contre la liste fermée — le LLM ne peut pas inventer d'id
        const validIds = new Set(items.map((i) => i.id))
        const citedIds = maybeValid.data.citedIds.filter((id) => validIds.has(id))
        return { text: maybeValid.data.text, citedIds, source: 'llm' }
      }
      // Le JSON est là mais ne correspond pas au schéma attendu
      console.warn('[copilot] schema mismatch — parsed:', JSON.stringify(result.parsed).slice(0, 200))
    } else {
      console.warn('[copilot] result.parsed is null — raw text:', result.text.slice(0, 200))
    }

    return {
      text: buildFallbackText(items, intent, delta, prepItems),
      citedIds: [],
      source: 'fallback',
    }
  } catch (err) {
    // Provider IA indisponible (timeout, quota, réseau) → réponse déterministe utile
    console.error('[copilot] provider error:', err instanceof Error ? err.message : String(err))
    return {
      text: buildFallbackText(items, intent, delta, prepItems),
      citedIds: [],
      source: 'fallback',
    }
  }
}
