// transcribeDictationAction — intégration du nettoyage LLM (mandat Vincent, lot
// post-shutter rework 2026-08-24). Couvre le test doctrine #6 : un nettoyage LLM
// indisponible retombe TOUJOURS sur le transcript STT brut, jamais une légende
// perdue. Même stratégie de mock que tests/lib/skip-intervention.test.ts (auth
// via @/lib/supabase/server + @/lib/db/users, hors contexte HTTP réel).

import { describe, it, expect, vi, beforeEach } from 'vitest'

declare global {
  // eslint-disable-next-line no-var
  var __DICTATION_TEST_USER_ID__: string | undefined
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: globalThis.__DICTATION_TEST_USER_ID__ ?? 'unset' } },
      })),
    },
  })),
}))

vi.mock('@/lib/db/users', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/db/users')>()
  return { ...orig, getUserRoleById: vi.fn(async () => 'chef_equipe' as const) }
})

const transcribeAudioMock = vi.fn()
vi.mock('@/lib/ai/transcribe', () => ({
  mimeToExt: () => 'webm',
  transcribeAudio: (...args: unknown[]) => transcribeAudioMock(...args),
}))

const normalizeCaptionMock = vi.fn()
vi.mock('@/lib/ai/normalize-caption', () => ({
  normalizeCaptionWithLLM: (...args: unknown[]) => normalizeCaptionMock(...args),
}))

async function importAction() {
  const mod = await import('@/app/(field)/m/site/[siteId]/capture-actions')
  return mod.transcribeDictationAction
}

function formData(siteId: string, audio: File | null) {
  const fd = new FormData()
  fd.set('site_id', siteId)
  if (audio) fd.set('audio', audio)
  return fd
}

const SITE_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.__DICTATION_TEST_USER_ID__ = 'user-1'
})

describe('transcribeDictationAction — repli sur le transcript brut (test doctrine #6)', () => {
  it('nettoyage LLM en échec → renvoie le transcript STT brut, jamais perdu', async () => {
    transcribeAudioMock.mockResolvedValue('euh la fissure elle est toujours là quoi')
    normalizeCaptionMock.mockResolvedValue({ ok: false, errorCode: 'TIMEOUT', errorDetail: 'Timeout après 20000ms' })

    const transcribeDictationAction = await importAction()
    const result = await transcribeDictationAction(formData(SITE_ID, new File(['x'], 'a.webm', { type: 'audio/webm' })))

    expect(result).toEqual({ ok: true, text: 'euh la fissure elle est toujours là quoi' })
  })

  it('nettoyage LLM réussi → renvoie la légende nettoyée, pas le brut', async () => {
    transcribeAudioMock.mockResolvedValue('euh la fissure elle est toujours là quoi')
    normalizeCaptionMock.mockResolvedValue({ ok: true, caption: 'La fissure est toujours là.' })

    const transcribeDictationAction = await importAction()
    const result = await transcribeDictationAction(formData(SITE_ID, new File(['x'], 'a.webm', { type: 'audio/webm' })))

    expect(result).toEqual({ ok: true, text: 'La fissure est toujours là.' })
  })

  it('nettoyage LLM renvoie une légende vide → repli sur le brut', async () => {
    transcribeAudioMock.mockResolvedValue('RAS')
    normalizeCaptionMock.mockResolvedValue({ ok: true, caption: '' })

    const transcribeDictationAction = await importAction()
    const result = await transcribeDictationAction(formData(SITE_ID, new File(['x'], 'a.webm', { type: 'audio/webm' })))

    expect(result).toEqual({ ok: true, text: 'RAS' })
  })

  it('un seul appel de nettoyage par dictée (pas de moteur IA dupliqué)', async () => {
    transcribeAudioMock.mockResolvedValue('un texte quelconque')
    normalizeCaptionMock.mockResolvedValue({ ok: true, caption: 'Un texte quelconque.' })

    const transcribeDictationAction = await importAction()
    await transcribeDictationAction(formData(SITE_ID, new File(['x'], 'a.webm', { type: 'audio/webm' })))

    expect(normalizeCaptionMock).toHaveBeenCalledTimes(1)
  })
})
