// lib/ai/transcribe.ts
// Transcription audio → texte. Chemin unique partagé par les notes vocales
// d'intervention ET les comptes-rendus de chantier.
//
// Priorité fournisseur (identique aux embeddings) : Google Gemini → OpenAI
// Whisper → chaîne vide. Appels REST bruts (pas via AIProvider) car ces
// endpoints ne renvoient pas de comptage de tokens.
//
// Extrait verbatim de app/(field)/m/intervention/[id]/voice-note-actions.ts.

import {
  closedBreaker,
  shouldAttempt,
  breakerPhase,
  recordUnavailable,
  recordAvailable,
  type BreakerState,
} from './provider-breaker'

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

function buildGeminiSystemInstruction(lexicalPrompt?: string): string {
  const base =
    'Transcris exactement ce qui est dit dans cet audio en français.\n' +
    'Retourne uniquement les mots prononcés, sans ajout ni commentaire.'
  if (!lexicalPrompt) return base
  return (
    base +
    '\nCes termes peuvent apparaître dans l\'audio et servent uniquement d\'aide à la reconnaissance : ' +
    lexicalPrompt +
    '.\nNe les ajoute jamais s\'ils ne sont pas prononcés dans l\'audio.'
  )
}

/**
 * Décomposition du temps passé chez le fournisseur (mandat d'audit, 16/08 :
 * « instrumenter séparément upload audio / attente fournisseur / transcription
 * afin que le prochain benchmark explique les ~4 s résiduelles »).
 *
 * Limite assumée : `providerWaitMs` agrège le téléversement de la charge ET la
 * génération, parce qu'un `generateContent` non streamé ne rend la main qu'aux
 * en-têtes de réponse. Les séparer exigerait de passer la transcription en
 * streaming — un changement de comportement, hors mandat. La voie ouverte ici
 * est la régression sur `payloadBytes`, qui varie déjà d'un facteur 3 entre un
 * tour court et un tour long : la pente donne le coût réseau, l'ordonnée à
 * l'origine le coût de génération.
 */
export type ProviderTimings = {
  /** Aller-retour OpenAI réellement payé. Absent quand le disjoncteur l'a évité. */
  openaiMs?: number
  /** Préparation locale de la charge (encodage base64). CPU pur. */
  encodeMs?: number
  /** Envoi de la charge + attente du fournisseur, jusqu'aux en-têtes de réponse. */
  providerWaitMs?: number
  /** Lecture du corps de la réponse. */
  providerBodyMs?: number
  /** Octets réellement envoyés au fournisseur (base64 inclus). */
  payloadBytes?: number
}

async function transcribeWithGeminiTimed(
  rawBuffer: ArrayBuffer,
  mimeType: string,
  lexicalPrompt?: string,
): Promise<{ text: string; timings: ProviderTimings }> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY!
  // Gemini n'accepte pas le suffixe codec (ex: "audio/webm;codecs=opus" → "audio/webm")
  const safeMime = mimeType.split(';')[0].trim()

  const tEncode = Date.now()
  // Audio long (réunion) → Files API ; audio court → inline base64.
  const audioPart =
    rawBuffer.byteLength > GEMINI_INLINE_MAX_BYTES
      ? { file_data: { mime_type: safeMime, file_uri: await uploadToGeminiFiles(rawBuffer, safeMime, apiKey) } }
      : { inline_data: { mime_type: safeMime, data: Buffer.from(rawBuffer).toString('base64') } }

  // Le contenu utilisateur ne contient QUE l'audio.
  // Le vocabulaire et les instructions sont isolés dans systemInstruction.
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: buildGeminiSystemInstruction(lexicalPrompt) }] },
    contents: [{ role: 'user', parts: [audioPart] }],
    // maxOutputTokens au plafond du modèle : une réunion d'1 h dépasse
    // largement 8192 tokens — sinon la transcription est tronquée.
    generationConfig: { temperature: 0, maxOutputTokens: 65536, thinkingConfig: { thinkingBudget: 0 } },
  })
  const encodeMs = Date.now() - tEncode

  const tWait = Date.now()
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    },
  )
  const providerWaitMs = Date.now() - tWait

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const tBody = Date.now()
  const data = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
  const providerBodyMs = Date.now() - tBody

  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '',
    timings: { encodeMs, providerWaitMs, providerBodyMs, payloadBytes: payload.length },
  }
}

async function transcribeWithGemini(rawBuffer: ArrayBuffer, mimeType: string, lexicalPrompt?: string): Promise<string> {
  return (await transcribeWithGeminiTimed(rawBuffer, mimeType, lexicalPrompt)).text
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
  timings?: ProviderTimings
}

/**
 * Fenêtre de réessai du disjoncteur OpenAI.
 * 15 min : un quota rechargé redevient utilisable dans le quart d'heure, sans
 * redéploiement, et le coût du réessai (~1 s une fois par instance chaude et
 * par fenêtre) est sans commune mesure avec le ~1 s PAR TOUR d'aujourd'hui.
 */
const OPENAI_BREAKER_COOLDOWN_MS = 15 * 60_000

let openaiBreaker: BreakerState = closedBreaker()

