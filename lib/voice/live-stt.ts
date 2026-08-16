'use client'

// P3-B — LA frontière STT du parcours vocal.
//
// Au-dessus de ce module, personne ne sait qui a transcrit : `finish()` rend un
// texte déjà normalisé, ou `null`. Un `null` fait retomber l'orbe sur le STT
// serveur avec l'audio qu'elle a de toute façon enregistré — repli de PANNE,
// jamais une seconde transcription systématique.
//
// Pourquoi Live : campagne du 16/08, 17 essais sur téléphone réel — transcript
// disponible 1 165 ms après la fin de parole (p50) contre 5 776 ms pour le STT
// serveur, sans erreur métier dangereuse. Le gain est de plusieurs secondes.
//
// Ce que Live NE fait PAS, et qu'il ne faut pas espérer ici : transcrire pendant
// que l'utilisateur parle. Mesuré 17 fois sur 17, `1er partiel − durée de
// parole = latence finale` à l'unité près : tout le transcript arrive en un
// message APRÈS `audioStreamEnd`. Live est un batch très rapide, pas un STT
// incrémental. Aucun affichage progressif ne doit être bâti là-dessus.
//
// Live n'accepte non plus AUCUN indice lexical (`systemInstruction` ne biaise
// pas `inputAudioTranscription` — réfuté 6/6). Les noms propres du chantier
// sont donc corrigés APRÈS, contre le vocabulaire fermé descendu avec le jeton,
// par un normaliseur déterministe qui s'abstient au moindre doute.
//
// ── Recouvrement MIC_READY : ABANDONNÉ, et c'est un choix ────────────────────
// Le préchargement P2-C (overview/briefing/préparation lancés pendant le STT)
// n'a plus de STT serveur derrière lequel se cacher : la transcription a quitté
// le serveur. Le faire survivre exigerait soit un store de tour partagé entre
// deux requêtes — état distribué sur Vercel, TTL, usage unique, courses,
// nettoyage — soit de faire transiter les read-models par le téléphone puis de
// les renvoyer. Cette seconde forme ferait du client la SOURCE des faits que le
// Copilote énonce : le serveur devrait soit les croire (nouvelle frontière de
// confiance sur l'entrée du modèle), soit les relire (et alors le gain est nul).
// Les deux branches sont des conditions d'arrêt du mandat. On perd ~1 s ; le STT
// client en rend ~4,6.

import { normalizeTranscript, type VocabularyTerm } from '@/lib/ai/transcript-normalizer'
import { PCM_SAMPLE_RATE, pcmToBase64 } from '@/lib/voice/pcm-tap'
import { traceVoice } from '@/lib/voice/voice-trace'

type LiveSession = { sendRealtimeInput: (p: unknown) => void; close: () => void }

export type LiveSttOutcome = {
  /** Transcript normalisé contre le vocabulaire du chantier. */
  text: string
  /** Termes réécrits — vides la plupart du temps, c'est attendu. */
  corrections: { from: string; to: string }[]
  /** Empans où plusieurs termes réels étaient plausibles : rien n'a été touché. */
  abstentions: number
}

export type LiveSttSession = {
  /** Un bloc PCM 16 kHz. Tamponné tant que la session n'est pas prête. */
  push: (chunk: Int16Array) => void
  /**
   * Fin de parole : ferme le flux audio et attend le transcript.
   * `null` = Live n'a rien rendu → l'appelant se replie sur le STT serveur.
   */
  finish: () => Promise<LiveSttOutcome | null>
  /** Abandon (orbe fermée, audio vide) : rien ne sera attendu ni renvoyé. */
  abort: () => void
}

/**
 * Attente maximale de `setupComplete` au moment de la fin de parole. La session
 * a été ouverte à l'ouverture du micro, donc plusieurs secondes plus tôt : si
 * elle n'est toujours pas prête ici, elle ne sera pas rapide. Mieux vaut partir
 * tout de suite sur le STT serveur que d'ajouter son délai au sien.
 */
const READY_GRACE_MS = 1500

/**
 * Attente maximale du transcript après `audioStreamEnd`. Au-delà, le STT
 * serveur (5,8 s p50) aurait de toute façon été le meilleur choix.
 */
const TRANSCRIPT_TIMEOUT_MS = 4000

/**
 * Silence après le dernier morceau de transcription avant de considérer le
 * texte complet. On n'attend surtout PAS `turnComplete` : il arrive après que le
 * modèle a commencé à répondre, et facturerait au STT une latence de génération
 * qui ne le concerne pas. 350 ms est une assurance — les mesures montrent un
 * message unique — et non un délai attendu.
 */
const TRANSCRIPT_QUIET_MS = 350

/** 30 s de parole à 40 ms le bloc. Au-delà ce n'est plus un tampon, c'est une fuite. */
const MAX_BUFFERED_CHUNKS = 750

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Ouvre une session Live. NON bloquante : la connexion (jeton + WebSocket +
 * `setupComplete`, 1 à 2 s au total) se fait en arrière-plan pendant que
 * l'utilisateur commence à parler, et le PCM capté entre-temps est tamponné puis
 * renvoyé d'un bloc. Attendre la session avant d'ouvrir le micro reviendrait à
 * échanger la latence gagnée en fin de tour contre la même latence en début.
 */
