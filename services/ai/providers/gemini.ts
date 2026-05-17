import { GoogleGenAI } from '@google/genai'
import type { AIProvider, CompletionInput, CompletionOutput } from '../index'

export class GeminiProvider implements AIProvider {
  name = 'gemini' as const

  async complete(input: CompletionInput): Promise<CompletionOutput> {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY non définie')

    const ai = new GoogleGenAI({ apiKey })
    const modelLight = process.env.AI_MODEL_LIGHT ?? 'gemini-2.0-flash'
    const modelHeavy = process.env.AI_MODEL_HEAVY ?? 'gemini-2.0-flash'
    const model = input.modelTier === 'heavy' ? modelHeavy : modelLight
    const start = Date.now()

    const response = await ai.models.generateContent({
      model,
      config: {
        systemInstruction: input.systemPrompt,
        temperature: 0.3,
        maxOutputTokens: input.maxOutputTokens ?? 1500,
        ...(input.responseSchema ? { responseMimeType: 'application/json' } : {}),
      },
      contents: input.userMessage,
    })

    const text = response.text ?? ''
    let parsed: unknown = null
    if (input.responseSchema) {
      try {
        parsed = JSON.parse(text)
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
