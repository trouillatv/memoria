import type { AIProvider, CompletionInput, CompletionOutput } from '../index'

/**
 * Provider Gemini — stub. Sera implémenté avec @google/genai quand l'utilisateur
 * pose GOOGLE_GENAI_API_KEY et bascule AI_PROVIDER=gemini.
 *
 * Pour le MVP, throws explicitement pour signaler la non-implémentation.
 */
export class GeminiProvider implements AIProvider {
  name = 'gemini' as const

  async complete(_input: CompletionInput): Promise<CompletionOutput> {
    throw new Error(
      'GeminiProvider not yet implemented. Install @google/genai, set GOOGLE_GENAI_API_KEY, and replace this stub.'
    )
  }
}