/**
 * Interrupteur opérationnel du fournisseur STT.
 *
 * Le disjoncteur ci-dessus est un état de MODULE : il vit dans une instance de
 * fonction. La production du 16/08 a montré que deux tours vocaux consécutifs
 * atterrissent sur deux instances Fluid Compute différentes — chacune est donc
 * partie sur un disjoncteur vierge, a payé son 429, et le péage de 595–753 ms
 * a été acquitté à chaque question malgré le Lot 1. La preuve du Lot 1 est
 * vraie dans une instance et fausse en production à ce rythme de trafic.
 *
 * Un disjoncteur partagé règlerait ça mais ajouterait une lecture à chaque
 * tour, sur un chemin dont on essaie précisément de retirer des allers-retours.
 * Tant que le quota OpenAI est épuisé — un fait constaté, pas une hypothèse —
 * la bonne réponse est un interrupteur, pas un automate.
 *
 *   VOICE_STT_PROVIDER absent | 'gemini'  → Gemini seul, OpenAI jamais appelé
 *   VOICE_STT_PROVIDER = 'auto'           → OpenAI d'abord + disjoncteur (historique)
 *
 * Le défaut est volontairement `gemini` : en production c'est DÉJÀ Gemini qui
 * transcrit à 100 %, la seule différence est qu'on cesse de payer le péage pour
 * l'apprendre. Réactiver OpenAI quand le quota revient est une variable
 * d'environnement, pas un déploiement. Une reprise automatique propre suppose
 * un disjoncteur partagé — un lot en soi, non ouvert ici.
 */
export type SttMode = 'auto' | 'gemini'

export function sttMode(): SttMode {
  return process.env.VOICE_STT_PROVIDER?.trim().toLowerCase() === 'auto' ? 'auto' : 'gemini'
}

/** Réservé aux tests — l'état du disjoncteur est un singleton de module. */
export function __resetOpenAiBreaker(): void {
  openaiBreaker = closedBreaker()
}

/**
 * Transcription dédiée au Copilote vocal.
 * Priorité : gpt-4o-mini-transcribe (prompt lexical natif) → Gemini (prompt lexical en texte) → erreur.
 * Bascule sur Gemini si OpenAI retourne 429 quota exhausted ou si la clé est absente.
 *
 * Depuis l'audit du 16/08, un refus pour quota n'est plus réappris à chaque
 * question : il ouvre un disjoncteur, et les tours suivants partent directement
 * sur Gemini. Le comportement fonctionnel est inchangé — c'est déjà Gemini qui
 * transcrit en production — seul le péage disparaît.
 */
export async function transcribeAudioForCopilot(
  rawBuffer: ArrayBuffer,
  mimeType: string,
  ext: string,
  lexicalPrompt?: string,
): Promise<CopilotTranscriptionResult> {
  const filename = `voice.${ext}`
  const fileSize = rawBuffer.byteLength
  const timings: ProviderTimings = {}

  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY)
  const geminiConfigured = Boolean(process.env.GOOGLE_GENAI_API_KEY)

  // L'interrupteur ne doit jamais rendre la transcription impossible : sans clé
  // Gemini, « Gemini seul » n'a aucun sens et OpenAI reprend la main quoi qu'il
  // arrive. C'est la seule condition qui prime sur la configuration.
  const openaiOffByMode = sttMode() === 'gemini' && geminiConfigured
  if (openaiOffByMode && openaiConfigured) {
    console.log('[Voice] stt_gemini_first — OpenAI desactive par configuration')
  }

  const openaiAllowed = openaiConfigured && !openaiOffByMode && shouldAttempt(openaiBreaker, Date.now())
  if (openaiConfigured && !openaiOffByMode && !openaiAllowed) {
    console.log('[Voice] openai_breaker_skip', {
      phase: breakerPhase(openaiBreaker, Date.now()),
      openedAt: openaiBreaker.openedAt,
      nextProbeInMs: Math.max(0, openaiBreaker.nextProbeAt - Date.now()),
    })
  }

  // ── Tentative OpenAI ──────────────────────────────────────────────────────
  if (openaiAllowed) {
    const tOpenai = Date.now()
    const form = new FormData()
    form.append('file', new Blob([rawBuffer], { type: mimeType }), filename)
    form.append('model', 'gpt-4o-mini-transcribe')
    form.append('language', 'fr')
    if (lexicalPrompt) form.append('prompt', lexicalPrompt)

    console.log('[Voice] openai_call', {
      model: 'gpt-4o-mini-transcribe', filename, mimeType, fileSize,
      promptLen: lexicalPrompt?.length ?? 0,
      breaker: breakerPhase(openaiBreaker, Date.now()),
    })

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
      openaiBreaker = recordAvailable()
      timings.openaiMs = Date.now() - tOpenai
      return {
        text:        data.text?.trim() ?? '',
        model:       'gpt-4o-mini-transcribe',
        tokensAudio: data.usage?.input_token_details?.audio_tokens,
        tokensOutput: data.usage?.output_tokens,
        timings,
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
      // Une panne franche n'est pas une indisponibilité de quota : on la remonte
      // telle quelle plutôt que de la masquer derrière un disjoncteur.
      throw new Error(`gpt-4o-mini-transcribe ${res.status}: ${JSON.stringify(body)}`)
    }
    timings.openaiMs = Date.now() - tOpenai
    openaiBreaker = recordUnavailable(openaiBreaker, Date.now(), OPENAI_BREAKER_COOLDOWN_MS)
    console.warn('[Voice] openai_quota_exhausted — disjoncteur ouvert, fallback Gemini', {
      wastedMs: timings.openaiMs,
      nextProbeInMs: OPENAI_BREAKER_COOLDOWN_MS,
    })
  }

  // ── Fallback Gemini ───────────────────────────────────────────────────────
  if (geminiConfigured) {
    console.log('[Voice] gemini_call', { mimeType, fileSize, promptLen: lexicalPrompt?.length ?? 0 })
    const { text, timings: gemini } = await transcribeWithGeminiTimed(rawBuffer, mimeType, lexicalPrompt)
    return { text, model: GEMINI_MODEL, timings: { ...timings, ...gemini } }
  }

  throw new Error('Aucun provider de transcription disponible (OpenAI quota exhausted, GOOGLE_GENAI_API_KEY absent)')
}
