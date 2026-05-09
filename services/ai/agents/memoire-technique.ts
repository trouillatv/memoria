import { z } from 'zod'
import type { AIAgent, AgentContext } from './types'
import { MEMOIRE_TECHNIQUE_V1 } from '../prompts/memoire-technique.v1'
import type { LecteurAoOutput } from './lecteur-ao'

export const memoireTechniqueOutputSchema = z.object({
  technical_memo: z.string().min(100),
})

export type MemoireTechniqueInput = { reading: LecteurAoOutput }
export type MemoireTechniqueOutput = z.infer<typeof memoireTechniqueOutputSchema>

export const memoireTechniqueAgent: AIAgent<MemoireTechniqueInput, MemoireTechniqueOutput> = {
  name: 'memoire_technique',
  description: "Génère un mémoire technique markdown grounded sur la bibliothèque AGP",
  modelTier: 'heavy',
  promptVersion: MEMOIRE_TECHNIQUE_V1.version,

  async run(input, ctx) {
    const isMock = ctx.provider.name === 'mock'
    const userMessage = isMock
      ? '__MOCK_FIXTURE__:' + JSON.stringify(buildMockFixture(input, ctx.libraryContext))
      : MEMOIRE_TECHNIQUE_V1.userTemplate({ reading: input.reading, libraryContext: ctx.libraryContext })

    const r = await ctx.provider.complete({
      systemPrompt: MEMOIRE_TECHNIQUE_V1.system,
      userMessage,
      responseSchema: memoireTechniqueOutputSchema,
      modelTier: 'heavy',
    })

    const parsed = memoireTechniqueOutputSchema.safeParse(r.parsed)
    if (!parsed.success) {
      // Fallback : si la sortie est juste du markdown, on l'enrobe
      if (typeof r.text === 'string' && r.text.length > 100) {
        return { technical_memo: r.text }
      }
      throw new Error(`memoire_technique: invalid output: ${parsed.error.message}`)
    }
    return parsed.data
  },
}

function buildMockFixture(input: MemoireTechniqueInput, libCtx: string): MemoireTechniqueOutput {
  const hasLib = libCtx.trim().length > 0
  return {
    technical_memo: `# Présentation de notre approche

## Compréhension du besoin

${input.reading.summary}

## Notre méthodologie

Nous appliquons une démarche structurée en 4 phases : audit initial, mise en place du dispositif, exécution avec contrôles qualité hebdomadaires, et reporting mensuel.

${hasLib ? '## Moyens humains et matériels\n\nLes informations issues de notre bibliothèque interne montrent un dispositif aligné avec ce marché.\n' : '_(bibliothèque AGP vide — mémoire générique)_\n'}

## Engagements qualité

${input.reading.constraints
  .filter((c) => c.category === 'qualité' || c.category === 'environnement')
  .map((c) => `- ${c.label}${c.detail ? ` : ${c.detail}` : ''}`)
  .join('\n')}

## Plan de gestion des risques

${input.reading.risks.map((r) => `- **${r.label}** (${r.severity}) : ${r.detail ?? '—'}`).join('\n')}

---

*Mémoire technique généré en mode mock — passer à AI_PROVIDER=gemini pour une version IA réelle.*`,
  }
}
