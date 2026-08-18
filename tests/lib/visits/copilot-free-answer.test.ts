import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AIProvider, CompletionOutput } from '@/services/ai'

// Dette signalée par Vincent en revue de D1 (streaming vocal, commit
// 67da5ee8, 2026-08-16) : `SPOKEN_FIELD_RE` — la regex qui détecte la fin du
// champ `spokenText` dans le JSON accumulé au fil du flux Gemini — n'avait
// aucun test sur : apostrophes/guillemets, accents, `\n`, un chunk coupé en
// plein milieu d'une séquence échappée, une livraison en chunks minuscules,
// et `spokenText` proche de la limite de troncature. « Ce n'est pas une
// raison pour bloquer la recette terrain, juste le prochain endroit où une
// régression discrète pourrait apparaître. »
//
// Ces tests passent par le vrai chemin de code (`answerCopilotFreeQuestionStream`
// avec un provider streamé scripté), pas par la regex isolée : ce qu'on
// vérifie ici est la robustesse de l'ACCUMULATION chunk par chunk, propriété
// que la regex seule ne peut pas exercer.

const mocks = vi.hoisted(() => ({ getAIProvider: vi.fn() }))
vi.mock('@/services/ai/factory', () => ({ getAIProvider: mocks.getAIProvider }))

import { answerCopilotFreeQuestion, answerCopilotFreeQuestionStream } from '@/lib/visits/copilot-free-answer'
import { sanitizeSpokenText } from '@/lib/voice/spoken-answer'

const FINAL: CompletionOutput = {
  text: '{"text":"Réponse écrite complète.","citedIds":[]}',
  parsed: { text: 'Réponse écrite complète.', citedIds: [] },
  tokens: { input: 10, output: 10 },
  model: 'test-model',
  durationMs: 1,
  finishReason: 'STOP',
}

function providerWithChunks(chunks: string[]): AIProvider {
  return {
    name: 'mock',
    complete: async () => FINAL,
    completeStream: async function* () {
      for (const chunk of chunks) yield chunk
      return FINAL
    },
  }
}

function fullJson(spokenRaw: string): string {
  return JSON.stringify({ spokenText: spokenRaw, text: 'Réponse écrite complète.', citedIds: [] })
}

/** Simule un flux Gemini granulaire : découpe en chunks de taille fixe. */
function chunkEvery(str: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size))
  return out
}

/** Découpe `str` exactement aux index donnés — cible un point précis (ex. en plein milieu d'une séquence échappée). */
function chunksAt(str: string, cuts: number[]): string[] {
  const points = [0, ...cuts, str.length]
  const out: string[] = []
  for (let i = 0; i < points.length - 1; i++) out.push(str.slice(points[i], points[i + 1]))
  return out.filter((c) => c.length > 0)
}

async function runStream(chunks: string[]): Promise<string[]> {
  mocks.getAIProvider.mockReturnValue(providerWithChunks(chunks))
  const spoken: string[] = []
  await answerCopilotFreeQuestionStream(
    'Question test',
    [],
    [],
    [],
    null,
    [],
    'Chantier Test',
    undefined,
    { onSpokenReady: (t) => spoken.push(t) },
  )
  return spoken
}

