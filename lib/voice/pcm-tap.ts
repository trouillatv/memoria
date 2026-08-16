'use client'

// P3-B — capture PCM 16 kHz du micro, pour Gemini Live.
//
// Gemini Live n'accepte pas de WebM : il veut du PCM 16 bits little-endian à
// 16 kHz, envoyé au fil de l'eau. 640 échantillons à 16 kHz = 40 ms, la taille
// de bloc recommandée par Google.
//
// CONTEXTE AUDIO DÉDIÉ, et c'est délibéré : l'orbe possède déjà un
// `AudioContext` à la fréquence par défaut de l'appareil (48 kHz en général),
// qui alimente l'`AnalyserNode` puis la VAD. Forcer CE contexte-là à 16 kHz
// changerait la fenêtre d'analyse (256 échantillons = 16 ms au lieu de 5,3 ms)
// et donc, potentiellement, l'instant de fin de parole. Le mandat interdit de
// toucher à la détection de fin de parole : on ouvre donc un second contexte,
// branché sur le MÊME `MediaStream`, et la VAD reste bit pour bit celle d'hier.
//
// Le worklet est chargé depuis une Blob URL : aucun fichier dans /public.

const WORKLET_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(640); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      let s = ch[i]
      if (s > 1) s = 1; else if (s < -1) s = -1
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0 }
    }
    return true
  }
}
registerProcessor('pcm-tap', PcmTap)
`

export const PCM_SAMPLE_RATE = 16000

export type PcmTap = { stop: () => void }

/** Int16 → base64, par tranches pour ne pas exploser la pile d'arguments. */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

/**
 * Branche un tap PCM sur un flux micro déjà obtenu.
 *
 * Renvoie `null` — jamais une exception — si l'appareil ne peut pas fournir du
 * 16 kHz ou si le worklet ne se charge pas. Ne JAMAIS envoyer du 48 kHz
 * étiqueté 16 kHz : la transcription serait fausse et on l'imputerait au
 * modèle. L'absence de tap fait simplement retomber l'orbe sur le STT serveur.
 */
export async function attachPcmTap(
  stream: MediaStream,
  onChunk: (chunk: Int16Array) => void,
): Promise<PcmTap | null> {
  let ctx: AudioContext | null = null
  try {
    ctx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE })
    if (ctx.sampleRate !== PCM_SAMPLE_RATE) {
      void ctx.close().catch(() => {})
      return null
    }

    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }

    const source = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'pcm-tap')
    node.port.onmessage = (e) => onChunk(e.data as Int16Array)
    // Pas de connexion vers `ctx.destination` : aucun retour audio.
    source.connect(node)

    const closing = ctx
    return {
      stop: () => {
        node.port.onmessage = null
        try { source.disconnect() } catch { /* graphe déjà démonté */ }
        void closing.close().catch(() => {})
      },
    }
  } catch {
    if (ctx) void ctx.close().catch(() => {})
    return null
  }
}
