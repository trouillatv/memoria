'use client'

// LOT 0 — banc d'essai. Code jetable, à supprimer à la clôture du spike.
//
// Quatre scénarios, dont deux qui n'existent que pour trancher l'ordre de
// démarrage — sur iOS, la session audio est attribuée au premier demandeur, et
// `getUserMedia` derrière un `await` perd parfois le geste utilisateur.
//
//   1. Micro seul                → référence : on sait déjà que ça marche
//   2. Reconnaissance seule      → les résultats intermédiaires arrivent-ils ?
//   3. Reconnaissance PUIS micro → l'ordre le plus favorable en théorie
//   4. Micro PUIS reconnaissance → l'ordre qu'imposerait notre code actuel
//
// On mesure au passage le plancher de bruit réel et le RMS max : ce sont les
// deux entrées dont le lot 1 a besoin pour calibrer la VAD ailleurs qu'au doigt
// mouillé.
//
// ── P3-A (mandat Vincent, 16/08) — scénario 5, isolé ────────────────────────
//
// Question unique : Gemini Live mérite-t-il d'entrer dans l'architecture ?
// Trois mesures, sur les 10 phrases déjà utilisées, et rien d'autre :
//   1. fin de parole → transcription finale Live    GO si < 1 s p50 (idéal <500 ms)
//   2. « PETRO ATITI » correct au moins 3 fois sur 3
//   3. SSI / TD / AGP / Clim Expert / Jérôme / Vincent Milon sans régression
//
// Le batch Gemini actuel tourne EN PARALLÈLE, sur exactement le même audio
// (un seul getUserMedia, deux consommateurs), pour donner sur chaque essai :
// transcript Live / transcript batch / phrase attendue / latence Live /
// latence batch. C'est un banc, pas une architecture : aucun code du Copilote
// n'est touché, il n'y a pas de « Live provisoire + batch vérité ». On teste le
// moteur avant l'architecture.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveServerMessage } from '@google/genai'

// ── Typage minimal de la Web Speech API (absente de lib.dom pour webkit) ──────

type SRAlternative = { transcript: string; confidence: number }
type SRResult = { readonly length: number; isFinal: boolean; [index: number]: SRAlternative }
type SRResultList = { readonly length: number; [index: number]: SRResult }
type SREvent = { resultIndex: number; results: SRResultList }
type SRErrorEvent = { error: string; message?: string }

interface SRInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onstart: (() => void) | null
  onaudiostart: (() => void) | null
  onspeechstart: (() => void) | null
  onspeechend: (() => void) | null
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: SRErrorEvent) => void) | null
  onend: (() => void) | null
}

type SRCtor = new () => SRInstance

function getSRCtor(): SRCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

// ── Scénarios ────────────────────────────────────────────────────────────────

type Scenario = 'mic' | 'speech' | 'speech-then-mic' | 'mic-then-speech' | 'live'

const SCENARIOS: Array<{ id: Scenario; label: string; hint: string }> = [
  { id: 'mic',             label: '1 · Micro seul',              hint: 'MediaRecorder + AnalyserNode' },
  { id: 'speech',          label: '2 · Reconnaissance seule',    hint: 'webkitSpeechRecognition' },
  { id: 'speech-then-mic', label: '3 · Reconnaissance → micro',  hint: 'SR démarrée en premier' },
  { id: 'mic-then-speech', label: '4 · Micro → reconnaissance',  hint: 'ordre de notre code actuel' },
  { id: 'live',            label: '5 · Gemini Live ∥ batch',     hint: 'P3-A — même audio, deux moteurs' },
]

