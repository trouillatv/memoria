/**
 * Preuve déterministe du Lot 1 : l'aller-retour OpenAI systématiquement perdu en
 * 429 n'est plus payé à chaque tour.
 *
 * L'audit du 16/08 a montré en production que CHAQUE tour vocal journalisait
 * `openai_error {status:429, code:'insufficient_quota'}` puis
 * `openai_quota_exhausted — fallback Gemini`, pour un coût mesuré de
 * 486 / 1237 / 1520 ms selon la taille de l'audio. Ce test ne mesure pas des
 * millisecondes — il compte les appels réseau, ce qui est reproductible.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { transcribeAudioForCopilot, __resetOpenAiBreaker } from '@/lib/ai/transcribe'

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions'
const GEMINI_HOST = 'generativelanguage.googleapis.com'

/** Compte les appels par fournisseur et rejoue les réponses réelles observées. */
function installFetchSpy(opts: { openaiOk?: boolean } = {}) {
  const calls = { openai: 0, gemini: 0 }
  const fetchMock = vi.fn(async (url: unknown) => {
    const href = String(url)
    if (href.startsWith(OPENAI_URL)) {
      calls.openai++
      if (opts.openaiOk) {
        return new Response(JSON.stringify({ text: 'transcription openai' }), { status: 200 })
      }
      // Corps verbatim du 429 observé en production.
      return new Response(
        JSON.stringify({ error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'quota' } }),
        { status: 429 },
      )
    }
    if (href.includes(GEMINI_HOST)) {
      calls.gemini++
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'transcription gemini' }] } }] }),
        { status: 200 },
      )
    }
    throw new Error(`URL non attendue dans ce test : ${href}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

const AUDIO = new ArrayBuffer(1024)

describe('transcribeAudioForCopilot — disjoncteur OpenAI', () => {
  beforeEach(() => {
    __resetOpenAiBreaker()
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    vi.stubEnv('GOOGLE_GENAI_API_KEY', 'gk-test')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-16T08:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    __resetOpenAiBreaker()
  })

  it('ne paie l’aller-retour 429 qu’UNE fois sur cinq tours consécutifs', async () => {
    const calls = installFetchSpy()

    for (let i = 0; i < 5; i++) {
      const r = await transcribeAudioForCopilot(AUDIO, 'audio/webm', 'webm')
      // Le comportement fonctionnel est identique à avant : c'est Gemini qui transcrit.
      expect(r.text).toBe('transcription gemini')
      expect(r.model).toBe('gemini-2.5-flash')
    }

    expect(calls.openai).toBe(1) // avant le Lot 1 : 5
    expect(calls.gemini).toBe(5)
  })

  it('n’expose plus `openaiMs` une fois le disjoncteur ouvert', async () => {
    installFetchSpy()

    const first = await transcribeAudioForCopilot(AUDIO, 'audio/webm', 'webm')
    expect(first.timings?.openaiMs).toBeTypeOf('number') // le péage du 1er tour

    const second = await transcribeAudioForCopilot(AUDIO, 'audio/webm', 'webm')
    expect(second.timings?.openaiMs).toBeUndefined()     // plus payé du tout
    // La décomposition Gemini, elle, reste présente : c'est ce qui doit expliquer
    // les ~4 s résiduelles au prochain benchmark.
    expect(second.timings?.providerWaitMs).toBeTypeOf('number')
    expect(second.timings?.payloadBytes).toBeGreaterThan(0)
  })

  it('resonde OpenAI après la fenêtre de réessai, sans redéploiement', async () => {
    const calls = installFetchSpy()

    await transcribeAudioForCopilot(AUDIO, 'audio/webm', 'webm')
    expect(calls.openai).toBe(1)

    // Juste avant la fenêtre de 15 min : toujours pas de sonde.
    vi.setSystemTime(new Date('2026-08-16T08:14:59Z'))
    await transcribeAudioForCopilot(AUDIO, 'audio/webm', 'webm')
    expect(calls.openai).toBe(1)

    // Après la fenêtre : une sonde repart.
    vi.setSystemTime(new Date('2026-08-16T08:15:00Z'))
    await transcribeAudioForCopilot(AUDIO, 'audio/webm', 'webm')
    expect(calls.openai).toBe(2)
  })

  it('un quota restauré redevient utilisable et referme le disjoncteur', async () => {
    // Premier tour : quota épuisé → Gemini, disjoncteur ouvert.
    installFetchSpy()
    await transcribeAudioForCopilot(AUDIO, 'audio/webm', 'webm')

    // Le quota revient. La sonde autorisée après 15 min doit le constater.
    vi.setSystemTime(new Date('2026-08-16T08:15:00Z'))
    const calls = installFetchSpy({ openaiOk: true })

    const probe = await transcribeAudioForCopilot(AUDIO, 'audio/webm', 'webm')
    expect(probe.model).toBe('gpt-4o-mini-transcribe')
    expect(calls.openai).toBe(1)

    // Disjoncteur refermé : le tour suivant repart directement sur OpenAI,
    // sans attendre une nouvelle fenêtre.
    const next = await transcribeAudioForCopilot(AUDIO, 'audio/webm', 'webm')
    expect(next.model).toBe('gpt-4o-mini-transcribe')
    expect(calls.openai).toBe(2)
    expect(calls.gemini).toBe(0)
  })

  it('une panne franche (500) reste une erreur, elle n’est pas masquée par le disjoncteur', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) =>
      String(url).startsWith(OPENAI_URL)
        ? new Response(JSON.stringify({ error: { code: 'server_error' } }), { status: 500 })
        : new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    ))

    await expect(transcribeAudioForCopilot(AUDIO, 'audio/webm', 'webm')).rejects.toThrow(/500/)
  })
})
