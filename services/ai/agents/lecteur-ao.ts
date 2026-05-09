import { z } from 'zod'
import type { AIAgent, AgentContext } from './types'
import { LECTEUR_AO_V1 } from '../prompts/lecteur-ao.v1'

const constraintSchema = z.object({
  label: z.string(),
  detail: z.string().optional(),
  required: z.boolean().optional(),
  category: z.string().optional(),
})

const riskSchema = z.object({
  label: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  detail: z.string().optional(),
})

const checklistItemSchema = z.object({
  item: z.string(),
  required: z.boolean(),
})

export const lecteurAoOutputSchema = z.object({
  summary: z.string(),
  constraints: z.array(constraintSchema),
  risks: z.array(riskSchema),
  checklist: z.array(checklistItemSchema),
})

export type LecteurAoInput = { rawText: string }
export type LecteurAoOutput = z.infer<typeof lecteurAoOutputSchema>

export const lecteurAoAgent: AIAgent<LecteurAoInput, LecteurAoOutput> = {
  name: 'lecteur_ao',
  description: "Lit le PDF d'AO et extrait contraintes, risques, checklist, résumé",
  modelTier: 'heavy',
  promptVersion: LECTEUR_AO_V1.version,

  async run(input, ctx) {
    // Mode mock : injecter une fixture réaliste
    const isMock = ctx.provider.name === 'mock'
    const userMessage = isMock
      ? '__MOCK_FIXTURE__:' + JSON.stringify(buildMockFixture(input.rawText))
      : LECTEUR_AO_V1.userTemplate(input.rawText)

    const r = await ctx.provider.complete({
      systemPrompt: LECTEUR_AO_V1.system,
      userMessage,
      responseSchema: lecteurAoOutputSchema,
      modelTier: 'heavy',
    })

    const parsed = lecteurAoOutputSchema.safeParse(r.parsed)
    if (!parsed.success) throw new Error(`lecteur_ao: invalid output: ${parsed.error.message}`)
    return parsed.data
  },
}

function buildMockFixture(rawText: string): LecteurAoOutput {
  const wordCount = rawText.split(/\s+/).length
  return {
    summary: `Mock — Cahier des charges de ${wordCount} mots environ. Marché de nettoyage type tertiaire avec exigences ISO 9001 et planning hebdomadaire. Échéance dans la semaine. Volume horaire mensuel estimé ~120h.`,
    constraints: [
      { label: 'ISO 9001:2015', detail: 'Certification exigée pour toute la durée du marché', required: true, category: 'qualité' },
      { label: 'Personnel en CDI', detail: 'Tout le personnel intervenant doit être en CDI', required: true, category: 'administratif' },
      { label: 'Produits écolabellisés', detail: 'Produits désinfectants Ecolabel uniquement', required: true, category: 'environnement' },
      { label: 'Astreinte téléphonique', detail: '24/7 pendant la durée du marché', required: false, category: 'opérationnel' },
    ],
    risks: [
      { label: 'Disponibilité personnel', severity: 'medium', detail: 'Recrutement difficile en zone X' },
      { label: 'Délai de mobilisation', severity: 'high', detail: 'Démarrage J+15 demandé' },
    ],
    checklist: [
      { item: 'Joindre attestation ISO 9001 valide', required: true },
      { item: 'Fournir liste nominative des agents avec n° contrat CDI', required: true },
      { item: 'Annexer fiche technique des produits Ecolabel', required: true },
      { item: 'Décrire dispositif d\'astreinte 24/7', required: false },
    ],
  }
}
