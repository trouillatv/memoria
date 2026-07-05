// services/ai/visit-summary.ts
// Le RÉSUMÉ de visite — la SEULE IA de la chaîne, à la fin, sur du TEXTE.
//
// Architecture (cf. décision produit) : 80-90 % du CR est déterministe (compteurs,
// tags, photos, dates). L'IA n'intervient QUE pour transformer les observations
// brutes en 5 phrases lisibles. Elle ORGANISE, elle N'INVENTE RIEN, elle PROPOSE
// (le conducteur corrige). Coût maîtrisé : jamais les images/vidéos dans le LLM,
// et GATE — sous 3 observations, aucun appel (résumé déterministe).

import { getAIProvider } from './factory'
import { withAITracking } from './tracking'

export interface VisitSummaryInput {
  siteName: string
  objective: string | null
  /** Ce qui a été noté/dit/commenté (notes, transcriptions, commentaires photo). */
  constats: string[]
  reserves: string[]
  actions: string[]
  surveiller: string[]
  photoCount: number
  userId: string | null
}

const SYSTEM = `Tu es MemorIA. Tu rédiges le RÉSUMÉ d'une visite de chantier à partir UNIQUEMENT des éléments fournis.
Règles STRICTES :
- 5 phrases maximum, factuelles et sobres.
- Tu ORGANISES ce qui a été observé ; tu N'INVENTES RIEN. Aucun fait, chiffre ou nom qui ne soit pas dans les données.
- Interdit les formules creuses ("visite productive"). Va au concret : sujets traités, réserves, points de vigilance, actions.
- Français, ton d'un conducteur de travaux qui débriefe. Pas de titre, pas de liste : un paragraphe.`

/** Nombre d'observations « signifiantes » — sert de GATE (< 3 → pas d'IA). */
function observationCount(input: VisitSummaryInput): number {
  return input.constats.length + input.reserves.length + input.actions.length + input.surveiller.length
}

function deterministicSummary(input: VisitSummaryInput): string {
  const parts: string[] = []
  if (input.reserves.length) parts.push(`${input.reserves.length} réserve${input.reserves.length > 1 ? 's' : ''} relevée${input.reserves.length > 1 ? 's' : ''}`)
  if (input.actions.length) parts.push(`${input.actions.length} action${input.actions.length > 1 ? 's' : ''} à prévoir`)
  if (input.surveiller.length) parts.push(`${input.surveiller.length} point${input.surveiller.length > 1 ? 's' : ''} à surveiller`)
  if (parts.length > 0) return `Visite avec ${parts.join(', ')}.`
  // Des constats sans tag = observations réelles : ne JAMAIS dire « aucune ».
  if (input.constats.length > 0) {
    return `Visite de suivi — ${input.constats.length} constat${input.constats.length > 1 ? 's' : ''} relevé${input.constats.length > 1 ? 's' : ''}.`
  }
  return 'Aucune observation particulière — captures conservées pour la mémoire du chantier.'
}

/**
 * Produit le résumé. Déterministe sous le seuil ou si l'IA échoue (le CR ne doit
 * JAMAIS être bloqué par l'IA). Un seul appel `light`, borné en tokens.
 */
export async function runVisitSummary(input: VisitSummaryInput): Promise<string> {
  if (observationCount(input) < 3) return deterministicSummary(input)

  const provider = getAIProvider()
  // Pas de clé IA (mock) → résumé déterministe, aucun appel. L'IA « rédige »
  // seulement quand un vrai provider est configuré.
  if (provider.name === 'mock') return deterministicSummary(input)

  const section = (title: string, items: string[]) =>
    items.length ? `${title} :\n${items.map((s) => `- ${s}`).join('\n')}` : null
  const userMessage = [
    `Chantier : ${input.siteName}`,
    input.objective ? `Objectif : ${input.objective}` : null,
    `Photos prises : ${input.photoCount}`,
    section('Constats', input.constats),
    section('Réserves', input.reserves),
    section('Actions à prévoir', input.actions),
    section('Points à surveiller', input.surveiller),
    '',
    'Rédige le résumé (5 phrases maximum).',
  ].filter(Boolean).join('\n')

  try {
    return await withAITracking('visit_summary', input.userId, async () => {
      const out = await provider.complete({ systemPrompt: SYSTEM, userMessage, modelTier: 'light', maxOutputTokens: 400 })
      const text = (out.text ?? '').trim()
      return { result: text || deterministicSummary(input), tokens: out.tokens, model: out.model, provider: provider.name, durationMs: out.durationMs }
    })
  } catch {
    return deterministicSummary(input)
  }
}
