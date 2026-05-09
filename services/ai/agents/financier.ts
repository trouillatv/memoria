import type { AIAgent, AgentContext } from './types'

export const financierAgent: AIAgent<unknown, unknown> = {
  name: 'financier',
  description: 'Analyse la rentabilité financière et estimation des coûts — TODO V2',
  modelTier: 'light',
  promptVersion: 'draft',
  async run() {
    throw new Error('financier agent not yet implemented (stub)')
  },
}
