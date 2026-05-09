import type { AIAgent, AgentName } from './types'
import { lecteurAoAgent } from './lecteur-ao'
import { memoireTechniqueAgent } from './memoire-technique'
import { opportunityScorerAgent } from './opportunity-scorer'
import { conformiteAgent } from './conformite'
import { contradicteurAgent } from './contradicteur'
import { financierAgent } from './financier'
import { terrainAgent } from './terrain'

export const agents: Record<AgentName, AIAgent<unknown, unknown>> = {
  lecteur_ao: lecteurAoAgent as AIAgent<unknown, unknown>,
  memoire_technique: memoireTechniqueAgent as AIAgent<unknown, unknown>,
  opportunity_scorer: opportunityScorerAgent as AIAgent<unknown, unknown>,
  conformite: conformiteAgent,
  contradicteur: contradicteurAgent,
  financier: financierAgent,
  terrain: terrainAgent,
}
