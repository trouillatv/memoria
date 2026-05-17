import { z } from 'zod'
import type { AIAgent, AgentContext } from './types'
import { OPPORTUNITY_SCORER_V1 } from '../prompts/opportunity-scorer.v1'
import type { LecteurAoOutput } from './lecteur-ao'

export const opportunityScorerOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  rationale: z.string(),
})

export type OpportunityScorerInput = { reading: LecteurAoOutput; memo: string }
export type OpportunityScorerOutput = z.infer<typeof opportunityScorerOutputSchema>

export const opportunityScorerAgent: AIAgent<OpportunityScorerInput, OpportunityScorerOutput> = {
  name: 'opportunity_scorer',
  description: "Score 0-100 d'opportunité commerciale",
  modelTier: 'light',
  promptVersion: OPPORTUNITY_SCORER_V1.version,

  async run(input, ctx) {
    const isMock = ctx.provider.name === 'mock'
    const userMessage = isMock
      ? '__MOCK_FIXTURE__:' + JSON.stringify(buildMockFixture(input))
      : OPPORTUNITY_SCORER_V1.userTemplate(input)

    const r = await ctx.provider.complete({
      systemPrompt: OPPORTUNITY_SCORER_V1.system,
      userMessage,
      responseSchema: opportunityScorerOutputSchema,
      modelTier: 'light',
      maxOutputTokens: 256,
    })

    const parsed = opportunityScorerOutputSchema.safeParse(r.parsed)
    if (!parsed.success) throw new Error(`opportunity_scorer: invalid: ${parsed.error.message}`)
    return parsed.data
  },
}

function buildMockFixture(input: OpportunityScorerInput): OpportunityScorerOutput {
  // Score basé sur le nombre de risques et contraintes
  const risksHigh = input.reading.risks.filter((r) => r.severity === 'high').length
  const constraintsCount = input.reading.constraints.length
  const baseScore = 75 - risksHigh * 15 - Math.max(0, constraintsCount - 3) * 2
  const score = Math.max(0, Math.min(100, baseScore))
  return {
    score,
    rationale: `Mock score basé sur ${risksHigh} risque(s) high et ${constraintsCount} contrainte(s) listée(s). Alignement métier estimé moyen-élevé.`,
  }
}
