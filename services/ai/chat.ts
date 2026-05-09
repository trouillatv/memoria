import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import type { ChatAgentName, DbTenderChatMessage } from '@/types/db'
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

const responseSchema = z.object({ content: z.string().min(1) })

export interface ChatInput {
  agentName: ChatAgentName
  userMessage: string
  attachmentText?: string         // texte extrait d'une PJ optionnelle
  tenderContext: string            // résumé AO + analyses concaténés
  libraryContext: string           // bibliothèque AGP sérialisée (peut être '')
  history: Pick<DbTenderChatMessage, 'role' | 'content' | 'agent_name'>[]
  userId: string | null
}

export interface ChatOutput {
  content: string
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

  const fullSystem = [
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
  ].join('\n')

  const userMsg = input.attachmentText
    ? `${input.userMessage}\n\n--- Document joint (texte extrait) ---\n${input.attachmentText.slice(0, 8000)}`
    : input.userMessage

  return withAITracking(`chat_${input.agentName}`, input.userId, async () => {
    const isMock = provider.name === 'mock'
    const fixture = isMock ? buildMockChatResponse(input.agentName, input.userMessage) : null
    const r = await provider.complete({
      systemPrompt: fullSystem,
      userMessage: isMock ? '__MOCK_FIXTURE__:' + JSON.stringify({ content: fixture }) : userMsg,
      responseSchema,
      modelTier: prompt.modelTier,
    })
    const parsed = responseSchema.safeParse(r.parsed)
    const content = parsed.success ? parsed.data.content : (typeof r.text === 'string' ? r.text : 'Erreur de parsing')

    return {
      result: {
        content,
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

function buildMockChatResponse(agent: ChatAgentName, userMsg: string): string {
  const intros: Record<ChatAgentName, string> = {
    general: "**(Mock — agent général)**\n\nVoici une réponse de démonstration. En mode mock je ne lis pas vraiment le PDF.",
    lecteur_ao: "**(Mock — lecteur AO)**\n\nDans le PDF mock, je vois les contraintes ISO 9001, CDI, Ecolabel et l'astreinte 24/7.",
    memoire_technique: "**(Mock — mémoire technique)**\n\nVoici une reformulation de démo de la mémoire technique :\n\n## Notre approche\n\n_(Réponse mock — pas basée sur le PDF réel.)_",
    contradicteur: "**(Mock — contradicteur)**\n\nPoints faibles potentiels (générés en mock) :\n1. Délai de mobilisation J+15 ambitieux\n2. Pas de plan B si le candidat ne trouve pas le personnel CDI\n3. La marge sur produits Ecolabel est mince",
    financier: "**(Mock — financier)**\n\nEstimations de démo :\n- Coût main d'œuvre : ~22 €/h chargé\n- Volume : ~120 h/mois\n- Marge cible : 12-15 %",
    terrain: "**(Mock — terrain)**\n\nDimensionnement de démo : 3-4 agents tournants, 2 chefs d'équipe, rotation hebdomadaire.",
    conformite: "**(Mock — conformité)**\n\nCertifications attendues (mock) :\n- ISO 9001:2015 (obligatoire)\n- ISO 14001 (recommandé)\n- CQP APH pour les agents",
  }
  return `${intros[agent]}\n\n_Question reçue : "${userMsg.slice(0, 100)}${userMsg.length > 100 ? '...' : ''}"_\n\nPour activer l'IA réelle, basculer \`AI_PROVIDER=gemini\` ou \`anthropic\`.`
}
