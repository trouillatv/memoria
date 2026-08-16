import { NextRequest, NextResponse } from 'next/server'
import { prepareCopilotAnswer } from '@/app/(dashboard)/sites/[id]/copilot-free-action'
import { answerCopilotFreeQuestionStream } from '@/lib/visits/copilot-free-answer'

// D1 (2026-08-16) : second transport du même pipeline que `askCopilotFreeAction`
// (Server Action, non streamé) — pas un second Copilote. `prepareCopilotAnswer`
// porte déjà toute la préparation transport-indépendante, y compris le contrôle
// d'accès au chantier (`requireSiteAccess`) : ce handler n'a donc aucune garde
// d'autorisation à dupliquer.
//
// SSE (pas de WebSocket) : un seul aller simple serveur→client, deux
// événements possibles avant la fermeture — `spoken` dès que `spokenText` est
// complet et conforme au contrat D0, puis `result` avec la réponse complète
// (texte, références, télémétrie) identique à celle du transport non streamé.
// Toute erreur de streaming émet `error` puis ferme proprement : le client
// se replie sur `askCopilotFreeAction` (contrainte Vincent #8), jamais de
// réponse à moitié écrite.
export const runtime = 'nodejs'

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// Audit D1 (16/08) : gain théorique (~1,9 s vs ~6,7 s, `_audit-ordre-spoken.ts`)
// non confirmé terrain. `COPILOT_DIAG=1` isole où il disparaît côté serveur —
// route → appel Gemini → 1er chunk → champ spokenText → événement SSE. Fermé
// par défaut, même convention que `[copilot-diag]` dans `copilot-free-action.ts`.
const diagEnabled = process.env.COPILOT_DIAG === '1'

function diagLog(stage: string, extra: Record<string, unknown> = {}) {
  if (!diagEnabled) return
  console.log('[copilot-stream-diag]', JSON.stringify({ stage, t: Date.now(), ...extra }))
}

export async function POST(req: NextRequest) {
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
        if (prep.kind === 'result') {
          controller.enqueue(encoder.encode(sseEvent('result', prep.result)))
          controller.close()
          return
        }

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
        controller.close()
      } catch (err) {
        console.error('[copilot-stream] stream_error:', err instanceof Error ? err.message : err)
        controller.enqueue(encoder.encode(sseEvent('error', { code: 'STREAM_ERROR' })))
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Désactive le buffering du proxy Vercel/nginx en amont — sans quoi
      // l'événement `spoken` n'atteint le client qu'au même moment que
      // `result`, annulant tout le gain de latence de D1.
      'X-Accel-Buffering': 'no',
    },
  })
}
