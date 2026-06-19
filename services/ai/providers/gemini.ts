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

    // Timeout DUR de 60 s par appel. Un appel Gemini bloqué (réseau, quota,
    // modèle lent) ne doit jamais figer l'analyse AO entière. On utilise un
    // AbortController explicite plutôt que httpOptions.timeout seul, car le SDK
    // ré-essaie les timeouts HTTP par défaut (cf. docs @google/genai) — le pire
    // cas dépasserait alors 60 s. Le signal coupe net, sans retry.
    const TIMEOUT_MS = 60_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let response
    try {
      response = await ai.models.generateContent({
        model,
        config: {
          systemInstruction: input.systemPrompt,
          temperature: 0.3,
          maxOutputTokens: input.maxOutputTokens ?? 1500,
          abortSignal: controller.signal,
          // Sortie JSON structurée : on DÉSACTIVE le thinking (gemini-2.5-flash).
          // Sinon le raisonnement interne consomme maxOutputTokens avant d'émettre
          // le JSON → texte tronqué/vide → parse échoue (cf. extraction engagements).
          ...(input.responseSchema
            ? { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
            : {}),
        },
        contents: input.userMessage,
      })
    } catch (e) {
      // Timeout → erreur explicite et exploitable. Sinon on propage l'erreur
      // Gemini telle quelle. Dans tous les cas l'erreur remonte au flux
      // d'analyse (orchestrator → after()) qui passe l'AO en `failed`.
      if (controller.signal.aborted) {
        throw new Error(`Gemini timeout après ${TIMEOUT_MS / 1000}s (modèle ${model})`)
      }
      throw e
    } finally {
      clearTimeout(timer)
    }

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
