import 'server-only'
import { z } from 'zod'

// ─── Schémas Zod (contrat de sortie LLM) ─────────────────────────────────────

export const LlmEvidenceSchema = z.object({
  temporaryKey: z.string(),
  evidenceType: z.enum(['text_excerpt', 'page_snapshot']),
  sourcePage: z.number().int(),
  caption: z.string().nullish(),
  nearbyText: z.string().nullish(),
  text: z.string().nullish(),
})

export const LlmProposalSchema = z.object({
  temporaryKey: z.string(),
  family: z.enum(['reservation', 'action', 'decision', 'observation', 'deadline', 'knowledge_fact']),
  label: z.string().min(3),
  description: z.string().nullish(),
  sourcePage: z.number().int().nullish(),
  sourceExcerpt: z.string().nullish(),
  sourcePayload: z.object({
    statusAtDocumentDate: z.string().nullish(),
    dueDate: z.string().nullish(),
    responsibleParty: z.string().nullish(),
  }).nullish(),
  evidenceKeys: z.array(z.string()),
})

export const LlmExtractionResultSchema = z.object({
  proposals: z.array(LlmProposalSchema),
  evidence: z.array(LlmEvidenceSchema),
})

export type LlmProposal = z.infer<typeof LlmProposalSchema>
export type LlmEvidence = z.infer<typeof LlmEvidenceSchema>
export type LlmExtractionResult = z.infer<typeof LlmExtractionResultSchema>

// ─── Schema responseSchema Gemini (OpenAPI 3.0 subset) ────────────────────────

const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          temporaryKey: { type: 'string' },
          family: {
            type: 'string',
            enum: ['reservation', 'action', 'decision', 'observation', 'deadline', 'knowledge_fact'],
          },
          label: { type: 'string' },
          description: { type: 'string' },
          sourcePage: { type: 'integer' },
          sourceExcerpt: { type: 'string' },
          sourcePayload: {
            type: 'object',
            properties: {
              statusAtDocumentDate: { type: 'string' },
              dueDate: { type: 'string' },
              responsibleParty: { type: 'string' },
            },
          },
          evidenceKeys: { type: 'array', items: { type: 'string' } },
        },
        required: ['temporaryKey', 'family', 'label', 'evidenceKeys'],
      },
    },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          temporaryKey: { type: 'string' },
          evidenceType: { type: 'string', enum: ['text_excerpt', 'page_snapshot'] },
          sourcePage: { type: 'integer' },
          caption: { type: 'string' },
          nearbyText: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['temporaryKey', 'evidenceType', 'sourcePage'],
      },
    },
  },
  required: ['proposals', 'evidence'],
} as const

// ─── Prompt système ───────────────────────────────────────────────────────────

function buildExtractionPrompt(text: string, pageCount: number): string {
  return `Tu es un assistant d'analyse de PV de visite technique. Tu extrais des informations structurées d'un compte rendu de visite de site de construction ou de maintenance.

Ce document comporte ${pageCount} page(s). Le texte est balisé avec [[page N]] pour indiquer les changements de page.

## Doctrine d'extraction (obligatoire)

1. Ne jamais inventer des données absentes du texte — extraction pure, zéro inférence.
2. Ne pas transformer une observation en action implicite : une constatation reste une observation.
3. Conserver les formulations incertaines (« à vérifier », « à confirmer », « semble ») dans le label ou la description.
4. Distinguer les points ouverts et les points résolus : un point résolu peut être une knowledge_fact ou une decision.
5. Citer la page exacte (sourcePage) pour chaque proposition — utilise les marqueurs [[page N]].
6. Ne pas déduire des intentions — se limiter aux faits et décisions explicitement mentionnés.
7. Pour une réservation (reservation) : conserver le libellé exact du PV, préciser l'état si mentionné (ouvert/levé/en cours).
8. Pour une action : ne citer que les actions explicitement attribuées (responsable nommé ou délai mentionné).
9. Une photo sans description textuelle adjacente → evidence uniquement (page_snapshot), pas de proposition.
10. Un chiffre ou mesure sans contexte clair → observation, pas action.

## Familles de propositions

- **reservation** : réserve de chantier (défaut, malfaçon, non-conformité) — ouverture, suivi ou levée.
- **action** : tâche à réaliser, avec responsable ou délai mentionné.
- **decision** : décision prise lors de la visite.
- **observation** : constatation factuelle sans action requise.
- **deadline** : échéance mentionnée (date ou délai chiffré).
- **knowledge_fact** : information factuelle utile à la connaissance long terme du site.

## Types de preuves

- **text_excerpt** : extrait de texte citant un passage clé (renseigne le champ \`text\`).
- **page_snapshot** : référence à une page contenant une photo ou schéma (pas de \`text\`).

## Idempotence

Chaque proposition et preuve reçoit un \`temporaryKey\` court et descriptif
(ex : "res-infiltration-p7", "act-joint-p8", "ev-text-p7-1", "ev-snap-p12").
Lie chaque preuve à sa proposition via \`evidenceKeys\` (liste de temporaryKey).

## Texte du document

${text}`
}

// ─── Appel LLM ───────────────────────────────────────────────────────────────

export async function extractHistoricalPvProposals(
  text: string,
  pageCount: number,
): Promise<LlmExtractionResult> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not set')

  const model = process.env.AI_MODEL ?? 'gemini-2.5-flash'
  const prompt = buildExtractionPrompt(text, pageCount)
  const start = Date.now()
  let outputText = ''

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 16000,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        }),
      },
    )

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Gemini extraction ${res.status}: ${body}`)
    }

    const data = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>
    }
    outputText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const parsed: unknown = JSON.parse(outputText)
    return LlmExtractionResultSchema.parse(parsed)
  } finally {
    try {
      const { logAIUsageDirect } = await import('@/services/ai/tracking')
      void logAIUsageDirect({
        feature: 'extract_historical_pv',
        userId: null,
        provider: 'gemini',
        model,
        inputTokens: Math.ceil(text.length / 4),
        outputTokens: Math.ceil(outputText.length / 4),
        durationMs: Date.now() - start,
        status: outputText ? 'success' : 'error',
        errorMsg: null,
      }).catch(() => {})
    } catch {
      /* tracking non bloquant */
    }
  }
}
