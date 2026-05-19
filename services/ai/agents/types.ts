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
  /** A3 — recall documentaire BORNÉ, calculé 1× par analyse (jamais par
   *  agent), déjà filtré visibility_level + plafonné (buildDocumentContext).
   *  Bloc « [doc:id] … » citable (A1). Vide si pas de provider/match. */
  documentContext?: string
  previousResults?: Partial<Record<AgentName, unknown>>
}

export interface AIAgent<TInput, TOutput> {
  name: AgentName
  description: string
  modelTier: 'light' | 'heavy'
  promptVersion: string
  run(input: TInput, ctx: AgentContext): Promise<TOutput>
}
