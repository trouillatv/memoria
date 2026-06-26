'use server'

// Atelier mémoire — agent de Q&A scopé À CE CHANTIER. Pas un chat généraliste :
// « interroger la mémoire de ce site ». À partir d'un DIGEST structuré (pas de
// RAG vectoriel pour l'instant), le LLM SYNTHÉTISE — il propose, il ne décide pas
// (doctrine memoire org : « tu synthétises et tu nommes, tu ne décides pas »).

import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getAIProvider } from '@/services/ai/factory'
import { withAITracking } from '@/services/ai/tracking'
import { getSiteMemoryDigest } from '@/lib/db/site-memory-digest'

const answerSchema = z.object({
  answer: z.string().default(''),
  retiens: z.array(z.string()).default([]),
  next: z.array(z.string()).default([]),
})
export type SiteMemoryAnswer = z.infer<typeof answerSchema>

const SYSTEM = [
  "Tu es le copilote mémoire de CE chantier (et de lui seul). Tu réponds à la question à partir UNIQUEMENT du digest fourni (réunions, visites, actions et réserves ouvertes, décisions, obligations, sujets, signaux, intervenants). Tu remplis :",
  '- answer : réponse COURTE, concrète, factuelle, appuyée sur le digest. Si l\'information manque, dis-le franchement plutôt que d\'inventer.',
  '- retiens : 0 à 4 points clés à RETENIR / SURVEILLER (ce qui traîne, bloque, revient).',
  '- next : 0 à 3 PROCHAINS POINTS à traiter, formulés comme des SUGGESTIONS prudentes ou des questions (« valider le devis ? »), JAMAIS comme un ordre. Tu proposes, l\'humain décide.',
  'INTERDITS : inventer un fait absent du digest ; prédire l\'avenir ; juger ou comparer des personnes. Français, phrases courtes.',
  'Réponds STRICTEMENT en JSON de cette forme : {"answer":"…","retiens":["…"],"next":["…"]}.',
].join('\n')

function mockAnswer(siteName: string, q: string, digestText: string): SiteMemoryAnswer {
  const retiens = digestText.split('\n').filter((l) => l.trim().startsWith('•')).slice(0, 3).map((l) => l.replace(/^\s*•\s*/, ''))
  return {
    answer: `(démo locale) Voici ce que je trouve dans la mémoire de ${siteName} au sujet de « ${q} ». Configurez une clé IA (Gemini/Anthropic) pour une vraie synthèse.`,
    retiens,
    next: [],
  }
}

export async function askSiteMemoryAction(
  siteId: string,
  question: string,
): Promise<{ ok: true; answer: SiteMemoryAnswer; mock: boolean } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') return { ok: false, error: 'Accès refusé' }
  if (!z.string().uuid().safeParse(siteId).success) return { ok: false, error: 'Site invalide' }

  const q = (question ?? '').trim().slice(0, 300)
  if (q.length < 3) return { ok: false, error: 'Question trop courte' }

  const digest = await getSiteMemoryDigest(siteId)
  if (!digest) return { ok: false, error: 'Chantier introuvable' }

  const provider = getAIProvider()
  try {
    const answer = await withAITracking('site_memory_qa', user.id, async () => {
      const userMessage = provider.name === 'mock'
        ? `__MOCK_FIXTURE__:${JSON.stringify(mockAnswer(digest.siteName, q, digest.text))}`
        : `Question : ${q}\n\n=== Mémoire du chantier ${digest.siteName} ===\n${digest.text}`
      const r = await provider.complete({ systemPrompt: SYSTEM, userMessage, responseSchema: answerSchema, modelTier: 'light', maxOutputTokens: 700 })
      const parsed = answerSchema.safeParse(r.parsed)
      const result: SiteMemoryAnswer = parsed.success ? parsed.data : { answer: '', retiens: [], next: [] }
      return { result, tokens: r.tokens, model: r.model, provider: provider.name, durationMs: r.durationMs }
    })
    return { ok: true, answer, mock: provider.name === 'mock' }
  } catch {
    return { ok: false, error: 'Synthèse indisponible' }
  }
}
