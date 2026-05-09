import type { AIAgent, AgentContext } from './types'

export const conformiteAgent: AIAgent<unknown, unknown> = {
  name: 'conformite',
  description: 'Vérifie conformité ISO/RGPD/clauses sociales — TODO V2',
  modelTier: 'light',
  promptVersion: 'draft',
  async run() {
    throw new Error('conformite agent not yet implemented (stub)')
  },
}
