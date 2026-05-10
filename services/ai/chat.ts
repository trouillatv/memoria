import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import type { ChatAgentName, DbTenderChatMessage } from '@/types/db'
import type { Source } from '@/types/sources'
import { GENERAL_CHAT_V1 } from './prompts/chat/general.v1'
import { LECTEUR_AO_CHAT_V1 } from './prompts/chat/lecteur-ao.v1'
import { MEMOIRE_TECHNIQUE_CHAT_V1 } from './prompts/chat/memoire-technique.v1'
import { CONTRADICTEUR_CHAT_V1 } from './prompts/chat/contradicteur.v1'
import { FINANCIER_CHAT_V1 } from './prompts/chat/financier.v1'
import { TERRAIN_CHAT_V1 } from './prompts/chat/terrain.v1'
import { CONFORMITE_CHAT_V1 } from './prompts/chat/conformite.v1'

const PROMPTS: Record<ChatAgentName, { version: string; modelTier: 'light' | 'heavy'; system: string }> = {
  general: GENERAL_CHAT_V1,
  lecteur_ao: LECTEUR_AO_CHAT_V1,
  memoire_technique: MEMOIRE_TECHNIQUE_CHAT_V1,
  contradicteur: CONTRADICTEUR_CHAT_V1,
  financier: FINANCIER_CHAT_V1,
  terrain: TERRAIN_CHAT_V1,
  conformite: CONFORMITE_CHAT_V1,
}

const sourceSchema = z.object({
  type: z.enum(['pdf', 'library', 'analysis']),
  quote: z.string().max(500),
  page: z.number().int().optional(),
  library_item_title: z.string().max(200).optional(),
  reasoning: z.string().max(200).optional(),
})

const responseSchema = z.object({
  content: z.string().min(1),
  sources: z.array(sourceSchema).max(5).optional(),
})

export interface ChatInput {
  agentName: ChatAgentName
  userMessage: string
  attachmentText?: string         // texte extrait d'une PJ optionnelle
  tenderContext: string            // résumé AO + analyses concaténés
  libraryContext: string           // bibliothèque AGP sérialisée (peut être '')
  history: Pick<DbTenderChatMessage, 'role' | 'content' | 'agent_name'>[]
  userId: string | null
  // si fourni, l'agent reçoit en plus les réponses des autres agents pour réagir/contester
  challengeContext?: { otherAgents: { agent: ChatAgentName; content: string }[] }
}

export interface ChatOutput {
  content: string
  sources?: Source[]              // NEW
  provider: string
  model: string
  promptVersion: string
  inputTokens: number
  outputTokens: number
  durationMs: number
}

export async function chatWithAgent(input: ChatInput): Promise<ChatOutput> {
  const prompt = PROMPTS[input.agentName]
  const provider = getAIProvider()

  const systemParts = [
    prompt.system,
    '',
    '=== Contexte AO ===',
    input.tenderContext || '(aucun contexte AO disponible)',
    '',
    '=== Bibliothèque AGP ===',
    input.libraryContext || '(bibliothèque vide)',
    '',
    '=== Historique récent ===',
    input.history.slice(-10).map(m => `[${m.role}${m.agent_name ? `:${m.agent_name}` : ''}] ${m.content}`).join('\n') || '(aucun message précédent)',
  ]

  if (input.challengeContext && input.challengeContext.otherAgents.length > 0) {
    const otherAgentsBloc = input.challengeContext.otherAgents
      .map((o) => `[Agent ${o.agent}] : ${o.content}`)
      .join('\n\n---\n\n')
    systemParts.push(
      '',
      '=== Réponses des autres agents (round précédent) ===',
      otherAgentsBloc,
      '',
      `Ta mission : réagir, contester, compléter ou nuancer leurs réponses depuis ta perspective d'agent ${input.agentName}. Sois direct, factuel.`,
    )
  }

  const fullSystem = systemParts.join('\n')

  const userMsg = input.attachmentText
    ? `${input.userMessage}\n\n--- Document joint (texte extrait) ---\n${input.attachmentText.slice(0, 8000)}`
    : input.userMessage

  return withAITracking(`chat_${input.agentName}`, input.userId, async () => {
    const isMock = provider.name === 'mock'
    const isChallenge = !!(input.challengeContext && input.challengeContext.otherAgents.length > 0)
    const fixture = isMock ? buildMockChatResponse(input.agentName, input.userMessage, isChallenge) : null
    const r = await provider.complete({
      systemPrompt: fullSystem,
      userMessage: isMock ? '__MOCK_FIXTURE__:' + JSON.stringify(fixture) : userMsg,
      responseSchema,
      modelTier: prompt.modelTier,
    })
    const parsed = responseSchema.safeParse(r.parsed)
    const content = parsed.success ? parsed.data.content : (typeof r.text === 'string' ? r.text : 'Erreur de parsing')
    const sources = parsed.success ? parsed.data.sources : undefined

    return {
      result: {
        content,
        sources,
        provider: provider.name,
        model: r.model,
        promptVersion: prompt.version,
        inputTokens: r.tokens.input,
        outputTokens: r.tokens.output,
        durationMs: r.durationMs,
      },
      tokens: r.tokens,
      model: r.model,
      provider: provider.name as 'mock' | 'gemini' | 'anthropic' | 'openai',
      durationMs: r.durationMs,
    }
  })
}

