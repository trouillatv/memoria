import { GoogleGenAI } from '@google/genai'
import type { AIProvider, CompletionInput, CompletionOutput } from '../index'

const MODEL_MAP: Record<'light' | 'heavy', string> = {
  light: 'gemini-2.0-flash',
  heavy: 'gemini-2.0-flash',
}

export class GeminiProvider implements AIProvider {
  name = 'gemini' as const
  private client: GoogleGenAI

  constructor() {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY non définie')
    this.client = new GoogleGenAI({ apiKey })
  }

  async complete(input: CompletionInput): Promise<CompletionOutput> {
    const model = MODEL_MAP[input.modelTier]
    const start = Date.now()

    const response = await this.client.models.generateContent({
      model,
      config: {
        systemInstruction: input.systemPrompt,
        ...(input.responseSchema ? { responseMimeType: 'application/json' } : {}),
        temperature: 0.3,
      },
      contents: [{ role: 'user', parts: [{ text: input.userMessage }] }],
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
