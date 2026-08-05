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

// Au-delà de ce seuil (octets bruts), l'audio en base64 fait exploser la limite
// ~20 Mo de la requête generateContent inline (base64 = +33 %). On bascule alors
// sur la Files API (upload séparé, référence par URI) — pas de plafond pratique.
// En deçà, l'inline reste plus simple/rapide (une seule requête).
const GEMINI_INLINE_MAX_BYTES = 12 * 1024 * 1024

const GEMINI_MODEL = 'gemini-2.5-flash'
const TRANSCRIBE_PROMPT =
  'Transcris cet audio en français. Retourne uniquement la transcription brute, sans explication ni ponctuation ajoutée.'

function buildGeminiPrompt(lexicalPrompt?: string): string {
  if (!lexicalPrompt) return TRANSCRIBE_PROMPT
  return `Transcris cet audio en français. Vocabulaire spécialisé susceptible d'apparaître : ${lexicalPrompt}. Retourne uniquement la transcription brute, sans explication ni ponctuation ajoutée.`
}

async function transcribeWithGemini(rawBuffer: ArrayBuffer, mimeType: string, lexicalPrompt?: string): Promise<string> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY!
  // Gemini n'accepte pas le suffixe codec (ex: "audio/webm;codecs=opus" → "audio/webm")
  const safeMime = mimeType.split(';')[0].trim()

  // Audio long (réunion) → Files API ; audio court → inline base64.
  const audioPart =
    rawBuffer.byteLength > GEMINI_INLINE_MAX_BYTES
      ? { file_data: { mime_type: safeMime, file_uri: await uploadToGeminiFiles(rawBuffer, safeMime, apiKey) } }
      : { inline_data: { mime_type: safeMime, data: Buffer.from(rawBuffer).toString('base64') } }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [audioPart, { text: buildGeminiPrompt(lexicalPrompt) }] }],
        // maxOutputTokens au plafond du modèle : une réunion d'1 h dépasse
        // largement 8192 tokens — sinon la transcription est tronquée.
        generationConfig: { temperature: 0, maxOutputTokens: 65536, thinkingConfig: { thinkingBudget: 0 } },
      }),
    },
  )

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

/**
 * Upload d'un audio volumineux via la Files API de Gemini (protocole resumable).
 * Retourne l'URI du fichier, utilisable dans generateContent via `file_data`.
 * Supprime le plafond inline ~20 Mo → seul chemin viable pour une réunion longue.
 */
async function uploadToGeminiFiles(rawBuffer: ArrayBuffer, mime: string, apiKey: string): Promise<string> {
  const bytes = rawBuffer.byteLength
  const body = Buffer.from(rawBuffer)

  // 1. Démarrage de l'upload resumable — on récupère l'URL d'upload dédiée.
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes),
        'X-Goog-Upload-Header-Content-Type': mime,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'memoria-audio' } }),
    },
  )
  if (!startRes.ok) throw new Error(`Gemini Files (start) ${startRes.status}: ${await startRes.text()}`)
  const uploadUrl = startRes.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Gemini Files : URL d’upload absente de la réponse')

  // 2. Envoi des octets + finalisation en une requête.
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': String(bytes),
    },
    body,
  })
  if (!upRes.ok) throw new Error(`Gemini Files (upload) ${upRes.status}: ${await upRes.text()}`)
  const uploaded = (await upRes.json()) as { file?: { uri?: string; name?: string; state?: string } }
  const file = uploaded.file
  if (!file?.uri || !file?.name) throw new Error('Gemini Files : réponse d’upload invalide')

  // 3. L'audio doit être « traité » (PROCESSING → ACTIVE) avant d'être utilisable.
  let state = file.state
  for (let i = 0; i < 30 && state && state !== 'ACTIVE'; i++) {
    if (state === 'FAILED') throw new Error('Gemini Files : traitement du fichier échoué')
    await new Promise((r) => setTimeout(r, 1000))
    const poll = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`)
    if (poll.ok) state = ((await poll.json()) as { state?: string }).state
  }
  if (state && state !== 'ACTIVE') throw new Error(`Gemini Files : fichier non prêt (état ${state})`)

  return file.uri
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

// ── gpt-4o-mini-transcribe (Copilote vocal) ───────────────────────────────────

export type CopilotTranscriptionResult = {
  text: string
  model: string
  tokensAudio?: number
  tokensOutput?: number
}

/**
 * Transcription dédiée au Copilote vocal.
 * Priorité : gpt-4o-mini-transcribe (prompt lexical natif) → Gemini (prompt lexical en texte) → erreur.
 * Bascule sur Gemini si OpenAI retourne 429 quota exhausted ou si la clé est absente.
 */
export async function transcribeAudioForCopilot(
  rawBuffer: ArrayBuffer,
  mimeType: string,
  ext: string,
  lexicalPrompt?: string,
): Promise<CopilotTranscriptionResult> {
  const filename = `voice.${ext}`
  const fileSize = rawBuffer.byteLength

  // ── Tentative OpenAI ──────────────────────────────────────────────────────
  if (process.env.OPENAI_API_KEY) {
    const form = new FormData()
    form.append('file', new Blob([rawBuffer], { type: mimeType }), filename)
    form.append('model', 'gpt-4o-mini-transcribe')
    form.append('language', 'fr')
    if (lexicalPrompt) form.append('prompt', lexicalPrompt)

    console.log('[Voice] openai_call', { model: 'gpt-4o-mini-transcribe', filename, mimeType, fileSize, promptLen: lexicalPrompt?.length ?? 0 })

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    })

    if (res.ok) {
      const data = (await res.json()) as {
        text: string
        usage?: {
          input_tokens?: number
          input_token_details?: { audio_tokens?: number }
          output_tokens?: number
        }
      }
      return {
        text:        data.text?.trim() ?? '',
        model:       'gpt-4o-mini-transcribe',
        tokensAudio: data.usage?.input_token_details?.audio_tokens,
        tokensOutput: data.usage?.output_tokens,
      }
    }

    let body: unknown = null
    try { body = await res.json() } catch { body = await res.text().catch(() => null) }
    const errObj = (typeof body === 'object' && body !== null)
      ? (body as Record<string, unknown>).error as Record<string, unknown> | undefined
      : undefined
    console.error('[Voice] openai_error', {
      status:  res.status,
      type:    errObj?.type,
      code:    errObj?.code,
      param:   errObj?.param,
      message: errObj?.message ?? body,
      model:   'gpt-4o-mini-transcribe',
      mimeType,
      filename,
      fileSize,
    })

    const isQuotaError = res.status === 429 || String(errObj?.code).includes('credit') || String(errObj?.code).includes('quota')
    if (!isQuotaError) {
      throw new Error(`gpt-4o-mini-transcribe ${res.status}: ${JSON.stringify(body)}`)
    }
    console.warn('[Voice] openai_quota_exhausted — fallback Gemini')
  }

  // ── Fallback Gemini ───────────────────────────────────────────────────────
  if (process.env.GOOGLE_GENAI_API_KEY) {
    console.log('[Voice] gemini_call', { mimeType, fileSize, promptLen: lexicalPrompt?.length ?? 0 })
    const text = await transcribeWithGemini(rawBuffer, mimeType, lexicalPrompt)
    return { text, model: GEMINI_MODEL }
  }

  throw new Error('Aucun provider de transcription disponible (OpenAI quota exhausted, GOOGLE_GENAI_API_KEY absent)')
}