export function openLiveStt(siteId: string): LiveSttSession {
  let session: LiveSession | null = null
  let setupDone = false
  let ready = false
  let failed = false
  let aborted = false

  let vocabulary: VocabularyTerm[] = []
  let transcript = ''
  let lastTextAt = 0
  let turnEnded = false

  const buffered: Int16Array[] = []
  let dropped = 0

  let settleReady: () => void = () => {}
  const readyOrFailed = new Promise<void>((resolve) => { settleReady = resolve })

  function give(reason: string) {
    if (ready || failed) return
    failed = true
    traceVoice('live-stt-unavailable', { reason })
    settleReady()
  }

  function send(chunk: Int16Array) {
    try {
      session?.sendRealtimeInput({
        audio: { data: pcmToBase64(chunk), mimeType: `audio/pcm;rate=${PCM_SAMPLE_RATE}` },
      })
    } catch {
      give('send-failed')
    }
  }

  function flush() {
    for (const chunk of buffered) send(chunk)
    buffered.length = 0
  }

  function close() {
    try { session?.close() } catch { /* déjà fermée */ }
    session = null
  }

  /**
   * Deux conditions, dans un ordre non garanti : `connect()` qui rend l'objet de
   * session, et le message `setupComplete` qui autorise à s'en servir. Le premier
   * arrivé ne fait rien, le second ouvre le robinet.
   */
  function markReady() {
    if (ready || failed || !setupDone || !session) return
    ready = true
    flush()
    settleReady()
  }

  void (async () => {
    try {
      const res = await fetch('/api/copilot/live-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId }),
      })
      if (!res.ok) { give(`token-${res.status}`); return }
      const data = (await res.json()) as { token?: string; model?: string; vocabulary?: VocabularyTerm[] }
      if (!data.token || !data.model) { give('token-shape'); return }
      vocabulary = data.vocabulary ?? []
      if (aborted) { give('aborted'); return }

      const { GoogleGenAI, Modality } = await import('@google/genai')
      // `apiVersion: 'v1alpha'` est OBLIGATOIRE avec un jeton éphémère : le SDK
      // bascule alors sur `BidiGenerateContentConstrained` et passe le jeton en
      // `access_token`. Sans lui, il construit une URL v1beta que le jeton ne
      // peut pas ouvrir — et se contente d'un `console.warn`, invisible sur un
      // téléphone.
      const ai = new GoogleGenAI({ apiKey: data.token, httpOptions: { apiVersion: 'v1alpha' } })
      const connected = await ai.live.connect({
        model: data.model,
        config: {
          // Cette config est IGNORÉE : le setup gelé dans le jeton la remplace
          // intégralement (voir la route). On la garde alignée pour qu'une
          // lecture du fichier ne laisse pas croire à une divergence.
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
        },
        callbacks: {
          onmessage: (msg) => {
            if (msg.setupComplete) {
              setupDone = true
              markReady()
            }
            const t = msg.serverContent?.inputTranscription?.text
            if (t) {
              transcript += t
              lastTextAt = Date.now()
            }
            if (msg.serverContent?.turnComplete || msg.serverContent?.generationComplete) {
              turnEnded = true
            }
          },
          onerror: () => give('socket-error'),
          onclose: () => { if (!ready) give('socket-closed') },
        },
      })
      // `connect()` résout avant `setupComplete` (mesuré : 1 à 1,8 s d'écart) :
      // la session existe mais n'accepte pas encore d'audio, d'où `markReady()`
      // qui attend les deux.
      session = connected as unknown as LiveSession
      if (aborted) { close(); return }
      markReady()
    } catch (err) {
      give(err instanceof Error ? err.message.slice(0, 60) : 'connect-failed')
    }
  })()

  return {
    push(chunk) {
      if (aborted || failed) return
      if (ready) { send(chunk); return }
      if (buffered.length >= MAX_BUFFERED_CHUNKS) { dropped++; return }
      buffered.push(chunk)
    },

    abort() {
      aborted = true
      buffered.length = 0
      close()
    },

    async finish() {
      if (aborted) return null

      await Promise.race([readyOrFailed, delay(READY_GRACE_MS)])
      if (!ready || !session) {
        traceVoice('live-stt-fallback', { reason: failed ? 'unavailable' : 'not-ready' })
        close()
        return null
      }

      flush()
      try {
        session.sendRealtimeInput({ audioStreamEnd: true })
      } catch {
        traceVoice('live-stt-fallback', { reason: 'stream-end-failed' })
        close()
        return null
      }

      const deadline = Date.now() + TRANSCRIPT_TIMEOUT_MS
      while (Date.now() < deadline && !aborted) {
        if (transcript && (turnEnded || Date.now() - lastTextAt >= TRANSCRIPT_QUIET_MS)) break
        await delay(50)
      }
      close()
      if (aborted) return null

      const raw = transcript.trim()
      if (!raw) {
        traceVoice('live-stt-fallback', { reason: 'empty' })
        return null
      }

      const normalized = normalizeTranscript(raw, vocabulary)
      traceVoice('live-stt', {
        chars: normalized.text.length,
        corrections: normalized.corrections.map((c) => `${c.from}→${c.to}`),
        abstentions: normalized.abstentions.length,
        vocabulary: vocabulary.length,
        droppedChunks: dropped,
      })
      return {
        text: normalized.text,
        corrections: normalized.corrections.map((c) => ({ from: c.from, to: c.to })),
        abstentions: normalized.abstentions.length,
      }
    },
  }
}
