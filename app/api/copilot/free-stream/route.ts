import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { resolveResourceAccess } from '@/lib/auth/resource-access'
import { mimeToExt, transcribeAudioForCopilot } from '@/lib/ai/transcribe'
import { buildLexicalPrompt } from '@/lib/ai/stt-lexicon'
import {
  prepareCopilotAnswer,
  startCopilotSitePrefetch,
  type PreparedCopilotAnswer,
} from '@/lib/visits/copilot-free-prepare'
import { answerCopilotFreeQuestionStream } from '@/lib/visits/copilot-free-answer'

// D1 (2026-08-16) : second transport du même pipeline que `askCopilotFreeAction`
// (Server Action, non streamé) — pas un second Copilote. `prepareCopilotAnswer`
// porte déjà toute la préparation transport-indépendante, y compris le contrôle
// d'accès au chantier : ce handler n'a donc aucune garde d'autorisation à
// dupliquer sur le chemin JSON.
//
// P2-C (16/08, mandat Vincent) : ce handler accepte AUSSI l'audio directement
// (multipart/form-data). C'est l'architecture (a) validée : tant que
// transcription et réponse étaient deux requêtes HTTP séparées, rien ne
// pouvait recouvrir le STT — deux requêtes ne partagent pas de mémoire sur
// Vercel. En une seule requête, le serveur lance EN PARALLÈLE du STT les
// lectures qui ne dépendent pas du texte (accès déjà décidé, overview,
// briefing, préparation de visite), puis les réutilise pour CE tour.
// Aucun cache durable, aucun store partagé : tout vit et meurt avec la requête.
//
// SSE (pas de WebSocket) : un seul aller simple serveur→client. Événements :
// `transcript` (tour vocal uniquement, dès que le STT rend le texte), `spoken`
// dès que `spokenText` est complet et conforme au contrat D0, puis `result`
// avec la réponse complète identique à celle du transport non streamé.
// Toute erreur émet `error` puis ferme proprement : le client se replie sur
// `askCopilotFreeAction` (contrainte Vincent #8), jamais de réponse à moitié
// écrite.
export const runtime = 'nodejs'

/** Rien ne part vers la base sans un UUID valide — avant même le contrôle d'accès. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// Audit D1 (16/08) : gain théorique (~1,9 s vs ~6,7 s, `_audit-ordre-spoken.ts`)
// non confirmé terrain. `COPILOT_DIAG=1` isole où il disparaît côté serveur —
// route → appel Gemini → 1er chunk → champ spokenText → événement SSE. Fermé
// par défaut, même convention que `[copilot-diag]` dans `copilot-free-prepare.ts`.
const diagEnabled = process.env.COPILOT_DIAG === '1'

function diagLog(stage: string, extra: Record<string, unknown> = {}) {
  if (!diagEnabled) return
  console.log('[copilot-stream-diag]', JSON.stringify({ stage, t: Date.now(), ...extra }))
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Désactive le buffering du proxy Vercel/nginx en amont — sans quoi
  // l'événement `spoken` n'atteint le client qu'au même moment que
  // `result`, annulant tout le gain de latence de D1.
  'X-Accel-Buffering': 'no',
} as const

/**
 * Déroule la réponse (LLM streamé ou résultat déterministe) dans le flux SSE.
 * Commun aux deux chemins (JSON et vocal) : c'est ce qui interdit toute
 * divergence de comportement entre une question tapée et une question parlée.
 */