describe('answerCopilotFreeQuestionStream — robustesse du parsing spokenText en flux', () => {
  beforeEach(() => {
    mocks.getAIProvider.mockReset()
  })

  it('annonce spokenText correctement quand il contient des apostrophes et des guillemets', async () => {
    const raw = `Le lot "façade" de l'entreprise est terminé.`
    const spoken = await runStream(chunkEvery(fullJson(raw), 5))
    expect(spoken).toEqual([sanitizeSpokenText(raw)])
  })

  it('annonce spokenText correctement avec des caractères accentués', async () => {
    const raw = `Ça y est, c'est réglé : la réception a été prononcée hier après-midi.`
    const spoken = await runStream(chunkEvery(fullJson(raw), 7))
    expect(spoken).toEqual([sanitizeSpokenText(raw)])
  })

  it('normalise les retours à la ligne internes en espace', async () => {
    const raw = 'Première phrase.\nDeuxième phrase.'
    const spoken = await runStream(chunkEvery(fullJson(raw), 4))
    expect(spoken).toEqual(['Première phrase. Deuxième phrase.'])
  })

  it("reste correct quand un chunk coupe en plein milieu d'une séquence échappée", async () => {
    const raw = `Le point "réserve n°3" est levé.`
    const json = fullJson(raw)
    const escapeIndex = json.indexOf('\\"')
    expect(escapeIndex).toBeGreaterThan(-1)
    // Coupe juste après le backslash, avant le guillemet échappé.
    const chunks = chunksAt(json, [escapeIndex + 1])
    const spoken = await runStream(chunks)
    expect(spoken).toEqual([sanitizeSpokenText(raw)])
  })

  it("reste correct livré en chunks d'un seul caractère", async () => {
    const raw = `Trois anomalies restent ouvertes, dont une de sécurité.`
    const spoken = await runStream(chunkEvery(fullJson(raw), 1))
    expect(spoken).toEqual([sanitizeSpokenText(raw)])
  })

  it('tronque à la dernière phrase complète quand spokenText dépasse la limite de troncature', async () => {
    const sentence = 'Le lot électricité avance normalement sur ce secteur du chantier. '
    const raw = sentence.repeat(10).trim()
    expect(raw.length).toBeGreaterThan(450)
    const spoken = await runStream(chunkEvery(fullJson(raw), 13))
    expect(spoken).toEqual([sanitizeSpokenText(raw)])
    expect(spoken[0]!.length).toBeLessThanOrEqual(450)
  })

  it("une séquence d'échappement invalide dans le flux ne fait pas planter la réponse et n'annonce rien", async () => {
    // `\q` n'est pas un échappement JSON valide : simule une génération corrompue.
    const badJson = '{"spokenText":"Valeur cass\\qée bizarre.","text":"Réponse écrite complète.","citedIds":[]}'
    const spoken = await runStream(chunkEvery(badJson, 6))
    expect(spoken).toEqual([])
  })
})

// Fix mutation-claim (Vincent 2026-08-18) : une réponse READ/answer/llm affirmait
// avoir exécuté un retrait/une création alors qu'aucun writer n'avait tourné
// (terrain OCEF : « Ne surveille pas le regard R4. » → « Je l'ai retiré de votre
// suivi actif. »). Garantie structurelle à deux niveaux — vérifiée ici au niveau
// du contexte transmis au LLM, jamais au niveau d'une reformulation de prompt
// seule : `mutation` doit TOUJOURS être présent dans le contexte envoyé au
// modèle, quel que soit l'appelant, et refléter fidèlement `extra`.
describe('answerCopilotFreeQuestion — contexte "mutation" toujours transmis au LLM', () => {
  beforeEach(() => {
    mocks.getAIProvider.mockReset()
  })

  function captureUserMessage(extra?: Parameters<typeof answerCopilotFreeQuestion>[7]): Promise<string> {
    let captured = ''
    mocks.getAIProvider.mockReturnValue({
      name: 'mock',
      complete: async (req: { userMessage: string }) => {
        captured = req.userMessage
        return FINAL
      },
    })
    return answerCopilotFreeQuestion('Question test', [], [], [], null, [], 'Chantier Test', extra).then(() => captured)
  }

  it('sans `extra` (aucun appelant ne le fournit) : mutation.status="none", neutralizedWrite=false', async () => {
    const userMessage = await captureUserMessage(undefined)
    expect(userMessage).toContain('"mutation"')
    const context = JSON.parse(userMessage.split('\n\nContexte :\n')[1]!)
    expect(context.mutation).toEqual({ status: 'none', neutralizedWrite: false })
  })

  it('avec `extra.neutralizedWrite=true` (négation d\'un verbe d\'écriture) : le contexte le porte fidèlement', async () => {
    const userMessage = await captureUserMessage({ mutationStatus: 'none', neutralizedWrite: true })
    const context = JSON.parse(userMessage.split('\n\nContexte :\n')[1]!)
    expect(context.mutation).toEqual({ status: 'none', neutralizedWrite: true })
  })

  it('avec `extra.neutralizedWrite=false` (lecture ordinaire, aucune négation) : le contexte le porte fidèlement', async () => {
    const userMessage = await captureUserMessage({ mutationStatus: 'none', neutralizedWrite: false })
    const context = JSON.parse(userMessage.split('\n\nContexte :\n')[1]!)
    expect(context.mutation).toEqual({ status: 'none', neutralizedWrite: false })
  })
})

