import type { AIAgent, AgentContext } from './types'

export const terrainAgent: AIAgent<unknown, unknown> = {
  name: 'terrain',
  description: 'Évalue les contraintes terrain et logistiques du site — TODO V2',
  modelTier: 'light',
  promptVersion: 'draft',
  async run() {
    throw new Error('terrain agent not yet implemented (stub)')
  },
}
