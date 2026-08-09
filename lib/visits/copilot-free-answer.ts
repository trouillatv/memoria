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
import type { ActorContext } from '@/lib/db/site-actor-responsibilities'

export interface RecentChangeContext {
  title: string
  occurredAt: string
  detail: string | null
}

export interface VisitPlanItemContext {
  label: string
  priority: string
  reason: string | null
  signals: string[]
}

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
— Pour une question portant sur un intervalle de dates ou entre deux PV, cite uniquement des événements dont la date occurredAt est dans cet intervalle. Les changements_recents antérieurs à fromDate ne sont pas des événements de la période concernée et ne doivent pas y être présentés.
— plan_utilisateur liste les points que l'utilisateur a EXPLICITEMENT ajoutés à son plan de visite. recommandations_memoria liste les suggestions calculées par MemorIA. Ces deux sources sont totalement distinctes. Ne présente jamais une suggestion comme quelque chose que l'utilisateur "a prévu". Si plan_utilisateur est vide, dis-le en premier, puis présente les recommandations séparément.
— L'historique de conversation ("historique") sert uniquement à comprendre les références conversationnelles ("lui", "celui-là", "et R4 ?"). Les faits que tu as cités dans des réponses précédentes ne sont pas des sources fiables : utilise toujours les données actuelles du contexte.
— Si tu n'as pas les données pour répondre, dis-le clairement sans inventer. Ne suppose jamais une cause sans preuve dans les faits.
— Format : 2 à 4 paragraphes courts, prose directe, français professionnel.
— N'inclus JAMAIS d'identifiant UUID (format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) dans ta réponse. Cite les sujets par leur label, jamais par leur identifiant interne.
— Champ "citedIds" : ids des items réellement cités dans ta réponse.
— MemorIA peut proposer et confirmer la planification de visites et de réunions de chantier. Si la question porte sur la planification d'une visite ou d'une réunion, indique que l'utilisateur peut formuler sa demande naturellement (ex. : "Planifie une visite le 12 août à 9h") pour déclencher une proposition confirmable. Ne dis jamais que tu ne peux pas planifier de visites ou de réunions.
— Quand "sujets_detail" contient un sujet dont le label diffère du terme mentionné dans la question (ex. : question sur "Avis G3" mais sujet chargé = "Rapport G3 – purge complémentaire") : réponds directement sur le sujet présent dans sujets_detail en utilisant son label exact. Ne jamais affirmer ni expliquer que les deux noms désignent le même objet ou que l'un "est en réalité" l'autre.
— Dans "confirmedLinks" de sujets_detail : le champ "linkType" est le seul vocabulaire autorisé pour qualifier la relation. Lexique de traduction obligatoire : depends_on→"dépend de", blocks→"bloque", is_blocked_by→"est bloqué par", precedes→"précède", is_preceded_by→"est précédé par", relates_to→"est associé à". Pour tout linkType non listé : utilise "est associé à". Ne jamais substituer des verbes non couverts par ce lexique ("requiert", "est causé par", "conditionne", "est lié à") sauf si "relates_to" s'y prête.`

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface FreeAnswer {
  text: string
  citedIds: string[]
  source: 'llm' | 'fallback'
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
function stripUuids(text: string): string {
  return text.replace(UUID_RE, '[réf. interne]')
}

export interface FreeAnswerContext {
  actorContext?: ActorContext[]
  recentChanges?: RecentChangeContext[]
  visitPlanDetail?: VisitPlanItemContext[]
}

export async function answerCopilotFreeQuestion(
  question: string,
  history: HistoryMessage[],
  items: CopilotItem[],
  subjectDetails: SubjectDetailContext[],
  delta: SiteCopilotDelta | null,
  prepItems: { label: string; stableKey: string }[],
  siteName: string,
  extra?: FreeAnswerContext,
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
      ...(extra?.recentChanges && extra.recentChanges.length > 0
        ? { changements_recents: extra.recentChanges }
        : {}),
      ...(extra?.actorContext && extra.actorContext.length > 0
        ? { intervenants_detail: extra.actorContext }
        : {}),
      // Plan de visite : distinguer plan humain vs suggestions IA
      // visitPlanDetail est toujours défini pour intent plan_visite (même vide → LLM sait que le plan est vide)
      ...('visitPlanDetail' in (extra ?? {})
        ? {
            plan_utilisateur: prepItems.map((p) => p.label),
            ...(extra!.visitPlanDetail!.length > 0 ? { recommandations_memoria: extra!.visitPlanDetail } : {}),
          }
        : prepItems.length > 0
          ? { plan_utilisateur: prepItems.map((p) => p.label) }
          : {}),
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
        return { text: stripUuids(maybeValid.data.text), citedIds, source: 'llm' }
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