async function streamPreparedAnswer(
  prep: PreparedCopilotAnswer,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<void> {
  if (prep.kind === 'result') {
    // Chemin déterministe : pas de classification LLM, mais on signale quand même
    // que la réponse n'est pas passée par le LLM.
    controller.enqueue(encoder.encode(sseEvent('diag', {
      det: 'deterministic', merged: 'deterministic', family: 'deterministic', applied: '', q: '', comp: 'null',
    })))
    controller.enqueue(encoder.encode(sseEvent('result', prep.result)))
    return
  }

  // Émet le routage AVANT la génération : le client peut l'afficher même si le
  // LLM met plusieurs secondes. C'est exactement l'étage que la recette cherche.
  controller.enqueue(encoder.encode(sseEvent('diag', prep._diag)))

  const answerStartAt = Date.now()
  const answer = await answerCopilotFreeQuestionStream(
    prep.question,
    prep.history,
    prep.items,
    prep.subjectDetails,
    prep.delta,
    prep.filteredPrep,
    prep.siteName,
    prep.extra,
    {
      onSpokenReady: (spokenText) => {
        diagLog('sse_spoken_enqueue', { spokenLength: spokenText.length })
        controller.enqueue(encoder.encode(sseEvent('spoken', { spokenText })))
      },
    },
  )
  const result = await prep.finish(answer, answerStartAt)
  controller.enqueue(encoder.encode(sseEvent('result', result)))
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) return handleVoiceTurn(req)

  // ── Chemin JSON (question déjà textuelle) — inchangé ───────────────────────
  let rawInput: unknown
  try {
    rawInput = await req.json()
  } catch (err) {
    console.error('[copilot-stream] body_parse_error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Corps de requête invalide', code: 'BODY_PARSE_ERROR' }, { status: 400 })
  }

  const q = (rawInput as { question?: unknown } | null)?.question
  diagLog('route_start', { q: typeof q === 'string' ? q.slice(0, 60) : null })

  const prep = await prepareCopilotAnswer(rawInput)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        await streamPreparedAnswer(prep, controller, encoder)
        controller.close()
      } catch (err) {
        console.error('[copilot-stream] stream_error:', err instanceof Error ? err.message : err)
        controller.enqueue(encoder.encode(sseEvent('error', { code: 'STREAM_ERROR' })))
        controller.close()
      }
    },
  })

  return new NextResponse(stream, { headers: SSE_HEADERS })
}

// ── Tour vocal complet : audio → [STT ∥ préchargement] → réponse ─────────────

