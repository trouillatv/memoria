import { z } from 'zod'

export type AIProviderName = 'mock' | 'gemini' | 'anthropic' | 'openai'

export interface CompletionInput {
  systemPrompt: string
  userMessage: string
  responseSchema?: z.ZodTypeAny
  // Schéma JSON natif à passer au provider (Gemini responseSchema).
  // Quand fourni, le provider l'utilise pour contraindre la structure de sortie
  // et éviter les variations de nommage de champs (snake_case vs camelCase, etc.)
  geminiSchema?: Record<string, unknown>
  modelTier: 'light' | 'heavy'
  maxOutputTokens?: number
}

export interface TokenUsage {
  input: number
  output: number
}

export interface CompletionOutput {
  text: string
  parsed?: unknown
  tokens: TokenUsage
  model: string
  durationMs: number
}

export interface AIProvider {
  name: AIProviderName
  complete(input: CompletionInput): Promise<CompletionOutput>
}