// Le niveau prompt de la même garantie : une règle absolue doit interdire toute
// revendication de mutation quand mutation.status="none", sans jamais interdire
// la reformulation naturelle d'une absence d'action (« D'accord, rien ne sera
// planifié » reste une réponse acceptable — ce n'est pas la même chose que
// « J'ai supprimé la réunion »).
describe('SYSTEM_PROMPT — règle absolue anti-revendication de mutation', () => {
  function readSystemPrompt(): string {
    const source = readFileSync(join(__dirname, '..', '..', '..', 'lib', 'visits', 'copilot-free-answer.ts'), 'utf-8')
    const match = source.match(/const SYSTEM_PROMPT = `[\s\S]*?`/)
    expect(match).not.toBeNull()
    return match![0]
  }

  it('interdit explicitement de revendiquer un ajout/retrait/création/planification/modification/clôture quand mutation.status="none"', () => {
    const prompt = readSystemPrompt()
    expect(prompt).toMatch(/mutation\.status/)
    expect(prompt).toMatch(/JAMAIS/)
    expect(prompt).toContain('neutralizedWrite')
  })

  // Vincent 2026-08-19 : le fix précédent (05eeb1f0) n'interdisait que les
  // revendications au PASSÉ ("j'ai retiré"). La recette terrain OCEF a montré
  // deux échecs au FUTUR — sémantiquement identiques au bug initial :
  // « Ne surveille pas le regard R4. » → « ... ne sera plus surveillé... »
  // « ... ne fait rien pour demain. » → « ... ne sera pas inclus dans votre plan... »
  // La garde doit donc explicitement couvrir les formulations futures, pas
  // seulement les exemples au passé.
  it('interdit explicitement les formulations FUTURES de changement d\'état ("ne sera plus", "sera retiré", "ne sera pas inclus"), pas seulement le passé', () => {
    const prompt = readSystemPrompt()
    expect(prompt).toMatch(/passé/)
    expect(prompt).toMatch(/présent/)
    expect(prompt).toMatch(/futur/i)
    expect(prompt).toContain('ne sera plus surveillé')
    expect(prompt).toContain('ne sera pas inclus dans votre plan de visite')
    expect(prompt).toContain('sera supprimée')
    expect(prompt).toContain('sera retiré')
  })

  it('distingue la négation d\'une création nouvelle (reformulation simple) de la négation d\'un suivi existant (confirmation explicite sans changement)', () => {
    const prompt = readSystemPrompt()
    // Cas 1 — création nouvelle : reformulation d'absence d'action au présent.
    expect(prompt).toContain('Je ne programme aucune nouvelle visite vendredi à partir de cette demande.')
    expect(prompt).toContain('Je ne crée ni ne planifie rien pour demain à partir de cette demande.')
    // Cas 2 — arrêt d'un suivi possiblement déjà existant : confirmation explicite, aucun changement affirmé.
    expect(prompt).toContain("J'ai compris que vous ne souhaitez plus surveiller le Regard R4. Aucun changement n'a été effectué sur le suivi.")
  })
})