// ── P3-A · capture PCM pour Gemini Live ──────────────────────────────────────
//
// Gemini Live n'accepte pas de WebM : il veut du PCM 16 bits little-endian à
// 16 kHz, envoyé au fil de l'eau. Google recommande des blocs de 20-40 ms et
// déconseille explicitement de tamponner une seconde — ce qui rendrait la
// mesure absurde puisque c'est justement l'anticipation qu'on cherche à
// mesurer. 640 échantillons à 16 kHz = 40 ms.
//
// Le worklet est chargé depuis une Blob URL : pas de fichier dans /public à
// nettoyer quand le spike sera supprimé.
const PCM_WORKLET_SOURCE = `
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

/**
 * Int16 → base64, par tranches pour ne pas exploser la pile d'arguments.
 *
 * Exportée uniquement pour être testée : une erreur d'octets ici enverrait de
 * l'audio corrompu à Gemini Live, et on imputerait au modèle une transcription
 * fausse. C'est la seule façon dont ce banc pourrait produire un verdict
 * d'architecture erroné sans que rien ne le signale à l'écran.
 */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

// VAD locale — le repère « fin de parole » PARTAGÉ par les deux pipelines.
//
// Pourquoi pas un appui manuel : le temps de réaction humain (200-400 ms) est
// du même ordre que le seuil qu'on teste (<500 ms). Il empoisonnerait la
// mesure au lieu de la fournir. Le RMS est calculé sur les blocs PCM eux-mêmes,
// pas sur l'AnalyserNode, dont le lissage (0,85) décalerait le repère de
// plusieurs dizaines de millisecondes vers le tard.
const VAD_CALIBRATION_CHUNKS = 12   // ≈ 480 ms de plancher de bruit
const VAD_HANGOVER_MS        = 700  // silence continu avant de déclarer la fin
const VAD_MIN_LOUD_CHUNKS    = 3    // il faut avoir parlé pour pouvoir se taire
const LIVE_FINALIZE_TIMEOUT_MS = 8000
/** Attente maximale de `setupComplete` avant d'ouvrir le micro malgré tout. */
const LIVE_SETUP_TIMEOUT_MS = 8000

// P2-C item 2 (mandat Vincent, 16/08) : corpus obligatoire, entités métier
// réelles + phrases naturelles chantier — sert à comparer Web Speech (résultat
// final) au backend Gemini (`/api/copilot/transcribe`), latence ET texte.
const PHRASES = [
  'Quels sont les prochains points de contrôle sur le chantier PETRO ATITI ?',
  'Est-ce que le SSI a été vérifié cette semaine sur AGP ?',
  'Rappelle-moi le dernier compte rendu de TD.',
  'Il faut relancer Clim Expert pour la mise en service.',
  'Jérôme doit passer demain matin sur le chantier.',
  'Envoie un message à Vincent Milon pour la réunion de dix-huit heures.',
  'Quelles sont les réserves encore ouvertes sur ce chantier ?',
  "On a coulé la dalle ce matin, il faudra vérifier le séchage vendredi.",
  "Le désenfumage n'est toujours pas raccordé, à qui je dois en parler ?",
  "Prépare-moi un résumé de la visite d'hier avec les points bloquants.",
]

// En production la route de transcription reçoit un `siteId` et injecte le
// lexique du chantier (nom + sujets canoniques) dans le prompt STT. Sans lui,
// Gemini fait les mêmes fautes que Web Speech (« P3 City » observé le 16/08) —
// la comparaison de qualité n'est équitable qu'avec ce lexique.
const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'

type RunRecord = {
  id: number
  phrase: string
  scenario: Scenario
  srLatencyMs: number | null
  srText: string | null
  backendLatencyMs: number | null
  backendText: string | null
  // P3-A — Gemini Live sur EXACTEMENT le même audio que le batch.
  //   liveFirstPartialMs : depuis le DÉBUT de parole. Une valeur nettement
  //     inférieure à la durée de la phrase prouve que la transcription commence
  //     pendant que l'utilisateur parle — c'est la preuve de concept.
  //   liveFinalMs : depuis la FIN de parole. C'est LE critère du mandat
  //     (GO < 1 s p50, idéalement < 500 ms). Une valeur NÉGATIVE est un
  //     résultat valide et excellent : la transcription était complète avant
  //     même que la VAD locale ne déclare le silence.
  liveFirstPartialMs: number | null
  liveFinalMs: number | null
  liveText: string | null
}

function resultsToText(results: RunRecord[]): string {
  return results
    .map((r, i) => {
      const delta =
        r.srLatencyMs != null && r.backendLatencyMs != null ? r.backendLatencyMs - r.srLatencyMs : null
      const gain =
        r.liveFinalMs != null && r.backendLatencyMs != null ? r.backendLatencyMs - r.liveFinalMs : null
      const lines = [
        `#${i + 1} [${r.scenario}] attendu : "${r.phrase}"`,
      ]
      if (r.scenario === 'live') {
        lines.push(
          `  live : final ${r.liveFinalMs != null ? `${r.liveFinalMs} ms` : '—'} depuis fin de parole` +
            (r.liveFirstPartialMs != null ? ` · 1er partiel ${r.liveFirstPartialMs} ms après début de parole` : '') +
            `\n         "${r.liveText ?? '—'}"`,
          `  batch: ${r.backendLatencyMs != null ? `${r.backendLatencyMs} ms` : '—'} · "${r.backendText ?? '—'}"`,
        )
        if (gain != null) lines.push(`  gain live vs batch : ${gain} ms`)
      } else {
        lines.push(
          `  SR   : ${r.srLatencyMs != null ? `${r.srLatencyMs} ms` : '—'} · "${r.srText ?? '—'}"`,
          `  back : ${r.backendLatencyMs != null ? `${r.backendLatencyMs} ms` : '—'} · "${r.backendText ?? '—'}"`,
        )
        if (delta != null) lines.push(`  delta (back - SR) : ${delta} ms`)
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

/** Ligne vide d'un essai — un seul endroit à modifier quand le type change. */
function emptyRun(id: number, phrase: string, scenario: Scenario): RunRecord {
  return {
    id, phrase, scenario,
    srLatencyMs: null, srText: null,
    backendLatencyMs: null, backendText: null,
    liveFirstPartialMs: null, liveFinalMs: null, liveText: null,
  }
}

export function SpikeVoiceHarness() {
  const [running, setRunning]   = useState<Scenario | null>(null)
  const [log, setLog]           = useState<Array<{ t: number; msg: string; bad?: boolean }>>([])
  const [interim, setInterim]   = useState('')
  const [srFinal, setSrFinal]   = useState('')
  const [level, setLevel]       = useState(0)
  const [noiseFloor, setNoise]  = useState<number | null>(null)
  const [peak, setPeak]         = useState(0)
  const [blobInfo, setBlobInfo] = useState<string | null>(null)
  const [backend, setBackend]   = useState<string | null>(null)
  const [sendToApi, setSendApi] = useState(true)
  const [env, setEnv]           = useState<string[]>([])
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [results, setResults]   = useState<RunRecord[]>([])
  const [copied, setCopied]     = useState(false)
  const [liveText, setLiveText] = useState('')

  const t0Ref       = useRef(0)
  const srRef       = useRef<SRInstance | null>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const ctxRef      = useRef<AudioContext | null>(null)
  const recRef      = useRef<MediaRecorder | null>(null)
  const rafRef      = useRef<number | null>(null)
  const peakRef     = useRef(0)
  const samplesRef  = useRef<number[]>([])
  // "Fin de parole" partagée par les deux pipelines (SR ∥ backend) — posée par
  // `onspeechend`, seul signal de fin de parole disponible ici (le backend n'a
  // pas de VAD propre dans ce spike).
  const speechEndAtRef      = useRef<number | null>(null)
  const srLatencyLoggedRef  = useRef(false)
  const currentRunIdRef     = useRef<number | null>(null)
  const runIdSeqRef         = useRef(0)
  // Sur Android, `isFinal` n'arrive pas toujours (observé le 16/08) — on garde
  // la dernière hypothèse pour pouvoir la figer au `onend` si aucun résultat
  // final ne s'est jamais présenté.
  const latestTranscriptRef = useRef('')

  // ── P3-A · état de la session Live ─────────────────────────────────────────
  type LiveSession = { sendRealtimeInput: (p: unknown) => void; close: () => void }
  const liveSessionRef      = useRef<LiveSession | null>(null)
  const liveTextRef         = useRef('')
  const liveFirstPartialRef = useRef<number | null>(null)
  const liveLastPartialRef  = useRef<number | null>(null)
  const liveFinalizedRef    = useRef(false)
  const liveTimeoutRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  // VAD locale, calculée sur les blocs PCM.
  const speechStartAtRef    = useRef<number | null>(null)
  const lastLoudAtRef       = useRef<number | null>(null)
  const loudChunksRef       = useRef(0)
  const vadFloorRef         = useRef<number[]>([])
  const vadThresholdRef     = useRef<number | null>(null)

  const say = useCallback((msg: string, bad?: boolean) => {
    setLog((prev) => [...prev, { t: Date.now() - t0Ref.current, msg, bad }])
  }, [])

  // Environnement — décisif pour interpréter un échec (PWA ? HTTPS ? quel OS ?).
  useEffect(() => {
    const w = window as unknown as { webkitSpeechRecognition?: unknown }
    setEnv([
      `UA : ${navigator.userAgent}`,
      `Contexte sécurisé : ${window.isSecureContext ? 'oui' : 'NON'}`,
      `PWA autonome : ${window.matchMedia('(display-mode: standalone)').matches ? 'oui' : 'non (onglet)'}`,
      `SpeechRecognition : ${getSRCtor() ? (w.webkitSpeechRecognition ? 'webkit' : 'standard') : 'ABSENTE'}`,
      `MediaRecorder : ${typeof MediaRecorder !== 'undefined' ? 'présent' : 'ABSENT'}`,
    ])
  }, [])

  const stopAll = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (liveTimeoutRef.current != null) { clearTimeout(liveTimeoutRef.current); liveTimeoutRef.current = null }
    try { liveSessionRef.current?.close() } catch { /* déjà fermée */ }
    liveSessionRef.current = null
    try { srRef.current?.stop() } catch { /* déjà arrêtée */ }
    srRef.current = null
    if (recRef.current?.state === 'recording') {
      try { recRef.current.stop() } catch { /* déjà arrêté */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    setLevel(0)
  }, [])

  useEffect(() => stopAll, [stopAll])

  // ── Reconnaissance vocale ──────────────────────────────────────────────────

  function startSpeech(): boolean {
    const Ctor = getSRCtor()
    if (!Ctor) { say('SpeechRecognition absente de ce navigateur', true); return false }

    const rec = new Ctor()
    rec.lang = 'fr-FR'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart      = () => say('SR onstart')
    rec.onaudiostart = () => say('SR onaudiostart — le micro est pris par la reconnaissance')
    rec.onspeechstart = () => say('SR onspeechstart — parole détectée')
    rec.onspeechend  = () => {
      say('SR onspeechend — silence détecté par le moteur')
      speechEndAtRef.current = Date.now()
      // Aligne l'arrêt de l'enregistreur sur le même instant : les deux
      // pipelines (SR ∥ backend) sont ainsi mesurés depuis la même « fin de
      // parole », condition nécessaire pour comparer honnêtement leurs latences.
      if (recRef.current?.state === 'recording') {
        try { recRef.current.stop() } catch { /* déjà arrêté */ }
      }
    }
    rec.onend        = () => {
      say('SR onend')
      // Repli : sur ce téléphone `isFinal` n'arrive pas toujours (observé
      // 16/08 — texte dupliqué en boucle, jamais de résultat final). Si
      // `onresult` n'a jamais rien figé, on fige ici la dernière hypothèse
      // connue plutôt que de perdre la mesure.
      if (!srLatencyLoggedRef.current) {
        srLatencyLoggedRef.current = true
        const text = latestTranscriptRef.current
        const id = currentRunIdRef.current
        if (speechEndAtRef.current != null) {
          const latency = Date.now() - speechEndAtRef.current
          say(`SR (sans isFinal) au onend : ${latency} ms depuis fin de parole · "${text || '—'}"`, !text)
          if (id != null) {
            setResults((prev) =>
              prev.map((r) => (r.id === id ? { ...r, srLatencyMs: latency, srText: text || '(aucun résultat)' } : r)),
            )
          }
        } else {
          say(`SR onend sans repère de fin de parole (onspeechend jamais déclenché) · "${text || '—'}"`, true)
          if (id != null) {
            setResults((prev) =>
              prev.map((r) => (r.id === id ? { ...r, srText: text || '(aucun résultat — onspeechstart jamais déclenché)' } : r)),
            )
          }
        }
      }
    }
    rec.onerror      = (e) => say(`SR onerror : ${e.error}${e.message ? ` — ${e.message}` : ''}`, true)

    rec.onresult = (e) => {
      // Sur ce téléphone, chaque nouveau `results[i]` réénonce le texte cumulé
      // depuis le début plutôt qu'un segment incrémental — additionner tous
      // les index produit un texte dupliqué en boucle. Le DERNIER index
      // contient déjà tout ce qui a été reconnu jusqu'ici.
      const lastIdx = e.results.length - 1
      const last = lastIdx >= 0 ? e.results[lastIdx] : null
      const text = last ? last[0].transcript : ''
      const isFinal = last ? last.isFinal : false
      latestTranscriptRef.current = text

      if (isFinal) {
        setSrFinal(text)
        setInterim('')
        if (!srLatencyLoggedRef.current && speechEndAtRef.current != null) {
          srLatencyLoggedRef.current = true
          const latency = Date.now() - speechEndAtRef.current
          say(`SR résultat final : ${latency} ms depuis fin de parole`)
          const id = currentRunIdRef.current
          if (id != null) {
            setResults((prev) => prev.map((r) => (r.id === id ? { ...r, srLatencyMs: latency, srText: text } : r)))
          }
        }
      } else {
        setInterim(text)
      }
    }

    try {
      rec.start()
      srRef.current = rec
      say('SR start() appelé')
      return true
    } catch (err) {
      say(`SR start() a levé : ${(err as Error).message}`, true)
      return false
    }
  }

  // ── Micro : MediaRecorder + AnalyserNode ───────────────────────────────────

  async function startMic(opts?: { pcm?: (chunk: Int16Array) => void }): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      say(`getUserMedia OK — ${stream.getAudioTracks().length} piste(s)`)

      const track = stream.getAudioTracks()[0]
      say(`piste : ${track.label || 'sans label'} · état ${track.readyState}`)
      track.onended = () => say('piste micro TERMINÉE par le système', true)
      track.onmute  = () => say('piste micro MUTE — conflit probable', true)

      // P3-A : un SEUL `getUserMedia`, deux consommateurs (MediaRecorder pour le
      // batch, tap PCM pour Live). C'est ce qui rend la comparaison honnête —
      // exactement le même audio. Et contrairement à Web Speech ∥ MediaRecorder,
      // il n'y a ici aucune contention micro : rien ne redemande le micro.
      const ctx = opts?.pcm ? new AudioContext({ sampleRate: 16000 }) : new AudioContext()
      ctxRef.current = ctx
      if (opts?.pcm && ctx.sampleRate !== 16000) {
        // Ne JAMAIS envoyer du 48 kHz étiqueté 16 kHz : la transcription serait
        // fausse et on l'imputerait au modèle. Mieux vaut échouer visiblement.
        say(`AudioContext refuse 16 kHz (${ctx.sampleRate} Hz) — scénario Live impossible ici`, true)
        return false
      }
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.85
      const source = ctx.createMediaStreamSource(stream)
      source.connect(analyser)

      if (opts?.pcm) {
        const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' }))
        try {
          await ctx.audioWorklet.addModule(url)
        } finally {
          URL.revokeObjectURL(url)
        }
        const node = new AudioWorkletNode(ctx, 'pcm-tap')
        node.port.onmessage = (e) => opts.pcm?.(e.data as Int16Array)
        // Pas de connexion vers `ctx.destination` : on ne veut aucun retour audio.
        source.connect(node)
        say(`tap PCM actif — ${ctx.sampleRate} Hz, blocs de 40 ms`)
      }

      const buf = new Uint8Array(analyser.fftSize)
      peakRef.current = 0
      samplesRef.current = []
      const loop = () => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const n = (buf[i] - 128) / 128
          sum += n * n
        }
        const rms = Math.sqrt(sum / buf.length)
        // 30 premières frames ≈ 500 ms : plancher de bruit du lieu.
        if (samplesRef.current.length < 30) {
          samplesRef.current.push(rms)
          if (samplesRef.current.length === 30) {
            const sorted = [...samplesRef.current].sort((a, b) => a - b)
            const median = sorted[15]
            setNoise(median)
            say(`plancher de bruit mesuré : ${median.toFixed(4)}`)
          }
        }
        if (rms > peakRef.current) { peakRef.current = rms; setPeak(rms) }
        setLevel(rms)
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)

      const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', '']
      const mime = MIME.find((m) => !m || MediaRecorder.isTypeSupported(m)) ?? ''
      say(`mimeType retenu : ${mime || '(défaut navigateur)'}`)

      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      const startMs = Date.now()
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      rec.onerror = () => say('MediaRecorder onerror', true)
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
        const ms = Date.now() - startMs
        setBlobInfo(`${(blob.size / 1024).toFixed(1)} ko · ${(ms / 1000).toFixed(1)} s · ${blob.type}`)
        say(`MediaRecorder onstop — ${blob.size} octets en ${ms} ms`, blob.size === 0)
        if (sendToApi && blob.size > 0) void sendBackend(blob, rec.mimeType, currentRunIdRef.current, speechEndAtRef.current)
      }
      rec.start()
      recRef.current = rec
      say('MediaRecorder démarré')
      return true
    } catch (err) {
      const e = err as Error
      say(`getUserMedia a échoué : ${e.name} — ${e.message}`, true)
      return false
    }
  }

  async function sendBackend(blob: Blob, mimeType: string, runId: number | null, speechEndAt: number | null) {
    const started = Date.now()
    say('POST /api/copilot/transcribe…')
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
      const form = new FormData()
      form.append('audio', blob, `spike.${ext}`)
      form.append('siteId', PETRO_SITE_ID)
      const res = await fetch('/api/copilot/transcribe', { method: 'POST', body: form })
      const data = await res.json() as { text?: string; model?: string; error?: string }
      if (!res.ok) { say(`backend ${res.status} : ${data.error ?? '—'}`, true); return }
      const text = data.text?.trim() || '(vide)'
      setBackend(text)
      const latencyFromSpeechEnd = speechEndAt != null ? Date.now() - speechEndAt : null
      say(
        `backend OK en ${Date.now() - started} ms depuis l'envoi` +
          (latencyFromSpeechEnd != null ? ` · ${latencyFromSpeechEnd} ms depuis fin de parole` : '') +
          ` · ${data.model ?? 'modèle inconnu'}`,
      )
      if (runId != null) {
        setResults((prev) =>
          prev.map((r) => (r.id === runId ? { ...r, backendLatencyMs: latencyFromSpeechEnd, backendText: text } : r)),
        )
      }
    } catch (err) {
      say(`backend a échoué : ${(err as Error).message}`, true)
    }
  }

  // ── P3-A · Gemini Live ─────────────────────────────────────────────────────

  /**
   * Fige le résultat Live de l'essai courant.
   *
   * `liveFinalMs` = arrivée du DERNIER morceau de transcription de l'utilisateur
   * moins la fin de parole. On ne prend surtout pas `turnComplete` : celui-ci
   * arrive après que le modèle a commencé à répondre, et facturerait au STT une
   * latence de génération qui ne le concerne pas.
   */
  const finalizeLive = useCallback((runId: number | null, reason: string) => {
    if (liveFinalizedRef.current) return
    liveFinalizedRef.current = true
    if (liveTimeoutRef.current != null) { clearTimeout(liveTimeoutRef.current); liveTimeoutRef.current = null }

    const speechEnd = speechEndAtRef.current
    const speechStart = speechStartAtRef.current
    const last = liveFirstPartialRef.current != null ? liveLastPartialRef.current : null
    const finalMs = speechEnd != null && last != null ? last - speechEnd : null
    const firstMs =
      speechStart != null && liveFirstPartialRef.current != null
        ? liveFirstPartialRef.current - speechStart
        : null
    const text = liveTextRef.current.trim()

    if (finalMs == null) {
      say(`Live figé (${reason}) SANS mesure — aucune transcription reçue`, true)
    } else if (finalMs < 0) {
      say(`Live figé (${reason}) : transcription complète ${-finalMs} ms AVANT la fin de parole détectée`)
    } else {
      say(`Live figé (${reason}) : ${finalMs} ms depuis la fin de parole`, finalMs > 1000)
    }
    if (firstMs != null) say(`Live 1er partiel : ${firstMs} ms après le début de parole`)

    if (runId != null) {
      setResults((prev) =>
        prev.map((r) =>
          r.id === runId
            ? { ...r, liveFinalMs: finalMs, liveFirstPartialMs: firstMs, liveText: text || '(aucune transcription)' }
            : r,
        ),
      )
    }
    try { liveSessionRef.current?.close() } catch { /* déjà fermée */ }
    liveSessionRef.current = null
    // La capture n'a plus rien à faire : le MediaRecorder a déjà été arrêté par
    // la VAD (bien avant, c'est le réseau qui nous amène ici) et son blob est
    // parti vers le backend.
    stopAll()
    setRunning(null)
  }, [say, stopAll])

  /**
   * VAD locale sur les blocs PCM — pose le repère « fin de parole » commun aux
   * deux pipelines, puis déclenche les deux fins : `audioStreamEnd` côté Live,
   * `MediaRecorder.stop()` côté batch. Les deux latences partent donc du MÊME
   * instant, condition sans laquelle la comparaison ne veut rien dire.
   */
  function onPcmChunk(runId: number, chunk: Int16Array) {
    const now = Date.now()

    // Envoi immédiat vers Live — aucun tampon, c'est tout l'enjeu.
    const session = liveSessionRef.current
    if (session) {
      try {
        session.sendRealtimeInput({ audio: { data: pcmToBase64(chunk), mimeType: 'audio/pcm;rate=16000' } })
      } catch (err) {
        say(`envoi Live échoué : ${(err as Error).message}`, true)
      }
    }

    let sum = 0
    for (let i = 0; i < chunk.length; i++) { const v = chunk[i] / 32768; sum += v * v }
    const rms = Math.sqrt(sum / chunk.length)

    // Calibration : plancher de bruit du lieu, mesuré au début de chaque essai.
    if (vadThresholdRef.current == null) {
      vadFloorRef.current.push(rms)
      if (vadFloorRef.current.length >= VAD_CALIBRATION_CHUNKS) {
        const sorted = [...vadFloorRef.current].sort((a, b) => a - b)
        const floor = sorted[Math.floor(sorted.length / 2)]
        const threshold = Math.max(floor * 4, 0.015)
        vadThresholdRef.current = threshold
        say(`VAD calibrée — plancher ${floor.toFixed(4)}, seuil ${threshold.toFixed(4)}`)
      }
      return
    }

    if (rms > vadThresholdRef.current) {
      loudChunksRef.current++
      lastLoudAtRef.current = now
      if (speechStartAtRef.current == null && loudChunksRef.current >= VAD_MIN_LOUD_CHUNKS) {
        speechStartAtRef.current = now
        say('VAD : début de parole')
      }
      return
    }

    // Silence. On ne peut se taire que si on a parlé.
    if (speechStartAtRef.current == null || speechEndAtRef.current != null) return
    const lastLoud = lastLoudAtRef.current
    if (lastLoud == null || now - lastLoud < VAD_HANGOVER_MS) return

    // Repère daté au DÉBUT du silence, pas à la fin du hangover : sinon on
    // s'accorderait gratuitement 700 ms sur les deux mesures.
    speechEndAtRef.current = lastLoud
    say(`VAD : fin de parole (datée ${VAD_HANGOVER_MS} ms en arrière)`)

    try { liveSessionRef.current?.sendRealtimeInput({ audioStreamEnd: true }) } catch { /* session fermée */ }
    if (recRef.current?.state === 'recording') {
      try { recRef.current.stop() } catch { /* déjà arrêté */ }
    }
    liveTimeoutRef.current = setTimeout(() => finalizeLive(runId, 'délai dépassé'), LIVE_FINALIZE_TIMEOUT_MS)
  }

  async function startLive(runId: number): Promise<boolean> {
    // 1. Jeton éphémère — la clé Gemini permanente reste sur le serveur.
    say('POST /api/spike/live-token…')
    let token: string
    let model: string
    try {
      const res = await fetch('/api/spike/live-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: PETRO_SITE_ID }),
      })
      const data = (await res.json()) as {
        token?: string; model?: string; lexiconTerms?: number
        error?: string; detail?: string
      }
      if (!res.ok || !data.token) {
        say(`jeton refusé (${res.status}) : ${data.error ?? '—'}${data.detail ? ` · ${data.detail}` : ''}`, true)
        return false
      }
      token = data.token
      model = data.model ?? ''
      say(`jeton obtenu · modèle ${model} · lexique ${data.lexiconTerms ?? 0} terme(s)`, (data.lexiconTerms ?? 0) === 0)
    } catch (err) {
      say(`jeton indisponible : ${(err as Error).message}`, true)
      return false
    }

    // 2. WebSocket DIRECT téléphone → Gemini. Pas de relais : Vercel n'héberge
    //    pas de serveur WebSocket, et le mandat l'interdit explicitement.
    try {
      const { GoogleGenAI, Modality } = await import('@google/genai')
      // `apiVersion: 'v1alpha'` est OBLIGATOIRE avec un jeton éphémère : le SDK
      // bascule alors sur la méthode `BidiGenerateContentConstrained` et passe
      // le jeton en `access_token`. Sans lui, il construit une URL v1beta que
      // le jeton ne peut pas ouvrir (vérifié dans dist/node/index.mjs, où le
      // SDK se contente d'un `console.warn` — invisible sur un téléphone).
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } })
      const connectedAt = Date.now()
      // `setupComplete` arrive 1 à 1,8 s APRÈS la résolution de `connect()`
      // (mesuré). Envoyer du PCM avant, c'est perdre la première seconde de
      // parole sans que rien ne l'indique à l'écran.
      let setupDone: (() => void) | null = null
      const setupReady = new Promise<void>((resolve) => { setupDone = resolve })
      const session = await ai.live.connect({
        model,
        config: {
          // Cette config est IGNORÉE : le setup gelé dans le jeton la remplace
          // intégralement (voir la route). On la garde alignée pour qu'une
          // lecture du fichier ne laisse pas croire à une divergence.
          // AUDIO et non TEXT : les 6 modèles Live de cette clé refusent TEXT.
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => say(`Live ouvert en ${Date.now() - connectedAt} ms`),
          onmessage: (msg: LiveServerMessage) => {
            if (msg.setupComplete) {
              say(`Live prêt en ${Date.now() - connectedAt} ms`)
              setupDone?.()
            }
            const t = msg.serverContent?.inputTranscription?.text
            if (t) {
              const now = Date.now()
              if (liveFirstPartialRef.current == null) {
                liveFirstPartialRef.current = now
                say('Live : 1er morceau de transcription reçu')
              }
              liveLastPartialRef.current = now
              liveTextRef.current += t
              setLiveText(liveTextRef.current)
            }
            if (msg.serverContent?.turnComplete || msg.serverContent?.generationComplete) {
              finalizeLive(runId, 'tour terminé')
            }
          },
          onerror: (e: ErrorEvent) => { say(`Live onerror : ${e.message || 'erreur'}`, true); setupDone?.() },
          onclose: (e: CloseEvent) => {
            say(`Live fermé (${e.code}${e.reason ? ` — ${e.reason}` : ''})`)
            setupDone?.()
          },
        },
      })
      liveSessionRef.current = session as unknown as LiveSession

      // On rend la main seulement quand le serveur est prêt à recevoir de
      // l'audio. Garde-fou : si `setupComplete` n'arrive jamais, mieux vaut un
      // essai dégradé qu'un bouton figé sans explication.
      const guard = setTimeout(() => {
        say('Live : setupComplete non reçu en 8 s — on démarre quand même', true)
        setupDone?.()
      }, LIVE_SETUP_TIMEOUT_MS)
      await setupReady
      clearTimeout(guard)
      return true
    } catch (err) {
      say(`connexion Live impossible : ${(err as Error).message}`, true)
      return false
    }
  }

  // ── Lancement d'un scénario ────────────────────────────────────────────────

  async function run(scenario: Scenario) {
    stopAll()
    t0Ref.current = Date.now()
    setLog([])
    setInterim('')
    setSrFinal('')
    setBlobInfo(null)
    setBackend(null)
    setNoise(null)
    setPeak(0)
    setRunning(scenario)
    setLiveText('')
    speechEndAtRef.current = null
    srLatencyLoggedRef.current = false
    latestTranscriptRef.current = ''
    liveTextRef.current = ''
    liveFirstPartialRef.current = null
    liveLastPartialRef.current = null
    liveFinalizedRef.current = false
    speechStartAtRef.current = null
    lastLoudAtRef.current = null
    loudChunksRef.current = 0
    vadFloorRef.current = []
    vadThresholdRef.current = null
    const runId = ++runIdSeqRef.current
    currentRunIdRef.current = runId
    const phrase = PHRASES[phraseIndex]
    setResults((prev) => [...prev, emptyRun(runId, phrase, scenario)])
    say(`▶ ${SCENARIOS.find((s) => s.id === scenario)?.label}`)

    // L'ordre est le sujet du test : SR d'abord reste dans le geste utilisateur,
    // getUserMedia d'abord impose un await avant tout appel à SR.
    if (scenario === 'mic') {
      await startMic()
    } else if (scenario === 'speech') {
      startSpeech()
    } else if (scenario === 'speech-then-mic') {
      startSpeech()
      await startMic()
    } else if (scenario === 'mic-then-speech') {
      const micOk = await startMic()
      if (micOk) startSpeech()
    } else {
      // P3-A : la session Live d'abord (jeton + WebSocket = un aller-retour
      // réseau), le micro ensuite. Ouvrir le micro avant reviendrait à
      // enregistrer du silence pendant l'établissement de la connexion — et,
      // pire, à perdre les premiers mots si Vincent parle trop tôt.
      const liveOk = await startLive(runId)
      if (!liveOk) { setRunning(null); stopAll(); return }
      const micOk = await startMic({ pcm: (chunk) => onPcmChunk(runId, chunk) })
      if (!micOk) { setRunning(null); stopAll(); return }
      say('Prêt — énoncez la phrase.')
    }
  }

  function finish() {
    say('■ arrêt manuel')
    if (running === 'live') {
      finalizeLive(currentRunIdRef.current, 'arrêt manuel')
      return // `finalizeLive` arrête déjà la capture et rend la main.
    }
    stopAll()
    setRunning(null)
  }

  const levelPct = Math.min(100, Math.round((level / 0.28) * 100))

  return (
    <div className="space-y-4 pb-10">
      <div>
        <h1 className="text-lg font-semibold">Spike vocal — lot 0 / P3-A</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Page temporaire. Scénarios 1-4 : micro et reconnaissance vocale
          peuvent-ils coexister ? (tranché, piste close). Scénario 5 : Gemini
          Live tient-il &lt; 1 s après la fin de parole sans perdre PETRO ATITI ?
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background p-3">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium text-muted-foreground">
            Phrase {phraseIndex + 1}/{PHRASES.length} — corpus P2-C
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPhraseIndex((i) => (i - 1 + PHRASES.length) % PHRASES.length)}
              disabled={running !== null}
              className="rounded-md border border-border px-2 py-1 text-[12px] disabled:opacity-40"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => setPhraseIndex((i) => (i + 1) % PHRASES.length)}
              disabled={running !== null}
              className="rounded-md border border-border px-2 py-1 text-[12px] disabled:opacity-40"
            >
              →
            </button>
          </div>
        </div>
        <p className="mt-1 text-[14px] leading-snug">« {PHRASES[phraseIndex]} »</p>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Répétez la même phrase plusieurs fois pour tester la stabilité — chaque
          essai s&apos;ajoute au journal de résultats ci-dessous.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => void run(s.id)}
            disabled={running !== null}
            className="rounded-xl border border-border bg-background px-3 py-3 text-left disabled:opacity-40"
          >
            <span className="block text-[13px] font-medium">{s.label}</span>
            <span className="block text-[11px] text-muted-foreground">{s.hint}</span>
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={sendToApi}
          onChange={(e) => setSendApi(e.target.checked)}
          className="h-4 w-4"
        />
        Transcrire aussi côté backend (comparaison de qualité)
      </label>

      {running && (
        <button
          type="button"
          onClick={finish}
          className="w-full rounded-xl bg-violet-500 px-4 py-3 text-[15px] font-medium text-white"
        >
          Terminer
        </button>
      )}

      {/* Niveau audio — prouve que l'AnalyserNode reçoit encore du signal quand
          la reconnaissance tourne aussi. Une barre morte = micro confisqué. */}
      <div className="rounded-xl border border-border bg-background p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-muted-foreground">Niveau audio</span>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            RMS {level.toFixed(4)} · pic {peak.toFixed(4)}
            {noiseFloor !== null && ` · bruit ${noiseFloor.toFixed(4)}`}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-violet-500 transition-[width] duration-75" style={{ width: `${levelPct}%` }} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-3">
        <p className="text-[12px] font-medium text-muted-foreground">Transcription live (Web Speech)</p>
        <p className="mt-1 min-h-[2.5rem] text-[14px] leading-snug">
          <span>{srFinal}</span>
          <span className="text-muted-foreground">{interim}</span>
          {!srFinal && !interim && <span className="text-muted-foreground">—</span>}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background p-3">
        <p className="text-[12px] font-medium text-muted-foreground">
          Transcription Gemini Live (P3-A · pendant la parole)
        </p>
        <p className="mt-1 min-h-[2.5rem] text-[14px] leading-snug">{liveText || '—'}</p>
      </div>

      <div className="rounded-xl border border-border bg-background p-3">
        <p className="text-[12px] font-medium text-muted-foreground">Transcription backend (source de vérité)</p>
        <p className="mt-1 min-h-[2.5rem] text-[14px] leading-snug">{backend ?? '—'}</p>
        {blobInfo && <p className="mt-1 text-[11px] text-muted-foreground">Audio : {blobInfo}</p>}
      </div>

      <div className="rounded-xl border border-border bg-background p-3">
        <p className="text-[12px] font-medium text-muted-foreground">Journal</p>
        <div className="mt-1 space-y-0.5">
          {log.length === 0 && <p className="text-[12px] text-muted-foreground">—</p>}
          {log.map((l, i) => (
            <p
              key={i}
              className={`text-[11.5px] leading-snug ${l.bad ? 'font-medium text-rose-600' : 'text-muted-foreground'}`}
            >
              <span className="tabular-nums">{String(l.t).padStart(5, ' ')} ms</span> · {l.msg}
            </p>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-3">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium text-muted-foreground">
            Résultats P2-C — {results.length} essai{results.length > 1 ? 's' : ''}
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(resultsToText(results))
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              disabled={results.length === 0}
              className="rounded-md border border-border px-2 py-1 text-[12px] disabled:opacity-40"
            >
              {copied ? 'Copié' : 'Copier'}
            </button>
            <button
              type="button"
              onClick={() => setResults([])}
              disabled={results.length === 0 || running !== null}
              className="rounded-md border border-border px-2 py-1 text-[12px] disabled:opacity-40"
            >
              Vider
            </button>
          </div>
        </div>
        <div className="mt-1 space-y-2">
          {results.length === 0 && <p className="text-[12px] text-muted-foreground">—</p>}
          {results.map((r, i) => {
            const delta = r.srLatencyMs != null && r.backendLatencyMs != null ? r.backendLatencyMs - r.srLatencyMs : null
            const gain = r.liveFinalMs != null && r.backendLatencyMs != null ? r.backendLatencyMs - r.liveFinalMs : null
            return (
              <div key={r.id} className="border-t border-border pt-1.5 first:border-t-0 first:pt-0">
                <p className="text-[11.5px] font-medium">#{i + 1} · {r.scenario} · « {r.phrase} »</p>
                {r.scenario === 'live' ? (
                  <>
                    <p className="text-[11.5px] text-muted-foreground">
                      live{' '}
                      <span className={r.liveFinalMs != null && r.liveFinalMs > 1000 ? 'font-medium text-rose-600' : ''}>
                        {r.liveFinalMs != null ? `${r.liveFinalMs} ms` : '—'}
                      </span>
                      {r.liveFirstPartialMs != null && ` · 1er partiel +${r.liveFirstPartialMs} ms`}
                      {' · batch '}
                      {r.backendLatencyMs != null ? `${r.backendLatencyMs} ms` : '—'}
                      {gain != null && ` · gain ${gain > 0 ? '+' : ''}${gain} ms`}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground">live : {r.liveText ?? '—'}</p>
                    <p className="text-[11.5px] text-muted-foreground">batch : {r.backendText ?? '—'}</p>
                  </>
                ) : (
                  <>
                    <p className="text-[11.5px] text-muted-foreground">
                      SR {r.srLatencyMs != null ? `${r.srLatencyMs} ms` : '—'} · back{' '}
                      {r.backendLatencyMs != null ? `${r.backendLatencyMs} ms` : '—'}
                      {delta != null && ` · delta ${delta > 0 ? '+' : ''}${delta} ms`}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground">SR : {r.srText ?? '—'}</p>
                    <p className="text-[11.5px] text-muted-foreground">back : {r.backendText ?? '—'}</p>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-3">
        <p className="text-[12px] font-medium text-muted-foreground">Environnement</p>
        {env.map((e, i) => (
          <p key={i} className="mt-0.5 break-words text-[11.5px] leading-snug text-muted-foreground">{e}</p>
        ))}
      </div>
    </div>
  )
}
