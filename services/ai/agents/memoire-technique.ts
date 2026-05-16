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

    // Pas de responseSchema : le prompt demande du markdown pur.
    // Forcer JSON ici confusait Gemini qui retournait {"technical_memo": "..."} en DB.
    const r = await ctx.provider.complete({
      systemPrompt: MEMOIRE_TECHNIQUE_V1.system,
      userMessage,
      modelTier: 'heavy',
    })

    const text = r.text?.trim() ?? ''

    // Si Gemini a quand même encapsulé en JSON, on extrait technical_memo
    if (text.startsWith('{')) {
      try {
        const obj = JSON.parse(text) as Record<string, unknown>
        if (typeof obj.technical_memo === 'string' && obj.technical_memo.length > 50) {
          return { technical_memo: obj.technical_memo }
        }
      } catch { /* pas du JSON valide — on utilise le texte brut */ }
    }

    if (text.length < 50) {
      throw new Error(`memoire_technique: réponse trop courte (${text.length} chars)`)
    }
    return { technical_memo: text }
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
