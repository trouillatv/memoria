import type { AIProvider } from '../index'

export type AgentName =
  | 'lecteur_ao'
  | 'memoire_technique'
  | 'opportunity_scorer'
  | 'conformite'
  | 'contradicteur'
  | 'financier'
  | 'terrain'

export interface AgentContext {
  provider: AIProvider
  userId: string | null
  libraryContext: string
  previousResults?: Partial<Record<AgentName, unknown>>
}

export interface AIAgent<TInput, TOutput> {
  name: AgentName
  description: string
  modelTier: 'light' | 'heavy'
  promptVersion: string
  run(input: TInput, ctx: AgentContext): Promise<TOutput>
}
