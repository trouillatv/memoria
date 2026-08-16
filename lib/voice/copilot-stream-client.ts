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
