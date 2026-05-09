import { z } from 'zod'

export type AIProviderName = 'mock' | 'gemini' | 'anthropic' | 'openai'

export interface CompletionInput {
  systemPrompt: string
  userMessage: string
  responseSchema?: z.ZodTypeAny
  modelTier: 'light' | 'heavy'
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
