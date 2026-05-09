import type { AIAgent, AgentContext } from './types'

export const contradicteurAgent: AIAgent<unknown, unknown> = {
  name: 'contradicteur',
  description: 'Joue le rôle du contradicteur pour challenger le mémoire technique — TODO V2',
  modelTier: 'light',
  promptVersion: 'draft',
  async run() {
    throw new Error('contradicteur agent not yet implemented (stub)')
  },
}
