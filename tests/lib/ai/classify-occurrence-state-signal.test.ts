// Test UNITAIRE (fetch mocké, aucune base) — P1-C2B.4 H2-B.2.
//
// Couvre le contrat de classifyOccurrenceStateSignal : succès sémantique ET, surtout,
// le diagnostic typé sur chaque famille de panne (mandat Vincent : une panne technique
// ne devient JAMAIS silencieusement NO_STATE_SIGNAL). Même pattern de mock que
// tests/lib/transcribe-breaker.test.ts (vi.stubGlobal('fetch', ...) + vi.stubEnv(...)).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { classifyOccurrenceStateSignal } from '@/lib/ai/classify-occurrence-state-signal'

const GEMINI_URL_PREFIX = 'https://generativelanguage.googleapis.com/v1beta/models/'

function geminiResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function geminiTextResponse(text: string) {
  return geminiResponse({ candidates: [{ content: { parts: [{ text }] } }] })
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_GENAI_API_KEY', 'gk-test')
  vi.stubEnv('AI_MODEL_LIGHT', 'gemini-2.5-flash')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('classifyOccurrenceStateSignal — succès sémantique', () => {
  it('retourne le signal, la confiance et l’extrait justificatif', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      geminiTextResponse(JSON.stringify({ signal: 'COMPLETED', confidence: 0.92, evidence_text: 'Travaux réalisés.' })),
    ))

    const result = await classifyOccurrenceStateSignal('Les travaux de reprise ont été réalisés.')

    expect(result).toEqual({ ok: true, signal: 'COMPLETED', confidence: 0.92, evidenceText: 'Travaux réalisés.' })
  })

  it('appelle le modèle configuré via AI_MODEL_LIGHT', async () => {
    vi.stubEnv('AI_MODEL_LIGHT', 'gemini-custom')
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      urls.push(String(url))
      return geminiTextResponse(JSON.stringify({ signal: 'NO_STATE_SIGNAL', confidence: 0.5, evidence_text: '' }))
    }))

    await classifyOccurrenceStateSignal('RAS.')

    expect(urls[0]).toContain('models/gemini-custom:generateContent')
  })
})

describe('classifyOccurrenceStateSignal — diagnostic typé (jamais un repli silencieux)', () => {
  it('CONFIG_ERROR si la clé API est absente', async () => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', '')
    vi.stubGlobal('fetch', vi.fn())

    const result = await classifyOccurrenceStateSignal('Un texte quelconque.')

    expect(result).toMatchObject({ ok: false, errorCode: 'CONFIG_ERROR' })
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('CONFIG_ERROR si le texte fourni est vide', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const result = await classifyOccurrenceStateSignal('   ')

    expect(result).toMatchObject({ ok: false, errorCode: 'CONFIG_ERROR' })
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('NETWORK_ERROR si fetch rejette', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))

    const result = await classifyOccurrenceStateSignal('Un texte quelconque.')

    expect(result).toMatchObject({ ok: false, errorCode: 'NETWORK_ERROR' })
  })

  it('TIMEOUT si la requête est abandonnée', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }))

    const promise = classifyOccurrenceStateSignal('Un texte quelconque.')
    // Le module utilise un vrai setTimeout (pas de fake timers ici) : le test
    // attend le déclenchement réel, borné par le timeout du test lui-même.
    const result = await promise

    expect(result).toMatchObject({ ok: false, errorCode: 'TIMEOUT' })
  }, 25_000)

  it('RATE_LIMIT sur HTTP 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiResponse({ error: 'quota' }, 429)))

    const result = await classifyOccurrenceStateSignal('Un texte quelconque.')

    expect(result).toMatchObject({ ok: false, errorCode: 'RATE_LIMIT' })
  })

  it('PROVIDER_ERROR sur une autre erreur HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiResponse({ error: 'boom' }, 500)))

    const result = await classifyOccurrenceStateSignal('Un texte quelconque.')

    expect(result).toMatchObject({ ok: false, errorCode: 'PROVIDER_ERROR' })
  })

  it('EMPTY_RESPONSE si Gemini ne renvoie aucun texte exploitable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiResponse({ candidates: [] })))

    const result = await classifyOccurrenceStateSignal('Un texte quelconque.')

    expect(result).toMatchObject({ ok: false, errorCode: 'EMPTY_RESPONSE' })
  })

  it('INVALID_RESPONSE si le texte renvoyé n’est pas du JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiTextResponse('ceci n’est pas du JSON')))

    const result = await classifyOccurrenceStateSignal('Un texte quelconque.')

    expect(result).toMatchObject({ ok: false, errorCode: 'INVALID_RESPONSE' })
  })

  it('SCHEMA_VALIDATION_ERROR si le JSON ne respecte pas le schéma attendu', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiTextResponse(JSON.stringify({ signal: 'PAS_UNE_VALEUR_VALIDE' }))))

    const result = await classifyOccurrenceStateSignal('Un texte quelconque.')

    expect(result).toMatchObject({ ok: false, errorCode: 'SCHEMA_VALIDATION_ERROR' })
  })
})
