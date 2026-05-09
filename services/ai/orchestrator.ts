import { getAIProvider } from './factory'
import { buildLibraryContext } from './library-context'
import { agents } from './agents/registry'
import { lecteurAoAgent, type LecteurAoOutput } from './agents/lecteur-ao'
import { memoireTechniqueAgent, type MemoireTechniqueOutput } from './agents/memoire-technique'
import { opportunityScorerAgent, type OpportunityScorerOutput } from './agents/opportunity-scorer'
import { withAITracking } from './tracking'
import type { AgentContext } from './agents/types'
import type { LibrarySnapshot } from './library-context'

export interface AnalyzeTenderResult {
  reading: LecteurAoOutput
  memo: MemoireTechniqueOutput
  score: OpportunityScorerOutput
  librarySnapshot: LibrarySnapshot
  promptVersions: Record<string, string>
  provider: string
  model: string
}

export async function analyzeTender(
  rawText: string,
  userId: string | null
): Promise<AnalyzeTenderResult> {
  const provider = getAIProvider()
  const lib = await buildLibraryContext()

  const ctx: AgentContext = {
    provider,
    userId,
    libraryContext: lib.markdown,
  }

  // Phase 1 — lecture séquentielle
  const reading = await withAITracking('lecteur_ao', userId, async () => {
    const result = await lecteurAoAgent.run({ rawText }, ctx)
    return {
      result,
      tokens: { input: 1000, output: 1500 },
      model: provider.name === 'mock' ? 'mock-1' : 'unknown',
      provider: provider.name,
      durationMs: 0,
    }
  })

  ctx.previousResults = { lecteur_ao: reading }

  // Phase 2 — mémoire technique (parallèle dans le futur quand on activera les autres agents)
  const memo = await withAITracking('memoire_technique', userId, async () => {
    const result = await memoireTechniqueAgent.run({ reading }, ctx)
    return {
      result,
      tokens: { input: 2000, output: 3000 },
      model: provider.name === 'mock' ? 'mock-1' : 'unknown',
      provider: provider.name,
      durationMs: 0,
    }
  })

  // Phase 3 — scoring final
  const score = await withAITracking('opportunity_scorer', userId, async () => {
    const result = await opportunityScorerAgent.run({ reading, memo: memo.technical_memo }, ctx)
    return {
      result,
      tokens: { input: 1500, output: 200 },
      model: provider.name === 'mock' ? 'mock-1' : 'unknown',
      provider: provider.name,
      durationMs: 0,
    }
  })

  return {
    reading,
    memo,
    score,
    librarySnapshot: lib.snapshot,
    promptVersions: {
      lecteur_ao: lecteurAoAgent.promptVersion,
      memoire_technique: memoireTechniqueAgent.promptVersion,
      opportunity_scorer: opportunityScorerAgent.promptVersion,
    },
    provider: provider.name,
    model: provider.name === 'mock' ? 'mock-1' : 'unknown',
  }
}

// Marquer agents non utilisé pour ESLint (registry exporté pour usage futur)
void agents
