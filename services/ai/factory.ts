import type { AIProvider } from './index'
import { MockProvider } from './providers/mock'
import { GeminiProvider } from './providers/gemini'
import { AnthropicProvider } from './providers/anthropic'

/**
 * Résolution du provider IA.
 * Priorité : AI_PROVIDER explicite → auto-détection par clé API → mock.
 * Ainsi GOOGLE_GENAI_API_KEY seule suffit — pas besoin de AI_PROVIDER=gemini.
 */
export function getAIProvider(): AIProvider {
  const explicit = process.env.AI_PROVIDER
  if (explicit === 'gemini')    return new GeminiProvider()
  if (explicit === 'anthropic') return new AnthropicProvider()
  if (explicit === 'mock')      return new MockProvider()

  // Auto-détection par clé disponible (même priorité que check-api-health)
  if (process.env.GOOGLE_GENAI_API_KEY) return new GeminiProvider()
  if (process.env.ANTHROPIC_API_KEY)    return new AnthropicProvider()

  return new MockProvider()
}
