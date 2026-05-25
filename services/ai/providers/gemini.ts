import { GoogleGenAI } from '@google/genai'
import type { AIProvider, CompletionInput, CompletionOutput } from '../index'

export class GeminiProvider implements AIProvider {
  name = 'gemini' as const

  async complete(input: CompletionInput): Promise<CompletionOutput> {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY non définie')

    const ai = new GoogleGenAI({ apiKey })
    const modelLight = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
    const modelHeavy = process.env.AI_MODEL_HEAVY ?? 'gemini-2.5-flash'
    const model = input.modelTier === 'heavy' ? modelHeavy : modelLight
    const start = Date.now()

    const response = await ai.models.generateContent({
      model,
      config: {
        systemInstruction: input.systemPrompt,
        temperature: 0.3,
        maxOutputTokens: input.maxOutputTokens ?? 1500,
        // Sortie JSON structurée : on DÉSACTIVE le thinking (gemini-2.5-flash).
        // Sinon le raisonnement interne consomme maxOutputTokens avant d'émettre
        // le JSON → texte tronqué/vide → parse échoue (cf. extraction engagements).
        ...(input.responseSchema
          ? { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
          : {}),
      },
      contents: input.userMessage,
    })

    const text = response.text ?? ''
    let parsed: unknown = null
    if (input.responseSchema) {
      // Strip défensif d'un éventuel fence ```json … ``` avant parse.
      const cleaned = text
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim()
      try {
        parsed = JSON.parse(cleaned)
      } catch {
        parsed = null
      }
    }

    return {
      text,
      parsed,
      tokens: {
        input: response.usageMetadata?.promptTokenCount ?? 0,
        output: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model,
      durationMs: Date.now() - start,
    }
  }
}
