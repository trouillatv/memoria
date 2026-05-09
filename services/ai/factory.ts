import type { AIProvider } from './index'
import { MockProvider } from './providers/mock'
import { GeminiProvider } from './providers/gemini'
import { AnthropicProvider } from './providers/anthropic'

export function getAIProvider(): AIProvider {
  switch (process.env.AI_PROVIDER) {
    case 'gemini':
      return new GeminiProvider()
    case 'anthropic':
      return new AnthropicProvider()
    case 'mock':
    default:
      return new MockProvider()
  }
}
