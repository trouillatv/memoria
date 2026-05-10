import type { ChatAgentName } from '@/types/db'

export type CopiloteMode = 'empty' | 'expert' | 'debate'

export const MAX_AGENTS = 3

export function resolveMode(agents: ChatAgentName[]): CopiloteMode {
  if (agents.length === 0) return 'empty'
  if (agents.length === 1) return 'expert'
  if (agents.length <= MAX_AGENTS) return 'debate'
  throw new Error(`max ${MAX_AGENTS} agents allowed`)
}

export function modeLabel(mode: CopiloteMode): string {
  switch (mode) {
    case 'empty':  return 'Choisissez un ou plusieurs experts'
    case 'expert': return "Avis d'expert"
    case 'debate': return 'Débat IA'
  }
}

export function modeCta(mode: CopiloteMode): string {
  switch (mode) {
    case 'empty':  return "Sélectionnez d'abord un expert"
    case 'expert': return 'Demander un avis'
    case 'debate': return 'Lancer le débat IA'
  }
}