async function handleVoiceTurn(req: NextRequest): Promise<NextResponse> {
  let form: FormData
  try {
    form = await req.formData()
  } catch (err) {
    console.error('[copilot-stream] formdata_error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'FormData parse failed', code: 'FORMDATA_ERROR' }, { status: 400 })
  }

  const audioFile = form.get('audio') as File | null
  const siteId    = form.get('siteId') as string | null
  if (!audioFile) return NextResponse.json({ error: 'Audio manquant', code: 'AUDIO_MISSING' }, { status: 400 })
  if (!UUID_RE.test(siteId ?? '')) {
    return NextResponse.json({ error: 'siteId invalide', code: 'SITE_ID_INVALID' }, { status: 400 })
  }

  // Le reste des champs du tour (historique, sujets résolus) voyage en JSON
  // dans un champ unique — même schéma que le chemin JSON, validé par
  // `prepareCopilotAnswer` une fois le transcript connu.
  let payload: { history?: unknown; resolvedSubjectIds?: unknown; conversationId?: unknown } = {}
  const rawPayload = form.get('payload')
  if (typeof rawPayload === 'string' && rawPayload) {
    try { payload = JSON.parse(rawPayload) } catch { /* payload optionnel — ignoré s'il est illisible */ }
  }

  // ── Auth puis accès — AVANT toute lecture métier et tout préchargement ─────
  // La décision vient de `resolveResourceAccess`, LA primitive canonique de
  // lecture (M2B) — même règle que `requireSiteAccess` utilisé par
  // `prepareCopilotAnswer`, et même décision d'appartenance que `requireOwned`
  // qui gardait le lexique sur la route de transcription séparée. Un refus est
  // un 404 uniforme : chantier étranger et chantier inexistant sont
  // indiscernables, aucun oracle, et RIEN n'a été préchargé.
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const access = await resolveResourceAccess({ kind: 'site', id: siteId as string }, user)
  if (!access.ok) {
    return NextResponse.json({ error: 'Introuvable', code: 'NOT_FOUND' }, { status: 404 })
  }

  let rawBuffer: ArrayBuffer
  try {
    rawBuffer = await audioFile.arrayBuffer()
  } catch (err) {
    console.error('[copilot-stream] buffer_error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Lecture buffer échouée', code: 'BUFFER_ERROR' }, { status: 400 })
  }
  if (rawBuffer.byteLength === 0) {
    return NextResponse.json({ error: 'Audio vide', code: 'AUDIO_EMPTY' }, { status: 400 })
  }

  const mimeType = audioFile.type || 'audio/webm'
  const ext      = mimeToExt(mimeType)
  const t0       = Date.now()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        // ── L'OVERLAP : les lectures indépendantes du texte partent ICI, en
        // même temps que le STT — pas après le transcript. Elles ne dépendent
        // que de `siteId`/`userId`, déjà autorisés ci-dessus. Promesses de
        // portée requête : mortes avec elle, jamais partagées, jamais
        // réutilisées au tour suivant.
        const prefetch = startCopilotSitePrefetch(access.context.resourceId, access.context.userId)
        let prefetchSettledAt = 0
        void Promise.allSettled([prefetch.overview, prefetch.briefing, prefetch.prepItems])
          .then(() => { prefetchSettledAt = Date.now() })

        // Lexique puis STT — même ordre, même lexique, même fournisseur que la
        // route de transcription séparée. Le STT lui-même n'est pas touché.
        const lexicalPrompt = await buildLexicalPrompt(access.context.resourceId).catch(() => '')
        let stt: Awaited<ReturnType<typeof transcribeAudioForCopilot>>
        try {
          stt = await transcribeAudioForCopilot(rawBuffer, mimeType, ext, lexicalPrompt || undefined)
        } catch (err) {
          console.error('[copilot-stream] provider_error:', err instanceof Error ? err.message : err)
          controller.enqueue(encoder.encode(sseEvent('error', { code: 'TRANSCRIBE_PROVIDER_ERROR' })))
          controller.close()
          return
        }
        const sttDoneAt = Date.now()
        const text = (stt.text ?? '').trim()

        // Le transcript part immédiatement — le client l'affiche et pose son
        // jalon de latence sans attendre la réponse.
        controller.enqueue(encoder.encode(sseEvent('transcript', { text })))
        if (!text) {
          // Même comportement observable que la route de transcription seule :
          // un transcript vide n'est pas une réponse, le client gère.
          controller.close()
          return
        }

        // Preuve de recouvrement (mandat P2-C) : combien du préchargement le
        // STT a réellement masqué. `masked=true` = tout était prêt avant le
        // transcript, il ne reste RIEN à attendre côté contexte commun.
        console.log('[copilot-stream] overlap', JSON.stringify({
          sttMs: sttDoneAt - t0,
          prefetchSettled: prefetchSettledAt > 0,
          prefetchMs: prefetchSettledAt > 0 ? prefetchSettledAt - t0 : null,
          masked: prefetchSettledAt > 0 && prefetchSettledAt <= sttDoneAt,
        }))

        const prep = await prepareCopilotAnswer(
          {
            siteId: access.context.resourceId,
            question: text,
            history: payload.history,
            resolvedSubjectIds: payload.resolvedSubjectIds,
            conversationId: payload.conversationId,
          },
          { access: access.context, prefetch },
        )

        await streamPreparedAnswer(prep, controller, encoder)
        controller.close()
      } catch (err) {
        console.error('[copilot-stream] voice_stream_error:', err instanceof Error ? err.message : err)
        try {
          controller.enqueue(encoder.encode(sseEvent('error', { code: 'STREAM_ERROR' })))
          controller.close()
        } catch { /* flux déjà fermé (client parti) — il n'y a plus personne à prévenir */ }
      }
    },
  })

  return new NextResponse(stream, { headers: SSE_HEADERS })
}
