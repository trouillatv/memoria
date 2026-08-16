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
  /** Raison d'arrêt du provider (ex. 'STOP', 'MAX_TOKENS'). Absent si le provider ne l'expose pas. */
  finishReason?: string
}

export interface AIProvider {
  name: AIProviderName
  complete(input: CompletionInput): Promise<CompletionOutput>
  /**
   * Variante streaming, optionnelle : un provider qui ne l'implémente pas
   * (mock, anthropic à ce jour) n'a pas de gain de latence oral, pas de panne —
   * l'appelant doit se replier sur `complete()` quand ce champ est absent
   * (D1, 2026-08-16).
   *
   * Émet des deltas de texte au fil de la génération et se termine avec le
   * même `CompletionOutput` que `complete()` — une seule vérité, deux formes
   * d'accès au même appel.
   */
  completeStream?(input: CompletionInput): AsyncGenerator<string, CompletionOutput, void>
}
