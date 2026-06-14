// lib/ai/transcribe.ts
// Transcription audio → texte. Chemin unique partagé par les notes vocales
// d'intervention ET les comptes-rendus de chantier.
//
// Priorité fournisseur (identique aux embeddings) : Google Gemini → OpenAI
// Whisper → chaîne vide. Appels REST bruts (pas via AIProvider) car ces
// endpoints ne renvoient pas de comptage de tokens.
//
// Extrait verbatim de app/(field)/m/intervention/[id]/voice-note-actions.ts.

export function mimeToExt(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

/** Quel fournisseur sera utilisé (pour le logging de coût). null si aucun. */
export function transcriptionProvider(): 'gemini' | 'openai' | null {
  if (process.env.GOOGLE_GENAI_API_KEY) return 'gemini'
  if (process.env.OPENAI_API_KEY) return 'openai'
  return null
}

// Même priorité que les embeddings : Google → OpenAI → vide
export async function transcribeAudio(
  rawBuffer: ArrayBuffer,
  mimeType: string,
  ext: string,
): Promise<string> {
  if (process.env.GOOGLE_GENAI_API_KEY) {
    return transcribeWithGemini(rawBuffer, mimeType)
  }
  if (process.env.OPENAI_API_KEY) {
    return transcribeWithWhisper(rawBuffer, mimeType, ext)
  }
  return ''
}

async function transcribeWithGemini(rawBuffer: ArrayBuffer, mimeType: string): Promise<string> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY!
  // Hardcodé : gemini-2.0-flash n'est plus dispo, on ne laisse pas l'env var l'écraser
  const model = 'gemini-2.5-flash'
  const base64 = Buffer.from(rawBuffer).toString('base64')
  // Gemini n'accepte pas le suffixe codec (ex: "audio/webm;codecs=opus" → "audio/webm")
  const safeMime = mimeType.split(';')[0].trim()

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: safeMime, data: base64 } },
            { text: 'Transcris cet audio en français. Retourne uniquement la transcription brute, sans explication ni ponctuation ajoutée.' },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
      }),
    },
  )

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

async function transcribeWithWhisper(rawBuffer: ArrayBuffer, mimeType: string, ext: string): Promise<string> {
  const whisperForm = new FormData()
  whisperForm.append('file', new Blob([rawBuffer], { type: mimeType }), `voice.${ext}`)
  whisperForm.append('model', 'whisper-1')
  whisperForm.append('language', 'fr')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: whisperForm,
  })

  if (!res.ok) throw new Error(`Whisper ${res.status}`)
  const { text } = (await res.json()) as { text: string }
  return text
}