function buildMockChatResponse(agent: ChatAgentName, userMsg: string, isChallenge = false): { content: string; sources: Source[] } {
  const intros: Record<ChatAgentName, string> = {
    general: "**(Mock — agent général)**\n\nVoici une réponse de démonstration. En mode mock je ne lis pas vraiment le PDF.",
    lecteur_ao: "**(Mock — lecteur AO)**\n\nDans le PDF mock, je vois les contraintes ISO 9001, CDI, Ecolabel et l'astreinte 24/7.",
    memoire_technique: "**(Mock — mémoire technique)**\n\nVoici une reformulation de démo de la mémoire technique :\n\n## Notre approche\n\n_(Réponse mock — pas basée sur le PDF réel.)_",
    contradicteur: "**(Mock — contradicteur)**\n\nPoints faibles potentiels (générés en mock) :\n1. Délai de mobilisation J+15 ambitieux\n2. Pas de plan B si le candidat ne trouve pas le personnel CDI\n3. La marge sur produits Ecolabel est mince",
    financier: "**(Mock — financier)**\n\nEstimations de démo :\n- Coût main d'œuvre : ~22 €/h chargé\n- Volume : ~120 h/mois\n- Marge cible : 12-15 %",
    terrain: "**(Mock — terrain)**\n\nDimensionnement de démo : 3-4 agents tournants, 2 chefs d'équipe, rotation hebdomadaire.",
    conformite: "**(Mock — conformité)**\n\nCertifications attendues (mock) :\n- ISO 9001:2015 (obligatoire)\n- ISO 14001 (recommandé)\n- CQP APH pour les agents",
  }

  const mockSources: Record<ChatAgentName, Source[]> = {
    general: [
      {
        type: 'pdf',
        quote: 'Le candidat doit justifier d\'une expérience d\'au moins 3 ans dans le nettoyage de sites hospitaliers.',
        page: 3,
        reasoning: 'Critère de recevabilité clé à mettre en avant dans la réponse',
      },
    ],
    lecteur_ao: [
      {
        type: 'pdf',
        quote: 'Astreinte 24/7 obligatoire pendant toute la durée du marché, avec intervention sous 2h.',
        page: 8,
        reasoning: 'Contrainte opérationnelle majeure impliquant un surcoût RH significatif',
      },
      {
        type: 'pdf',
        quote: 'Certification ISO 9001 version 2015 exigée pour soumissionner.',
        page: 2,
        reasoning: 'Critère éliminatoire — à vérifier en priorité avant dépôt',
      },
    ],
    memoire_technique: [
      {
        type: 'library',
        quote: '14 agents CDI, dont 8 CQP APH, déployés sur sites similaires en milieu hospitalier.',
        library_item_title: 'Moyens humains — équipe permanente',
        reasoning: 'Référence de capacité humaine à valoriser dans la mémoire technique',
      },
      {
        type: 'pdf',
        quote: 'Les agents doivent être formés aux protocoles de bio-nettoyage en zone à risque.',
        page: 11,
        reasoning: 'Exigence à couvrir explicitement dans la section formation de la mémoire',
      },
    ],
    contradicteur: [
      {
        type: 'pdf',
        quote: 'Pénalités de retard : 5% du montant mensuel du marché par jour calendaire de retard.',
        page: 12,
        reasoning: 'Citation directe de la clause sanctionnante — exposition financière à chiffrer',
      },
      {
        type: 'analysis',
        quote: 'Marge cible 15% — hypothèse financier sur base volume 120h/mois.',
        reasoning: 'Hypothèse à challenger : pénalité × jours possibles peut dépasser la marge entière',
      },
    ],
    financier: [
      {
        type: 'pdf',
        quote: 'Astreinte 24/7 obligatoire pendant la durée du marché.',
        page: 7,
        reasoning: 'Coût caché estimé à +8k€/an à intégrer dans le chiffrage',
      },
      {
        type: 'library',
        quote: '14 agents CDI, dont 8 CQP APH',
        library_item_title: 'Moyens humains — équipe permanente',
        reasoning: 'Base de calcul du coût main d\'œuvre pour ce type de marché',
      },
    ],
    terrain: [
      {
        type: 'pdf',
        quote: 'Accès aux zones techniques uniquement entre 6h et 8h du matin, hors co-activité.',
        page: 9,
        reasoning: 'Contrainte horaire qui impose des rotations spécifiques et un encadrement dédié',
      },
      {
        type: 'analysis',
        quote: 'Dimensionnement initial estimé à 3-4 agents tournants + 1 chef d\'équipe.',
        reasoning: 'Base de calcul à affiner selon le plan de charge exact du site',
      },
    ],
    conformite: [
      {
        type: 'pdf',
        quote: 'ISO 9001:2015 et Ecolabel européen exigés. CQP APH recommandé mais non éliminatoire.',
        page: 2,
        reasoning: 'Checklist de certifications obligatoires à vérifier avant dépôt du dossier',
      },
    ],
  }

  const content = isChallenge
    ? `**(Mock — challenge round)**\n\nJe réagis aux autres agents : depuis ma perspective d'agent **${agent}**, je nuance / conteste les points soulevés.\n\n${intros[agent]}\n\n_Question initiale : "${userMsg.slice(0, 100)}${userMsg.length > 100 ? '...' : ''}"_\n\nPour activer l'IA réelle, basculer \`AI_PROVIDER=gemini\` ou \`anthropic\`.`
    : `${intros[agent]}\n\n_Question reçue : "${userMsg.slice(0, 100)}${userMsg.length > 100 ? '...' : ''}"_\n\nPour activer l'IA réelle, basculer \`AI_PROVIDER=gemini\` ou \`anthropic\`.`

  return { content, sources: mockSources[agent] }
}
