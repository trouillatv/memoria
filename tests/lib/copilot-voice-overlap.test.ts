// @vitest-environment node
/**
 * P2-C — overlap serveur (architecture a, mandat Vincent 16/08).
 *
 * Le tour vocal fusionné (`POST /api/copilot/free-stream` en multipart) doit :
 *   1. démarrer les lectures communes AVANT la fin du STT (l'overlap lui-même) ;
 *   2. les RÉUTILISER dans `prepareCopilotAnswer` — aucun second chargement ;
 *   3. ne RIEN précharger quand l'accès est refusé ;
 *   4. ne rien partager entre deux tours (deux utilisateurs / deux chantiers) ;
 *   5. jeter la réponse quand l'orbe abandonne le tour ;
 *   6. produire un résultat métier STRICTEMENT identique avec et sans overlap.
 *
 * Ces tests comptent des appels et des ordres, pas des latences : c'est
 * reproductible. Les latences réelles se mesurent sur téléphone (Q4 ×3).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

// ── Journal d'ordre partagé entre tous les mocks ─────────────────────────────
const trace: string[] = []

const getCurrentUserWithProfile = vi.fn()
const resolveResourceAccess = vi.fn()
const transcribeAudioForCopilot = vi.fn()
const buildLexicalPrompt = vi.fn()
const prepareCopilotAnswer = vi.fn()
const startCopilotSitePrefetch = vi.fn()

vi.mock('@/lib/db/users', () => ({
  getCurrentUserWithProfile: () => getCurrentUserWithProfile(),
}))

vi.mock('@/lib/auth/resource-access', () => ({
  resolveResourceAccess: (...args: unknown[]) => {
    trace.push('access')
    return resolveResourceAccess(...args)
  },
}))

vi.mock('@/lib/ai/transcribe', () => ({
  mimeToExt: () => 'webm',
  transcribeAudioForCopilot: (...args: unknown[]) => transcribeAudioForCopilot(...args),
}))

vi.mock('@/lib/ai/stt-lexicon', () => ({
  buildLexicalPrompt: (...args: unknown[]) => {
    trace.push('lexicon')
    return buildLexicalPrompt(...args)
  },
}))

vi.mock('@/lib/visits/copilot-free-prepare', () => ({
  prepareCopilotAnswer: (...args: unknown[]) => {
    trace.push('prepare')
    return prepareCopilotAnswer(...args)
  },
  startCopilotSitePrefetch: (...args: unknown[]) => {
    trace.push('prefetch:start')
    return startCopilotSitePrefetch(...args)
  },
}))

vi.mock('@/lib/visits/copilot-free-answer', () => ({
  answerCopilotFreeQuestionStream: vi.fn(),
}))

const SITE_A = '75bd3d23-d515-46bd-8de8-254495a5bade'
const SITE_B = '00000000-0000-4000-8000-000000000002'

function accessContext(siteId: string, userId: string) {
  return { resourceId: siteId, organizationId: 'org-1', membershipRole: 'manager', userId }
}

function makeVoiceRequest(siteId: string): NextRequest {
  const form = new FormData()
  form.append('audio', new File([new Uint8Array([1, 2, 3, 4])], 'voice.webm', { type: 'audio/webm' }))
  form.append('siteId', siteId)
  form.append('payload', JSON.stringify({ history: [], resolvedSubjectIds: [] }))
  return new Request('http://localhost/api/copilot/free-stream', {
    method: 'POST',
    body: form,
  }) as unknown as NextRequest
}

async function readSseEvents(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const text = await res.text()
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((raw) => {
      const event = raw.split('\n').find((l) => l.startsWith('event:'))?.slice(6).trim() ?? ''
      const dataLine = raw.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim() ?? 'null'
      return { event, data: JSON.parse(dataLine) }
    })
}

describe('POST /api/copilot/free-stream — tour vocal fusionné (P2-C)', () => {
  beforeEach(() => {
    trace.length = 0
    vi.clearAllMocks()
    getCurrentUserWithProfile.mockResolvedValue({ id: 'u1', role: 'manager' })
    resolveResourceAccess.mockImplementation(async (req: { id: string }) => ({
      ok: true, context: accessContext(req.id, 'u1'),
    }))
    buildLexicalPrompt.mockResolvedValue('PETRO ATITI, SSI')
    // Le STT « met du temps » : tout ce qui doit le recouvrir doit être parti avant.
    transcribeAudioForCopilot.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20))
      trace.push('stt:done')
      return { text: 'Que dois-je préparer pour ma réunion de demain ?', model: 'stt-test' }
    })
    startCopilotSitePrefetch.mockImplementation((siteId: string, userId: string) => ({
      siteId,
      userId,
      startedAt: Date.now(),
      overview: Promise.resolve({ ok: true, value: { fake: 'overview' } }),
      briefing: Promise.resolve({ ok: true, value: null }),
      prepItems: Promise.resolve([]),
    }))
    prepareCopilotAnswer.mockResolvedValue({
      kind: 'result',
      result: { kind: 'answer', text: 'Réponse.', references: [], source: 'deterministic', interactionId: null },
      _diag: {
        det: 'READ/strong', merged: 'READ', family: 'global', applied: '—', q: '', comp: 'null',
        detIntent: 'READ', detConfidence: 'strong', detSignals: [],
        mergedIntent: 'READ', mergedConfidence: 'strong', mergedSignals: [],
        comprehensionMode: null, comprehensionConfidence: null, comprehensionIntent: null,
        appliedRules: [],
        p6Attempted: false, p6Ambiguous: false, p6SegmentsCount: 0, p6Segments: [],
        p6Decision: 'single', p6FallbackReason: null, p6ProposalCount: 0,
      },
    })
  })

  it('1. les lectures communes démarrent AVANT la fin du STT', async () => {
    const { POST } = await import('@/app/api/copilot/free-stream/route')
    const res = await POST(makeVoiceRequest(SITE_A))
    await readSseEvents(res as unknown as Response)

    expect(trace.indexOf('prefetch:start')).toBeGreaterThanOrEqual(0)
    expect(trace.indexOf('prefetch:start')).toBeLessThan(trace.indexOf('stt:done'))
  })

  it('2. le transcript arrive, puis `prepareCopilotAnswer` reçoit LES MÊMES promesses — jamais un second chargement', async () => {
    const { POST } = await import('@/app/api/copilot/free-stream/route')
    const res = await POST(makeVoiceRequest(SITE_A))
    const events = await readSseEvents(res as unknown as Response)

    expect(events[0]).toEqual({ event: 'transcript', data: { text: 'Que dois-je préparer pour ma réunion de demain ?' } })
    expect(events[1]?.event).toBe('result')

    // Une seule création de préchargement pour tout le tour…
    expect(startCopilotSitePrefetch).toHaveBeenCalledTimes(1)
    // …et c'est CET objet (identité stricte) que la préparation reçoit.
    const created = startCopilotSitePrefetch.mock.results[0].value
    const [rawInput, precomputed] = prepareCopilotAnswer.mock.calls[0]
    expect(precomputed.prefetch).toBe(created)
    expect(precomputed.access).toEqual(accessContext(SITE_A, 'u1'))
    expect(rawInput).toMatchObject({ siteId: SITE_A, question: 'Que dois-je préparer pour ma réunion de demain ?' })
  })

  it('3. accès refusé → 404 uniforme, AUCUN préchargement, aucun STT, aucun lexique', async () => {
    resolveResourceAccess.mockResolvedValue({ ok: false, reason: 'membership_missing' })
    const { POST } = await import('@/app/api/copilot/free-stream/route')

    const res = await POST(makeVoiceRequest(SITE_A))

    expect(res.status).toBe(404)
    expect(startCopilotSitePrefetch).not.toHaveBeenCalled()
    expect(transcribeAudioForCopilot).not.toHaveBeenCalled()
    expect(buildLexicalPrompt).not.toHaveBeenCalled()
    expect(prepareCopilotAnswer).not.toHaveBeenCalled()
  })

  it('3bis. non authentifié → 401 avant toute lecture', async () => {
    getCurrentUserWithProfile.mockResolvedValue(null)
    const { POST } = await import('@/app/api/copilot/free-stream/route')

    const res = await POST(makeVoiceRequest(SITE_A))

    expect(res.status).toBe(401)
    expect(resolveResourceAccess).not.toHaveBeenCalled()
    expect(startCopilotSitePrefetch).not.toHaveBeenCalled()
  })

  it('4. deux tours, deux utilisateurs, deux chantiers → aucun partage possible', async () => {
    const { POST } = await import('@/app/api/copilot/free-stream/route')

    getCurrentUserWithProfile.mockResolvedValue({ id: 'u1', role: 'manager' })
    resolveResourceAccess.mockImplementation(async (req: { id: string }) => ({
      ok: true, context: accessContext(req.id, 'u1'),
    }))
    await readSseEvents(await POST(makeVoiceRequest(SITE_A)) as unknown as Response)

    getCurrentUserWithProfile.mockResolvedValue({ id: 'u2', role: 'manager' })
    resolveResourceAccess.mockImplementation(async (req: { id: string }) => ({
      ok: true, context: accessContext(req.id, 'u2'),
    }))
    await readSseEvents(await POST(makeVoiceRequest(SITE_B)) as unknown as Response)

    // Chaque tour a créé SON préchargement, avec SON couple (chantier, user).
    expect(startCopilotSitePrefetch.mock.calls).toEqual([[SITE_A, 'u1'], [SITE_B, 'u2']])
    // Et chaque préparation a reçu l'objet de SON tour, pas celui de l'autre.
    const p1 = prepareCopilotAnswer.mock.calls[0][1]
    const p2 = prepareCopilotAnswer.mock.calls[1][1]
    expect(p1.prefetch).toBe(startCopilotSitePrefetch.mock.results[0].value)
    expect(p2.prefetch).toBe(startCopilotSitePrefetch.mock.results[1].value)
    expect(p1.prefetch).not.toBe(p2.prefetch)
    expect(p1.access.userId).toBe('u1')
    expect(p2.access.userId).toBe('u2')
  })

  it('transcript vide → flux fermé sans réponse, préparation jamais appelée', async () => {
    transcribeAudioForCopilot.mockResolvedValue({ text: '', model: 'stt-test' })
    const { POST } = await import('@/app/api/copilot/free-stream/route')

    const events = await readSseEvents(await POST(makeVoiceRequest(SITE_A)) as unknown as Response)

    expect(events).toEqual([{ event: 'transcript', data: { text: '' } }])
    expect(prepareCopilotAnswer).not.toHaveBeenCalled()
  })

  it('le chemin JSON (question tapée) reste inchangé : pas de précalcul', async () => {
    const { POST } = await import('@/app/api/copilot/free-stream/route')
    const req = new Request('http://localhost/api/copilot/free-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: SITE_A, question: 'Où en est le chantier ?' }),
    }) as unknown as NextRequest

    const events = await readSseEvents(await POST(req) as unknown as Response)

    expect(events[0]?.event).toBe('result')
    expect(startCopilotSitePrefetch).not.toHaveBeenCalled()
    expect(prepareCopilotAnswer).toHaveBeenCalledTimes(1)
    // Un seul argument : le chemin JSON n'injecte JAMAIS de confiance précalculée.
    expect(prepareCopilotAnswer.mock.calls[0][1]).toBeUndefined()
  })
})

// ── 5. Abandon du tour (orbe fermée) : réponse jetée, flux annulé ────────────

describe('askCopilotVoiceTurnStreamed — abandon', () => {
  it('onTranscript → false : le flux est annulé, la réponse est jetée', async () => {
    let cancelled = false
    const sse = [
      'event: transcript\ndata: {"text":"bonjour"}\n\n',
      'event: result\ndata: {"kind":"answer","text":"jamais lue","references":[],"source":"llm","interactionId":null}\n\n',
    ]
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse[0]))
        // Le second événement n'est volontairement jamais poussé : un flux
        // annulé n'a pas à être lu jusqu'au bout.
      },
      cancel() { cancelled = true },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))

    const { askCopilotVoiceTurnStreamed } = await import('@/lib/voice/copilot-stream-client')
    const outcome = await askCopilotVoiceTurnStreamed(
      {
        siteId: SITE_A,
        turn: { kind: 'audio', audio: new Blob([new Uint8Array([1])]), mimeType: 'audio/webm' },
        history: [],
        resolvedSubjectIds: [],
      },
      { onTranscript: () => false, onSpokenReady: () => {} },
    )

    expect(outcome).toEqual({ transcript: 'bonjour', result: null, aborted: true })
    expect(cancelled).toBe(true)
    vi.unstubAllGlobals()
  })
})

// ── 6. Voie Live : le transcript vient du téléphone, pas du serveur ──────────
//
// P3-B — c'est l'invariant « jamais deux STT pour un même tour » : sur la voie
// Live, aucun audio ne part, la requête est du JSON, et le serveur ne transcrit
// rien. Le reste du parcours (SSE, `spoken`, `result`) est identique.

describe('askCopilotVoiceTurnStreamed — voie Live (transcript déjà connu)', () => {
  it('envoie du JSON sans audio et remonte le transcript avant toute requête', async () => {
    const order: string[] = []
    const sse = 'event: result\ndata: {"kind":"answer","text":"ok","references":[],"source":"llm","interactionId":null}\n\n'
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      order.push('fetch')
      // Aucun multipart : le serveur n'a pas d'audio à transcrire.
      expect(init.body).toBeTypeOf('string')
      expect(String(init.body)).toContain('"question":"pose une réserve"')
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse))
          controller.close()
        },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { askCopilotVoiceTurnStreamed } = await import('@/lib/voice/copilot-stream-client')
    const outcome = await askCopilotVoiceTurnStreamed(
      {
        siteId: SITE_A,
        turn: { kind: 'transcript', text: 'pose une réserve' },
        history: [],
        resolvedSubjectIds: [],
      },
      {
        onTranscript: (t) => { order.push(`transcript:${t}`); return true },
        onSpokenReady: () => {},
      },
    )

    // Le texte est affiché AVANT l'aller-retour réseau — c'est là qu'est le gain.
    expect(order).toEqual(['transcript:pose une réserve', 'fetch'])
    expect(outcome.transcript).toBe('pose une réserve')
    expect(outcome.result?.kind).toBe('answer')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('abandon avant la requête : orbe fermée → aucune requête émise', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { askCopilotVoiceTurnStreamed } = await import('@/lib/voice/copilot-stream-client')
    const outcome = await askCopilotVoiceTurnStreamed(
      { siteId: SITE_A, turn: { kind: 'transcript', text: 'bonjour' }, history: [], resolvedSubjectIds: [] },
      { onTranscript: () => false, onSpokenReady: () => {} },
    )

    expect(outcome).toEqual({ transcript: 'bonjour', result: null, aborted: true })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
