// Test UNITAIRE (fetch mocké, aucune base) — lot post-shutter rework (mandat Vincent
// 2026-08-24). Couvre le contrat de normalizeCaptionWithLLM : nettoyage de FORME
// uniquement (pass-through de ce que renvoie le modèle), diagnostic typé sur chaque
// famille de panne, jamais un repli silencieux. Même pattern de mock que
// tests/lib/ai/classify-occurrence-state-signal.test.ts.
//
// Les 7 cas de doctrine du mandat sont répartis :
// - 1 à 5 (euh/hésitation, négation, incertitude, approximation, noms/nombres) : ici,
//   en contrat pass-through — on vérifie que la fonction relaie fidèlement une légende
//   déjà conforme à la doctrine, sans la modifier davantage, ET que le prompt envoyé au
//   modèle porte explicitement chaque garde-fou (négation, incertitude, mesures).
// - 6 (nettoyage indisponible → transcript brut) : ici, côté normalizeCaptionWithLLM
//   (ok:false), le repli sur le brut est vérifié côté appelant dans
//   tests/field capture-actions (transcribeDictationAction).
// - 7 (capture 1 puis capture 2 → pas de fuite de légende) : composant, hors périmètre
//   de cette fonction pure — couvert par les tests PostShutterDictation.tsx.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { normalizeCaptionWithLLM } from '@/lib/ai/normalize-caption'

function geminiResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function geminiCaptionResponse(caption: string) {
  return geminiResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ caption }) }] } }] })
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_GENAI_API_KEY', 'gk-test')
  vi.stubEnv('AI_MODEL_LIGHT', 'gemini-2.5-flash')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('normalizeCaptionWithLLM — nettoyage de forme, jamais de fond', () => {
  it('« euh la fissure elle est toujours là quoi » → formulation propre, même fait (test doctrine #1)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiCaptionResponse('La fissure est toujours là.')))

    const result = await normalizeCaptionWithLLM('euh la fissure elle est toujours là quoi')

    expect(result).toEqual({ ok: true, caption: 'La fissure est toujours là.' })
  })

  it('« R4 n\'est toujours pas réglé » → négation strictement conservée (test doctrine #2)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiCaptionResponse('R4 n’est toujours pas réglé.')))

    const result = await normalizeCaptionWithLLM('R4 n\'est toujours pas réglé')

    expect(result.ok).toBe(true)
    expect(result.ok && result.caption).toMatch(/n[’']est toujours pas/)
  })

  it('« peut-être une infiltration » → « peut-être » conservé (test doctrine #3)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiCaptionResponse('Peut-être une infiltration.')))

    const result = await normalizeCaptionWithLLM('peut-être une infiltration')

    expect(result.ok).toBe(true)
    expect(result.ok && result.caption.toLowerCase()).toContain('peut-être')
  })

  it('« environ 12 mètres » → « environ » conservé, jamais une mesure certaine (test doctrine #4)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiCaptionResponse('Environ 12 mètres.')))

    const result = await normalizeCaptionWithLLM('environ 12 mètres')

    expect(result.ok).toBe(true)
    expect(result.ok && result.caption.toLowerCase()).toContain('environ')
    expect(result.ok && result.caption).toContain('12')
  })

  it('nom d\'entreprise et nombres inchangés (test doctrine #5)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiCaptionResponse('SOTRAMEC a livré 3 palettes le 12 mars.')))

    const result = await normalizeCaptionWithLLM('euh donc SOTRAMEC a livré euh 3 palettes le 12 mars')

    expect(result.ok).toBe(true)
    expect(result.ok && result.caption).toBe('SOTRAMEC a livré 3 palettes le 12 mars.')
  })

  it('le prompt envoyé au modèle porte explicitement les garde-fous de doctrine', async () => {
    let sentBody: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = String(init?.body ?? '')
      return geminiCaptionResponse('Peu importe.')
    }))

    await normalizeCaptionWithLLM('un texte quelconque')

    expect(sentBody).toBeDefined()
    const prompt = JSON.parse(sentBody as string).systemInstruction.parts[0].text as string
    expect(prompt).toMatch(/négation/i)
    expect(prompt).toMatch(/incertitude/i)
    expect(prompt).toMatch(/nombre/i)
    expect(prompt).toMatch(/interdit/i)
  })
})

describe('normalizeCaptionWithLLM — texte vide (rien à nettoyer)', () => {
  it('ne relaie pas d’appel réseau pour un texte vide', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const result = await normalizeCaptionWithLLM('   ')

    expect(result).toEqual({ ok: true, caption: '' })
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
})

describe('normalizeCaptionWithLLM — diagnostic typé (jamais un repli silencieux, test doctrine #6)', () => {
  it('CONFIG_ERROR si la clé API est absente', async () => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', '')
    vi.stubGlobal('fetch', vi.fn())

    const result = await normalizeCaptionWithLLM('un texte quelconque')

    expect(result).toMatchObject({ ok: false, errorCode: 'CONFIG_ERROR' })
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('NETWORK_ERROR si fetch rejette', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))

    const result = await normalizeCaptionWithLLM('un texte quelconque')

    expect(result).toMatchObject({ ok: false, errorCode: 'NETWORK_ERROR' })
  })

  it('RATE_LIMIT sur HTTP 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiResponse({ error: 'quota' }, 429)))

    const result = await normalizeCaptionWithLLM('un texte quelconque')

    expect(result).toMatchObject({ ok: false, errorCode: 'RATE_LIMIT' })
  })

  it('PROVIDER_ERROR sur une autre erreur HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiResponse({ error: 'boom' }, 500)))

    const result = await normalizeCaptionWithLLM('un texte quelconque')

    expect(result).toMatchObject({ ok: false, errorCode: 'PROVIDER_ERROR' })
  })

  it('EMPTY_RESPONSE si Gemini ne renvoie aucun texte exploitable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiResponse({ candidates: [] })))

    const result = await normalizeCaptionWithLLM('un texte quelconque')

    expect(result).toMatchObject({ ok: false, errorCode: 'EMPTY_RESPONSE' })
  })

  it('INVALID_RESPONSE si le texte renvoyé n’est pas du JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiResponse({ candidates: [{ content: { parts: [{ text: 'pas du JSON' }] } }] })))

    const result = await normalizeCaptionWithLLM('un texte quelconque')

    expect(result).toMatchObject({ ok: false, errorCode: 'INVALID_RESPONSE' })
  })

  it('SCHEMA_VALIDATION_ERROR si le JSON ne respecte pas le schéma attendu', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ pasLeChamp: 'x' }) }] } }] })))

    const result = await normalizeCaptionWithLLM('un texte quelconque')

    expect(result).toMatchObject({ ok: false, errorCode: 'SCHEMA_VALIDATION_ERROR' })
  })

  it('EMPTY_RESPONSE si le modèle renvoie une légende vide', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiCaptionResponse('   ')))

    const result = await normalizeCaptionWithLLM('un texte quelconque')

    expect(result).toMatchObject({ ok: false, errorCode: 'EMPTY_RESPONSE' })
  })
})
