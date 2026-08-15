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

import { useCallback, useEffect, useRef, useState } from 'react'

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

type Scenario = 'mic' | 'speech' | 'speech-then-mic' | 'mic-then-speech'

const SCENARIOS: Array<{ id: Scenario; label: string; hint: string }> = [
  { id: 'mic',             label: '1 · Micro seul',              hint: 'MediaRecorder + AnalyserNode' },
  { id: 'speech',          label: '2 · Reconnaissance seule',    hint: 'webkitSpeechRecognition' },
  { id: 'speech-then-mic', label: '3 · Reconnaissance → micro',  hint: 'SR démarrée en premier' },
  { id: 'mic-then-speech', label: '4 · Micro → reconnaissance',  hint: 'ordre de notre code actuel' },
]

const PHRASE_TEST =
  'Quels sont les prochains points de contrôle sur le chantier PETRO ATITI ?'

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

  const t0Ref       = useRef(0)
  const srRef       = useRef<SRInstance | null>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const ctxRef      = useRef<AudioContext | null>(null)
  const recRef      = useRef<MediaRecorder | null>(null)
  const rafRef      = useRef<number | null>(null)
  const peakRef     = useRef(0)
  const samplesRef  = useRef<number[]>([])

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
    rec.onspeechend  = () => say('SR onspeechend — silence détecté par le moteur')
    rec.onend        = () => say('SR onend')
    rec.onerror      = (e) => say(`SR onerror : ${e.error}${e.message ? ` — ${e.message}` : ''}`, true)

    rec.onresult = (e) => {
      let fin = ''
      let inter = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) fin += r[0].transcript
        else inter += r[0].transcript
      }
      if (fin) setSrFinal(fin)
      setInterim(inter)
      if (inter && !fin) say(`SR interim (${inter.length} car.)`)
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

  async function startMic(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      say(`getUserMedia OK — ${stream.getAudioTracks().length} piste(s)`)

      const track = stream.getAudioTracks()[0]
      say(`piste : ${track.label || 'sans label'} · état ${track.readyState}`)
      track.onended = () => say('piste micro TERMINÉE par le système', true)
      track.onmute  = () => say('piste micro MUTE — conflit probable', true)

      const ctx = new AudioContext()
      ctxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.85
      ctx.createMediaStreamSource(stream).connect(analyser)

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
        if (sendToApi && blob.size > 0) void sendBackend(blob, rec.mimeType)
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

  async function sendBackend(blob: Blob, mimeType: string) {
    const started = Date.now()
    say('POST /api/copilot/transcribe…')
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
      const form = new FormData()
      form.append('audio', blob, `spike.${ext}`)
      const res = await fetch('/api/copilot/transcribe', { method: 'POST', body: form })
      const data = await res.json() as { text?: string; model?: string; error?: string }
      if (!res.ok) { say(`backend ${res.status} : ${data.error ?? '—'}`, true); return }
      setBackend(data.text?.trim() || '(vide)')
      say(`backend OK en ${Date.now() - started} ms · ${data.model ?? 'modèle inconnu'}`)
    } catch (err) {
      say(`backend a échoué : ${(err as Error).message}`, true)
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
    } else {
      const micOk = await startMic()
      if (micOk) startSpeech()
    }
  }

  function finish() {
    say('■ arrêt manuel')
    stopAll()
    setRunning(null)
  }

  const levelPct = Math.min(100, Math.round((level / 0.28) * 100))

  return (
    <div className="space-y-4 pb-10">
      <div>
        <h1 className="text-lg font-semibold">Spike vocal — lot 0</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Page temporaire. Objectif : micro et reconnaissance vocale peuvent-ils
          coexister sur ce téléphone ?
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background p-3">
        <p className="text-[12px] font-medium text-muted-foreground">Phrase à dire, identique à chaque test</p>
        <p className="mt-1 text-[14px] leading-snug">« {PHRASE_TEST} »</p>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Marquez une pause d&apos;environ une seconde après « contrôle » — c&apos;est la
          micro-pause qui ne doit pas couper l&apos;enregistrement.
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
        <p className="text-[12px] font-medium text-muted-foreground">Environnement</p>
        {env.map((e, i) => (
          <p key={i} className="mt-0.5 break-words text-[11.5px] leading-snug text-muted-foreground">{e}</p>
        ))}
      </div>
    </div>
  )
}
