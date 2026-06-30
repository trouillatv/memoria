// services/ai/comprehension.ts
// « Voilà ce que j'ai compris » — généré comme PROTOCOLE D'ÉVALUATION (mig 179).
//
// UN appel LLM borné, au-dessus du READ-MODEL déjà structuré (lensTender) — pas
// des 80 photos brutes. Il produit des AFFIRMATIONS ATOMIQUES (une idée notable
// chacune, donc notable d'un seul verdict), chacune CITANT sa provenance (les
// faits du read-model qui la soutiennent → auditable, testable « écho juste »).
//
// Cadrage du prompt = la « lecture de reprise » (cf. lensTakeover) : « un
// conducteur reprend cette affaire demain sans avoir participé à la visite — que
// doit-il comprendre immédiatement ? ». Bien plus proche de l'objectif métier
// qu'un simple « résume ».
//
// L'IA PROPOSE, l'humain JUGE : rien n'est promu en vérité ; chaque affirmation
// est notée (juste / vague / parasite / dangereux). Discipline coût IA : un seul
// appel, retrieval borné au dossier, async. Jamais de jugement sur une personne.

import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import type { AIProviderName } from './index'

export const COMPREHENSION_CATEGORIES = ['site', 'important', 'a_verifier', 'risque', 'poste'] as const
export type ComprehensionCategory = (typeof COMPREHENSION_CATEGORIES)[number]

export const comprehensionSchema = z.object({
  affirmations: z.array(z.object({
    category: z.enum(COMPREHENSION_CATEGORIES).default('important'),
    text: z.string().min(1).max(1000),
    // Indices des faits fournis (numérotés) qui soutiennent l'affirmation.
    support: z.array(z.number().int()).default([]),
  })).max(24).default([]),
})
export type ComprehensionParsed = z.infer<typeof comprehensionSchema>

export interface ComprehensionAffirmation {
  category: ComprehensionCategory
  text: string
  provenance: string[]
}

export interface ComprehensionInput {
  siteName: string
  clientName: string | null
  /** Faits NUMÉROTÉS issus du read-model (lensTender) — l'IA ne lit que ça. */
  facts: string[]
  userId: string | null
}

export interface ComprehensionResult {
  affirmations: ComprehensionAffirmation[]
  model: string | null
  provider: AIProviderName
}

const SYSTEM = `Tu aides un conducteur de travaux qui REPREND cette affaire demain matin sans
avoir participé à la prévisite. À partir UNIQUEMENT des faits numérotés qu'on te
fournit (issus de ce qui a été capté sur le terrain), écris ce qu'il doit
COMPRENDRE immédiatement.

Tu produis une liste d'AFFIRMATIONS ATOMIQUES : une seule idée par affirmation,
formulée pour pouvoir être jugée vraie/fausse d'un coup. Pas de paragraphe, pas
de liste fourre-tout.

Chaque affirmation cite, dans "support", les NUMÉROS des faits qui la soutiennent.
N'affirme RIEN qui ne s'appuie pas sur au moins un fait fourni — n'invente aucun
chiffre, date, nom ou conclusion absente. Quand un indice est mince, formule
prudemment (« semble », « à confirmer ») plutôt que d'affirmer.

Catégories : site (le site et son organisation) · important (points importants
observés) · a_verifier (ce qui reste incertain) · risque (risques de chiffrage /
contraintes lourdes) · poste (postes de travaux potentiels).

Règles :
- JAMAIS de jugement sur une personne — tu parles du site, de l'ouvrage, des
  contraintes, jamais de la valeur des gens.
- Sobre et concret, pas de remplissage. 6 à 15 affirmations selon la matière.
- Si la matière est trop mince pour une catégorie, ne la force pas.`

function buildUserMessage(input: ComprehensionInput): string {
  const head = `Affaire : ${input.siteName}${input.clientName ? ` (donneur d'ordre : ${input.clientName})` : ''}`
  const facts = input.facts.length > 0
    ? input.facts.map((f, i) => `[${i}] ${f}`).join('\n')
    : '(aucun fait capté)'
  return [
    head,
    '',
    '=== Faits captés pendant la prévisite (numérotés) ===',
    facts,
    '',
    'Écris les affirmations atomiques (avec leurs "support"). Réponds en JSON.',
  ].join('\n')
}

/** Mock déterministe : quelques affirmations dérivées des faits (démo sans clé). */
function mockComprehension(input: ComprehensionInput): ComprehensionParsed {
  const n = input.facts.length
  const affirmations: ComprehensionParsed['affirmations'] = []
  if (n > 0) affirmations.push({ category: 'site', text: `Affaire ${input.siteName} — prévisite documentée (${n} élément(s) capté(s)).`, support: [0] })
  for (let i = 0; i < Math.min(n, 4); i++) {
    affirmations.push({ category: 'important', text: input.facts[i].slice(0, 160), support: [i] })
  }
  return { affirmations }
}

/** Mappe les indices "support" → textes de faits (filtre les indices hors borne). */
function resolveProvenance(support: number[], facts: string[]): string[] {
  return [...new Set(support)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < facts.length)
    .map((i) => facts[i])
}

export async function runComprehensionAgent(input: ComprehensionInput): Promise<ComprehensionResult> {
  const provider = getAIProvider()

  const out = await withAITracking('comprehension_synthesis', input.userId, async () => {
    const userMessage = provider.name === 'mock'
      ? `__MOCK_FIXTURE__:${JSON.stringify(mockComprehension(input))}`
      : buildUserMessage(input)
    const res = await provider.complete({
      systemPrompt: SYSTEM,
      userMessage,
      responseSchema: comprehensionSchema,
      modelTier: 'heavy',
      maxOutputTokens: 1600,
    })
    let parsed: ComprehensionParsed | undefined
    if (res.parsed !== undefined && res.parsed !== null) {
      const r = comprehensionSchema.safeParse(res.parsed)
      if (r.success) parsed = r.data
    }
    if (parsed === undefined) {
      try {
        const r = comprehensionSchema.safeParse(JSON.parse(res.text))
        if (r.success) parsed = r.data
      } catch { /* ignore */ }
    }
    if (parsed === undefined) throw new Error('[comprehension] parsing impossible')
    return { result: { parsed, model: res.model }, tokens: res.tokens, model: res.model, provider: provider.name, durationMs: res.durationMs }
  })

  const affirmations: ComprehensionAffirmation[] = out.parsed.affirmations
    .filter((a) => a.text.trim().length > 0)
    .map((a) => ({
      category: a.category,
      text: a.text.trim(),
      provenance: resolveProvenance(a.support, input.facts),
    }))

  return { affirmations, model: out.model, provider: provider.name }
}
