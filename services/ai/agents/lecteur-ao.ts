import { z } from 'zod'
import type { AIAgent, AgentContext } from './types'
import { LECTEUR_AO_V1 } from '../prompts/lecteur-ao.v1'

// TOLÉRANCE : on TRONQUE les chaînes trop longues au lieu de faire échouer toute
// l'analyse (un LLM verbeux dépasse régulièrement ces plafonds).
const capped = (max: number) => z.string().transform((s) => s.slice(0, max))
const cappedOpt = (max: number) => z.string().transform((s) => s.slice(0, max)).optional()

const sourceSchemaForAnalysis = z.object({
  type: z.enum(['pdf', 'library', 'analysis']),
  quote: capped(500),
  page: z.number().int().optional(),
  library_item_title: cappedOpt(200),
  reasoning: cappedOpt(200),
})

// TOLÉRANCE : un LLM verbeux peut renvoyer plus de sources que le plafond. On
// TRONQUE (transform) au lieu de FAIRE ÉCHOUER toute l'analyse (cause réelle des
// AO « failed » : un risk avec >3 sources cassait le safeParse entier).
const sourcesCapped = (max: number) =>
  z.array(sourceSchemaForAnalysis).optional().transform((a) => (a ? a.slice(0, max) : a))

const constraintSchema = z.object({
  label: z.string(),
  detail: z.string().optional(),
  required: z.boolean().optional(),
  category: z.string().optional(),
  sources: sourcesCapped(3),
})

const riskSchema = z.object({
  label: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  detail: z.string().optional(),
  sources: sourcesCapped(3),
})

const checklistItemSchema = z.object({
  item: z.string(),
  required: z.boolean(),
  sources: sourcesCapped(2),
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
    // A3 — extraits documentaires déjà BORNÉS par buildDocumentContext
    // (1×/analyse, plafonné). Slice défensif : on ne fait jamais confiance
    // aveugle à un contexte non borné. Citable [doc:id] (A1).
    const docBlock = ctx.documentContext
      ? `\n\n${ctx.documentContext.slice(0, 6000)}`
      : ''
    const userMessage = isMock
      ? '__MOCK_FIXTURE__:' + JSON.stringify(buildMockFixture(input.rawText))
      : LECTEUR_AO_V1.userTemplate(input.rawText) + docBlock

    const r = await ctx.provider.complete({
      systemPrompt: LECTEUR_AO_V1.system,
      userMessage,
      responseSchema: lecteurAoOutputSchema,
      modelTier: 'heavy',
      // Analyse AO complète = JSON volumineux. Thinking désormais désactivé sur
      // les sorties JSON (cf. provider) → tout le budget va au JSON. Headroom
      // large pour éviter la troncature (cause de « received null »).
      maxOutputTokens: 8000,
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
      {
        label: 'ISO 9001:2015',
        detail: 'Certification exigée pour toute la durée du marché',
        required: true,
        category: 'qualité',
        sources: [
          { type: 'pdf', quote: 'Le candidat justifiera de la certification ISO 9001:2015 en cours de validité', page: 3, reasoning: 'Citation directe de l\'obligation de certification' },
        ],
      },
      {
        label: 'Personnel en CDI',
        detail: 'Tout le personnel intervenant doit être en CDI',
        required: true,
        category: 'administratif',
        sources: [
          { type: 'pdf', quote: 'L\'ensemble du personnel intervenant sera en contrat à durée indéterminée', page: 5, reasoning: 'Clause sociale stricte exigeant le CDI' },
        ],
      },
      {
        label: 'Produits écolabellisés',
        detail: 'Produits désinfectants Ecolabel uniquement',
        required: true,
        category: 'environnement',
        sources: [
          { type: 'pdf', quote: 'Seuls les produits porteurs de l\'Ecolabel européen seront utilisés pour l\'ensemble des prestations', page: 7, reasoning: 'Exigence environnementale explicite' },
        ],
      },
      {
        label: 'Astreinte téléphonique',
        detail: '24/7 pendant la durée du marché',
        required: false,
        category: 'opérationnel',
        sources: [
          { type: 'pdf', quote: 'Le prestataire assurera une astreinte téléphonique 24h/24 et 7j/7', page: 9, reasoning: 'Engagement de disponibilité permanente' },
        ],
      },
    ],
    risks: [
      {
        label: 'Disponibilité personnel',
        severity: 'medium',
        detail: 'Recrutement difficile en zone X',
        sources: [
          { type: 'pdf', quote: 'Démarrage J+15 demandé après notification du marché', page: 8, reasoning: 'Le délai de mobilisation rend le recrutement tendu sur ce bassin' },
        ],
      },
      {
        label: 'Délai de mobilisation',
        severity: 'high',
        detail: 'Démarrage J+15 demandé',
        sources: [
          { type: 'pdf', quote: 'Le titulaire devra être en mesure de démarrer les prestations dans un délai de 15 jours', page: 8, reasoning: 'Délai très court nécessitant une anticipation importante' },
        ],
      },
    ],
    checklist: [
      {
        item: 'Joindre attestation ISO 9001 valide',
        required: true,
        sources: [
          { type: 'pdf', quote: 'Joindre la copie certifiée conforme du certificat ISO 9001 en cours de validité', page: 14 },
        ],
      },
      {
        item: 'Fournir liste nominative des agents avec n° contrat CDI',
        required: true,
        sources: [
          { type: 'pdf', quote: 'Fournir la liste nominative du personnel avec les références de contrat de travail', page: 15 },
        ],
      },
      {
        item: 'Annexer fiche technique des produits Ecolabel',
        required: true,
        sources: [
          { type: 'pdf', quote: 'Annexer les fiches techniques et les certificats Ecolabel de l\'ensemble des produits utilisés', page: 15 },
        ],
      },
      {
        item: 'Décrire dispositif d\'astreinte 24/7',
        required: false,
        sources: [
          { type: 'pdf', quote: 'Décrire le dispositif d\'astreinte mis en place pour assurer la disponibilité 24h/24', page: 16 },
        ],
      },
    ],
  }
}
