'use client'

// D1 (2026-08-16) : client SSE de `/api/copilot/free-stream`, le second
// transport du même pipeline que `askCopilotFreeAction`. Renvoie exactement le
// même `CopilotFreeResult` ; la seule différence observable est l'appel de
// `onSpokenReady` avant que ce résultat n'arrive.
//
// Lève systématiquement en cas d'erreur réseau, d'événement `error`, ou de
// flux fermé sans `result` : l'appelant se replie alors sur `askCopilotFreeAction`
// (transport non streamé) — jamais de réponse partielle affichée (contrainte
// Vincent #8).

import type { CopilotFreeResult } from '@/app/(dashboard)/sites/[id]/copilot-free-action'

export interface StreamedFreeAnswerInput {
  siteId: string
  question: string
  history: { role: 'user' | 'assistant'; content: string }[]
  resolvedSubjectIds: string[]
}

// ── Tour vocal complet (P2-C overlap) ────────────────────────────────────────
//
// L'audio part TEL QUEL vers `/api/copilot/free-stream` : le serveur transcrit
// et répond dans la même requête, ce qui lui permet de lancer les lectures du
// chantier pendant le STT. Événement supplémentaire : `transcript`, émis dès
// que le texte est connu.

export interface VoiceTurnStreamInput {
  siteId: string
  audio: Blob
  mimeType: string
  history: { role: 'user' | 'assistant'; content: string }[]
  resolvedSubjectIds: string[]
}

export interface VoiceTurnStreamOutcome {
  /** `null` = le tour a échoué avant même le transcript. */
  transcript: string | null
  /** `null` = pas de réponse streamée (erreur après transcript, ou abandon). */
  result: CopilotFreeResult | null
  /** `true` = l'appelant a demandé l'abandon via `onTranscript` → rien à afficher. */
  aborted: boolean
}

/**
 * Ne lève QUE sur un échec réseau/HTTP avant tout événement. Une erreur émise
 * PAR le flux (événement `error`) rend `result: null` sans lever : l'appelant
 * dispose alors du transcript pour se replier sur le transport non streamé
 * (contrainte Vincent #8 — jamais de réponse partielle).
 */
export async function askCopilotVoiceTurnStreamed(
  input: VoiceTurnStreamInput,
  handlers: {
    /** Renvoyer `false` = abandonner le tour (orbe fermée) : lecture annulée. */
    onTranscript: (text: string) => boolean
    onSpokenReady: (spokenText: string) => void
  },
): Promise<VoiceTurnStreamOutcome> {
  const ext = input.mimeType.includes('mp4') ? 'mp4' : input.mimeType.includes('ogg') ? 'ogg' : 'webm'
  const form = new FormData()
  form.append('audio', input.audio, `voice.${ext}`)
  form.append('siteId', input.siteId)
  form.append('payload', JSON.stringify({
    history: input.history,
    resolvedSubjectIds: input.resolvedSubjectIds,
  }))

  const res = await fetch('/api/copilot/free-stream', { method: 'POST', body: form })
  if (!res.ok || !res.body) throw new Error(`free-stream HTTP ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let transcript: string | null = null
  let result: CopilotFreeResult | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const eventLine = raw.split('\n').find((l) => l.startsWith('event:'))
      const dataLine = raw.split('\n').find((l) => l.startsWith('data:'))
      if (!eventLine || !dataLine) continue
      const event = eventLine.slice('event:'.length).trim()
      const data = JSON.parse(dataLine.slice('data:'.length).trim())

      if (event === 'transcript') {
        transcript = data.text as string
        if (!handlers.onTranscript(transcript)) {
          // Abandon : on coupe le flux — la réponse en cours de génération est
          // jetée côté client, et le serveur voit le flux fermé.
          await reader.cancel().catch(() => {})
          return { transcript, result: null, aborted: true }
        }
      } else if (event === 'spoken') {
        handlers.onSpokenReady(data.spokenText)
      } else if (event === 'result') {
        result = data as CopilotFreeResult
      } else if (event === 'error') {
        await reader.cancel().catch(() => {})
        return { transcript, result: null, aborted: false }
      }
    }
  }

  return { transcript, result, aborted: false }
}

export async function askCopilotFreeActionStreamed(
  input: StreamedFreeAnswerInput,
  handlers: { onSpokenReady: (spokenText: string) => void },
): Promise<CopilotFreeResult> {
  const res = await fetch('/api/copilot/free-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok || !res.body) throw new Error(`free-stream HTTP ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: CopilotFreeResult | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const eventLine = raw.split('\n').find((l) => l.startsWith('event:'))
      const dataLine = raw.split('\n').find((l) => l.startsWith('data:'))
      if (!eventLine || !dataLine) continue
      const event = eventLine.slice('event:'.length).trim()
      const data = JSON.parse(dataLine.slice('data:'.length).trim())

      if (event === 'spoken') {
        handlers.onSpokenReady(data.spokenText)
      } else if (event === 'result') {
        result = data as CopilotFreeResult
      } else if (event === 'error') {
        throw new Error(`free-stream event error: ${data?.code ?? 'unknown'}`)
      }
    }
  }

  if (!result) throw new Error('free-stream closed without result')
  return result
}
