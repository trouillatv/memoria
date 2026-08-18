// @vitest-environment node
/**
 * Décisions structurelles Vincent (2026-08-18), après l'audit vocal PETRO
 * 6487ff04 :
 *  1. La normalisation lexicale (P0-1, 6fda9f64) devient commune à toute
 *     transcription persistée par `transcribeAudio` — pas seulement au
 *     Copilote vocal live.
 *  2. Le fallback Whisper ne doit jamais persister une hallucination connue
 *     (démontrée sur 56065499 et 3f381cc3) — signatures fermées, pas de
 *     détection générique.
 *
 * Réseau (fetch) et vocabulaire (`buildSiteVocabulary`, backé par la DB) sont
 * mockés : ce fichier prouve le câblage, pas les fournisseurs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transcribeAudio } from '@/lib/ai/transcribe'
import type { VocabularyTerm } from '@/lib/ai/transcript-normalizer'

const GEMINI_HOST = 'generativelanguage.googleapis.com'
const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions'

vi.mock('@/lib/ai/stt-vocabulary', () => ({
  buildSiteVocabulary: vi.fn(
    async (): Promise<VocabularyTerm[]> => [
      {
        canonical: 'PETRO ATTITI',
        kind: 'site',
        forms: [
          { value: 'P3 à Titi', source: 'known_mistranscription', canonicalValue: 'PETRO ATTITI' },
          { value: 'Pétro à Titi', source: 'known_mistranscription', canonicalValue: 'PETRO ATTITI' },
          { value: 'Petrofac Titi', source: 'known_mistranscription', canonicalValue: 'PETRO ATTITI' },
        ],
      },
    ],
  ),
}))

function respGemini(text: string, finishReason = 'STOP') {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }] }),
    { status: 200 },
  )
}

/** Distingue l'appel Gemini PRIMAIRE de sa CONTINUATION par le contenu du prompt système. */
function installGeminiFlow(opts: { primaryText: string; continuationText?: string; whisperText?: string }) {
  const calls = { primary: 0, continuation: 0, whisper: 0 }
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const href = String(url)
    if (href.startsWith(OPENAI_URL)) {
      calls.whisper++
      return new Response(JSON.stringify({ text: opts.whisperText ?? '' }), { status: 200 })
    }
    if (href.includes(GEMINI_HOST)) {
      const body = String(init?.body ?? '')
      if (body.includes('Reprends la transcription')) {
        calls.continuation++
        return respGemini(opts.continuationText ?? '', 'STOP')
      }
      calls.primary++
      return respGemini(opts.primaryText, 'STOP')
    }
    throw new Error(`URL non attendue dans ce test : ${href}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

const SMALL_AUDIO = new ArrayBuffer(1024) // < seuil de continuation (60 000 o)
const LONG_AUDIO = new ArrayBuffer(70_000) // > seuil : déclenche la détection de troncature

describe('transcribeAudio — normalisation lexicale commune', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', 'gk-test')
    vi.stubEnv('OPENAI_API_KEY', '')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('corrige une forme fausse connue quand un siteId est fourni', async () => {
    installGeminiFlow({ primaryText: 'Chantier de P3 à Titi, compte rendu du jour.' })
    const text = await transcribeAudio(SMALL_AUDIO, 'audio/webm', 'webm', 'site-petro')
    expect(text).toContain('PETRO ATTITI')
    expect(text).not.toContain('P3 à Titi')
  })

  it('sans siteId, le texte est rendu strictement inchangé (aucune régression)', async () => {
    installGeminiFlow({ primaryText: 'Chantier de P3 à Titi, compte rendu du jour.' })
    const text = await transcribeAudio(SMALL_AUDIO, 'audio/webm', 'webm')
    expect(text).toBe('Chantier de P3 à Titi, compte rendu du jour.')
  })

  it('un transcript sain sans terme du vocabulaire reste inchangé', async () => {
    installGeminiFlow({ primaryText: 'Rien à signaler aujourd’hui sur ce chantier.' })
    const text = await transcribeAudio(SMALL_AUDIO, 'audio/webm', 'webm', 'site-petro')
    expect(text).toBe('Rien à signaler aujourd’hui sur ce chantier.')
  })
})

describe('transcribeAudio — garde anti-hallucination Whisper', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', 'gk-test')
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('rejette la signature « abonnement / vidéos » (cas réel 56065499) — garde le texte Gemini', async () => {
    const calls = installGeminiFlow({
      primaryText: 'Ils ont tout regroupé dans un sac à l’extérieur pour les gravats',
      continuationText: '', // continuation vide → rejetée, on tombe sur Whisper
      whisperText: 'Ils ont tout regroupé dans un sac à l’extérieur pour les gravats. Merci de vous abonner à ma chaîne pour ne manquer aucune de mes vidéos.',
    })
    const text = await transcribeAudio(LONG_AUDIO, 'audio/webm', 'webm')
    expect(text).toBe('Ils ont tout regroupé dans un sac à l’extérieur pour les gravats')
    expect(text).not.toContain('ma chaîne')
    expect(calls.whisper).toBe(1) // le fallback a bien été tenté, pas ignoré
  })

  it('rejette la signature « Amara.org » (cas réel 3f381cc3) — garde le texte Gemini', async () => {
    installGeminiFlow({
      primaryText: 'La visite est finalisée',
      continuationText: '',
      whisperText: 'La visite est finalisée. Sous-titres réalisés par la communauté d’Amara.org',
    })
    const text = await transcribeAudio(LONG_AUDIO, 'audio/webm', 'webm')
    expect(text).toBe('La visite est finalisée')
    expect(text).not.toContain('Amara')
  })

  it('accepte un fallback Whisper propre, sans signature connue (pas de sur-blocage)', async () => {
    installGeminiFlow({
      primaryText: 'Ils ont tout regroupé dans un sac',
      continuationText: '',
      whisperText: 'Ils ont tout regroupé dans un sac à l’extérieur pour les gravats.',
    })
    const text = await transcribeAudio(LONG_AUDIO, 'audio/webm', 'webm')
    expect(text).toBe('Ils ont tout regroupé dans un sac à l’extérieur pour les gravats.')
  })

  it('normalise aussi un fallback Whisper accepté (la garde ne court-circuite pas la normalisation)', async () => {
    installGeminiFlow({
      primaryText: 'Compte rendu du chantier de P3 à Titi',
      continuationText: '',
      whisperText: 'Compte rendu du chantier de P3 à Titi, première intervention.',
    })
    const text = await transcribeAudio(LONG_AUDIO, 'audio/webm', 'webm', 'site-petro')
    expect(text).toContain('PETRO ATTITI')
  })

  it('un texte terminé proprement dès la réponse primaire ne déclenche ni continuation ni Whisper', async () => {
    const calls = installGeminiFlow({ primaryText: 'Visite terminée sans incident.' })
    const text = await transcribeAudio(LONG_AUDIO, 'audio/webm', 'webm')
    expect(text).toBe('Visite terminée sans incident.')
    expect(calls.continuation).toBe(0)
    expect(calls.whisper).toBe(0)
  })
})

describe('transcribeAudio — garde anti-boucle de répétition (continuation Gemini)', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', 'gk-test')
    vi.stubEnv('OPENAI_API_KEY', '')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('rejette une continuation dégénérée en boucle de répétition (cas réel 6487ff04) et garde le texte primaire', async () => {
    // Reproduit le bug réel : finishReason MAX_TOKENS (pas STOP), donc
    // `isAbruptStop` seul ne l'aurait pas rejetée — la garde de répétition si.
    const degenerate = 'des '.repeat(20000).trim() + '.'
    installGeminiFlow({
      primaryText: 'Ils ont fait le balayage global de toute la zone',
      continuationText: degenerate,
    })
    // installGeminiFlow renvoie toujours finishReason: 'STOP' — on doit donc
    // vérifier que la garde de répétition agit indépendamment du finishReason.
    const text = await transcribeAudio(LONG_AUDIO, 'audio/webm', 'webm')
    expect(text).toBe('Ils ont fait le balayage global de toute la zone')
    expect(text).not.toContain('des des des')
  })

  it('accepte une continuation propre contenant une répétition courte plausible (pas de sur-blocage)', async () => {
    installGeminiFlow({
      primaryText: 'Alors on a vu que',
      continuationText: 'non non non ce n\'était pas grave, on a continué le chantier normalement.',
    })
    const text = await transcribeAudio(LONG_AUDIO, 'audio/webm', 'webm')
    expect(text).toContain('non non non')
    expect(text).toContain('continué le chantier normalement')
  })
})
