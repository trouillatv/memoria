// @vitest-environment node
/**
 * Invariant de cloisonnement sur la route de transcription vocale.
 *
 * `buildLexicalPrompt` lit `sites.name` et les `canonical_subject.label` d'un
 * chantier via le client admin, qui BYPASSE la RLS. Tant que cette lecture
 * partait avant l'authentification, un appel connaissant un UUID obtenait le
 * nom d'un chantier étranger et 15 de ses sujets dans son propre prompt STT —
 * le même incident que celui documenté dans `lib/field/site-access.ts`, sur un
 * chemin qui y avait échappé parce qu'il n'est pas une page.
 *
 * Ces tests ne mesurent pas une latence : ils comptent les tables lues et
 * l'ordre des étapes, ce qui est reproductible.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

/** Journal d'ordre partagé : chaque étape observable s'y inscrit. */
const trace: string[] = []
/** Tables réellement interrogées par le prompt lexical. */
const tablesRead: string[] = []

const getCurrentUserWithProfile = vi.fn()
const requireOwned = vi.fn()
const transcribeAudioForCopilot = vi.fn()

vi.mock('@/lib/db/users', () => ({
  getCurrentUserWithProfile: () => getCurrentUserWithProfile(),
}))

vi.mock('@/lib/auth/ownership', () => ({
  requireOwned: (...args: unknown[]) => {
    trace.push('authz')
    return requireOwned(...args)
  },
}))

vi.mock('@/lib/ai/transcribe', () => ({
  mimeToExt: () => 'webm',
  transcribeAudioForCopilot: (...args: unknown[]) => {
    trace.push('stt')
    return transcribeAudioForCopilot(...args)
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      trace.push(`read:${table}`)
      tablesRead.push(table)
      const qb: Record<string, unknown> = {}
      qb.select = () => qb
      qb.eq = () => qb
      qb.order = () => qb
      qb.limit = async () => ({ data: [{ label: 'SSI' }, { label: 'Désenfumage' }], error: null })
      qb.single = async () => ({ data: { name: 'PETRO ATITI' }, error: null })
      return qb
    },
  }),
}))

const SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'

function makeRequest(siteId: string | null): NextRequest {
  const form = new FormData()
  form.append('audio', new File([new Uint8Array([1, 2, 3, 4])], 'tour.webm', { type: 'audio/webm' }))
  if (siteId) form.append('siteId', siteId)
  return new Request('http://localhost/api/copilot/transcribe', {
    method: 'POST',
    body: form,
  }) as unknown as NextRequest
}

describe('POST /api/copilot/transcribe — aucune lecture métier avant autorisation', () => {
  beforeEach(() => {
    trace.length = 0
    tablesRead.length = 0
    vi.clearAllMocks()
    getCurrentUserWithProfile.mockResolvedValue({ id: 'u1', role: 'manager' })
    requireOwned.mockResolvedValue({ allowed: true })
    transcribeAudioForCopilot.mockResolvedValue({ text: 'bonjour', model: 'gemini-2.5-flash' })
  })

  it('un appel NON authentifié ne déclenche aucune lecture, même avec un UUID valide', async () => {
    getCurrentUserWithProfile.mockResolvedValue(null)
    const { POST } = await import('@/app/api/copilot/transcribe/route')

    const res = await POST(makeRequest(SITE_ID))

    expect(res.status).toBe(401)
    expect(tablesRead).toEqual([]) // avant ce lot : ['sites', 'canonical_subject']
  })

  it('un chantier hors périmètre n’est jamais lu, et ne renvoie pas d’oracle d’existence', async () => {
    requireOwned.mockResolvedValue({ allowed: false, error: 'Objet introuvable' })
    const { POST } = await import('@/app/api/copilot/transcribe/route')

    const res = await POST(makeRequest(SITE_ID))

    expect(requireOwned).toHaveBeenCalledWith('manager', 'sites', SITE_ID)
    expect(tablesRead).toEqual([])
    // Comportement observable identique à un appel sans `siteId` : la
    // transcription a lieu, simplement sans lexique.
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ text: 'bonjour' })
    expect(transcribeAudioForCopilot).toHaveBeenCalledWith(
      expect.anything(), 'audio/webm', 'webm', undefined,
    )
  })

  it('un chantier autorisé garde exactement le lexique d’avant', async () => {
    const { POST } = await import('@/app/api/copilot/transcribe/route')

    const res = await POST(makeRequest(SITE_ID))

    expect(res.status).toBe(200)
    expect(tablesRead).toEqual(['sites', 'canonical_subject'])
    expect(transcribeAudioForCopilot).toHaveBeenCalledWith(
      expect.anything(), 'audio/webm', 'webm', 'PETRO ATITI, SSI, Désenfumage',
    )
  })

  it('la garde d’appartenance précède la première lecture métier', async () => {
    const { POST } = await import('@/app/api/copilot/transcribe/route')

    await POST(makeRequest(SITE_ID))

    expect(trace.indexOf('authz')).toBeGreaterThanOrEqual(0)
    expect(trace.indexOf('authz')).toBeLessThan(trace.indexOf('read:sites'))
  })

  it('sans `siteId`, aucune garde et aucune lecture — chemin inchangé', async () => {
    const { POST } = await import('@/app/api/copilot/transcribe/route')

    const res = await POST(makeRequest(null))

    expect(res.status).toBe(200)
    expect(requireOwned).not.toHaveBeenCalled()
    expect(tablesRead).toEqual([])
  })
})
